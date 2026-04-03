"""Task Memory API router for managing agent task memory and facts."""

from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from deerflow.collab.storage import (
    get_agent_runtime_storage,
    get_project_storage,
    get_task_memory_storage,
)

from app.gateway.routers.events import emit_task_memory_updated, emit_task_progress

router = APIRouter(prefix="/api/task-memory", tags=["task-memory"])

UNASSIGNED_AGENT_ID = "__unassigned__"


def _aggregate_main_task_memory(project: dict, task: dict, memory_storage) -> dict:
    """Build/refresh main-task memory snapshot from subtask memories."""
    task_id = task.get("id") or ""
    project_id = project.get("id") or ""
    agent_id = task.get("assigned_to") or UNASSIGNED_AGENT_ID
    memory = memory_storage.load_task_memory(project_id, agent_id, task_id)

    facts = []
    summary_parts = []
    seen = set()
    subtasks = task.get("subtasks") or []
    for st in subtasks:
        st_id = st.get("id")
        if not st_id:
            continue
        st_agent = st.get("assigned_to") or task.get("assigned_to") or UNASSIGNED_AGENT_ID
        st_mem = memory_storage.load_task_memory(project_id, st_agent, st_id)
        for fact in st_mem.get("facts", []) or []:
            fid = fact.get("id") or f"{st_id}:{fact.get('content', '')[:64]}"
            if fid in seen:
                continue
            seen.add(fid)
            facts.append({**fact, "task_id": st_id})
        out = (st_mem.get("output_summary") or "").strip()
        if out:
            summary_parts.append(f"[{st_id}] {out}")

    progress_values = [int(st.get("progress") or 0) for st in subtasks]
    avg_progress = int(sum(progress_values) / len(progress_values)) if progress_values else 0
    if subtasks and all((st.get("status") == "completed") for st in subtasks):
        status = "completed"
        progress = 100
        current_step = "All subtasks completed"
    elif any((st.get("progress") or 0) > 0 for st in subtasks):
        status = "executing"
        progress = avg_progress
        current_step = "Subtasks in progress"
    else:
        status = memory.get("status") or "pending"
        progress = memory.get("progress") or 0
        current_step = memory.get("current_step") or ""

    memory["task_id"] = task_id
    memory["project_id"] = project_id
    memory["agent_id"] = agent_id
    memory["status"] = status
    memory["progress"] = progress
    memory["current_step"] = current_step
    memory["facts"] = facts
    if summary_parts:
        memory["output_summary"] = "\n".join(summary_parts)[:8000]
    memory.setdefault("created_at", datetime.utcnow().isoformat() + "Z")
    if status == "completed":
        memory["completed_at"] = memory.get("completed_at") or datetime.utcnow().isoformat() + "Z"
    memory_storage.save_task_memory(memory)
    return memory


class TaskMemoryResponse(BaseModel):
    """Response model for task memory."""

    task_id: str
    agent_id: str
    project_id: str
    status: str
    facts: list[dict]
    output_summary: str
    current_step: str
    progress: int
    created_at: str
    updated_at: str
    completed_at: str | None = None
    parent_task_id: str | None = Field(default=None, description="Set when task_id is a subtask in subtasks[]")
    is_subtask: bool = Field(default=False, description="True when resolving a subtask id")


class AddFactRequest(BaseModel):
    """Request model for adding a fact."""

    content: str = Field(default="", description="Fact content")
    category: str = Field(default="finding", description="Fact category")
    confidence: float = Field(default=0.5, description="Confidence score (0-1)")
    source_message: str | None = Field(default=None, description="Source message ID")


class UpdateProgressRequest(BaseModel):
    """Request model for updating task progress."""

    progress: int = Field(default=0, description="Progress 0-100")
    current_step: str = Field(default="", description="Current step description")


class AgentMemoryResponse(BaseModel):
    """Response model for agent memory."""

    agent_id: str
    agent_name: str
    project_id: str
    tasks: list[dict]
    total_tasks: int
    completed_tasks: int


class ProjectFactsResponse(BaseModel):
    """Response model for project facts."""

    project_id: str
    facts: list[dict]
    total: int


class ProjectStatusResponse(BaseModel):
    """Response model for project runtime status."""

    project_id: str
    agents: list[dict]
    tasks: list[dict]


@router.get(
    "/tasks/{task_id}",
    response_model=TaskMemoryResponse,
    summary="Get Task Memory",
    description="Get memory for a main task id or a subtask id (matched in subtasks[]). Storage key: (project_id, agent_id, task_id).",
)
async def get_task_memory(task_id: str) -> TaskMemoryResponse:
    """Get task memory by main task ID or subtask ID."""
    projects_storage = get_project_storage()
    memory_storage = get_task_memory_storage()

    # NOTE:
    # Some main tasks may not have `assigned_to` yet (agent_id="").
    # For those cases we still want GET/PUT progress & facts to work
    # consistently by reading/writing under a stable sentinel agent_id.
    projects = projects_storage.list_projects()
    for project_summary in projects:
        project = projects_storage.load_project(project_summary["id"])
        if not project:
            continue

        for task in project.get("tasks", []):
            # Main task match
            if task.get("id") == task_id:
                agent_id = task.get("assigned_to") or UNASSIGNED_AGENT_ID
                memory = memory_storage.load_task_memory(project["id"], agent_id, task_id)
                if task.get("subtasks"):
                    memory = _aggregate_main_task_memory(project, task, memory_storage)
                return TaskMemoryResponse(
                    task_id=memory.get("task_id", task_id),
                    agent_id=memory.get("agent_id", agent_id),
                    project_id=memory.get("project_id", project["id"]),
                    status=memory.get("status", "unknown"),
                    facts=memory.get("facts", []),
                    output_summary=memory.get("output_summary", ""),
                    current_step=memory.get("current_step", ""),
                    progress=memory.get("progress", 0),
                    created_at=memory.get("created_at", ""),
                    updated_at=memory.get("updated_at", ""),
                    completed_at=memory.get("completed_at"),
                    parent_task_id=None,
                    is_subtask=False,
                )

            # Subtask match
            parent_main_task_id = task.get("id")
            for st in task.get("subtasks") or []:
                if st.get("id") != task_id:
                    continue
                agent_id = st.get("assigned_to") or task.get("assigned_to") or UNASSIGNED_AGENT_ID
                memory = memory_storage.load_task_memory(project["id"], agent_id, task_id)
                return TaskMemoryResponse(
                    task_id=memory.get("task_id", task_id),
                    agent_id=memory.get("agent_id", agent_id),
                    project_id=memory.get("project_id", project["id"]),
                    status=memory.get("status", "unknown"),
                    facts=memory.get("facts", []),
                    output_summary=memory.get("output_summary", ""),
                    current_step=memory.get("current_step", ""),
                    progress=memory.get("progress", 0),
                    created_at=memory.get("created_at", ""),
                    updated_at=memory.get("updated_at", ""),
                    completed_at=memory.get("completed_at"),
                    parent_task_id=parent_main_task_id,
                    is_subtask=True,
                )

    raise HTTPException(status_code=404, detail=f"Task memory for '{task_id}' not found")


@router.post("/tasks/{task_id}/facts", response_model=dict, summary="Add Task Fact", description="Add a fact to task memory.")
async def add_task_fact(task_id: str, request: AddFactRequest) -> dict:
    """Add a fact to task memory."""
    projects_storage = get_project_storage()
    memory_storage = get_task_memory_storage()
    projects = projects_storage.list_projects()

    for project_summary in projects:
        project = projects_storage.load_project(project_summary["id"])
        if project:
            for task in project.get("tasks", []):
                if task.get("id") == task_id:
                    agent_id = task.get("assigned_to") or UNASSIGNED_AGENT_ID
                    memory = memory_storage.load_task_memory(project["id"], agent_id, task_id)

                    fact = {
                        "id": f"fact_{datetime.utcnow().isoformat()}",
                        "content": request.content,
                        "category": request.category,
                        "confidence": request.confidence,
                        "source_message": request.source_message,
                    }

                    memory.setdefault("facts", []).append(fact)
                    memory_storage.save_task_memory(memory)

                    memory_storage.add_fact_to_project(project["id"], fact)

                    await emit_task_memory_updated(project["id"], task_id, len(memory.get("facts", [])))

                    return {"success": True, "fact": fact}

    raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")


@router.put("/tasks/{task_id}/progress", response_model=dict, summary="Update Task Progress", description="Update task progress and current step.")
async def update_task_progress(task_id: str, request: UpdateProgressRequest) -> dict:
    """Update task progress."""
    projects_storage = get_project_storage()
    memory_storage = get_task_memory_storage()
    projects = projects_storage.list_projects()

    for project_summary in projects:
        project = projects_storage.load_project(project_summary["id"])
        if project:
            for task in project.get("tasks", []):
                if task.get("id") == task_id:
                    agent_id = task.get("assigned_to") or UNASSIGNED_AGENT_ID
                    memory = memory_storage.load_task_memory(project["id"], agent_id, task_id)

                    memory["progress"] = request.progress
                    memory["current_step"] = request.current_step
                    memory["updated_at"] = datetime.utcnow().isoformat() + "Z"

                    memory_storage.save_task_memory(memory)

                    task["progress"] = request.progress
                    projects_storage.save_project(project)

                    await emit_task_progress(project["id"], task_id, request.progress, request.current_step)
                    await emit_task_memory_updated(project["id"], task_id, len(memory.get("facts", [])))

                    return {"success": True, "progress": request.progress, "current_step": request.current_step}

    raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")


@router.get("/agents/{agent_id}", response_model=list[AgentMemoryResponse], summary="Get Agent Memories", description="Get all task memories for an agent.")
async def get_agent_memories(agent_id: str) -> list[AgentMemoryResponse]:
    """Get all task memories for an agent."""
    projects_storage = get_project_storage()
    memory_storage = get_task_memory_storage()
    runtime_storage = get_agent_runtime_storage()
    projects = projects_storage.list_projects()

    result = []

    for project_summary in projects:
        project = projects_storage.load_project(project_summary["id"])
        if project:
            project_tasks = []
            completed_count = 0

            for task in project.get("tasks", []):
                if task.get("assigned_to") == agent_id:
                    memory = memory_storage.load_task_memory(project["id"], agent_id, task["id"])
                    project_tasks.append({
                        "task": task,
                        "memory": memory,
                    })
                    if task.get("status") == "completed":
                        completed_count += 1

            if project_tasks:
                agent_info = runtime_storage.get_agent(agent_id) or {}
                result.append(AgentMemoryResponse(
                    agent_id=agent_id,
                    agent_name=agent_info.get("agent_name", agent_id),
                    project_id=project["id"],
                    tasks=project_tasks,
                    total_tasks=len(project_tasks),
                    completed_tasks=completed_count,
                ))

    return result


@router.get("/projects/{project_id}/facts", response_model=ProjectFactsResponse, summary="Get Project Facts", description="Get all facts for a project.")
async def get_project_facts(project_id: str) -> ProjectFactsResponse:
    """Get all facts for a project."""
    memory_storage = get_task_memory_storage()
    facts_data = memory_storage.load_project_facts(project_id)

    return ProjectFactsResponse(
        project_id=project_id,
        facts=facts_data.get("facts", []),
        total=len(facts_data.get("facts", [])),
    )


@router.get("/projects/{project_id}/status", response_model=ProjectStatusResponse, summary="Get Project Runtime Status", description="Get runtime status of all agents and tasks in a project.")
async def get_project_status(project_id: str) -> ProjectStatusResponse:
    """Get project runtime status."""
    projects_storage = get_project_storage()
    memory_storage = get_task_memory_storage()
    runtime_storage = get_agent_runtime_storage()

    project = projects_storage.load_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")

    agents = []
    task_map = {}

    for task in project.get("tasks", []):
        task_map[task["id"]] = task
        if task.get("assigned_to"):
            agent_id = task["assigned_to"]
            agent_info = runtime_storage.get_agent(agent_id) or {}
            memory = memory_storage.load_task_memory(project_id, agent_id, task["id"])

            agent_found = False
            for a in agents:
                if a["agent_id"] == agent_id:
                    a_found = True
                    break

            if not agent_found:
                agents.append({
                    "agent_id": agent_id,
                    "agent_name": agent_info.get("agent_name", agent_id),
                    "status": agent_info.get("status", "idle"),
                    "current_task_id": task["id"],
                    "progress": memory.get("progress", 0),
                    "last_heartbeat": agent_info.get("last_heartbeat"),
                })

    return ProjectStatusResponse(
        project_id=project_id,
        agents=agents,
        tasks=[task_map[t["id"]] for t in project.get("tasks", [])],
    )


@router.get("/projects/{project_id}/search", response_model=dict, summary="Search Project Facts", description="Search facts across all agents in a project.")
async def search_project_facts(project_id: str, keyword: str = "") -> dict:
    """Search facts in a project."""
    if not keyword:
        return {"results": [], "total": 0}

    memory_storage = get_task_memory_storage()
    facts_data = memory_storage.load_project_facts(project_id)

    results = []
    for fact in facts_data.get("facts", []):
        if keyword.lower() in fact.get("content", "").lower():
            results.append(fact)

    return {
        "results": results,
        "total": len(results),
        "keyword": keyword,
    }
