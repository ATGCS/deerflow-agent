"""DAG dependency resolution for supervisor subtasks.

Provides:
- depends_on extraction / name-index building
- Reference-to-ID resolution (id or name)
- Auto-finalization of unrunnable pending subtasks
- Subtask eligibility resolution for start_execution waves
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

logger = logging.getLogger(__name__)

# Re-exported from supervisor_tool module for backward compat
_TERMINAL_SUBTASK = frozenset({"completed", "failed", "cancelled"})
_IN_FLIGHT_SUBTASK = frozenset({"executing", "running", "in_progress"})


def _subtask_dep_ids(st: dict[str, Any]) -> list[str]:
    """depends_on from worker_profile (other subtask ids that must complete first)."""
    wp = st.get("worker_profile")
    if not isinstance(wp, dict):
        return []
    raw = wp.get("depends_on") or []
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for x in raw:
        d = str(x).strip()
        if d:
            out.append(d)
    return out


def _build_subtask_name_index(by_id: dict[str, dict[str, Any]]) -> dict[str, list[str]]:
    """Name -> [subtask ids] index for resolving depends_on that use names."""
    idx: dict[str, list[str]] = {}
    for sid, st in by_id.items():
        nm = str(st.get("name") or "").strip()
        if not nm:
            continue
        idx.setdefault(nm, []).append(sid)
    return idx


def _resolve_dep_ref_to_id(
    dep_ref: str,
    *,
    current_sid: str,
    by_id: dict[str, dict[str, Any]],
    name_index: dict[str, list[str]],
) -> str | None:
    """Resolve depends_on item to concrete subtask id.

    Accept both:
    - subtask id (preferred)
    - subtask name (compat)
    """
    ref = str(dep_ref or "").strip()
    if not ref:
        return None
    if ref == current_sid:
        return None
    if ref in by_id:
        return ref
    cands = name_index.get(ref) or []
    if len(cands) == 1:
        return cands[0]
    return ref


def _auto_finalize_unrunnable_pending_subtasks(storage: Any, main_task_id: str) -> dict[str, Any]:
    """Mark impossible pending subtasks as cancelled so root task can converge.

    Cases:
    - upstream dependency already reached terminal non-completed state (failed/cancelled/timed_out)
    """
    from deerflow.collab.storage import find_main_task, rollup_root_task_progress_from_subtasks

    row = find_main_task(storage, main_task_id)
    if not row:
        return {"changed": False, "skipped": []}
    proj, task = row
    subtasks: list[dict[str, Any]] = [x for x in (task.get("subtasks") or []) if isinstance(x, dict)]
    if not subtasks:
        return {"changed": False, "skipped": []}

    by_id: dict[str, dict[str, Any]] = {}
    for st in subtasks:
        sid = str(st.get("id") or "").strip()
        if sid:
            by_id[sid] = st
    if not by_id:
        return {"changed": False, "skipped": []}
    name_index = _build_subtask_name_index(by_id)
    status_by_id: dict[str, str] = {
        sid: str(st.get("status") or "pending").strip().lower() for sid, st in by_id.items()
    }

    changed = False
    skipped: list[dict[str, Any]] = []
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for sid, st in by_id.items():
        s_status = status_by_id.get(sid, "pending")
        if s_status in _TERMINAL_SUBTASK or s_status in _IN_FLIGHT_SUBTASK:
            continue
        deps = _subtask_dep_ids(st)
        if not deps:
            continue

        blocked_by_upstream_terminal: list[str] = []
        for dep_ref in deps:
            dep_id = _resolve_dep_ref_to_id(
                dep_ref,
                current_sid=sid,
                by_id=by_id,
                name_index=name_index,
            )
            if not dep_id or dep_id not in by_id:
                continue
            d_status = status_by_id.get(dep_id, "pending")
            if d_status in {"failed", "cancelled", "timed_out"}:
                blocked_by_upstream_terminal.append(dep_id)

        if not blocked_by_upstream_terminal:
            continue

        reason = f"auto_skipped: upstream_terminal_non_completed={blocked_by_upstream_terminal}"

        st["status"] = "cancelled"
        st["progress"] = int(st.get("progress") or 0)
        st["error"] = reason[:500]
        st["completed_at"] = st.get("completed_at") or now
        changed = True
        skipped.append({"subtaskId": sid, "reason": reason})

    if not changed:
        return {"changed": False, "skipped": []}

    task["subtasks"] = subtasks
    storage.save_project(proj)
    try:
        rollup_root_task_progress_from_subtasks(storage, main_task_id)
    except Exception:
        logger.debug("auto finalize pending subtasks: rollup failed task_id=%s", main_task_id, exc_info=True)
    return {"changed": True, "skipped": skipped}


def _resolve_subtasks_for_start_execution(
    storage: Any,
    main_task_id: str,
    explicit: list[str] | None,
) -> tuple[list[str], list[dict[str, Any]]]:
    """Pick subtasks to delegate in this wave: assigned, non-terminal, all depends_on completed.

    Multiple subtasks whose dependencies are all satisfied run **in parallel** in the same start_execution.
    Subtasks still waiting on upstream work are returned in ``blocked`` for UI / lead planning.

    Returns:
        runnable: ordered ids to pass to delegate (explicit order if explicit; else subtasks list order).
        blocked: diagnostic rows (e.g. dependencies_not_satisfied, unassigned, already_terminal).
    """
    from deerflow.collab.storage import find_main_task

    row = find_main_task(storage, main_task_id)
    if not row:
        return [], []
    _proj, task = row
    subtasks: list[Any] = task.get("subtasks") or []
    by_id: dict[str, dict[str, Any]] = {}
    for st in subtasks:
        sid = st.get("id")
        if sid:
            by_id[str(sid)] = st
    name_index = _build_subtask_name_index(by_id)
    status_by_id: dict[str, str] = {
        sid: (st.get("status") or "pending").strip().lower() for sid, st in by_id.items()
    }

    def unmet_dependencies(sid: str, st: dict[str, Any]) -> list[str]:
        bad: list[str] = []
        for dep_ref in _subtask_dep_ids(st):
            dep = _resolve_dep_ref_to_id(
                dep_ref,
                current_sid=sid,
                by_id=by_id,
                name_index=name_index,
            )
            if dep is None:
                continue
            if dep not in status_by_id:
                bad.append(str(dep_ref))
                continue
            if status_by_id[dep] != "completed":
                bad.append(dep)
        return bad

    def eligible(sid: str) -> bool:
        st = by_id.get(sid)
        if not st:
            return False
        status = status_by_id.get(sid, "pending")
        if status in _TERMINAL_SUBTASK:
            return False
        if status in _IN_FLIGHT_SUBTASK:
            return False
        if not str(st.get("assigned_to") or "").strip():
            return False
        return len(unmet_dependencies(sid, st)) == 0

    runnable: list[str] = []
    blocked: list[dict[str, Any]] = []

    if explicit:
        seen: set[str] = set()
        for raw in explicit:
            sid = str(raw).strip()
            if not sid or sid in seen:
                continue
            seen.add(sid)
            st = by_id.get(sid)
            if not st:
                blocked.append({"subtaskId": sid, "reason": "not_found"})
                continue
            if eligible(sid):
                runnable.append(sid)
                continue
            stt = status_by_id.get(sid, "pending")
            if stt in _TERMINAL_SUBTASK:
                blocked.append({"subtaskId": sid, "reason": "already_terminal", "status": stt})
            elif not str(st.get("assigned_to") or "").strip():
                blocked.append({"subtaskId": sid, "reason": "unassigned"})
            else:
                blocked.append(
                    {
                        "subtaskId": sid,
                        "reason": "dependencies_not_satisfied",
                        "unmetDependencies": unmet_dependencies(sid, st),
                    }
                )
        return runnable, blocked

    seen_run: set[str] = set()
    for st in subtasks:
        sid = st.get("id")
        if not sid:
            continue
        sid = str(sid)
        if not eligible(sid):
            continue
        if sid in seen_run:
            continue
        seen_run.add(sid)
        runnable.append(sid)

    for sid, st in by_id.items():
        if sid in seen_run:
            continue
        status = status_by_id.get(sid, "pending")
        if status in _TERMINAL_SUBTASK:
            continue
        if not str(st.get("assigned_to") or "").strip():
            continue
        blocked.append(
            {
                "subtaskId": sid,
                "reason": "waiting_on_dependencies",
                "unmetDependencies": unmet_dependencies(sid, st),
            }
        )
    return runnable, blocked


__all__ = [
    "_TERMINAL_SUBTASK",
    "_IN_FLIGHT_SUBTASK",
    "_subtask_dep_ids",
    "_build_subtask_name_index",
    "_resolve_dep_ref_to_id",
    "_auto_finalize_unrunnable_pending_subtasks",
    "_resolve_subtasks_for_start_execution",
]
