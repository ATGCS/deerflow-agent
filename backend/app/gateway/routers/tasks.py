"""Tasks API router for multi-agent collaboration - task-centric model."""

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, Field

from deerflow.collab.authorize_execution import authorize_main_task_execution
from deerflow.collab.models import WorkerProfile
from deerflow.collab.storage import (
    get_project_storage,
    get_task_memory_storage,
    new_project_bundle_root_task,
)
from deerflow.collab.thread_collab import advance_collab_phase_to_executing_for_task
from deerflow.config.paths import get_paths
from app.gateway.routers.events import emit_task_completed, emit_task_progress

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _reconcile_main_task_status(task: dict) -> bool:
    """Normalize main task status/progress from subtask states."""
    subtasks = task.get("subtasks") or []
    if not subtasks:
        return False

    changed = False
    if all((st.get("status") == "completed") for st in subtasks):
        if task.get("status") != "completed":
            task["status"] = "completed"
            changed = True
        if task.get("progress") != 100:
            task["progress"] = 100
            changed = True
        if not task.get("completed_at"):
            task["completed_at"] = datetime.utcnow().isoformat() + "Z"
            changed = True
    return changed


class CreateTaskRequest(BaseModel):
    name: str = Field(default="", description="Task name")
    description: str = Field(default="", description="Task description")
    thread_id: str | None = Field(default=None, description="Bind LangGraph thread to this task")


class UpdateTaskRequest(BaseModel):
    name: str | None = Field(default=None, description="Task name")
    description: str | None = Field(default=None, description="Task description")
    status: str | None = Field(default=None, description="Task status")
    progress: int | None = Field(default=None, description="Progress 0-100")


class AddSubtaskRequest(BaseModel):
    name: str = Field(default="", description="Subtask name")
    description: str = Field(default="", description="Subtask description")
    dependencies: list[str] = Field(default_factory=list, description="List of subtask IDs this depends on")
    worker_profile: WorkerProfile | None = Field(
        default=None,
        description="Optional worker constraints (§5.2: base_subagent, tools, skills, instruction, depends_on)",
    )


class UpdateSubtaskRequest(BaseModel):
    name: str | None = Field(default=None, description="Subtask name")
    description: str | None = Field(default=None, description="Subtask description")
    status: str | None = Field(default=None, description="Subtask status")
    assigned_to: str | None = Field(default=None, description="Assigned agent ID")
    progress: int | None = Field(default=None, description="Progress 0-100")


class AssignSubtaskRequest(BaseModel):
    agent_id: str = Field(default="", description="Agent ID to assign")


class AuthorizeExecutionRequest(BaseModel):
    authorized_by: str = Field(default="user", description="user | lead | system")
    thread_id: str | None = Field(
        default=None,
        description="Current LangGraph thread id: collab_state is written here when it differs from the task's bound thread_id",
    )


@router.get("", summary="List All Tasks", description="Get a list of all tasks.")
async def list_tasks() -> list[dict]:
    """List all tasks (flattened from all projects)."""
    try:
        storage = get_project_storage()
        projects = storage.list_projects()

        all_tasks = []
        for project_summary in projects:
            project = storage.load_project(project_summary["id"])
            if project:
                for task in project.get("tasks", []):
                    task_data = task.copy()
                    task_data["parent_project_id"] = project["id"]
                    task_data["project_name"] = project.get("name", "")
                    all_tasks.append(task_data)

        all_tasks.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return all_tasks
    except Exception:
        # UI dashboard should not hard-fail due to storage issues.
        logger.exception("list_tasks failed; returning empty list.")
        return []


@router.get("/{task_id}", summary="Get Task", description="Get a task by ID.")
async def get_task(task_id: str) -> dict:
    """Get a task with its subtasks."""
    storage = get_project_storage()
    projects = storage.list_projects()

    for project_summary in projects:
        project = storage.load_project(project_summary["id"])
        if project:
            for i, task in enumerate(project.get("tasks", [])):
                if task.get("id") == task_id:
                    if _reconcile_main_task_status(task):
                        project["tasks"][i] = task
                        storage.save_project(project)
                    task_data = task.copy()
                    task_data["parent_project_id"] = project["id"]
                    task_data["project_name"] = project.get("name", "")
                    return task_data

    raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")


@router.post("", summary="Create Task", description="Create a new task.")
async def create_task(request: CreateTaskRequest) -> dict:
    """Create a new task (same bundle shape as supervisor create_task)."""
    storage = get_project_storage()
    project_data, task = new_project_bundle_root_task(
        request.name,
        request.description,
        thread_id=request.thread_id,
    )

    if storage.save_project(project_data):
        out = task.copy()
        out["parent_project_id"] = project_data["id"]
        out["project_name"] = project_data["name"]
        return out
    raise HTTPException(status_code=500, detail="Failed to create task")


@router.post(
    "/{task_id}/authorize-execution",
    summary="Authorize task execution",
    description="Gate §5.3: set execution_authorized=true when task is in planned or planning status.",
)
async def authorize_task_execution(
    task_id: str,
    request: AuthorizeExecutionRequest | None = Body(default=None),
) -> dict:
    """Allow task tool / workers to run after plan review."""
    storage = get_project_storage()
    body = request if request is not None else AuthorizeExecutionRequest()
    ok, msg = authorize_main_task_execution(storage, task_id, body.authorized_by)
    if not ok:
        if "not found" in msg.lower():
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=400, detail=msg)

    try:
        advance_collab_phase_to_executing_for_task(
            get_paths(), task_id, runtime_thread_id=body.thread_id
        )
    except Exception:
        logger.exception("authorize-execution: advance_collab_phase_to_executing_for_task failed task_id=%s", task_id)

    for project_summary in storage.list_projects():
        project = storage.load_project(project_summary["id"])
        if not project:
            continue
        for task in project.get("tasks", []):
            if task.get("id") == task_id:
                return {
                    "success": True,
                    "task_id": task_id,
                    "message": msg,
                    "execution_authorized": True,
                    "authorized_at": task.get("authorized_at"),
                    "authorized_by": task.get("authorized_by"),
                }
    raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")


@router.put("/{task_id}", summary="Update Task", description="Update a task.")
async def update_task(task_id: str, request: UpdateTaskRequest) -> dict:
    """Update a task."""
    storage = get_project_storage()
    projects = storage.list_projects()

    for project_summary in projects:
        project = storage.load_project(project_summary["id"])
        if project:
            for i, task in enumerate(project.get("tasks", [])):
                if task.get("id") == task_id:
                    if request.name is not None:
                        task["name"] = request.name
                    if request.description is not None:
                        task["description"] = request.description
                    if request.status is not None:
                        task["status"] = request.status
                        if request.status == "executing" and not task.get("started_at"):
                            task["started_at"] = datetime.utcnow().isoformat() + "Z"
                        elif request.status in ("completed", "failed") and not task.get("completed_at"):
                            task["completed_at"] = datetime.utcnow().isoformat() + "Z"
                    if request.progress is not None:
                        task["progress"] = request.progress

                    project["tasks"][i] = task
                    if storage.save_project(project):
                        if request.progress is not None:
                            await emit_task_progress(project["id"], task_id, task.get("progress", 0), "")
                        if request.status == "completed":
                            await emit_task_completed(project["id"], task_id, task.get("result"))
                        return task
                    raise HTTPException(status_code=500, detail="Failed to update task")

    raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")


@router.delete("/{task_id}", summary="Delete Task", description="Delete a task.")
async def delete_task(task_id: str) -> dict:
    """Delete a task and its project."""
    storage = get_project_storage()
    projects = storage.list_projects()

    for project_summary in projects:
        project = storage.load_project(project_summary["id"])
        if project:
            for i, task in enumerate(project.get("tasks", [])):
                if task.get("id") == task_id:
                    project["tasks"].pop(i)
                    if len(project["tasks"]) == 0:
                        storage.delete_project(project["id"])
                    else:
                        storage.save_project(project)
                    return {"success": True, "message": f"Task '{task_id}' deleted"}

    raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")


@router.post("/{task_id}/start", summary="Start Task Planning", description="Start task planning and execution.")
async def start_task(task_id: str) -> dict:
    """Start task planning (Supervisor will analyze and create subtasks)."""
    storage = get_project_storage()
    projects = storage.list_projects()

    for project_summary in projects:
        project = storage.load_project(project_summary["id"])
        if project:
            for i, task in enumerate(project.get("tasks", [])):
                if task.get("id") == task_id:
                    task["status"] = "planning"
                    project["status"] = "planning"
                    project["tasks"][i] = task
                    if storage.save_project(project):
                        return {"success": True, "message": "Task started planning", "task_id": task_id}
                    raise HTTPException(status_code=500, detail="Failed to start task")

    raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")


@router.post("/{task_id}/stop", summary="Stop Task Execution", description="Stop a running task.")
async def stop_task(task_id: str) -> dict:
    """Stop task execution."""
    storage = get_project_storage()
    projects = storage.list_projects()

    for project_summary in projects:
        project = storage.load_project(project_summary["id"])
        if project:
            for i, task in enumerate(project.get("tasks", [])):
                if task.get("id") == task_id:
                    task["status"] = "paused"
                    project["status"] = "paused"
                    project["tasks"][i] = task
                    if storage.save_project(project):
                        return {"success": True, "message": "Task stopped", "task_id": task_id}
                    raise HTTPException(status_code=500, detail="Failed to stop task")

    raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")


@router.get("/{task_id}/subtasks", summary="List Subtasks", description="List all subtasks of a task.")
async def list_subtasks(task_id: str) -> list[dict]:
    """List all subtasks of a task."""
    task = await get_task(task_id)
    return task.get("subtasks", [])


@router.post("/{task_id}/subtasks", summary="Add Subtask", description="Add a subtask to a task.")
async def add_subtask(task_id: str, request: AddSubtaskRequest) -> dict:
    """Add a subtask to a task."""
    storage = get_project_storage()
    projects = storage.list_projects()

    for project_summary in projects:
        project = storage.load_project(project_summary["id"])
        if project:
            for i, task in enumerate(project.get("tasks", [])):
                if task.get("id") == task_id:
                    now = datetime.utcnow().isoformat() + "Z"
                    subtask = {
                        "id": str(uuid.uuid4())[:8],
                        "name": request.name,
                        "description": request.description,
                        "status": "pending",
                        "dependencies": request.dependencies,
                        "assigned_to": None,
                        "result": None,
                        "error": None,
                        "created_at": now,
                        "started_at": None,
                        "completed_at": None,
                        "progress": 0,
                    }
                    if request.worker_profile is not None:
                        wp = request.worker_profile.to_storage_dict()
                        if wp:
                            subtask["worker_profile"] = wp

                    task.setdefault("subtasks", []).append(subtask)
                    project["tasks"][i] = task
                    if storage.save_project(project):
                        return subtask
                    raise HTTPException(status_code=500, detail="Failed to add subtask")

    raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")


@router.get("/{task_id}/subtasks/{subtask_id}", summary="Get Subtask", description="Get a subtask by ID.")
async def get_subtask(task_id: str, subtask_id: str) -> dict:
    """Get a subtask by ID."""
    task = await get_task(task_id)
    for subtask in task.get("subtasks", []):
        if subtask.get("id") == subtask_id:
            return subtask
    raise HTTPException(status_code=404, detail=f"Subtask '{subtask_id}' not found in task '{task_id}'")


@router.put("/{task_id}/subtasks/{subtask_id}", summary="Update Subtask", description="Update a subtask.")
async def update_subtask(task_id: str, subtask_id: str, request: UpdateSubtaskRequest) -> dict:
    """Update a subtask."""
    storage = get_project_storage()
    projects = storage.list_projects()

    for project_summary in projects:
        project = storage.load_project(project_summary["id"])
        if project:
            for i, task in enumerate(project.get("tasks", [])):
                if task.get("id") == task_id:
                    for j, subtask in enumerate(task.get("subtasks", [])):
                        if subtask.get("id") == subtask_id:
                            if request.name is not None:
                                subtask["name"] = request.name
                            if request.description is not None:
                                subtask["description"] = request.description
                            if request.status is not None:
                                subtask["status"] = request.status
                                if request.status == "executing" and not subtask.get("started_at"):
                                    subtask["started_at"] = datetime.utcnow().isoformat() + "Z"
                                elif request.status in ("completed", "failed") and not subtask.get("completed_at"):
                                    subtask["completed_at"] = datetime.utcnow().isoformat() + "Z"
                            if request.assigned_to is not None:
                                subtask["assigned_to"] = request.assigned_to
                            if request.progress is not None:
                                subtask["progress"] = request.progress

                            task["subtasks"][j] = subtask
                            _reconcile_main_task_status(task)
                            project["tasks"][i] = task
                            if storage.save_project(project):
                                if request.progress is not None:
                                    await emit_task_progress(
                                        project["id"],
                                        subtask_id,
                                        subtask.get("progress", 0),
                                        "",
                                    )
                                if request.status == "completed":
                                    await emit_task_completed(project["id"], subtask_id, subtask.get("result"))
                                if task.get("status") == "completed":
                                    await emit_task_completed(project["id"], task_id, task.get("result"))
                                return subtask
                            raise HTTPException(status_code=500, detail="Failed to update subtask")

    raise HTTPException(status_code=404, detail=f"Subtask '{subtask_id}' not found")


@router.delete("/{task_id}/subtasks/{subtask_id}", summary="Delete Subtask", description="Delete a subtask.")
async def delete_subtask(task_id: str, subtask_id: str) -> dict:
    """Delete a subtask."""
    storage = get_project_storage()
    projects = storage.list_projects()

    for project_summary in projects:
        project = storage.load_project(project_summary["id"])
        if project:
            for i, task in enumerate(project.get("tasks", [])):
                if task.get("id") == task_id:
                    subtasks = task.get("subtasks", [])
                    for j, subtask in enumerate(subtasks):
                        if subtask.get("id") == subtask_id:
                            task["subtasks"].pop(j)
                            project["tasks"][i] = task
                            if storage.save_project(project):
                                return {"success": True, "message": f"Subtask '{subtask_id}' deleted"}
                            raise HTTPException(status_code=500, detail="Failed to delete subtask")

    raise HTTPException(status_code=404, detail=f"Subtask '{subtask_id}' not found")


@router.post("/{task_id}/subtasks/{subtask_id}/assign", summary="Assign Subtask", description="Assign a subtask to an agent.")
async def assign_subtask(task_id: str, subtask_id: str, request: AssignSubtaskRequest) -> dict:
    """Assign a subtask to an agent."""
    storage = get_project_storage()
    projects = storage.list_projects()

    for project_summary in projects:
        project = storage.load_project(project_summary["id"])
        if project:
            for i, task in enumerate(project.get("tasks", [])):
                if task.get("id") == task_id:
                    for j, subtask in enumerate(task.get("subtasks", [])):
                        if subtask.get("id") == subtask_id:
                            subtask["assigned_to"] = request.agent_id
                            if subtask["status"] == "pending":
                                subtask["status"] = "pending"

                            task["subtasks"][j] = subtask
                            project["tasks"][i] = task
                            if storage.save_project(project):
                                return {"success": True, "message": f"Subtask assigned to {request.agent_id}"}
                            raise HTTPException(status_code=500, detail="Failed to assign subtask")

    raise HTTPException(status_code=404, detail=f"Subtask '{subtask_id}' not found")
