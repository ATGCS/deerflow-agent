"""Supervisor tool for multi-agent task planning and coordination."""

import asyncio
import json
import logging
import os
import time
import uuid
from typing import Annotated, Any

from langchain.tools import InjectedToolCallId, ToolRuntime, tool
from langgraph.typing import ContextT
from pydantic import ValidationError

from deerflow.collab.models import CollabPhase, WorkerProfile
from deerflow.collab.authorize_execution import authorize_main_task_execution
from deerflow.collab.storage import (
    find_main_task,
    find_open_main_task_id_by_name,
    find_subtask_by_ids,
    get_project_storage,
    get_task_memory_storage,
    load_task_memory_for_task_id,
    new_project_bundle_root_task,
    rollup_root_task_progress_from_subtasks,
)
from deerflow.collab.thread_collab import (
    advance_collab_phase_to_executing_for_task,
    append_sidebar_supervisor_step,
    load_thread_collab_state,
    merge_thread_collab_state,
    save_thread_collab_state,
)
from deerflow.config.agents_config import load_agent_config, list_all_agents
from deerflow.config.paths import get_paths
from deerflow.subagents import get_available_subagent_names
from deerflow.subagents.builtins import BUILTIN_SUBAGENTS

logger = logging.getLogger(__name__)

_TERMINAL_SUBTASK = frozenset({"completed", "failed", "cancelled"})
# Subtasks already handed to task_tool / subagent — exclude from new start_execution waves.
_IN_FLIGHT_SUBTASK = frozenset({"executing", "running", "in_progress"})
_MONITOR_TERMINAL_MAIN = frozenset({"completed", "failed", "cancelled"})
_bg_task_monitors: dict[str, asyncio.Task[Any]] = {}
_task_watch_state: dict[str, dict[str, Any]] = {}


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

    from deerflow.tools.builtins.task_tool import task_tool as tt
    coro = getattr(tt, "coroutine", None)
    if coro is None:
        logger.error("task_tool has no coroutine; cannot delegate from start_execution")
        return [{"subtaskId": sid, "ok": False, "error": "task_tool unavailable"} for sid in subtask_ids]

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
            lines = [f"- 上游子任务 `{dep_name}`（id={dep_id}）已完成。"]
            if dep_step:
                lines.append(f"  - 完成步骤：{dep_step[:300]}")
            if dep_summary:
                lines.append(f"  - 摘要：{dep_summary[:1200]}")
            if dep_result:
                lines.append(f"  - 结果：{dep_result[:1200]}")
            chunks.append("\n".join(lines))
        if not chunks:
            return ""
        return (
            "\n\n【上游依赖输出（供本子任务直接消费）】\n"
            + "\n".join(chunks)
            + "\n请基于以上上游输出继续执行，不要重复搜索上游已完成的内容。"
        )

    async def _one(sid: str) -> dict[str, Any]:
        st = find_subtask_by_ids(storage, main_task_id, sid)
        if not st:
            return {"subtaskId": sid, "ok": False, "error": "subtask not found"}
        name = (st.get("name") or "subtask").strip() or "subtask"
        desc = (st.get("description") or "").strip()
        prompt = desc if desc else (
            f"完成子任务「{name}」。协作主任务 id: {main_task_id}；子任务 id: {sid}。"
        )
        dep_ctx = _build_dependency_context(sid, st)
        if dep_ctx:
            prompt = f"{prompt}{dep_ctx}"
        subagent_type = _resolved_subagent_type_for_subtask(st)
        tcid = f"supervisor-start-exec-{main_task_id}-{sid}-{uuid.uuid4().hex[:12]}"
        try:
            out = await coro(
                runtime=runtime,
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

    from datetime import datetime as _dt

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
                            detail = f"任务监控：{main_status} · {main_progress}%"
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


def _record_supervisor_ui_step(
    runtime: ToolRuntime[ContextT, dict] | None,
    tool_call_id: str,
    action: str,
    label: str,
) -> None:
    """Persist a compact supervisor step for DeerPanel task sidebar (best-effort)."""
    tid = _runtime_thread_id(runtime)
    if not tid:
        return
    try:
        import uuid as _uuid

        from deerflow.collab.thread_collab import append_sidebar_supervisor_step

        sid = (tool_call_id or "").strip()
        step_id = sid if sid else str(_uuid.uuid4())
        append_sidebar_supervisor_step(
            get_paths(),
            tid,
            {"id": step_id, "action": action, "label": label, "done": True},
        )
    except Exception:
        logger.debug("append sidebar supervisor step failed", exc_info=True)


def _runtime_thread_id(runtime: ToolRuntime[ContextT, dict] | None) -> str | None:
    if runtime is None:
        return None
    ctx = getattr(runtime, "context", None)
    if isinstance(ctx, dict):
        tid = ctx.get("thread_id")
        if tid:
            return str(tid)
    cfg = getattr(runtime, "config", None) or {}
    conf = cfg.get("configurable") or {}
    tid = conf.get("thread_id")
    return str(tid) if tid else None


def _dbg_enabled(runtime: ToolRuntime[ContextT, dict] | None) -> bool:
    # Opt-in noisy logs via runtime context (preferred) or env var (fallback).
    try:
        ctx = getattr(runtime, "context", None)
        if isinstance(ctx, dict) and "DEERFLOW_SUPERVISOR_DEBUG" in ctx:
            v = ctx.get("DEERFLOW_SUPERVISOR_DEBUG")
            if isinstance(v, bool):
                return v
            return str(v).strip().lower() in {"1", "true", "yes", "on"}
    except Exception:
        pass
    return str(os.getenv("DEERFLOW_SUPERVISOR_DEBUG", "")).strip().lower() in {"1", "true", "yes", "on"}


def _repr_with_invisibles(v: object) -> str:
    # Make whitespace/newlines visible in logs.
    s = "" if v is None else str(v)
    return (
        s.replace("\r", "\\r")
        .replace("\n", "\\n")
        .replace("\t", "\\t")
        .replace(" ", "·")
    )


def _clamp_progress(value: int | None) -> int:
    if value is None:
        return 0
    return max(0, min(100, int(value)))


def _subtask_worker_profile_suffix(st: dict) -> str:
    """Compact worker_profile line for list_subtasks / get_status (template + constraints)."""
    wp = st.get("worker_profile")
    if not isinstance(wp, dict) or not wp:
        return ""
    parts: list[str] = []
    b = wp.get("base_subagent")
    if b:
        parts.append(f"base={b}")
    tools = wp.get("tools") or []
    if tools:
        t = ",".join(str(x) for x in tools[:12])
        if len(tools) > 12:
            t += ",..."
        parts.append(f"tools={t}")
    skills = wp.get("skills") or []
    if skills:
        s = ",".join(str(x) for x in skills[:12])
        if len(skills) > 12:
            s += ",..."
        parts.append(f"skills={s}")
    dep = wp.get("depends_on") or []
    if dep:
        parts.append(f"deps={','.join(str(x) for x in dep)}")
    ins = (wp.get("instruction") or "").strip()
    if ins:
        parts.append(f"instr={ins[:80]}{'…' if len(ins) > 80 else ''}")
    if not parts:
        return ""
    return " | profile: " + "; ".join(parts)


def _subtask_row_dict(st: dict) -> dict[str, Any]:
    """Structured subtask row for JSON tool results (get_status / list_subtasks)."""
    status = st.get("status", "unknown")
    icon = {"pending": "⚪", "executing": "🔴", "completed": "✅", "failed": "❌"}.get(status, "⚪")
    wp = st.get("worker_profile")
    summary = _subtask_worker_profile_suffix(st)
    if summary.startswith(" | profile: "):
        summary = summary[len(" | profile: ") :]
    else:
        summary = ""
    return {
        "id": st.get("id"),
        "name": st.get("name", "unnamed"),
        "status": status,
        "statusIcon": icon,
        "assignedTo": st.get("assigned_to") or "unassigned",
        "progress": st.get("progress", 0),
        "workerProfile": wp if isinstance(wp, dict) else None,
        "workerProfileSummary": summary,
    }


def _build_monitor_subtask_rows(
    storage: Any,
    subtasks: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Build rich subtask rows for monitor_execution(_step) to support lead-agent reasoning."""
    sub_rows: list[dict[str, Any]] = []
    failed_subtasks: list[dict[str, Any]] = []
    mem_store = get_task_memory_storage()

    for st in subtasks:
        sid = str(st.get("id") or "")
        s_status = str(st.get("status") or "pending").strip().lower()
        s_prog = st.get("progress", 0) or 0
        s_err = st.get("error") or st.get("failed_at") or None

        wp = st.get("worker_profile")
        wp_dict = wp if isinstance(wp, dict) else None
        observed = st.get("observed_tools") or []
        if not isinstance(observed, list):
            observed = []
        observed_calls = st.get("observed_tool_calls") or []
        if not isinstance(observed_calls, list):
            observed_calls = []

        item: dict[str, Any] = {
            "subtaskId": sid,
            "status": s_status,
            "progress": s_prog,
            "assignedTo": st.get("assigned_to") or "unassigned",
            "workerProfile": wp_dict,
            "workerProfileSummary": _subtask_worker_profile_suffix(st).replace(" | profile: ", ""),
            "observedTools": [str(x) for x in observed if str(x).strip()],
            "observedToolCalls": observed_calls[-40:],
        }

        # If observed tools are not yet available, fall back to worker_profile.tools (planned tools).
        if not item["observedTools"] and isinstance(wp_dict, dict):
            raw_tools = wp_dict.get("tools") or []
            if isinstance(raw_tools, list):
                item["observedTools"] = [str(x) for x in raw_tools if str(x).strip()]

        # Attach subtask memory snapshot (best-effort).
        try:
            if sid:
                mrow = load_task_memory_for_task_id(storage, mem_store, sid)
                if mrow is not None:
                    mem, _project_id, _agent_id, _parent_task_id = mrow
                    facts = mem.get("facts") or []
                    if not isinstance(facts, list):
                        facts = []
                    item["memory"] = {
                        "status": mem.get("status", ""),
                        "progress": mem.get("progress", 0),
                        "current_step": mem.get("current_step", ""),
                        "output_summary": mem.get("output_summary", ""),
                        "factsCount": len(facts),
                    }
        except Exception:
            logger.debug("monitor subtask memory snapshot failed sid=%s", sid, exc_info=True)

        if s_err and s_status in {"failed"}:
            item["error"] = s_err
            failed_subtasks.append(item)

        sub_rows.append(item)

    return sub_rows, failed_subtasks


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
    now = time.time()
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


async def _broadcast_task_event(project_id: str, event_type: str, data: dict) -> None:
    """Best-effort SSE broadcast from supervisor paths."""
    try:
        from deerflow.collab.sse_notify import broadcast_project_event

        await broadcast_project_event(project_id, event_type, data)
    except Exception:
        logger.debug("Failed to broadcast task event", exc_info=True)


def _persist_main_task_memory_snapshot(project: dict, task: dict) -> int:
    """Aggregate subtask memories into the main-task memory file."""
    mem_store = get_task_memory_storage()
    project_id = project.get("id")
    task_id = task.get("id")
    if not project_id or not task_id:
        return 0

    main_agent_id = task.get("assigned_to") or ""
    main_mem = mem_store.load_task_memory(project_id, main_agent_id, task_id)
    main_mem["task_id"] = task_id
    main_mem["project_id"] = project_id
    main_mem["agent_id"] = main_agent_id
    main_mem["status"] = task.get("status") or "pending"
    main_mem["progress"] = _clamp_progress(task.get("progress"))
    main_mem["current_step"] = (
        "All subtasks completed" if (task.get("status") == "completed") else "Task in progress"
    )

    aggregated_facts = []
    output_parts = []
    seen_fact_ids = set()
    for st in task.get("subtasks", []):
        st_id = st.get("id")
        if not st_id:
            continue
        st_agent_id = (st.get("assigned_to") or task.get("assigned_to") or "") or ""
        st_mem = mem_store.load_task_memory(project_id, st_agent_id, st_id)
        out = (st_mem.get("output_summary") or "").strip()
        if out:
            output_parts.append(f"[{st_id}] {out}")
        for fact in st_mem.get("facts", []) or []:
            fid = fact.get("id") or f"{st_id}:{fact.get('content', '')[:64]}"
            if fid in seen_fact_ids:
                continue
            seen_fact_ids.add(fid)
            aggregated_facts.append({**fact, "task_id": st_id})

    if output_parts:
        main_mem["output_summary"] = "\n".join(output_parts)[:8000]
    main_mem["facts"] = aggregated_facts
    if task.get("status") == "completed":
        from datetime import datetime

        now = datetime.utcnow().isoformat() + "Z"
        main_mem["completed_at"] = now

    mem_store.save_task_memory(main_mem)
    return len(aggregated_facts)


@tool("supervisor", parse_docstring=True)
async def supervisor_tool(
    runtime: ToolRuntime[ContextT, dict],
    action: str,
    tool_call_id: Annotated[str, InjectedToolCallId],
    task_name: str | None = None,
    task_description: str | None = None,
    subtask_name: str | None = None,
    subtask_description: str | None = None,
    task_id: str | None = None,
    subtask_id: str | None = None,
    assigned_agent: str | None = None,
    subtasks: list[dict[str, Any]] | None = None,
    subtask_ids: list[str] | None = None,
    progress: int | None = None,
    status: str | None = None,
    authorized_by: str | None = None,
    worker_profile_json: str | None = None,
    wait_for_completion: bool = False,
    monitor_poll_seconds: int = 5,
    monitor_timeout_seconds: int | None = None,
    monitor_step_seconds: int = 10,
) -> str:
    """Supervisor tool for creating and managing complex multi-agent tasks with subtasks.

    Use this tool when:
    - User requests a complex task that requires multiple steps
    - You need to coordinate multiple agents working in parallel
    - You want to track progress across multiple subtasks
    - A task requires diverse skills (research, writing, coding, etc.)

    **Workflow:**
    1. Create a main task with `action=create_task`
    2. Before adding subtasks: call `action=list_subtasks` (or `get_status`) on this `task_id` to see
       existing rows, `assigned_to`, and `worker_profile`. Only `create_subtask` when no suitable row exists.
    3. Add subtasks with `action=create_subtask` or `action=create_subtasks` (optional `worker_profile_json`).
       - Prefer create+assign in one call by passing `assigned_agent` (single) or `subtasks` (batch).
    4. Update progress with `action=update_progress`
    5. Mark completed with `action=complete_subtask`

    Args:
        action: One of create_task, create_subtask, create_subtasks, update_progress,
            complete_subtask, start_execution, monitor_execution, get_status, get_task_memory, list_subtasks, set_task_planned (see workflow above).
        task_name: Name for a new task (required for create_task).
        task_description: Description for a new task (optional for create_task).
        subtask_name: Name for a new subtask (required for create_subtask).
        subtask_description: Description for a new subtask (optional for create_subtask).
        task_id: Main task id (required for create_subtask, get_status, get_task_memory, list_subtasks, set_task_planned).
        subtask_id: ID of an existing subtask (required for complete_subtask; optional for update_progress when updating main task).
        assigned_agent: Agent ID for create_subtask (optional); must be a configured subagent name。
            When used with `action=\"create_subtask\"`, the new subtask will be created already assigned (create+assign).
        subtasks: For create_subtasks: list of subtask objects (batch create+assign).
            Each item may include fields such as name (required), description, assigned_agent, worker_profile_json (JSON string).
        subtask_ids: For start_execution: optional; if set, only these ids are *considered*
            (must exist on the task). Each subtask actually delegated must still be assigned,
            non-terminal, and have every `worker_profile.depends_on` upstream in `completed`.
            Ready ids in the allowed set run in parallel in one call; others appear in
            `blockedSubtasks` in the JSON result. If omitted/empty after normalize, the tool
            auto-picks every assigned non-terminal subtask whose dependencies are satisfied
            (same parallel batch); still-waiting subtasks are listed in `blockedSubtasks`.
        progress: Progress 0-100 (required for update_progress).
        status: Optional status for update_progress (e.g. `failed`, `cancelled`, `completed`). When provided, it will be persisted to subtask/main task and rolled up into main task status.
        authorized_by: Recorded on authorize/start_execution (default lead for start_execution).
        worker_profile_json: Optional JSON object string for create_subtask (worker constraints, tools, etc.).
        wait_for_completion: For start_execution only. If False (default), kick off subagents in the
            background and return immediately so the lead model is not blocked; completion is persisted
            by the task tool's async polling. If True, block until each subagent run finishes (legacy).
        monitor_poll_seconds: For monitor_execution/monitor_execution_step only. Poll interval in seconds.
        monitor_timeout_seconds: For monitor_execution only. If provided, stop polling after this many seconds.
        monitor_step_seconds: For monitor_execution_step only. How long (max) to wait before returning a snapshot.
    """
    # NOTE: `assigned_agent` for create_subtask(s) refers to *subagent template name* (subagent_type),
    # not a "custom agent" config entry from agents/ directory. These are different namespaces.
    available_agents = get_available_subagent_names()
    storage = get_project_storage()

    # Normalize ids to avoid mismatches caused by model/tool serialization adding
    # accidental whitespace (e.g. "ccd29719 " or "ccd29719\n").
    def _norm_id(v: str | None) -> str | None:
        if v is None:
            return None
        return v.strip() if isinstance(v, str) else str(v).strip()

    task_id = _norm_id(task_id)
    subtask_id = _norm_id(subtask_id)
    assigned_agent = _norm_id(assigned_agent)
    if subtasks is not None and not isinstance(subtasks, list):
        subtasks = None
    if subtask_ids is not None:
        _sid_clean: list[str] = []
        for _s in subtask_ids:
            _n = _norm_id(_s) if _s is not None else None
            if _n:
                _sid_clean.append(_n)
        subtask_ids = _sid_clean or None

    if _dbg_enabled(runtime):
        try:
            storage_dir = getattr(storage, "_storage_dir", None)
        except Exception:
            storage_dir = "<error>"
        logger.warning(
            "supervisor_tool(debug): action=%s tool_call_id=%s runtime_thread_id=%s "
            "task_id=%s(%s) subtask_id=%s(%s) assigned_agent=%s(%s) storage_dir=%r available_agents=%r",
            action,
            tool_call_id,
            _runtime_thread_id(runtime),
            task_id,
            _repr_with_invisibles(task_id),
            subtask_id,
            _repr_with_invisibles(subtask_id),
            assigned_agent,
            _repr_with_invisibles(assigned_agent),
            str(storage_dir),
            list(available_agents),
        )

    if action == "create_task":
        if not task_name:
            return json.dumps({
                "success": False,
                "action": "create_task",
                "error": "task_name is required for create_task action"
            }, ensure_ascii=False)

        task_id_new = find_open_main_task_id_by_name(storage, task_name)
        if task_id_new:
            return json.dumps({
                "success": False,
                "action": "create_task",
                "error": f"Task '{task_name}' already exists with ID: {task_id_new}",
                "existingTaskId": task_id_new
            }, ensure_ascii=False)

        bound_thread = _runtime_thread_id(runtime)
        project_data, task_data = new_project_bundle_root_task(
            task_name,
            task_description or "",
            thread_id=bound_thread,
        )

        if storage.save_project(project_data):
            logger.info(f"Created task '{task_name}' with ID: {task_data['id']}")
            
            # 返回结构化的 JSON 格式，方便前端解析
            result = {
                "success": True,
                "taskId": task_data['id'],
                "id": task_data['id'],  # 兼容性字段
                "task_id": task_data['id'],  # 兼容性字段
                "name": task_name,
                "description": task_description or "",
                "projectId": project_data.get('id'),
                "project_id": project_data.get('id'),  # 兼容性字段
                "parent_project_id": project_data.get('id'),  # 兼容性字段
                "projectName": project_data.get('name', ''),
                "threadId": bound_thread,
                "status": "pending",
                "progress": 0
            }
            _record_supervisor_ui_step(
                runtime, tool_call_id, "create_task", f"创建主任务：{task_name}"
            )
            return json.dumps(result, ensure_ascii=False)
        return json.dumps({
            "success": False,
            "action": "create_task",
            "error": "Failed to create task"
        }, ensure_ascii=False)

    elif action == "create_subtasks":
        if not task_id:
            return json.dumps(
                {
                    "success": False,
                    "action": "create_subtasks",
                    "error": "task_id is required for create_subtasks action",
                },
                ensure_ascii=False,
            )
        if not subtasks or not isinstance(subtasks, list):
            return json.dumps(
                {
                    "success": False,
                    "action": "create_subtasks",
                    "error": "subtasks (array) is required for create_subtasks action",
                },
                ensure_ascii=False,
            )

        created: list[dict[str, Any]] = []
        errors: list[dict[str, Any]] = []

        def _normalize_depends_on_in_worker_profile(
            wp: dict[str, Any] | None,
            existing_subtasks: list[dict[str, Any]],
        ) -> tuple[dict[str, Any] | None, list[str]]:
            """Normalize worker_profile.depends_on from names/ids -> ids."""
            if not isinstance(wp, dict):
                return wp, []
            raw_dep = wp.get("depends_on")
            if not isinstance(raw_dep, list) or not raw_dep:
                return wp, []

            by_id: dict[str, dict[str, Any]] = {}
            by_name: dict[str, list[str]] = {}
            for st in existing_subtasks:
                if not isinstance(st, dict):
                    continue
                sid = str(st.get("id") or "").strip()
                if not sid:
                    continue
                by_id[sid] = st
                nm = str(st.get("name") or "").strip()
                if nm:
                    by_name.setdefault(nm, []).append(sid)

            normalized: list[str] = []
            unresolved: list[str] = []
            for dep in raw_dep:
                ref = str(dep or "").strip()
                if not ref:
                    continue
                if ref in by_id:
                    normalized.append(ref)
                    continue
                cands = by_name.get(ref) or []
                if len(cands) == 1:
                    normalized.append(cands[0])
                    continue
                unresolved.append(ref)
                normalized.append(ref)

            if normalized == raw_dep:
                return wp, unresolved
            merged = dict(wp)
            merged["depends_on"] = normalized
            return merged, unresolved

        def _parse_wp_json(raw: str | None) -> dict | None:
            if raw is None:
                return None
            if not str(raw).strip():
                return None
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                raise ValueError("worker_profile_json must be valid JSON")
            if not isinstance(parsed, dict):
                raise ValueError("worker_profile_json must be a JSON object")
            wp = WorkerProfile.model_validate(parsed)
            return wp.to_storage_dict() or None

        projects = storage.list_projects()
        for project_summary in projects:
            project = storage.load_project(project_summary["id"])
            if not project:
                continue
            for i, task in enumerate(project.get("tasks", [])):
                if task.get("id") != task_id:
                    continue

                import uuid as _uuid
                from datetime import datetime

                now = datetime.utcnow().isoformat() + "Z"
                for idx, spec in enumerate(subtasks):
                    if not isinstance(spec, dict):
                        errors.append({"index": idx, "error": "subtasks[i] must be an object"})
                        continue
                    nm = str(spec.get("name") or spec.get("subtask_name") or "").strip()
                    if not nm:
                        errors.append({"index": idx, "error": "subtasks[i].name is required"})
                        continue
                    desc = str(spec.get("description") or spec.get("subtask_description") or "").strip()
                    agent = str(spec.get("assigned_agent") or spec.get("assignedTo") or "").strip() or None
                    # UX: Do not fail the row on unknown assigned_agent.
                    # Create the subtask unassigned and return a warning so the lead agent
                    # can proceed without getting stuck in "Unknown agent" loops.
                    row_warnings: list[dict[str, Any]] = []
                    if agent and agent not in available_agents:
                        row_warnings.append(
                            {
                                "index": idx,
                                "name": nm,
                                "warning": f"Unknown subagent template '{agent}' (subtask created unassigned)",
                                "availableSubagents": list(available_agents),
                            }
                        )
                        agent = None
                    wp_raw = spec.get("worker_profile_json")
                    try:
                        worker_profile = _parse_wp_json(str(wp_raw) if wp_raw is not None else None)
                    except (ValidationError, ValueError) as e:
                        errors.append({"index": idx, "name": nm, "error": str(e)})
                        continue

                    # Friendly spec fields (so lead model doesn't need upstream ids beforehand):
                    # subtasks[i].depends_on / dependsOn can be names or ids.
                    # Also allow direct worker-profile knobs without forcing worker_profile_json.
                    direct_dep = spec.get("depends_on")
                    if direct_dep is None:
                        direct_dep = spec.get("dependsOn")
                    direct_instr = spec.get("instruction")
                    direct_tools = spec.get("tools")
                    direct_skills = spec.get("skills")
                    direct_model = spec.get("model")
                    has_direct_profile = any(
                        x is not None for x in [direct_dep, direct_instr, direct_tools, direct_skills, direct_model]
                    )
                    if has_direct_profile:
                        wp_obj: dict[str, Any] = dict(worker_profile or {})
                        if direct_dep is not None:
                            if isinstance(direct_dep, list):
                                wp_obj["depends_on"] = [str(x).strip() for x in direct_dep if str(x).strip()]
                            else:
                                row_warnings.append(
                                    {
                                        "index": idx,
                                        "name": nm,
                                        "warning": "subtasks[i].depends_on must be an array; ignored",
                                    }
                                )
                        if isinstance(direct_instr, str) and direct_instr.strip():
                            wp_obj["instruction"] = direct_instr.strip()
                        if isinstance(direct_tools, list):
                            wp_obj["tools"] = [str(x).strip() for x in direct_tools if str(x).strip()]
                        if isinstance(direct_skills, list):
                            wp_obj["skills"] = [str(x).strip() for x in direct_skills if str(x).strip()]
                        if isinstance(direct_model, str) and direct_model.strip():
                            wp_obj["model"] = direct_model.strip()
                        # Default base_subagent from assignment when absent.
                        if not str(wp_obj.get("base_subagent") or "").strip() and agent:
                            wp_obj["base_subagent"] = agent
                        try:
                            wp_valid = WorkerProfile.model_validate(wp_obj)
                            worker_profile = wp_valid.to_storage_dict() or None
                        except ValidationError as e:
                            errors.append({"index": idx, "name": nm, "error": f"direct worker profile: {e}"})
                            continue

                    subtask_data: dict[str, Any] = {
                        "id": str(_uuid.uuid4())[:8],
                        "name": nm,
                        "description": desc,
                        "status": "pending",
                        "dependencies": [],
                        "assigned_to": agent,
                        "result": None,
                        "error": None,
                        "created_at": now,
                        "started_at": None,
                        "completed_at": None,
                        "progress": 0,
                    }
                    if worker_profile is not None:
                        worker_profile, unresolved_dep = _normalize_depends_on_in_worker_profile(
                            worker_profile,
                            [x for x in (task.get("subtasks") or []) if isinstance(x, dict)],
                        )
                        subtask_data["worker_profile"] = worker_profile
                        if unresolved_dep:
                            row_warnings.append(
                                {
                                    "index": idx,
                                    "name": nm,
                                    "warning": "depends_on contains unresolved references (kept as-is)",
                                    "unresolvedDependsOn": unresolved_dep,
                                }
                            )
                        # 若未显式 assigned_agent，且 profile 提供 base_subagent，则默认按 profile 分配
                        if not subtask_data.get("assigned_to"):
                            bs = str(worker_profile.get("base_subagent") or "").strip()
                            if bs:
                                subtask_data["assigned_to"] = bs

                    task.setdefault("subtasks", []).append(subtask_data)
                    created.append(
                        {
                            "subtaskId": subtask_data["id"],
                            "id": subtask_data["id"],
                            "subtask_id": subtask_data["id"],
                            "name": nm,
                            "description": desc,
                            "parentTaskId": task_id,
                            "task_id": task_id,
                            "status": "pending",
                            "progress": 0,
                            **(
                                {"assignedTo": subtask_data["assigned_to"]}
                                if subtask_data.get("assigned_to")
                                else {}
                            ),
                            **({"warnings": row_warnings} if row_warnings else {}),
                        }
                    )

                project["tasks"][i] = task
                storage.save_project(project)
                _record_supervisor_ui_step(
                    runtime,
                    tool_call_id,
                    "create_subtasks",
                    f"批量创建子任务：{len(created)} 个",
                )
                return json.dumps(
                    {
                        "success": len(created) > 0,
                        "action": "create_subtasks",
                        "taskId": task_id,
                        "created": created,
                        "errors": errors,
                    },
                    ensure_ascii=False,
                )

        return json.dumps(
            {"success": False, "action": "create_subtasks", "error": f"Task '{task_id}' not found"},
            ensure_ascii=False,
        )

    elif action == "create_subtask":
        if not task_id or not subtask_name:
            return json.dumps({
                "success": False,
                "action": "create_subtask",
                "error": "task_id and subtask_name are required for create_subtask action"
            }, ensure_ascii=False)
        warnings: list[dict[str, Any]] = []
        if assigned_agent and assigned_agent not in available_agents:
            warnings.append(
                {
                    "warning": f"Unknown subagent template '{assigned_agent}' (subtask created unassigned)",
                    "availableSubagents": list(available_agents),
                }
            )
            assigned_agent = None

        worker_profile: dict | None = None
        if worker_profile_json and str(worker_profile_json).strip():
            try:
                parsed = json.loads(worker_profile_json)
            except json.JSONDecodeError:
                return json.dumps({
                    "success": False,
                    "action": "create_subtask",
                    "error": "worker_profile_json must be valid JSON"
                }, ensure_ascii=False)
            if not isinstance(parsed, dict):
                return json.dumps({
                    "success": False,
                    "action": "create_subtask",
                    "error": "worker_profile_json must be a JSON object"
                }, ensure_ascii=False)
            try:
                wp = WorkerProfile.model_validate(parsed)
            except ValidationError as e:
                return json.dumps({
                    "success": False,
                    "action": "create_subtask",
                    "error": f"worker_profile_json: {e}"
                }, ensure_ascii=False)
            worker_profile = wp.to_storage_dict() or None

        def _normalize_depends_on_in_worker_profile_single(
            wp: dict[str, Any] | None,
            existing_subtasks: list[dict[str, Any]],
        ) -> tuple[dict[str, Any] | None, list[str]]:
            if not isinstance(wp, dict):
                return wp, []
            raw_dep = wp.get("depends_on")
            if not isinstance(raw_dep, list) or not raw_dep:
                return wp, []
            by_id: dict[str, dict[str, Any]] = {}
            by_name: dict[str, list[str]] = {}
            for st in existing_subtasks:
                if not isinstance(st, dict):
                    continue
                sid = str(st.get("id") or "").strip()
                if not sid:
                    continue
                by_id[sid] = st
                nm = str(st.get("name") or "").strip()
                if nm:
                    by_name.setdefault(nm, []).append(sid)
            normalized: list[str] = []
            unresolved: list[str] = []
            for dep in raw_dep:
                ref = str(dep or "").strip()
                if not ref:
                    continue
                if ref in by_id:
                    normalized.append(ref)
                    continue
                cands = by_name.get(ref) or []
                if len(cands) == 1:
                    normalized.append(cands[0])
                    continue
                unresolved.append(ref)
                normalized.append(ref)
            if normalized == raw_dep:
                return wp, unresolved
            merged = dict(wp)
            merged["depends_on"] = normalized
            return merged, unresolved

        projects = storage.list_projects()
        task_found = False

        for project_summary in projects:
            project = storage.load_project(project_summary["id"])
            if project:
                for i, task in enumerate(project.get("tasks", [])):
                    if task.get("id") == task_id:
                        import uuid
                        from datetime import datetime

                        now = datetime.utcnow().isoformat() + "Z"
                        subtask_data = {
                            "id": str(uuid.uuid4())[:8],
                            "name": subtask_name,
                            "description": subtask_description or "",
                            "status": "pending",
                            "dependencies": [],
                            "assigned_to": assigned_agent or None,
                            "result": None,
                            "error": None,
                            "created_at": now,
                            "started_at": None,
                            "completed_at": None,
                            "progress": 0,
                        }
                        if worker_profile is not None:
                            worker_profile, unresolved_dep = _normalize_depends_on_in_worker_profile_single(
                                worker_profile,
                                [x for x in (task.get("subtasks") or []) if isinstance(x, dict)],
                            )
                            subtask_data["worker_profile"] = worker_profile
                            if unresolved_dep:
                                warnings.append(
                                    {
                                        "warning": "depends_on contains unresolved references (kept as-is)",
                                        "unresolvedDependsOn": unresolved_dep,
                                    }
                                )
                            bs = str(worker_profile.get("base_subagent") or "").strip()
                            if bs:
                                # 若未显式指定 assigned_agent，则默认用 profile.base_subagent
                                if not subtask_data.get("assigned_to"):
                                    subtask_data["assigned_to"] = bs

                        task.setdefault("subtasks", []).append(subtask_data)
                        project["tasks"][i] = task
                        storage.save_project(project)
                        task_found = True
                        logger.info(f"Created subtask '{subtask_name}' in task {task_id}")
                        
                        # 返回结构化的 JSON 格式
                        result = {
                            "success": True,
                            "action": "create_subtask",
                            "subtaskId": subtask_data['id'],
                            "id": subtask_data['id'],
                            "subtask_id": subtask_data['id'],
                            "name": subtask_name,
                            "description": subtask_description or "",
                            "parentTaskId": task_id,
                            "task_id": task_id,
                            "status": "pending",
                            "progress": 0,
                            **(
                                {"assignedTo": subtask_data["assigned_to"]}
                                if subtask_data.get("assigned_to")
                                else {}
                            ),
                        }
                        if warnings:
                            result["warnings"] = warnings
                        _record_supervisor_ui_step(
                            runtime,
                            tool_call_id,
                            "create_subtask",
                            f"创建子任务：{subtask_name}" + (f" → {subtask_data.get('assigned_to')}" if subtask_data.get("assigned_to") else ""),
                        )
                        return json.dumps(result, ensure_ascii=False)

        if not task_found:
            return json.dumps({
                "success": False,
                "action": "create_subtask",
                "error": f"Task '{task_id}' not found"
            }, ensure_ascii=False)

    elif action == "update_progress":
        if not task_id:
            return json.dumps({
                "success": False,
                "action": "update_progress",
                "error": "task_id is required for update_progress action"
            }, ensure_ascii=False)
        if progress is None:
            return json.dumps({
                "success": False,
                "action": "update_progress",
                "error": "progress is required for update_progress action (0-100)"
            }, ensure_ascii=False)

        progress_value = _clamp_progress(progress)
        status_norm: str | None = None
        now: str | None = None
        if status is not None:
            status_norm = str(status).strip().lower()
            if status_norm in {"done"}:
                status_norm = "completed"
            if status_norm in {"error"}:
                status_norm = "failed"
            if status_norm in {"canceled"}:
                status_norm = "cancelled"
            if status_norm in {"executing", "running", "in_progress"}:
                status_norm = "in_progress"
            if status_norm in {"pending", "planning", "planned"}:
                status_norm = "in_progress"
            if status_norm in {"completed", "failed", "cancelled"}:
                from datetime import datetime as _dt
                now = _dt.utcnow().isoformat() + "Z"

        effective_progress = 100 if status_norm == "completed" else progress_value

        projects = storage.list_projects()

        for project_summary in projects:
            project = storage.load_project(project_summary["id"])
            if project:
                for i, task in enumerate(project.get("tasks", [])):
                    if task.get("id") == task_id:
                        if subtask_id:
                            for j, subtask in enumerate(task.get("subtasks", [])):
                                if subtask.get("id") == subtask_id:
                                    if status_norm == "completed":
                                        subtask["status"] = "completed"
                                        subtask["progress"] = effective_progress
                                        if "completed_at" in subtask:
                                            subtask["completed_at"] = subtask.get("completed_at") or now
                                    elif status_norm == "failed":
                                        subtask["status"] = "failed"
                                        subtask["progress"] = effective_progress
                                        subtask["failed_at"] = subtask.get("failed_at") or now
                                    elif status_norm == "cancelled":
                                        subtask["status"] = "cancelled"
                                        subtask["progress"] = effective_progress
                                    elif status_norm:
                                        subtask["status"] = status_norm
                                        subtask["progress"] = effective_progress
                                    else:
                                        subtask["progress"] = progress_value
                                    task["subtasks"][j] = subtask
                                    project["tasks"][i] = task
                                    storage.save_project(project)
                                    # Root status convergence depends on all subtasks' terminal states.
                                    rollup_root_task_progress_from_subtasks(storage, task_id)
                                    await _broadcast_task_event(
                                        project.get("id"),
                                        "task:progress",
                                        {
                                            "task_id": subtask_id,
                                            "progress": effective_progress,
                                            "current_step": "",
                                        },
                                    )
                                    
                                    # 返回结构化的 JSON 格式
                                    result = {
                                        "success": True,
                                        "action": "update_progress",
                                        "subtaskId": subtask_id,
                                        "taskId": task_id,
                                        "progress": effective_progress,
                                        "message": f"Updated progress of subtask {subtask_id} to {progress_value}%"
                                    }
                                    return json.dumps(result, ensure_ascii=False)
                            return json.dumps({
                                "success": False,
                                "action": "update_progress",
                                "error": f"Subtask '{subtask_id}' not found"
                            }, ensure_ascii=False)
                        task["progress"] = progress_value
                        if status_norm:
                            if status_norm == "completed":
                                task["status"] = "completed"
                                task["progress"] = effective_progress
                                if "completed_at" in task:
                                    task["completed_at"] = task.get("completed_at") or now
                            elif status_norm == "failed":
                                task["status"] = "failed"
                                if "failed_at" in task:
                                    task["failed_at"] = task.get("failed_at") or now
                            elif status_norm == "cancelled":
                                task["status"] = "cancelled"
                            else:
                                task["status"] = status_norm
                        project["tasks"][i] = task
                        storage.save_project(project)
                        _persist_main_task_memory_snapshot(project, task)
                        rollup_root_task_progress_from_subtasks(storage, task_id)
                        await _broadcast_task_event(
                            project.get("id"),
                            "task:progress",
                            {
                                "task_id": task_id,
                                "progress": effective_progress,
                                "current_step": "",
                            },
                        )
                        
                        # 返回结构化的 JSON 格式
                        result = {
                            "success": True,
                            "action": "update_progress",
                            "taskId": task_id,
                            "progress": effective_progress,
                            "message": f"Updated progress of main task {task_id} to {effective_progress}%"
                        }
                        _record_supervisor_ui_step(
                            runtime,
                            tool_call_id,
                            "update_progress",
                            f"主任务进度 {effective_progress}%",
                        )
                        return json.dumps(result, ensure_ascii=False)

        return json.dumps({
            "success": False,
            "action": "update_progress",
            "error": f"Task '{task_id}' not found"
        }, ensure_ascii=False)

    elif action == "complete_subtask":
        if not task_id or not subtask_id:
            return json.dumps({
                "success": False,
                "action": "complete_subtask",
                "error": "task_id and subtask_id are required for complete_subtask action"
            }, ensure_ascii=False)

        projects = storage.list_projects()

        for project_summary in projects:
            project = storage.load_project(project_summary["id"])
            if project:
                for i, task in enumerate(project.get("tasks", [])):
                    if task.get("id") == task_id:
                        for j, subtask in enumerate(task.get("subtasks", [])):
                            if subtask.get("id") == subtask_id:
                                import uuid
                                from datetime import datetime

                                now = datetime.utcnow().isoformat() + "Z"
                                subtask["status"] = "completed"
                                subtask["progress"] = 100
                                subtask["completed_at"] = now
                                task["subtasks"][j] = subtask
                                # If all subtasks are completed, mark the parent task completed too.
                                if task.get("subtasks") and all(
                                    (s.get("status") == "completed") for s in task.get("subtasks", [])
                                ):
                                    task["status"] = "completed"
                                    task["progress"] = 100
                                    if not task.get("completed_at"):
                                        task["completed_at"] = now
                                project["tasks"][i] = task
                                storage.save_project(project)
                                await _broadcast_task_event(
                                    project.get("id"),
                                    "task:completed",
                                    {"task_id": subtask_id, "result": subtask.get("result")},
                                )
                                facts_count = _persist_main_task_memory_snapshot(project, task)
                                await _broadcast_task_event(
                                    project.get("id"),
                                    "task_memory:updated",
                                    {"task_id": task_id, "facts_count": facts_count},
                                )
                                if task.get("status") == "completed":
                                    await _broadcast_task_event(
                                        project.get("id"),
                                        "task:completed",
                                        {"task_id": task_id, "result": task.get("result")},
                                    )
                                logger.info(f"Completed subtask {subtask_id}")
                                
                                # 返回结构化的 JSON 格式
                                result = {
                                    "success": True,
                                    "action": "complete_subtask",
                                    "subtaskId": subtask_id,
                                    "taskId": task_id,
                                    "status": "completed",
                                    "message": f"Subtask {subtask_id} marked as completed"
                                }
                                return json.dumps(result, ensure_ascii=False)
                        return json.dumps({
                            "success": False,
                            "action": "complete_subtask",
                            "error": f"Subtask '{subtask_id}' not found in task '{task_id}'"
                        }, ensure_ascii=False)
        return json.dumps({
            "success": False,
            "action": "complete_subtask",
            "error": f"Task '{task_id}' not found"
        }, ensure_ascii=False)

    elif action == "start_execution":
        if not task_id:
            return json.dumps({
                "success": False,
                "action": "start_execution",
                "error": "task_id is required for start_execution action"
            }, ensure_ascii=False)
        actor = authorized_by or "lead"

        if subtask_ids:
            row = find_main_task(storage, task_id)
            if not row:
                return json.dumps({
                    "success": False,
                    "action": "start_execution",
                    "taskId": task_id,
                    "error": f"Task '{task_id}' not found",
                }, ensure_ascii=False)
            _project, _task = row
            _existing = {st.get("id") for st in (_task.get("subtasks") or [])}
            _missing = [x for x in subtask_ids if x not in _existing]
            if _missing:
                return json.dumps({
                    "success": False,
                    "action": "start_execution",
                    "taskId": task_id,
                    "error": f"Subtask id(s) not under this task: {_missing}",
                }, ensure_ascii=False)

        ok, msg = authorize_main_task_execution(storage, task_id, actor)
        if not ok:
            return json.dumps({
                "success": False,
                "action": "start_execution",
                "taskId": task_id,
                "error": msg
            }, ensure_ascii=False)

        to_run, blocked_subtasks = _resolve_subtasks_for_start_execution(
            storage, task_id, subtask_ids
        )
        if to_run:
            from datetime import datetime as _dt

            _now = _dt.utcnow().isoformat() + "Z"
            row_mark = find_main_task(storage, task_id)
            if row_mark:
                proj_mark, t_mark = row_mark
                to_set = set(to_run)
                for st in t_mark.get("subtasks") or []:
                    if st.get("id") in to_set:
                        st["started_at"] = st.get("started_at") or _now
                storage.save_project(proj_mark)

        # 与 HTTP authorize-execution 对齐：必须把该聊天线程的 collab_phase 推进到 executing，
        # 否则 CollabPhaseMiddleware 仍提示「等待执行」。随后对本批子任务并行调用 task 工具，子智能体开始实际执行。
        phase_ok = False
        try:
            phase_ok = advance_collab_phase_to_executing_for_task(
                get_paths(), task_id, runtime_thread_id=_runtime_thread_id(runtime)
            )
        except Exception:
            logger.exception("start_execution: advance_collab_phase_to_executing_for_task failed for task_id=%s", task_id)

        delegated: list[dict[str, Any]] = []
        if to_run:
            try:
                delegated = await delegate_collab_subtasks_for_start_execution(
                    runtime,
                    storage,
                    task_id,
                    to_run,
                    wait_for_completion=wait_for_completion,
                )
            except Exception:
                logger.exception("start_execution: delegate_collab_subtasks_for_start_execution failed task_id=%s", task_id)
                delegated = [
                    {"subtaskId": sid, "ok": False, "error": "delegation failed"}
                    for sid in to_run
                ]

        all_ok = all(d.get("ok") for d in delegated) if delegated else True

        # Server-side convergence: persist delegated subtask/main-task status immediately,
        # so UI does not depend on model remembering extra supervisor calls.
        row_done = find_main_task(storage, task_id)
        if row_done and delegated:
            from datetime import datetime as _dt

            proj_done, task_done = row_done
            now_done = _dt.utcnow().isoformat() + "Z"
            delegated_map: dict[str, dict[str, Any]] = {
                str(d.get("subtaskId")): d for d in delegated if d.get("subtaskId")
            }
            for st in task_done.get("subtasks") or []:
                sid = str(st.get("id") or "")
                rec = delegated_map.get(sid)
                if not rec:
                    continue
                if rec.get("detached"):
                    continue
                st["updated_at"] = now_done
                if rec.get("ok"):
                    st["status"] = "completed"
                    st["progress"] = 100
                    st["completed_at"] = st.get("completed_at") or now_done
                else:
                    if (st.get("status") or "").strip().lower() != "completed":
                        st["status"] = "failed"
                    st["failed_at"] = st.get("failed_at") or now_done
            subtasks_all = task_done.get("subtasks") or []
            total = len(subtasks_all)
            completed_cnt = sum(1 for s in subtasks_all if (s.get("status") or "").strip().lower() == "completed")
            failed_cnt = sum(1 for s in subtasks_all if (s.get("status") or "").strip().lower() == "failed")
            terminal_cnt = sum(
                1
                for s in subtasks_all
                if (s.get("status") or "").strip().lower() in {"completed", "failed", "cancelled"}
            )
            if total > 0 and completed_cnt == total:
                task_done["status"] = "completed"
                task_done["progress"] = 100
                task_done["completed_at"] = task_done.get("completed_at") or now_done
            elif total > 0 and terminal_cnt == total and failed_cnt > 0:
                # All subtasks terminated and at least one failed -> mark main task failed.
                task_done["status"] = "failed"
                task_done["failed_at"] = task_done.get("failed_at") or now_done
                task_done["progress"] = int((completed_cnt / total) * 100)
            elif total > 0:
                task_done["status"] = "in_progress"
                task_done["progress"] = int((completed_cnt / total) * 100)
            task_done["updated_at"] = now_done
            if storage.save_project(proj_done):
                facts_count = _persist_main_task_memory_snapshot(proj_done, task_done)
                await _broadcast_task_event(
                    proj_done.get("id"),
                    "task_memory:updated",
                    {"task_id": task_id, "facts_count": facts_count},
                )
                await _broadcast_task_event(
                    proj_done.get("id"),
                    "task:progress",
                    {
                        "task_id": task_id,
                        "progress": int(task_done.get("progress") or 0),
                        "current_step": "",
                    },
                )
                if (task_done.get("status") or "").strip().lower() == "completed":
                    await _broadcast_task_event(
                        proj_done.get("id"),
                        "task:completed",
                        {"task_id": task_id, "result": task_done.get("result")},
                    )

        # 返回结构化的 JSON 格式
        _msg = f"Execution authorized for task {task_id}. ({msg})"
        auto_follow = False
        follow_payload: dict[str, Any] | None = None
        if not wait_for_completion and to_run:
            _msg += " Subagents are running in the background; the lead thread is not blocked."
            if any(bool(d.get("detached")) for d in delegated):
                auto_follow = True
                try:
                    _ensure_background_task_monitor(
                        storage,
                        task_id,
                        _runtime_thread_id(runtime),
                        poll_seconds=max(1.0, float(monitor_poll_seconds or 2)),
                    )
                except Exception:
                    logger.debug("start_execution: ensure background monitor failed", exc_info=True)
                # Backend-controlled follow loop: keep the main tool turn alive and poll repeatedly
                # so the lead agent can continue reasoning with fresh snapshots.
                try:
                    follow_payload = await _monitor_main_task_until_terminal(
                        storage,
                        task_id,
                        poll_seconds=max(1.0, float(monitor_poll_seconds or 2)),
                        timeout_seconds=monitor_timeout_seconds,
                        timeline_step_seconds=max(2, int(monitor_step_seconds or 5)),
                        # Keep the lead model responsive: return incremental snapshot quickly.
                        slice_seconds=2,
                    )
                except Exception:
                    logger.debug("start_execution: auto-follow monitor failed", exc_info=True)
                    follow_payload = {
                        "success": False,
                        "error": "auto-follow monitor failed",
                    }
        if blocked_subtasks:
            _msg += f" {len(blocked_subtasks)} subtask(s) skipped (not ready — see blockedSubtasks)."
        result = {
            "success": True,
            "action": "start_execution",
            "taskId": task_id,
            "authorizedBy": actor,
            "message": _msg,
            "collabPhaseAdvanced": phase_ok,
            "waitForCompletion": wait_for_completion,
            "subtaskIds": to_run,
            "blockedSubtasks": blocked_subtasks,
            "delegatedSubtasks": delegated,
            "delegationAllSucceeded": all_ok,
            "autoFollowed": auto_follow,
            "mustContinueMonitoring": bool(auto_follow),
            "nextMonitorInSeconds": 2 if auto_follow else 0,
        }
        if follow_payload is not None:
            result["follow"] = follow_payload
        return json.dumps(result, ensure_ascii=False)

    elif action == "set_task_planned":
        if not task_id:
            return json.dumps({
                "success": False,
                "action": "set_task_planned",
                "error": "task_id is required for set_task_planned action"
            }, ensure_ascii=False)
        
        # 查找并更新任务状态（须遍历全部 project：任务可能在非列表首项的工程中）
        projects = storage.list_projects()
        for project_summary in projects:
            project = storage.load_project(project_summary["id"])
            if not project:
                continue
            for i, task in enumerate(project.get("tasks", [])):
                if task.get("id") == task_id:
                    from datetime import datetime

                    now = datetime.utcnow().isoformat() + "Z"
                    task["status"] = "planned"
                    task["updated_at"] = now
                    project["tasks"][i] = task
                    
                    if storage.save_project(project):
                        result = {
                            "success": True,
                            "action": "set_task_planned",
                            "taskId": task_id,
                            "status": "planned",
                            "message": f"Task {task_id} status set to planned"
                        }
                        _record_supervisor_ui_step(
                            runtime,
                            tool_call_id,
                            "set_task_planned",
                            f"任务已规划：{task_id}",
                        )
                        return json.dumps(result, ensure_ascii=False)
                    else:
                        return json.dumps({
                            "success": False,
                            "action": "set_task_planned",
                            "taskId": task_id,
                            "error": "Failed to save project"
                        }, ensure_ascii=False)

        return json.dumps({
            "success": False,
            "action": "set_task_planned",
            "taskId": task_id,
            "error": f"Task '{task_id}' not found"
        }, ensure_ascii=False)

    elif action == "get_status":
        if not task_id:
            return json.dumps({
                "success": False,
                "action": "get_status",
                "error": "task_id is required for get_status action"
            }, ensure_ascii=False)

        projects = storage.list_projects()

        for project_summary in projects:
            project = storage.load_project(project_summary["id"])
            if project:
                for task in project.get("tasks", []):
                    if task.get("id") == task_id:
                        subtasks = task.get("subtasks", [])
                        auth = task.get("execution_authorized", False)
                        tid = task.get("thread_id")
                        result = {
                            "success": True,
                            "action": "get_status",
                            "taskId": task_id,
                            "name": task.get("name"),
                            "status": task.get("status", "unknown"),
                            "progress": task.get("progress", 0),
                            "executionAuthorized": bool(auth),
                            "threadId": tid,
                            "subtaskCount": len(subtasks),
                            "subtasks": [_subtask_row_dict(st) for st in subtasks],
                        }
                        return json.dumps(result, ensure_ascii=False, default=str)

        return json.dumps({
            "success": False,
            "action": "get_status",
            "error": f"Task '{task_id}' not found"
        }, ensure_ascii=False)

    elif action == "get_task_memory":
        if not task_id:
            return json.dumps({
                "success": False,
                "action": "get_task_memory",
                "error": "task_id is required for get_task_memory action"
            }, ensure_ascii=False)
        mem_store = get_task_memory_storage()
        row = load_task_memory_for_task_id(storage, mem_store, task_id)
        if row is None:
            return json.dumps({
                "success": False,
                "action": "get_task_memory",
                "error": f"Task '{task_id}' not found"
            }, ensure_ascii=False)
        mem, project_id, agent_id, parent_task_id = row
        facts = mem.get("facts") or []
        if not isinstance(facts, list):
            facts = []
        result = {
            "success": True,
            "action": "get_task_memory",
            "taskId": task_id,
            "projectId": project_id,
            "memoryKeyAgentId": agent_id,
            "parentTaskId": parent_task_id,
            "isSubtaskMemory": parent_task_id is not None,
            "memory": {
                "status": mem.get("status", ""),
                "progress": mem.get("progress", 0),
                "current_step": mem.get("current_step", ""),
                "output_summary": mem.get("output_summary", ""),
                "facts": facts,
                "factsCount": len(facts),
            },
        }
        return json.dumps(result, ensure_ascii=False, default=str)

    elif action == "monitor_execution":
        """Block until a collaborative task reaches a terminal state and return status+memory snapshot."""
        if not task_id:
            return json.dumps({
                "success": False,
                "action": "monitor_execution",
                "error": "task_id is required for monitor_execution action",
            }, ensure_ascii=False)

        # Safety: avoid too-fast polling storms
        try:
            poll_seconds = max(1, int(monitor_poll_seconds))
        except Exception:
            poll_seconds = 5
        timeout_seconds = monitor_timeout_seconds
        start_ts = asyncio.get_event_loop().time()

        terminal_main = {"completed", "failed", "cancelled"}

        while True:
            try:
                _auto_finalize_unrunnable_pending_subtasks(storage, task_id)
            except Exception:
                logger.debug("monitor_execution: auto finalize pending failed task_id=%s", task_id, exc_info=True)
            row = find_main_task(storage, task_id)
            if not row:
                return json.dumps({
                    "success": False,
                    "action": "monitor_execution",
                    "taskId": task_id,
                    "error": f"Task '{task_id}' not found",
                }, ensure_ascii=False)

            _proj, task = row
            t_status = str(task.get("status") or "pending").strip().lower()
            t_progress = task.get("progress", 0) or 0
            subtasks = task.get("subtasks") or []

            sub_rows, failed_subtasks = _build_monitor_subtask_rows(storage, subtasks)

            main_terminal = t_status in terminal_main
            all_sub_terminal = True
            for st in subtasks:
                s_status = str(st.get("status") or "pending").strip().lower()
                if s_status not in _TERMINAL_SUBTASK:
                    all_sub_terminal = False
                    break

            if main_terminal or (subtasks and all_sub_terminal):
                # Attach task memory snapshot (best-effort).
                mem_store = get_task_memory_storage()
                mem_row = load_task_memory_for_task_id(storage, mem_store, task_id)
                memory_payload: dict[str, Any] | None = None
                if mem_row is not None:
                    mem, project_id, agent_id, parent_task_id = mem_row
                    facts = mem.get("facts") or []
                    if not isinstance(facts, list):
                        facts = []
                    memory_payload = {
                        "status": mem.get("status", ""),
                        "progress": mem.get("progress", 0),
                        "current_step": mem.get("current_step", ""),
                        "output_summary": mem.get("output_summary", ""),
                        "factsCount": len(facts),
                        # Keep first few facts to limit response size.
                        "facts": facts[:10],
                    }

                return json.dumps({
                    "success": True,
                    "action": "monitor_execution",
                    "taskId": task_id,
                    "status": t_status,
                    "progress": t_progress,
                    "subtasks": sub_rows,
                    "failedSubtasks": failed_subtasks,
                    "memory": memory_payload,
                }, ensure_ascii=False, default=str)

            # Timeout guard
            if timeout_seconds is not None:
                elapsed = asyncio.get_event_loop().time() - start_ts
                if elapsed > float(timeout_seconds):
                    return json.dumps({
                        "success": False,
                        "action": "monitor_execution",
                        "taskId": task_id,
                        "status": t_status,
                        "progress": t_progress,
                        "error": f"monitor_execution timeout after {timeout_seconds}s",
                        "subtasks": sub_rows,
                    }, ensure_ascii=False, default=str)

            await asyncio.sleep(poll_seconds)

    elif action == "monitor_execution_step":
        """Poll for at most `monitor_step_seconds` and return an incremental snapshot.

        This is used when the lead agent should report progress every N seconds
        without requiring a full terminal wait.
        """
        if not task_id:
            return json.dumps({
                "success": False,
                "action": "monitor_execution_step",
                "error": "task_id is required for monitor_execution_step action",
            }, ensure_ascii=False)

        try:
            poll_seconds = max(1, int(monitor_poll_seconds))
        except Exception:
            poll_seconds = 5

        try:
            step_seconds = max(1, int(monitor_step_seconds))
        except Exception:
            step_seconds = 10

        start_ts = asyncio.get_event_loop().time()
        terminal_main = {"completed", "failed", "cancelled"}
        # Prefer returning on meaningful state change to avoid repetitive monitor spam.
        baseline_sig = ""
        try:
            prev = _task_watch_state.get(task_id) or {}
            baseline_sig = str(prev.get("last_monitor_return_sig") or "")
        except Exception:
            baseline_sig = ""

        while True:
            try:
                _auto_finalize_unrunnable_pending_subtasks(storage, task_id)
            except Exception:
                logger.debug("monitor_execution_step: auto finalize pending failed task_id=%s", task_id, exc_info=True)
            row = find_main_task(storage, task_id)
            if not row:
                return json.dumps({
                    "success": False,
                    "action": "monitor_execution_step",
                    "taskId": task_id,
                    "error": f"Task '{task_id}' not found",
                }, ensure_ascii=False)

            _proj, task = row
            t_status = str(task.get("status") or "pending").strip().lower()
            t_progress = task.get("progress", 0) or 0
            subtasks = task.get("subtasks") or []

            sub_rows, failed_subtasks = _build_monitor_subtask_rows(storage, subtasks)

            # Determine whether we can treat this snapshot as terminal.
            main_terminal = t_status in terminal_main
            all_sub_terminal = True
            for st in subtasks:
                s_status = str(st.get("status") or "pending").strip().lower()
                if s_status not in _TERMINAL_SUBTASK:
                    all_sub_terminal = False
                    break
            sub_terminal = bool(subtasks) and all_sub_terminal

            # Attach task memory snapshot (best-effort, keep small)
            memory_payload: dict[str, Any] | None = None
            try:
                mem_store = get_task_memory_storage()
                mem_row = load_task_memory_for_task_id(storage, mem_store, task_id)
                if mem_row is not None:
                    mem, project_id, agent_id, parent_task_id = mem_row
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
                # Monitoring should never fail because memory is unavailable.
                logger.debug("monitor_execution_step: memory snapshot failed", exc_info=True)

            elapsed = asyncio.get_event_loop().time() - start_ts
            cur_sig = json.dumps(
                {
                    "status": t_status,
                    "progress": int(t_progress or 0),
                    "sub": [(str(x.get("subtaskId") or ""), str(x.get("status") or ""), int(x.get("progress") or 0)) for x in sub_rows],
                    "step": str((memory_payload or {}).get("current_step") or ""),
                },
                ensure_ascii=False,
                default=str,
            )

            # Terminal: return immediately with terminal=true
            if main_terminal or sub_terminal:
                rec = _compute_monitor_recommendation(
                    task_id=task_id,
                    status=t_status,
                    progress=int(t_progress or 0),
                    sub_rows=sub_rows,
                    memory_payload=memory_payload,
                )
                return json.dumps({
                    "success": True,
                    "action": "monitor_execution_step",
                    "taskId": task_id,
                    "terminal": True,
                    "status": t_status,
                    "progress": t_progress,
                    "subtasks": sub_rows,
                    "failedSubtasks": failed_subtasks,
                    "memory": memory_payload,
                    "recommendation": rec,
                    "noChange": False,
                }, ensure_ascii=False, default=str)

            # Return early when state changed (preferred path).
            if cur_sig and cur_sig != baseline_sig:
                rec = _compute_monitor_recommendation(
                    task_id=task_id,
                    status=t_status,
                    progress=int(t_progress or 0),
                    sub_rows=sub_rows,
                    memory_payload=memory_payload,
                )
                try:
                    ws = _task_watch_state.get(task_id) or {}
                    ws["last_monitor_return_sig"] = cur_sig
                    _task_watch_state[task_id] = ws
                except Exception:
                    pass
                return json.dumps({
                    "success": True,
                    "action": "monitor_execution_step",
                    "taskId": task_id,
                    "terminal": False,
                    "status": t_status,
                    "progress": t_progress,
                    "subtasks": sub_rows,
                    "failedSubtasks": failed_subtasks,
                    "memory": memory_payload,
                    "recommendation": rec,
                    "noChange": False,
                    "elapsedSeconds": int(elapsed),
                }, ensure_ascii=False, default=str)

            # Non-terminal + unchanged: still return immediately with a full snapshot.
            # 目标：每次 monitor_execution_step 都有结构化结果，避免前端显示“无结果”。
            rec = _compute_monitor_recommendation(
                task_id=task_id,
                status=t_status,
                progress=int(t_progress or 0),
                sub_rows=sub_rows,
                memory_payload=memory_payload,
            )
            return json.dumps({
                "success": True,
                "action": "monitor_execution_step",
                "taskId": task_id,
                "terminal": False,
                "status": t_status,
                "progress": t_progress,
                "subtasks": sub_rows,
                "failedSubtasks": failed_subtasks,
                "memory": memory_payload,
                "recommendation": rec,
                "noChange": True,
                "elapsedSeconds": int(elapsed),
            }, ensure_ascii=False, default=str)

    elif action == "list_subtasks":
        if not task_id:
            return json.dumps({
                "success": False,
                "action": "list_subtasks",
                "error": "task_id is required for list_subtasks action"
            }, ensure_ascii=False)

        projects = storage.list_projects()

        for project_summary in projects:
            project = storage.load_project(project_summary["id"])
            if project:
                for task in project.get("tasks", []):
                    if task.get("id") == task_id:
                        subtasks = task.get("subtasks", [])
                        payload = {
                            "success": True,
                            "action": "list_subtasks",
                            "taskId": task_id,
                            "subtasks": [_subtask_row_dict(st) for st in subtasks],
                        }
                        if not subtasks:
                            payload["message"] = f"No subtasks found for task '{task_id}'"
                        return json.dumps(payload, ensure_ascii=False, default=str)

        return json.dumps({
            "success": False,
            "action": "list_subtasks",
            "error": f"Task '{task_id}' not found"
        }, ensure_ascii=False)

    elif action == "create_agent":
        """Create a new agent configuration.
        
        Args:
            agent_name: Unique identifier for the agent (required)
            agent_type: Type of agent - 'custom', 'subagent', or 'acp' (default: 'subagent')
            description: Agent description (optional)
            model: Model to use (optional)
            system_prompt: System prompt for subagents (required for subagent type)
            tools: List of tool names (optional)
            skills: List of skill names (optional)
            disallowed_tools: List of disallowed tool names (optional)
            max_turns: Maximum number of turns (default: 50)
            timeout_seconds: Timeout in seconds (default: 900)
        """
        agent_name = runtime.context.get("agent_name") if runtime.context else None
        if not agent_name:
            agent_name = runtime.config.get("configurable", {}).get("agent_name")
        
        if not agent_name:
            return "Error: agent_name is required for create_agent action (pass in context or configurable)"
        
        agent_type = runtime.context.get("agent_type", "subagent") if runtime.context else "subagent"
        if not agent_type:
            agent_type = runtime.config.get("configurable", {}).get("agent_type", "subagent")
        
        description = runtime.context.get("description", "") if runtime.context else ""
        if not description:
            description = runtime.config.get("configurable", {}).get("description", "")
        
        model = runtime.context.get("model") if runtime.context else None
        if not model:
            model = runtime.config.get("configurable", {}).get("model")
        
        system_prompt = runtime.context.get("system_prompt") if runtime.context else None
        if not system_prompt:
            system_prompt = runtime.config.get("configurable", {}).get("system_prompt")
        
        tools = runtime.context.get("tools") if runtime.context else None
        if not tools:
            tools = runtime.config.get("configurable", {}).get("tools")
        
        skills = runtime.context.get("skills") if runtime.context else None
        if not skills:
            skills = runtime.config.get("configurable", {}).get("skills")
        
        disallowed_tools = runtime.context.get("disallowed_tools") if runtime.context else None
        if not disallowed_tools:
            disallowed_tools = runtime.config.get("configurable", {}).get("disallowed_tools")
        
        max_turns = runtime.context.get("max_turns", 50) if runtime.context else 50
        if not max_turns:
            max_turns = runtime.config.get("configurable", {}).get("max_turns", 50)
        
        timeout_seconds = runtime.context.get("timeout_seconds", 900) if runtime.context else 900
        if not timeout_seconds:
            timeout_seconds = runtime.config.get("configurable", {}).get("timeout_seconds", 900)
        
        # Validate agent type
        if agent_type not in ["custom", "subagent", "acp"]:
            return f"Error: Invalid agent_type '{agent_type}'. Must be 'custom', 'subagent', or 'acp'"
        
        # Validate subagent requires system_prompt
        if agent_type == "subagent" and not system_prompt:
            return "Error: system_prompt is required for subagent type"
        
        # Check if agent already exists
        try:
            existing = load_agent_config(agent_name)
            if existing:
                return f"Error: Agent '{agent_name}' already exists"
        except FileNotFoundError:
            pass  # Expected - agent doesn't exist yet
        
        # Create agent directory and config file
        import yaml
        from pathlib import Path
        
        agents_dir = get_paths().agents_dir
        agent_dir = agents_dir / agent_name
        
        try:
            agent_dir.mkdir(parents=True, exist_ok=True)
            
            config_data = {
                "name": agent_name,
                "description": description,
                "agent_type": agent_type,
            }
            
            if model:
                config_data["model"] = model
            if system_prompt:
                config_data["system_prompt"] = system_prompt
            if tools:
                config_data["tools"] = tools
            if skills:
                config_data["skills"] = skills
            if disallowed_tools:
                config_data["disallowed_tools"] = disallowed_tools
            if max_turns != 50:
                config_data["max_turns"] = max_turns
            if timeout_seconds != 900:
                config_data["timeout_seconds"] = timeout_seconds
            
            config_file = agent_dir / "config.yaml"
            with open(config_file, "w", encoding="utf-8") as f:
                yaml.dump(config_data, f, default_flow_style=False, allow_unicode=True)
            
            logger.info(f"Created agent '{agent_name}' ({agent_type}) at {agent_dir}")
            return f"Agent '{agent_name}' created successfully at {agent_dir}"
        
        except Exception as e:
            logger.error(f"Failed to create agent '{agent_name}': {e}", exc_info=True)
            return f"Error: Failed to create agent '{agent_name}': {e}"

    elif action == "update_agent":
        """Update an existing agent configuration.
        
        Args:
            agent_name: Name of the agent to update (required)
            description: New description (optional)
            model: New model (optional)
            system_prompt: New system prompt (optional)
            tools: New tool list (optional)
            skills: New skill list (optional)
            disallowed_tools: New disallowed tools list (optional)
            max_turns: New max turns (optional)
            timeout_seconds: New timeout (optional)
        """
        agent_name = runtime.context.get("agent_name") if runtime.context else None
        if not agent_name:
            agent_name = runtime.config.get("configurable", {}).get("agent_name")
        
        if not agent_name:
            return "Error: agent_name is required for update_agent action"
        
        # Load existing agent config
        try:
            existing_cfg = load_agent_config(agent_name)
            if not existing_cfg:
                return f"Error: Agent '{agent_name}' not found"
        except FileNotFoundError:
            return f"Error: Agent '{agent_name}' not found"
        
        # Get update parameters
        updates = {}
        
        description = runtime.context.get("description") if runtime.context else None
        if description is not None:
            updates["description"] = description
        elif runtime.config.get("configurable", {}).get("description") is not None:
            updates["description"] = runtime.config.get("configurable", {}).get("description")
        
        model = runtime.context.get("model") if runtime.context else None
        if model is not None:
            updates["model"] = model
        elif runtime.config.get("configurable", {}).get("model") is not None:
            updates["model"] = runtime.config.get("configurable", {}).get("model")
        
        system_prompt = runtime.context.get("system_prompt") if runtime.context else None
        if system_prompt is not None:
            updates["system_prompt"] = system_prompt
        elif runtime.config.get("configurable", {}).get("system_prompt") is not None:
            updates["system_prompt"] = runtime.config.get("configurable", {}).get("system_prompt")
        
        tools = runtime.context.get("tools") if runtime.context else None
        if tools is not None:
            updates["tools"] = tools
        elif runtime.config.get("configurable", {}).get("tools") is not None:
            updates["tools"] = runtime.config.get("configurable", {}).get("tools")
        
        skills = runtime.context.get("skills") if runtime.context else None
        if skills is not None:
            updates["skills"] = skills
        elif runtime.config.get("configurable", {}).get("skills") is not None:
            updates["skills"] = runtime.config.get("configurable", {}).get("skills")
        
        disallowed_tools = runtime.context.get("disallowed_tools") if runtime.context else None
        if disallowed_tools is not None:
            updates["disallowed_tools"] = disallowed_tools
        elif runtime.config.get("configurable", {}).get("disallowed_tools") is not None:
            updates["disallowed_tools"] = runtime.config.get("configurable", {}).get("disallowed_tools")
        
        max_turns = runtime.context.get("max_turns") if runtime.context else None
        if max_turns is not None:
            updates["max_turns"] = max_turns
        elif runtime.config.get("configurable", {}).get("max_turns") is not None:
            updates["max_turns"] = runtime.config.get("configurable", {}).get("max_turns")
        
        timeout_seconds = runtime.context.get("timeout_seconds") if runtime.context else None
        if timeout_seconds is not None:
            updates["timeout_seconds"] = timeout_seconds
        elif runtime.config.get("configurable", {}).get("timeout_seconds") is not None:
            updates["timeout_seconds"] = runtime.config.get("configurable", {}).get("timeout_seconds")
        
        if not updates:
            return "Error: No update parameters provided"
        
        # Update config file
        import yaml
        from pathlib import Path
        
        agents_dir = get_paths().agents_dir
        agent_dir = agents_dir / agent_name
        config_file = agent_dir / "config.yaml"
        
        try:
            # Read existing config
            with open(config_file, "r", encoding="utf-8") as f:
                config_data = yaml.safe_load(f) or {}
            
            # Apply updates
            config_data.update(updates)
            
            # Write back
            with open(config_file, "w", encoding="utf-8") as f:
                yaml.dump(config_data, f, default_flow_style=False, allow_unicode=True)
            
            logger.info(f"Updated agent '{agent_name}' with: {list(updates.keys())}")
            return f"Agent '{agent_name}' updated successfully. Updated fields: {', '.join(updates.keys())}"
        
        except Exception as e:
            logger.error(f"Failed to update agent '{agent_name}': {e}", exc_info=True)
            return f"Error: Failed to update agent '{agent_name}': {e}"

    elif action == "list_agents":
        """List available subagent templates and configured custom/ACP agents.

        Note:
            create_subtask(s).assigned_agent expects a *subagent template name* (subagent_type),
            not a custom agent config entry.
        """
        try:
            subagents = sorted(list(get_available_subagent_names()))
            agents = list_all_agents()

            def _fmt(v: Any) -> str:
                if v is None:
                    return "inherit/all"
                if isinstance(v, list):
                    vv = [str(x).strip() for x in v if str(x).strip()]
                    if not vv:
                        return "inherit/all"
                    return "[" + ", ".join(vv) + "]"
                return str(v)

            def _agent_caps(name: str) -> dict[str, Any]:
                # Built-ins (general-purpose / bash) are stored in code.
                if name in BUILTIN_SUBAGENTS:
                    cfg = BUILTIN_SUBAGENTS[name]
                    return {
                        "tools": cfg.tools,
                        "skills": None,
                        "disallowed_tools": cfg.disallowed_tools,
                        "model": cfg.model,
                        "description": cfg.description,
                    }

                cfg = load_agent_config(name)
                if not cfg:
                    return {"tools": None, "skills": None, "disallowed_tools": None, "model": None, "description": None}
                return {
                    "tools": cfg.tools,
                    "skills": cfg.skills,
                    "disallowed_tools": cfg.disallowed_tools,
                    "model": cfg.model,
                    "description": cfg.description,
                }

            lines: list[str] = []
            lines.append(f"Available subagent templates for create_subtask.assigned_agent ({len(subagents)}):")
            for n in subagents:
                caps = _agent_caps(n)
                desc = caps.get("description") or "No description"
                model = caps.get("model") or "default"
                tools_s = _fmt(caps.get("tools"))
                skills_s = _fmt(caps.get("skills"))
                disallowed_s = _fmt(caps.get("disallowed_tools"))
                lines.append(
                    f"  - {n} | model: {model} | tools: {tools_s} | skills: {skills_s} | disallowed_tools: {disallowed_s} | {desc}"
                )

            if agents:
                lines.append("")
                lines.append(f"Configured agents (custom/subagent/acp configs) ({len(agents)}):")
                for agent in agents:
                    agent_type = agent.agent_type
                    model = agent.model or "default"
                    desc = agent.description or "No description"
                    tools_s = _fmt(getattr(agent, "tools", None))
                    skills_s = _fmt(getattr(agent, "skills", None))
                    disallowed_s = _fmt(getattr(agent, "disallowed_tools", None))
                    lines.append(
                        f"  - {agent.name} ({agent_type}) | model: {model} | tools: {tools_s} | skills: {skills_s} | disallowed_tools: {disallowed_s} | {desc}"
                    )

            return "\n".join(lines)
        
        except Exception as e:
            logger.error(f"Failed to list agents: {e}", exc_info=True)
            return f"Error: Failed to list agents: {e}"

    return json.dumps({
        "success": False,
        "action": action,
        "error": f"Unknown action '{action}'",
        "availableActions": [
            "create_task",
            "create_subtask",
            "create_subtasks",
            "update_progress",
            "complete_subtask",
            "start_execution",
            "monitor_execution",
            "monitor_execution_step",
            "set_task_planned",
            "get_status",
            "get_task_memory",
            "list_subtasks",
            "create_agent",
            "update_agent",
            "list_agents",
        ],
    }, ensure_ascii=False)
