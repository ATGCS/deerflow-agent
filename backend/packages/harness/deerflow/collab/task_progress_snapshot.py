"""Rebuild task sidebar / collab panel state for a chat thread (e.g. after page refresh)."""

from __future__ import annotations

from typing import Any

from deerflow.collab.storage import (
    find_main_task,
    get_project_storage,
    get_task_memory_storage,
    load_task_memory_for_task_id,
)
from deerflow.collab.thread_collab import load_thread_collab_state
from deerflow.config.paths import Paths


def find_root_tasks_bound_to_thread(storage: Any, thread_id: str) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    """All top-level tasks whose ``thread_id`` matches the LangGraph chat thread."""
    out: list[tuple[dict[str, Any], dict[str, Any]]] = []
    tid = (thread_id or "").strip()
    if not tid:
        return out
    for summary in storage.list_projects():
        project = storage.load_project(summary["id"])
        if not project:
            continue
        for task in project.get("tasks", []) or []:
            if (task.get("thread_id") or "").strip() == tid:
                out.append((project, task))
    return out


def _as_int_progress(v: Any) -> int:
    try:
        if v is None:
            return 0
        return max(0, min(100, int(v)))
    except (TypeError, ValueError):
        return 0


def build_task_progress_snapshot(paths: Paths, thread_id: str) -> dict[str, Any]:
    """Return JSON-serializable snapshot for the DeerPanel task sidebar (main + subtasks).

    ``supervisor_steps`` mirror persisted ``sidebar_supervisor_steps`` on thread collab state
    (plus live streaming events on connected clients).
    """
    storage = get_project_storage()
    mem_store = get_task_memory_storage()
    collab = load_thread_collab_state(paths, thread_id)
    phase_val = collab.collab_phase.value if hasattr(collab.collab_phase, "value") else str(collab.collab_phase)
    supervisor_steps: list[dict[str, Any]] = [
        dict(x) for x in (collab.sidebar_supervisor_steps or []) if isinstance(x, dict)
    ]

    def pack(project: dict[str, Any], task: dict[str, Any]) -> dict[str, Any]:
        subs: list[dict[str, Any]] = []
        for st in task.get("subtasks") or []:
            if not isinstance(st, dict):
                continue
            sid = st.get("id")
            if not sid:
                continue
            sid_s = str(sid)
            memory_payload: dict[str, Any] | None = None
            try:
                row = load_task_memory_for_task_id(storage, mem_store, sid_s)
                if row is not None:
                    mem, _project_id, _agent_id, _parent = row
                    if isinstance(mem, dict):
                        memory_payload = {
                            "status": mem.get("status", ""),
                            "progress": _as_int_progress(mem.get("progress")),
                            "current_step": mem.get("current_step", ""),
                            "output_summary": mem.get("output_summary", ""),
                        }
            except Exception:
                memory_payload = None

            otc = st.get("observed_tool_calls")
            if not isinstance(otc, list):
                otc = []
            subs.append(
                {
                    "subtaskId": sid_s,
                    "parentTaskId": str(task.get("id") or ""),
                    "name": st.get("name"),
                    "description": st.get("description"),
                    "status": st.get("status"),
                    "progress": _as_int_progress(st.get("progress")),
                    "assignedAgent": st.get("assigned_to"),
                    # For tooltip: backend-observed tool calls (with input/output) + memory summary
                    "observed_tool_calls": [x for x in otc if isinstance(x, dict)],
                    **({"memory": memory_payload} if memory_payload is not None else {}),
                }
            )
        mid = task.get("id")
        return {
            "main_task": {
                "taskId": str(mid) if mid else None,
                "projectId": str(project.get("id") or "") or None,
                "name": task.get("name"),
                "status": task.get("status"),
                "progress": _as_int_progress(task.get("progress")),
            },
            "subtasks": subs,
        }

    main_choice: tuple[dict[str, Any], dict[str, Any]] | None = None
    bound = (collab.bound_task_id or "").strip()
    if bound:
        found = find_main_task(storage, bound)
        if found:
            proj, task = found
            bt = (task.get("thread_id") or "").strip()
            if not bt or bt == thread_id.strip():
                main_choice = (proj, task)

    if main_choice is None:
        cands = find_root_tasks_bound_to_thread(storage, thread_id)
        if not cands:
            return {
                "thread_id": thread_id,
                "collab_phase": phase_val,
                "bound_task_id": collab.bound_task_id,
                "bound_project_id": collab.bound_project_id,
                "main_task": None,
                "subtasks": [],
                "supervisor_steps": [],
            }
        # Prefer authorized tasks, then latest updated_at / created_at string sort
        def sort_key(item: tuple[dict[str, Any], dict[str, Any]]) -> tuple[Any, ...]:
            _p, t = item
            auth = 1 if t.get("execution_authorized") else 0
            u = str(t.get("updated_at") or t.get("created_at") or "")
            return (auth, u)

        cands.sort(key=sort_key, reverse=True)
        main_choice = cands[0]

    packed = pack(main_choice[0], main_choice[1])
    return {
        "thread_id": thread_id,
        "collab_phase": phase_val,
        "bound_task_id": collab.bound_task_id,
        "bound_project_id": collab.bound_project_id,
        **packed,
        "supervisor_steps": supervisor_steps,
    }
