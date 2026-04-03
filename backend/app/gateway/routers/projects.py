"""Projects API router for managing multi-agent collaboration projects."""

import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from deerflow.collab.storage import get_project_storage

router = APIRouter(prefix="/api/projects", tags=["projects"])


class CreateProjectRequest(BaseModel):
    """Request model for creating a project."""

    name: str = Field(default="", description="Project name")
    description: str = Field(default="", description="Project description")


class UpdateProjectRequest(BaseModel):
    """Request model for updating a project."""

    name: str | None = Field(default=None, description="Project name")
    description: str | None = Field(default=None, description="Project description")
    status: str | None = Field(default=None, description="Project status")


class AddTaskRequest(BaseModel):
    """Request model for adding a task to a project."""

    name: str = Field(default="", description="Task name")
    description: str = Field(default="", description="Task description")
    dependencies: list[str] = Field(default_factory=list, description="List of task IDs this task depends on")


class UpdateTaskRequest(BaseModel):
    """Request model for updating a task."""

    name: str | None = Field(default=None, description="Task name")
    description: str | None = Field(default=None, description="Task description")
    status: str | None = Field(default=None, description="Task status")
    assigned_to: str | None = Field(default=None, description="Assigned agent ID")
    progress: int | None = Field(default=None, description="Progress 0-100")


@router.get("", summary="List Projects", description="Get a list of all projects.")
async def list_projects() -> list[dict]:
    """List all projects."""
    storage = get_project_storage()
    return storage.list_projects()


@router.get("/{project_id}", summary="Get Project", description="Get a project by ID.")
async def get_project(project_id: str) -> dict:
    """Get a project by ID."""
    storage = get_project_storage()
    project = storage.load_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    return project


@router.post("", summary="Create Project", description="Create a new project.")
async def create_project(request: CreateProjectRequest) -> dict:
    """Create a new project."""
    storage = get_project_storage()

    now = datetime.utcnow().isoformat() + "Z"
    project = {
        "id": str(uuid.uuid4())[:8],
        "name": request.name,
        "description": request.description,
        "tasks": [],
        "status": "pending",
        "supervisor_session_id": None,
        "created_at": now,
        "updated_at": now,
    }

    if storage.save_project(project):
        return project
    raise HTTPException(status_code=500, detail="Failed to create project")


@router.put("/{project_id}", summary="Update Project", description="Update a project.")
async def update_project(project_id: str, request: UpdateProjectRequest) -> dict:
    """Update a project."""
    storage = get_project_storage()
    project = storage.load_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")

    if request.name is not None:
        project["name"] = request.name
    if request.description is not None:
        project["description"] = request.description
    if request.status is not None:
        project["status"] = request.status

    if storage.save_project(project):
        return project
    raise HTTPException(status_code=500, detail="Failed to update project")


@router.delete("/{project_id}", summary="Delete Project", description="Delete a project.")
async def delete_project(project_id: str) -> dict:
    """Delete a project."""
    storage = get_project_storage()
    if not storage.delete_project(project_id):
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    return {"success": True, "message": f"Project '{project_id}' deleted"}


@router.post("/{project_id}/tasks", summary="Add Task", description="Add a task to a project.")
async def add_task(project_id: str, request: AddTaskRequest) -> dict:
    """Add a task to a project."""
    storage = get_project_storage()
    project = storage.load_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")

    now = datetime.utcnow().isoformat() + "Z"
    task = {
        "id": str(uuid.uuid4())[:8],
        "name": request.name,
        "description": request.description,
        "status": "pending",
        "parent_id": None,
        "dependencies": request.dependencies,
        "assigned_to": None,
        "result": None,
        "error": None,
        "created_at": now,
        "started_at": None,
        "completed_at": None,
        "progress": 0,
        "execution_authorized": False,
        "thread_id": None,
        "authorized_at": None,
        "authorized_by": None,
    }

    project.setdefault("tasks", []).append(task)

    if storage.save_project(project):
        return task
    raise HTTPException(status_code=500, detail="Failed to add task")


@router.get("/{project_id}/tasks", summary="List Tasks", description="List all tasks in a project.")
async def list_tasks(project_id: str) -> list[dict]:
    """List all tasks in a project."""
    storage = get_project_storage()
    project = storage.load_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    return project.get("tasks", [])


@router.get("/{project_id}/tasks/{task_id}", summary="Get Task", description="Get a task by ID.")
async def get_task(project_id: str, task_id: str) -> dict:
    """Get a task by ID."""
    storage = get_project_storage()
    project = storage.load_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")

    for task in project.get("tasks", []):
        if task.get("id") == task_id:
            return task

    raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found in project '{project_id}'")


@router.put("/{project_id}/tasks/{task_id}", summary="Update Task", description="Update a task.")
async def update_task(project_id: str, task_id: str, request: UpdateTaskRequest) -> dict:
    """Update a task."""
    storage = get_project_storage()
    project = storage.load_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")

    task = None
    task_index = None
    for i, t in enumerate(project.get("tasks", [])):
        if t.get("id") == task_id:
            task = t
            task_index = i
            break

    if task is None:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found in project '{project_id}'")

    if request.name is not None:
        task["name"] = request.name
    if request.description is not None:
        task["description"] = request.description
    if request.status is not None:
        task["status"] = request.status
        if request.status == "executing" and not task.get("started_at"):
            task["started_at"] = datetime.utcnow().isoformat() + "Z"
        elif request.status in ("completed", "failed", "cancelled") and not task.get("completed_at"):
            task["completed_at"] = datetime.utcnow().isoformat() + "Z"
    if request.assigned_to is not None:
        task["assigned_to"] = request.assigned_to
    if request.progress is not None:
        task["progress"] = request.progress

    project["tasks"][task_index] = task

    if storage.save_project(project):
        return task
    raise HTTPException(status_code=500, detail="Failed to update task")


@router.delete("/{project_id}/tasks/{task_id}", summary="Delete Task", description="Delete a task.")
async def delete_task(project_id: str, task_id: str) -> dict:
    """Delete a task."""
    storage = get_project_storage()
    project = storage.load_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")

    tasks = project.get("tasks", [])
    task_index = None
    for i, t in enumerate(tasks):
        if t.get("id") == task_id:
            task_index = i
            break

    if task_index is None:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found in project '{project_id}'")

    del project["tasks"][task_index]

    for task in project.get("tasks", []):
        if task_id in task.get("dependencies", []):
            task["dependencies"].remove(task_id)

    if storage.save_project(project):
        return {"success": True, "message": f"Task '{task_id}' deleted"}
    raise HTTPException(status_code=500, detail="Failed to delete task")
