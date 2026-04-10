"""Execution delegation and auto-followup for supervisor subtasks.

Provides:
- delegate_collab_subtasks_for_start_execution — parallel subagent invocation via collab_bridge
- auto_delegate_collab_followup_wave — automatic wave-2+ delegation when upstream completes
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

from langchain.tools import ToolRuntime
from langgraph.typing import ContextT

logger = logging.getLogger(__name__)

# Register followup handler at import time so task_tool can call us via bridge.
# This is done lazily below (after function definitions) to avoid forward-ref issues.


async def delegate_collab_subtasks_for_start_execution(
    runtime: ToolRuntime[ContextT, dict] | None,
    storage: Any,
    main_task_id: str,
    subtask_ids: list[str],
    *,
    wait_for_completion: bool = False,
) -> list[dict[str, Any]]:
    """Invoke ``task`` for each subtask (parallel). Used by ``start_execution`` so workers actually run.

    When ``wait_for_completion`` is False (default), each subagent runs in the background and this
    function returns as soon as all starts succeed; project rows are updated on completion by the
    existing ``task_tool`` polling path.
    """
    from deerflow.collab.storage import (
        find_main_task,
        find_subtask_by_ids,
        get_task_memory_storage,
        load_task_memory_for_task_id,
    )
    from deerflow.tools.builtins.supervisor.dependency import (
        _build_subtask_name_index,
        _resolve_dep_ref_to_id,
        _subtask_dep_ids,
    )

    from deerflow.tools.builtins.collab_bridge import delegate_via_task_tool, is_bridge_ready

    if not subtask_ids:
        return []
    if runtime is None:
        logger.warning("start_execution: skip subagent delegation (no tool runtime)")
        return [
            {
                "subtaskId": sid,
                "ok": False,
                "error": "No runtime: cannot delegate to task tool",
            }
            for sid in subtask_ids
        ]

    # Use collab_bridge instead of directly importing task_tool (breaks circular dep)
    _task_ok, _ = is_bridge_ready()
    if not _task_ok:
        logger.error("start_execution: task_tool delegate not registered via collab_bridge")
        return [{"subtaskId": sid, "ok": False, "error": "task_tool unavailable (bridge not ready)"} for sid in subtask_ids]

    dep_by_id: dict[str, dict[str, Any]] = {}
    try:
        dep_row = find_main_task(storage, main_task_id)
        if dep_row:
            _dep_proj, dep_task = dep_row
            for _st in dep_task.get("subtasks") or []:
                if isinstance(_st, dict):
                    _sid = str(_st.get("id") or "").strip()
                    if _sid:
                        dep_by_id[_sid] = _st
    except Exception:
        dep_by_id = {}
    dep_name_index = _build_subtask_name_index(dep_by_id)

    def _build_dependency_context(sid: str, st: dict[str, Any]) -> str:
        """Build upstream dependency handoff context for dependent subtasks."""
        dep_refs = _subtask_dep_ids(st)
        if not dep_refs:
            return ""
        mem_store = get_task_memory_storage()
        chunks: list[str] = []
        for dep_ref in dep_refs:
            dep_id = _resolve_dep_ref_to_id(
                dep_ref,
                current_sid=sid,
                by_id=dep_by_id,
                name_index=dep_name_index,
            )
            if not dep_id:
                continue
            dep = find_subtask_by_ids(storage, main_task_id, dep_id)
            if not dep:
                continue
            dep_status = str(dep.get("status") or "").strip().lower()
            if dep_status != "completed":
                continue
            dep_name = str(dep.get("name") or dep_id).strip()
            dep_result = str(dep.get("result") or "").strip()
            dep_summary = ""
            dep_step = ""
            try:
                mrow = load_task_memory_for_task_id(storage, mem_store, dep_id)
                if mrow is not None:
                    mem, _pid, _aid, _parent = mrow
                    dep_summary = str(mem.get("output_summary") or "").strip()
                    dep_step = str(mem.get("current_step") or "").strip()
            except Exception:
                logger.debug("build dependency context memory read failed dep=%s", dep_id, exc_info=True)
            lines = [f"- Upstream subtask `{dep_name}` (id={dep_id}) completed."]
            if dep_step:
                lines.append(f"  - Step: {dep_step[:300]}")
            if dep_summary:
                lines.append(f"  - Summary: {dep_summary[:1200]}")
            if dep_result:
                lines.append(f"  - Result: {dep_result[:1200]}")
            chunks.append("\n".join(lines))
        if not chunks:
            return ""
        return (
            "\n\n[Upstream dependency output for downstream consumption]\n"
            + "\n".join(chunks)
            + "\nPlease continue execution based on upstream output; do not re-do upstream work."
        )

    async def _one(sid: str) -> dict[str, Any]:
        st = find_subtask_by_ids(storage, main_task_id, sid)
        if not st:
            return {"subtaskId": sid, "ok": False, "error": "subtask not found"}
        name = (st.get("name") or "subtask").strip() or "subtask"
        desc = (st.get("description") or "").strip()
        prompt = desc if desc else (
            f"Complete subtask '{name}'. Collab main task id: {main_task_id}; subtask id: {sid}."
        )
        dep_ctx = _build_dependency_context(sid, st)
        if dep_ctx:
            prompt = f"{prompt}{dep_ctx}"
        subagent_type = _resolved_subagent_type_for_subtask(st)
        tcid = f"supervisor-start-exec-{main_task_id}-{sid}-{uuid.uuid4().hex[:12]}"
        try:
            out = await delegate_via_task_tool(
                runtime,
                description=name[:120],
                prompt=prompt,
                subagent_type=subagent_type,
                tool_call_id=tcid,
                max_turns=None,
                collab_task_id=main_task_id,
                collab_subtask_id=sid,
                detach=not wait_for_completion,
            )
            text = out if isinstance(out, str) else str(out)
            if text.startswith("Task Detached."):
                return {
                    "subtaskId": sid,
                    "ok": True,
                    "detached": True,
                    "result": text,
                }
            ok = text.startswith("Task Succeeded.")
            err = None if ok else text[:4000]
            return {"subtaskId": sid, "ok": ok, "result": text if ok else None, "error": err}
        except Exception as e:
            logger.exception("delegate subtask %s via task_tool failed", sid)
            return {"subtaskId": sid, "ok": False, "error": str(e)}

    return list(await asyncio.gather(*[_one(sid) for sid in subtask_ids]))


async def auto_delegate_collab_followup_wave(
    runtime: ToolRuntime[ContextT, dict] | None,
    main_task_id: str,
) -> None:
    """When a subtask finishes, start any newly runnable dependents without another ``start_execution``.

    This matches user expectation for ``depends_on`` chains: wave 2+ runs automatically once
    upstream work is ``completed`` (failed upstream keeps dependents blocked).
    """
    from datetime import datetime as _dt

    from deerflow.collab.storage import find_main_task, get_project_storage
    from deerflow.collab.thread_collab import advance_collab_phase_to_executing_for_task
    from deerflow.config.paths import get_paths
    from deerflow.tools.builtins.supervisor.dependency import _resolve_subtasks_for_start_execution
    from deerflow.tools.builtins.supervisor.monitor import _ensure_background_task_monitor
    from deerflow.tools.builtins.supervisor.utils import _runtime_thread_id

    if runtime is None:
        return
    tid = str(main_task_id or "").strip()
    if not tid:
        return
    storage = get_project_storage()
    to_run, _blocked = _resolve_subtasks_for_start_execution(storage, tid, None)
    if not to_run:
        return
    row = find_main_task(storage, tid)
    if not row:
        return
    _proj, main_task = row
    if not bool(main_task.get("execution_authorized")):
        logger.warning("auto_delegate_collab_followup_wave: task %s not execution_authorized; skip", tid)
        return

    _now = _dt.utcnow().isoformat() + "Z"
    to_set = set(to_run)
    for st in main_task.get("subtasks") or []:
        if st.get("id") in to_set:
            st["started_at"] = st.get("started_at") or _now
    storage.save_project(_proj)

    try:
        advance_collab_phase_to_executing_for_task(
            get_paths(), tid, runtime_thread_id=_runtime_thread_id(runtime)
        )
    except Exception:
        logger.exception("auto_delegate_collab_followup_wave: advance_collab_phase failed task_id=%s", tid)

    try:
        delegated = await delegate_collab_subtasks_for_start_execution(
            runtime,
            storage,
            tid,
            to_run,
            wait_for_completion=False,
        )
    except Exception:
        logger.exception("auto_delegate_collab_followup_wave: delegate failed task_id=%s", tid)
        return

    if delegated and any(bool(d.get("detached")) for d in delegated):
        try:
            _ensure_background_task_monitor(
                storage,
                tid,
                runtime_thread_id=_runtime_thread_id(runtime),
            )
        except Exception:
            logger.debug("auto_delegate_collab_followup_wave: background monitor failed", exc_info=True)

    logger.info(
        "auto_delegate_collab_followup_wave: task=%s started %d subtask(s): %s",
        tid,
        len(to_run),
        to_run,
    )


def _resolved_subagent_type_for_subtask(st: dict) -> str:
    """Prefer explicit assigned_to on the subtask row; else worker_profile.base_subagent; else default."""
    a = (st.get("assigned_to") or "").strip()
    if a:
        return a
    wp = st.get("worker_profile")
    if isinstance(wp, dict):
        b = str(wp.get("base_subagent") or "").strip()
        if b:
            return b
    return "general-purpose"


__all__ = [
    "delegate_collab_subtasks_for_start_execution",
    "auto_delegate_collab_followup_wave",
    "_resolved_subagent_type_for_subtask",
]

# ── Register followup handler on collab_bridge at import time ─────────
# This allows task_tool.py to call auto_delegate_collab_followup_wave
# without directly importing supervisor (breaks circular dependency).
try:
    from deerflow.tools.builtins.collab_bridge import register_followup_handler

    register_followup_handler(auto_delegate_collab_followup_wave)
except Exception:
    logger.debug("collab_bridge: failed to register followup handler", exc_info=True)
