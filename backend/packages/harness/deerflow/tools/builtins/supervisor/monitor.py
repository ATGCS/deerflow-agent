"""Background monitor, recommendation engine, and auto-follow loop for supervisor.

Provides:
- _ensure_background_task_monitor — server-side asyncio monitor for detached runs
- _compute_monitor_recommendation — stalled/fail/continue signals
- _monitor_main_task_until_terminal — backend poll loop used by start_execution auto-follow
- _broadcast_task_event — SSE event broadcast helper
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any

from langchain.tools import ToolRuntime
from langgraph.typing import ContextT

logger = logging.getLogger(__name__)

_bg_task_monitors: dict[str, asyncio.Task[Any]] = {}
_task_watch_state: dict[str, dict[str, Any]] = {}

from deerflow.tools.builtins.supervisor.dependency import (
    _TERMINAL_SUBTASK as _MONITOR_TERMINAL_MAIN,
)


def _ensure_background_task_monitor(
    storage: Any,
    main_task_id: str,
    runtime_thread_id: str | None,
    *,
    poll_seconds: float = 2.0,
) -> None:
    """Server-side monitor for detached runs: keep writing progress/memory/collab convergence.

    This guarantees long tasks are tracked by backend even if lead-agent run already ended.
    """
    from deerflow.collab.models import CollabPhase
    from deerflow.collab.storage import find_main_task, get_task_memory_storage, load_task_memory_for_task_id
    from deerflow.collab.thread_collab import append_sidebar_supervisor_step, load_thread_collab_state, merge_thread_collab_state, save_thread_collab_state
    from deerflow.config.paths import get_paths
    from deerflow.tools.builtins.supervisor.dependency import _TERMINAL_SUBTASK, _auto_finalize_unrunnable_pending_subtasks
    from deerflow.tools.builtins.supervisor.memory import _broadcast_task_event

    key = str(main_task_id or "").strip()
    if not key:
        return
    prev = _bg_task_monitors.get(key)
    if prev is not None and not prev.done():
        return

    async def _runner() -> None:
        paths = get_paths()
        last_sig = ""
        try:
            while True:
                try:
                    _auto_finalize_unrunnable_pending_subtasks(storage, key)
                except Exception:
                    logger.debug("background monitor: auto finalize pending failed task_id=%s", key, exc_info=True)
                row = find_main_task(storage, key)
                if not row:
                    return
                project, task = row
                main_status = str(task.get("status") or "pending").strip().lower()
                main_progress = int(task.get("progress") or 0)
                subtasks = [st for st in (task.get("subtasks") or []) if isinstance(st, dict)]
                terminal_sub = bool(subtasks) and all(
                    str(st.get("status") or "pending").strip().lower() in _TERMINAL_SUBTASK for st in subtasks
                )
                terminal_main = main_status in _MONITOR_TERMINAL_MAIN or terminal_sub

                mem_step = ""
                mem_summary = ""
                try:
                    mem_store = get_task_memory_storage()
                    mem_row = load_task_memory_for_task_id(storage, mem_store, key)
                    if mem_row is not None:
                        mem, _pid, _aid, _parent = mem_row
                        mem_step = str(mem.get("current_step") or "").strip()
                        mem_summary = str(mem.get("output_summary") or "").strip()
                except Exception:
                    logger.debug("background monitor: read task memory failed", exc_info=True)

                sig = json.dumps(
                    {
                        "s": main_status,
                        "p": main_progress,
                        "st": [(str(st.get("id") or ""), str(st.get("status") or "")) for st in subtasks],
                        "m": mem_step,
                    },
                    ensure_ascii=False,
                )
                if sig != last_sig:
                    last_sig = sig
                    tid = (runtime_thread_id or task.get("thread_id") or "").strip()
                    if tid:
                        try:
                            detail = f"Monitor: {main_status} · {main_progress}%"
                            if mem_step:
                                detail += f" · {mem_step[:120]}"
                            append_sidebar_supervisor_step(
                                paths,
                                tid,
                                {"id": f"monitor-{key}-{uuid.uuid4().hex[:10]}", "action": "monitor", "label": detail, "done": bool(terminal_main)},
                                max_steps=120,
                            )
                        except Exception:
                            logger.debug("background monitor: append supervisor step failed", exc_info=True)

                    try:
                        await _broadcast_task_event(
                            project.get("id"),
                            "task:progress",
                            {
                                "task_id": key,
                                "status": main_status,
                                "progress": main_progress,
                                "current_step": mem_step,
                                "output_summary": mem_summary[:500],
                            },
                        )
                    except Exception:
                        logger.debug("background monitor: broadcast progress failed", exc_info=True)

                if terminal_main:
                    tid = (runtime_thread_id or task.get("thread_id") or "").strip()
                    if tid:
                        try:
                            current = load_thread_collab_state(paths, tid)
                            merged = merge_thread_collab_state(current, {"collab_phase": CollabPhase.DONE.value})
                            save_thread_collab_state(paths, tid, merged)
                        except Exception:
                            logger.debug("background monitor: set collab phase done failed", exc_info=True)
                    return

                await asyncio.sleep(max(0.5, float(poll_seconds)))
        finally:
            cur = _bg_task_monitors.get(key)
            if cur is not None and cur.done():
                _bg_task_monitors.pop(key, None)

    _bg_task_monitors[key] = asyncio.create_task(_runner(), name=f"supervisor-monitor-{key}")


def _compute_monitor_recommendation(
    *,
    task_id: str,
    status: str,
    progress: int,
    sub_rows: list[dict[str, Any]],
    memory_payload: dict[str, Any] | None,
) -> dict[str, Any]:
    """Return backend-side recommendation for lead-agent decision making.

    Signals:
    - continue_wait: still moving
    - retry_or_reassign: there are failed subtasks
    - check_stalled: no progress/current_step change for a period
    """
    now = __import__("time").time()  # avoid top-level time import
    step = ""
    if isinstance(memory_payload, dict):
        step = str(memory_payload.get("current_step") or "").strip()

    failed_ids = [
        str(s.get("subtaskId") or "")
        for s in sub_rows
        if str(s.get("status") or "").strip().lower() == "failed"
    ]
    signature = json.dumps({"p": int(progress or 0), "step": step}, ensure_ascii=False)
    ws = _task_watch_state.get(task_id) or {}
    last_sig = str(ws.get("signature") or "")
    last_change_ts = float(ws.get("last_change_ts") or now)
    no_change_count = int(ws.get("no_change_count") or 0)
    if signature != last_sig:
        last_change_ts = now
        no_change_count = 0
    else:
        no_change_count += 1
    _task_watch_state[task_id] = {
        "signature": signature,
        "last_change_ts": last_change_ts,
        "updated_ts": now,
        "no_change_count": no_change_count,
    }

    stagnant_seconds = max(0, int(now - last_change_ts))
    # Practical threshold: 90s without progress/current_step change means probably stalled.
    stalled = stagnant_seconds >= 90 and status not in _MONITOR_TERMINAL_MAIN

    if failed_ids:
        return {
            "action": "retry_or_reassign",
            "reason": "Detected failed subtasks.",
            "failedSubtaskIds": failed_ids,
            "stalled": stalled,
            "stagnantSeconds": stagnant_seconds,
            "noChangeCount": no_change_count,
        }
    if stalled:
        return {
            "action": "check_stalled",
            "reason": "No progress/current_step update for a while.",
            "failedSubtaskIds": [],
            "stalled": True,
            "stagnantSeconds": stagnant_seconds,
            "noChangeCount": no_change_count,
        }
    return {
        "action": "continue_wait",
        "reason": "Task is progressing or waiting normally.",
        "failedSubtaskIds": [],
        "stalled": False,
        "stagnantSeconds": stagnant_seconds,
        "noChangeCount": no_change_count,
    }


async def _monitor_main_task_until_terminal(
    storage: Any,
    task_id: str,
    *,
    poll_seconds: float,
    timeout_seconds: int | None,
    timeline_step_seconds: int = 5,
    slice_seconds: int | None = None,
) -> dict[str, Any]:
    """Backend-side monitor loop used by start_execution auto-follow mode."""
    from deerflow.collab.storage import find_main_task, get_task_memory_storage, load_task_memory_for_task_id
    from deerflow.tools.builtins.supervisor.dependency import _TERMINAL_SUBTASK, _auto_finalize_unrunnable_pending_subtasks
    from deerflow.tools.builtins.supervisor.display import _build_monitor_subtask_rows

    start_ts = asyncio.get_event_loop().time()
    last_timeline_emit_ts = start_ts
    timeline: list[dict[str, Any]] = []

    while True:
        try:
            _auto_finalize_unrunnable_pending_subtasks(storage, task_id)
        except Exception:
            logger.debug("auto-follow monitor: auto finalize pending failed task_id=%s", task_id, exc_info=True)
        row = find_main_task(storage, task_id)
        if not row:
            return {
                "success": False,
                "error": f"Task '{task_id}' not found while monitoring",
                "timeline": timeline,
            }
        _proj, task = row
        t_status = str(task.get("status") or "pending").strip().lower()
        t_progress = int(task.get("progress") or 0)
        subtasks = [st for st in (task.get("subtasks") or []) if isinstance(st, dict)]
        sub_rows, failed_subtasks = _build_monitor_subtask_rows(storage, subtasks)

        memory_payload: dict[str, Any] | None = None
        try:
            mem_store = get_task_memory_storage()
            mem_row = load_task_memory_for_task_id(storage, mem_store, task_id)
            if mem_row is not None:
                mem, _pid, _aid, _parent = mem_row
                facts = mem.get("facts") or []
                if not isinstance(facts, list):
                    facts = []
                memory_payload = {
                    "status": mem.get("status", ""),
                    "progress": mem.get("progress", 0),
                    "current_step": mem.get("current_step", ""),
                    "output_summary": mem.get("output_summary", ""),
                    "factsCount": len(facts),
                    "facts": facts[:5],
                }
        except Exception:
            logger.debug("auto-follow monitor: memory snapshot failed", exc_info=True)

        rec = _compute_monitor_recommendation(
            task_id=task_id,
            status=t_status,
            progress=t_progress,
            sub_rows=sub_rows,
            memory_payload=memory_payload,
        )

        now = asyncio.get_event_loop().time()
        if now - last_timeline_emit_ts >= float(max(1, timeline_step_seconds)):
            last_timeline_emit_ts = now
            snap = {
                "status": t_status,
                "progress": t_progress,
                "failedSubtasks": failed_subtasks[:5],
                "memory": memory_payload,
                "recommendation": rec,
                "elapsedSeconds": int(now - start_ts),
            }
            timeline.append(snap)
            if len(timeline) > 30:
                timeline = timeline[-30:]

        all_sub_terminal = bool(subtasks) and all(
            str(st.get("status") or "pending").strip().lower() in _TERMINAL_SUBTASK for st in subtasks
        )
        if t_status in _MONITOR_TERMINAL_MAIN or all_sub_terminal:
            return {
                "success": True,
                "terminal": True,
                "status": t_status,
                "progress": t_progress,
                "subtasks": sub_rows,
                "failedSubtasks": failed_subtasks,
                "memory": memory_payload,
                "recommendation": rec,
                "timeline": timeline,
            }

        if slice_seconds is not None and (now - start_ts) >= float(max(1, int(slice_seconds))):
            return {
                "success": True,
                "terminal": False,
                "status": t_status,
                "progress": t_progress,
                "subtasks": sub_rows,
                "failedSubtasks": failed_subtasks,
                "memory": memory_payload,
                "recommendation": rec,
                "timeline": timeline,
                "elapsedSeconds": int(now - start_ts),
            }

        if timeout_seconds is not None and (now - start_ts) > float(timeout_seconds):
            return {
                "success": False,
                "terminal": False,
                "status": t_status,
                "progress": t_progress,
                "error": f"auto-follow monitor timeout after {timeout_seconds}s",
                "subtasks": sub_rows,
                "failedSubtasks": failed_subtasks,
                "memory": memory_payload,
                "recommendation": rec,
                "timeline": timeline,
            }

        await asyncio.sleep(max(0.5, float(poll_seconds)))


__all__ = [
    "_ensure_background_task_monitor",
    "_compute_monitor_recommendation",
    "_monitor_main_task_until_terminal",
    "_bg_task_monitors",
    "_task_watch_state",
]
