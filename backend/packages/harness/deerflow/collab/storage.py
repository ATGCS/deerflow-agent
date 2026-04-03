"""Storage for project and task data."""

import json
import logging
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from deerflow.collab.models import (
    AgentRuntime,
    Project,
    ProjectStatus,
    Task,
    TaskFact,
    TaskMemory,
    TaskStatus,
)

logger = logging.getLogger(__name__)


def create_empty_project(name: str = "", description: str = "") -> dict[str, Any]:
    """Create an empty project structure."""
    now = datetime.utcnow().isoformat() + "Z"
    return {
        "id": str(uuid.uuid4())[:8],
        "name": name,
        "description": description,
        "tasks": [],
        "status": ProjectStatus.PENDING.value,
        "supervisor_session_id": None,
        "created_at": now,
        "updated_at": now,
    }


def create_empty_task(
    name: str = "",
    description: str = "",
    project_id: str = "",
    dependencies: list[str] | None = None,
) -> dict[str, Any]:
    """Create an empty task structure."""
    now = datetime.utcnow().isoformat() + "Z"
    return {
        "id": str(uuid.uuid4())[:8],
        "name": name,
        "description": description,
        "status": TaskStatus.PENDING.value,
        "parent_id": None,
        "dependencies": dependencies or [],
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
        "subtasks": [],
    }


def create_task_memory(
    task_id: str = "",
    agent_id: str = "",
    project_id: str = "",
) -> dict[str, Any]:
    """Create an empty task memory structure."""
    now = datetime.utcnow().isoformat() + "Z"
    return {
        "task_id": task_id,
        "agent_id": agent_id,
        "project_id": project_id,
        "status": TaskStatus.PENDING.value,
        "facts": [],
        "output_summary": "",
        "current_step": "",
        "progress": 0,
        "created_at": now,
        "updated_at": now,
        "completed_at": None,
    }


class ProjectStorage:
    """Storage for projects and tasks using JSON files."""

    def __init__(self, storage_dir: Path | None = None):
        """Initialize the project storage."""
        if storage_dir is None:
            from deerflow.config.paths import get_paths
            paths = get_paths()
            storage_dir = paths.base_dir / ".deer-flow" / "projects"

        self._storage_dir = Path(storage_dir)
        self._index_file = self._storage_dir / "index.json"
        # Cache mtime using nanoseconds to avoid stale reads when writes happen within
        # the same timestamp resolution.
        self._project_cache: dict[str, tuple[dict[str, Any], int | None]] = {}
        # ProjectStorage can be accessed concurrently by LangGraph tool-calls.
        # Use a re-entrant lock to prevent partially-written JSON reads/writes.
        self._lock = threading.RLock()

    def _ensure_dir(self) -> None:
        """Ensure storage directory exists."""
        self._storage_dir.mkdir(parents=True, exist_ok=True)

    def _load_index(self) -> dict[str, Any]:
        """Load the project index."""
        if not self._index_file.exists():
            return {"projects": [], "version": "1.0", "last_updated": ""}

        try:
            with open(self._index_file, encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("Failed to load project index: %s", e)
            return {"projects": [], "version": "1.0", "last_updated": ""}

    def _save_index(self, index: dict[str, Any]) -> None:
        """Save the project index."""
        self._ensure_dir()
        index["last_updated"] = datetime.utcnow().isoformat() + "Z"

        temp_path = self._index_file.with_suffix(".tmp")
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(index, f, indent=2, ensure_ascii=False)
        temp_path.replace(self._index_file)

    def _get_project_file(self, project_id: str) -> Path:
        """Get the project file path."""
        return self._storage_dir / f"project_{project_id}.json"

    def load_project(self, project_id: str) -> dict[str, Any] | None:
        """Load a project by ID."""
        project_file = self._get_project_file(project_id)

        with self._lock:
            try:
                current_mtime = project_file.stat().st_mtime_ns if project_file.exists() else None
            except OSError:
                current_mtime = None

            cached = self._project_cache.get(project_id)
            if cached is not None and cached[1] == current_mtime:
                return cached[0]

            if not project_file.exists():
                return None

            try:
                with open(project_file, encoding="utf-8") as f:
                    project_data = json.load(f)
                self._project_cache[project_id] = (project_data, current_mtime)
                return project_data
            except (json.JSONDecodeError, OSError) as e:
                logger.warning("Failed to load project %s: %s", project_id, e)
                return None

    def save_project(self, project_data: dict[str, Any]) -> bool:
        """Save a project."""
        project_id = project_data.get("id")
        if not project_id:
            return False

        with self._lock:
            self._ensure_dir()
            project_file = self._get_project_file(project_id)

            try:
                project_data["updated_at"] = datetime.utcnow().isoformat() + "Z"

                temp_path = project_file.with_suffix(".tmp")
                with open(temp_path, "w", encoding="utf-8") as f:
                    json.dump(project_data, f, indent=2, ensure_ascii=False)
                temp_path.replace(project_file)

                try:
                    mtime = project_file.stat().st_mtime_ns
                except OSError:
                    mtime = None

                # Cache a copy to prevent shared-reference mutation across callers.
                self._project_cache[project_id] = (project_data, mtime)

                index = self._load_index()
                if project_id not in index.get("projects", []):
                    index.setdefault("projects", []).append(project_id)
                    self._save_index(index)

                logger.info("Project %s saved", project_id)
                return True
            except OSError as e:
                logger.error("Failed to save project %s: %s", project_id, e)
                return False

    def delete_project(self, project_id: str) -> bool:
        """Delete a project."""
        project_file = self._get_project_file(project_id)

        with self._lock:
            try:
                if project_file.exists():
                    project_file.unlink()

                if project_id in self._project_cache:
                    del self._project_cache[project_id]

                index = self._load_index()
                if "projects" in index and project_id in index["projects"]:
                    index["projects"].remove(project_id)
                    self._save_index(index)

                logger.info("Project %s deleted", project_id)
                return True
            except OSError as e:
                logger.error("Failed to delete project %s: %s", project_id, e)
                return False

    def list_projects(self) -> list[dict[str, Any]]:
        """List all projects (summary info only)."""
        with self._lock:
            index = self._load_index()
            projects: list[dict[str, Any]] = []

            for project_id in index.get("projects", []):
                project_data = self.load_project(project_id)
                if project_data:
                    projects.append({
                        "id": project_data.get("id"),
                        "name": project_data.get("name"),
                        "description": project_data.get("description"),
                        "status": project_data.get("status"),
                        "created_at": project_data.get("created_at"),
                        "updated_at": project_data.get("updated_at"),
                        "task_count": len(project_data.get("tasks", [])),
                    })

            return projects


class TaskMemoryStorage:
    """Storage for task memory and agent runtime data."""

    _UNASSIGNED_AGENT_ID = "__unassigned__"

    def __init__(self, storage_dir: Path | None = None):
        """Initialize the task memory storage."""
        if storage_dir is None:
            from deerflow.config.paths import get_paths
            paths = get_paths()
            storage_dir = paths.base_dir / ".deer-flow" / "task_memory"

        self._storage_dir = Path(storage_dir)
        # Cache mtime using nanoseconds to avoid stale reads when writes happen within
        # the same filesystem timestamp resolution.
        self._cache: dict[str, tuple[dict[str, Any], int | None]] = {}
        self._lock = threading.Lock()

    def _ensure_dir(self, *parts: str) -> Path:
        """Ensure directory exists and return path."""
        path = self._storage_dir.joinpath(*parts)
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _normalize_agent_id(self, agent_id: str | None) -> str:
        """Normalize empty/None agent_id for per-task memory persistence.

        When `assigned_to` is not set yet, routers pass `agent_id=""`.
        Without normalization we'd fall back to `global_facts.json` and/or
        refuse to save, causing `progress/current_step` readback bugs.
        """
        if not agent_id:
            return self._UNASSIGNED_AGENT_ID
        return agent_id

    def _get_memory_file(self, project_id: str, agent_id: str | None = None, task_id: str | None = None) -> Path:
        """Get the memory file path."""
        if task_id is not None and agent_id is not None:
            return self._storage_dir / project_id / "agents" / agent_id / f"{task_id}.json"
        elif agent_id is not None:
            return self._storage_dir / project_id / "agents" / agent_id / "index.json"
        elif project_id:
            return self._storage_dir / project_id / "global_facts.json"
        return self._storage_dir / "index.json"

    def load_task_memory(self, project_id: str, agent_id: str, task_id: str) -> dict[str, Any]:
        """Load task memory from ``{storage_dir}/{project_id}/agents/{agent_id}/{task_id}.json``.

        ``task_id`` is the **memory key**: use the main task id for top-level tasks, or the subtask id
        for rows in ``subtasks[]`` (same on-disk layout; distinct files per id).
        """
        agent_id = self._normalize_agent_id(agent_id)
        memory_file = self._get_memory_file(project_id, agent_id, task_id)

        cache_key = f"{project_id}/{agent_id}/{task_id}"
        try:
            current_mtime = memory_file.stat().st_mtime_ns if memory_file.exists() else None
        except OSError:
            current_mtime = None

        cached = self._cache.get(cache_key)
        if cached is not None and cached[1] == current_mtime:
            return cached[0]

        if not memory_file.exists():
            return create_task_memory(task_id, agent_id, project_id)

        try:
            with open(memory_file, encoding="utf-8") as f:
                memory_data = json.load(f)
            self._cache[cache_key] = (memory_data, current_mtime)
            return memory_data
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("Failed to load task memory %s: %s", cache_key, e)
            return create_task_memory(task_id, agent_id, project_id)

    def save_task_memory(self, memory_data: dict[str, Any]) -> bool:
        """Save task memory."""
        project_id = memory_data.get("project_id")
        agent_id = self._normalize_agent_id(memory_data.get("agent_id"))
        task_id = memory_data.get("task_id")

        if not all([project_id, task_id]):
            return False
        memory_data["agent_id"] = agent_id

        memory_file = self._get_memory_file(project_id, agent_id, task_id)
        memory_file.parent.mkdir(parents=True, exist_ok=True)

        try:
            memory_data["updated_at"] = datetime.utcnow().isoformat() + "Z"

            temp_path = memory_file.with_suffix(".tmp")
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(memory_data, f, indent=2, ensure_ascii=False)
            temp_path.replace(memory_file)

            cache_key = f"{project_id}/{agent_id}/{task_id}"
            try:
                mtime = memory_file.stat().st_mtime_ns
            except OSError:
                mtime = None
            self._cache[cache_key] = (memory_data, mtime)

            logger.info("Task memory saved: %s", cache_key)
            return True
        except OSError as e:
            logger.error("Failed to save task memory: %s", e)
            return False

    def load_project_facts(self, project_id: str) -> dict[str, Any]:
        """Load all facts for a project."""
        facts_file = self._get_memory_file(project_id)

        if not facts_file.exists():
            return {"version": "1.0", "project_id": project_id, "facts": [], "last_updated": ""}

        try:
            with open(facts_file, encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("Failed to load project facts %s: %s", project_id, e)
            return {"version": "1.0", "project_id": project_id, "facts": [], "last_updated": ""}

    def save_project_facts(self, facts_data: dict[str, Any]) -> bool:
        """Save project facts."""
        project_id = facts_data.get("project_id")
        if not project_id:
            return False

        facts_file = self._get_memory_file(project_id)
        facts_file.parent.mkdir(parents=True, exist_ok=True)

        try:
            facts_data["last_updated"] = datetime.utcnow().isoformat() + "Z"

            temp_path = facts_file.with_suffix(".tmp")
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(facts_data, f, indent=2, ensure_ascii=False)
            temp_path.replace(facts_file)

            logger.info("Project facts saved: %s", project_id)
            return True
        except OSError as e:
            logger.error("Failed to save project facts: %s", e)
            return False

    def add_fact_to_project(self, project_id: str, fact: dict[str, Any]) -> bool:
        """Add a fact to project's global facts."""
        facts_data = self.load_project_facts(project_id)
        facts_data.setdefault("facts", []).append(fact)
        return self.save_project_facts(facts_data)

    def get_agent_memories(self, project_id: str, agent_id: str) -> list[dict[str, Any]]:
        """Get all task memories for an agent in a project."""
        agent_dir = self._storage_dir / project_id / "agents" / agent_id

        if not agent_dir.exists():
            return []

        memories = []
        for memory_file in agent_dir.glob("*.json"):
            if memory_file.name == "index.json":
                continue
            try:
                with open(memory_file, encoding="utf-8") as f:
                    memories.append(json.load(f))
            except (json.JSONDecodeError, OSError):
                continue

        return memories


class AgentRuntimeStorage:
    """Storage for agent runtime status."""

    def __init__(self, storage_dir: Path | None = None):
        """Initialize the agent runtime storage."""
        if storage_dir is None:
            from deerflow.config.paths import get_paths
            paths = get_paths()
            storage_dir = paths.base_dir / ".deer-flow" / "agent_runtime"

        self._storage_dir = Path(storage_dir)
        self._runtime_file = self._storage_dir / "runtime.json"
        self._lock = threading.Lock()

    def _ensure_dir(self) -> None:
        """Ensure storage directory exists."""
        self._storage_dir.mkdir(parents=True, exist_ok=True)

    def _load_runtime(self) -> dict[str, Any]:
        """Load agent runtime data."""
        if not self._runtime_file.exists():
            return {"agents": {}, "last_updated": ""}

        try:
            with open(self._runtime_file, encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("Failed to load agent runtime: %s", e)
            return {"agents": {}, "last_updated": ""}

    def _save_runtime(self, runtime_data: dict[str, Any]) -> None:
        """Save agent runtime data."""
        self._ensure_dir()
        runtime_data["last_updated"] = datetime.utcnow().isoformat() + "Z"

        temp_path = self._runtime_file.with_suffix(".tmp")
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(runtime_data, f, indent=2, ensure_ascii=False)
        temp_path.replace(self._runtime_file)

    def update_agent(self, agent_data: dict[str, Any]) -> bool:
        """Update an agent's runtime status."""
        with self._lock:
            runtime_data = self._load_runtime()
            agent_id = agent_data.get("agent_id")
            if agent_id:
                runtime_data.setdefault("agents", {})[agent_id] = agent_data
                self._save_runtime(runtime_data)
                return True
            return False

    def get_agent(self, agent_id: str) -> dict[str, Any] | None:
        """Get an agent's runtime status."""
        runtime_data = self._load_runtime()
        return runtime_data.get("agents", {}).get(agent_id)

    def get_all_agents(self) -> list[dict[str, Any]]:
        """Get all agents' runtime status."""
        runtime_data = self._load_runtime()
        return list(runtime_data.get("agents", {}).values())

    def remove_agent(self, agent_id: str) -> bool:
        """Remove an agent's runtime status."""
        with self._lock:
            runtime_data = self._load_runtime()
            if agent_id in runtime_data.get("agents", {}):
                del runtime_data["agents"][agent_id]
                self._save_runtime(runtime_data)
                return True
            return False


def find_main_task(storage: ProjectStorage, main_task_id: str) -> tuple[dict[str, Any], dict[str, Any]] | None:
    """Locate a top-level main task by id across all project buckets."""
    for summary in storage.list_projects():
        project = storage.load_project(summary["id"])
        if not project:
            continue
        for task in project.get("tasks", []):
            if task.get("id") == main_task_id:
                return project, task
    return None


def find_subtask_by_ids(
    storage: ProjectStorage,
    main_task_id: str,
    subtask_id: str,
) -> dict[str, Any] | None:
    """Return a subtask row from ``main_task_id``'s ``subtasks[]``, or None."""
    found = find_main_task(storage, main_task_id)
    if not found:
        return None
    _project, task = found
    for st in task.get("subtasks") or []:
        if st.get("id") == subtask_id:
            return st
    return None


def find_subtask_row_by_id(
    storage: ProjectStorage,
    subtask_id: str,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]] | None:
    """Locate ``(project, main_task, subtask_row)`` when ``subtask_id`` appears in any ``subtasks[]``."""
    for summary in storage.list_projects():
        project = storage.load_project(summary["id"])
        if not project:
            continue
        for task in project.get("tasks", []):
            for st in task.get("subtasks") or []:
                if st.get("id") == subtask_id:
                    return project, task, st
    return None


def load_task_memory_for_task_id(
    project_storage: ProjectStorage,
    memory_storage: TaskMemoryStorage,
    task_id: str,
) -> tuple[dict[str, Any], str, str, str | None] | None:
    """Resolve TaskMemory for a **main task id** or a **subtask id** (``GET /api/task-memory/tasks/{id}``).

    On-disk path: ``task_memory/{project_id}/agents/{agent_id}/{task_id}.json`` — ``task_id`` is always
    the memory file basename; for subtasks, ``agent_id`` prefers ``subtask.assigned_to`` then main task's.

    Returns ``(memory_dict, project_id, agent_id_used, parent_main_task_id_or_none)``.
    ``parent_main_task_id_or_none`` is ``None`` for a main task, else the parent main task id.
    """
    main = find_main_task(project_storage, task_id)
    if main is not None:
        project, task = main
        agent_id = task.get("assigned_to") or ""
        mem = memory_storage.load_task_memory(project["id"], agent_id, task_id)
        return mem, project["id"], agent_id, None

    sub = find_subtask_row_by_id(project_storage, task_id)
    if sub is None:
        return None
    project, main_task, subtask = sub
    agent_id = (subtask.get("assigned_to") or main_task.get("assigned_to") or "") or ""
    mem = memory_storage.load_task_memory(project["id"], agent_id, task_id)
    return mem, project["id"], agent_id, main_task.get("id")


def load_task_memory_for_main_task(
    project_storage: ProjectStorage,
    memory_storage: TaskMemoryStorage,
    main_task_id: str,
) -> tuple[dict[str, Any], str, str] | None:
    """Resolve TaskMemory for a **main** task id only (not subtask ids).

    Prefer :func:`load_task_memory_for_task_id` when the id may be a subtask.

    Returns ``(memory_dict, project_id, agent_id_used)`` or ``None`` if no such main task exists.
    """
    found = find_main_task(project_storage, main_task_id)
    if not found:
        return None
    project, task = found
    agent_id = task.get("assigned_to") or ""
    mem = memory_storage.load_task_memory(project["id"], agent_id, main_task_id)
    return mem, project["id"], agent_id


def persist_task_memory_after_subagent_run(
    memory_storage: TaskMemoryStorage,
    project_id: str,
    agent_id: str,
    memory_task_id: str,
    *,
    outcome: Literal["completed", "failed", "timed_out"],
    output_summary: str,
    current_step: str,
    progress: int,
    source_ref: str | None = None,
) -> tuple[bool, int]:
    """Persist ``output_summary`` / ``facts`` / status after a ``task`` tool subagent run (F-02).

    Storage key matches F-01: ``task_memory/{project_id}/agents/{agent_id}/{memory_task_id}.json``.
    Best-effort: logs and returns ``(False, 0)`` on error; never raises.
    Returns ``(ok, facts_count)``.
    """
    try:
        mem = memory_storage.load_task_memory(project_id, agent_id, memory_task_id)
        now = datetime.utcnow().isoformat() + "Z"
        mem["task_id"] = memory_task_id
        mem["agent_id"] = agent_id
        mem["project_id"] = project_id
        mem["output_summary"] = (output_summary or "")[:8000]
        mem["current_step"] = (current_step or "")[:2000]
        mem["progress"] = min(100, max(0, int(progress)))
        mem["updated_at"] = now
        if outcome == "completed":
            mem["status"] = TaskStatus.COMPLETED.value
            mem["completed_at"] = now
        else:
            mem["status"] = TaskStatus.FAILED.value
            mem["completed_at"] = now
        fact_id = f"subagent_{uuid.uuid4().hex[:16]}"
        snippet = (output_summary or "").strip()
        if len(snippet) > 500:
            snippet = snippet[:500] + "…"
        fact_body = f"[subagent {outcome}] {snippet}" if snippet else f"[subagent {outcome}]"
        fact: dict[str, Any] = {
            "id": fact_id,
            "content": fact_body,
            "category": "conclusion" if outcome == "completed" else "finding",
            "confidence": 0.85 if outcome == "completed" else 0.55,
            "source_message": source_ref,
        }
        mem.setdefault("facts", []).append(fact)
        if not memory_storage.save_task_memory(mem):
            return False, 0
        memory_storage.add_fact_to_project(project_id, {**fact, "task_id": memory_task_id})
        return True, len(mem.get("facts", []))
    except Exception:
        logger.exception(
            "persist_task_memory_after_subagent_run failed project=%s task=%s",
            project_id,
            memory_task_id,
        )
        return False, 0


def authorize_main_task_execution(storage: ProjectStorage, task_id: str, authorized_by: str) -> tuple[bool, str]:
    """Set execution_authorized when status is planned or planning. Idempotent if already authorized."""
    allowed_status = ("planned", "planning")
    for summary in storage.list_projects():
        project = storage.load_project(summary["id"])
        if not project:
            continue
        for i, task in enumerate(project.get("tasks", [])):
            if task.get("id") != task_id:
                continue
            if task.get("execution_authorized"):
                return True, "Already authorized"
            if task.get("status") not in allowed_status:
                return False, (
                    f"Task status must be one of {allowed_status!r} to authorize execution; "
                    f"got {task.get('status')!r}"
                )
            now = datetime.utcnow().isoformat() + "Z"
            task["execution_authorized"] = True
            task["authorized_at"] = now
            task["authorized_by"] = authorized_by
            project["tasks"][i] = task
            if storage.save_project(project):
                return True, "Execution authorized"
            return False, "Failed to save project"
    return False, f"Task '{task_id}' not found"


def collab_execution_gate_error(main_task_id: str, runtime_thread_id: str | None) -> str | None:
    """Return user-facing error if collaborative main task cannot run workers; None if OK."""
    storage = get_project_storage()
    found = find_main_task(storage, main_task_id)
    if found is None:
        return f"Error: collaborative task id {main_task_id!r} was not found."
    _project, task = found
    if not task.get("execution_authorized"):
        return (
            "Error: This collaborative task is not authorized for worker execution. "
            "After the plan is ready (status planned or planning), call "
            "POST /api/tasks/{task_id}/authorize-execution or supervisor(action=start_execution, task_id=...). "
            "Then invoke this tool with collab_task_id set to that task id (or set context collab_task_id)."
        )
    bound = task.get("thread_id")
    if bound:
        if not runtime_thread_id:
            return "Error: collaborative task is bound to a thread; current runtime has no thread_id."
        if bound != runtime_thread_id:
            return "Error: collaborative task is bound to a different conversation (thread_id mismatch)."
    return None


def find_open_main_task_id_by_name(storage: ProjectStorage, task_name: str) -> str | None:
    """If a root task with this name exists in pending/planning, return its id (supervisor dedupe)."""
    for project_summary in storage.list_projects():
        project = storage.load_project(project_summary["id"])
        if not project:
            continue
        for task in project.get("tasks", []):
            if task.get("name") == task_name and task.get("status") in ("pending", "planning"):
                tid = task.get("id")
                return str(tid) if tid else None
    return None


def new_project_bundle_root_task(
    task_name: str,
    task_description: str = "",
    thread_id: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build ``(project_dict, root_task_dict)`` — single source for HTTP ``POST /api/tasks`` and ``supervisor(create_task)``."""
    now = datetime.utcnow().isoformat() + "Z"
    task = create_empty_task(name=task_name, description=task_description)
    task["created_at"] = now
    task["thread_id"] = thread_id
    task["subtasks"] = list(task.get("subtasks") or [])
    project = create_empty_project(name=f"任务: {task_name}", description=task_description)
    project["tasks"] = [task]
    project["created_at"] = now
    project["updated_at"] = now
    return project, task


_storage_instance: ProjectStorage | None = None
_task_memory_instance: TaskMemoryStorage | None = None
_agent_runtime_instance: AgentRuntimeStorage | None = None
_storage_lock = threading.Lock()


def get_project_storage() -> ProjectStorage:
    """Get the project storage instance."""
    global _storage_instance
    if _storage_instance is not None:
        return _storage_instance

    with _storage_lock:
        if _storage_instance is not None:
            return _storage_instance
        _storage_instance = ProjectStorage()
        return _storage_instance


def get_task_memory_storage() -> TaskMemoryStorage:
    """Get the task memory storage instance."""
    global _task_memory_instance
    if _task_memory_instance is not None:
        return _task_memory_instance

    with _storage_lock:
        if _task_memory_instance is not None:
            return _task_memory_instance
        _task_memory_instance = TaskMemoryStorage()
        return _task_memory_instance


def get_agent_runtime_storage() -> AgentRuntimeStorage:
    """Get the agent runtime storage instance."""
    global _agent_runtime_instance
    if _agent_runtime_instance is not None:
        return _agent_runtime_instance

    with _storage_lock:
        if _agent_runtime_instance is not None:
            return _agent_runtime_instance
        _agent_runtime_instance = AgentRuntimeStorage()
        return _agent_runtime_instance
