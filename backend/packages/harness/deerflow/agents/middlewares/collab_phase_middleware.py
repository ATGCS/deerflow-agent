"""Inject collaboration phase rules into the model context (multi-agent collab design §6.1)."""

from __future__ import annotations

import json
from typing import Any, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langgraph.runtime import Runtime

from deerflow.collab.models import CollabPhase
from deerflow.collab.id_format import make_formatted_id
from deerflow.collab.storage import find_main_task, get_project_storage
from deerflow.collab.thread_collab import load_thread_collab_state
from deerflow.config.paths import get_paths

# supervisor 动作：必须带 task_id 且与当前绑定主任务 id 一致，才算「触达协作主任务」（读/写均可）。
_SUPERVISOR_ACTIONS_TOUCHING_BOUND_TASK = frozenset(
    {
        "monitor_execution_step",
        "monitor_execution",
        "get_status",
        "get_task_memory",
        "start_execution",
        "update_progress",
        "complete_subtask",
        "create_subtask",
        "create_subtasks",
        "list_subtasks",
        "set_task_planned",
    }
)


def _tool_calls_include_monitor_for_bound_task(tool_calls: list[Any] | None, bound_task_id: str) -> bool:
    bid = str(bound_task_id or "").strip()
    if not bid:
        return False
    for tc in tool_calls or []:
        d = _tool_call_as_dict(tc)
        if str(d.get("name", "")).strip() != "supervisor":
            continue
        args = _normalize_tool_call_args(d)
        if str(args.get("task_id", "")).strip() != bid:
            continue
        act = str(args.get("action", "")).strip()
        if act in {"monitor_execution_step", "monitor_execution"}:
            return True
    return False


def _tool_call_as_dict(tc: Any) -> dict[str, Any]:
    if isinstance(tc, dict):
        return tc
    name = getattr(tc, "name", None)
    args = getattr(tc, "args", None)
    tid = getattr(tc, "id", None)
    return {"name": name, "args": args if args is not None else {}, "id": tid}


def _normalize_tool_call_args(tc: dict[str, Any]) -> dict[str, Any]:
    args = tc.get("args")
    if args is None:
        args = tc.get("arguments")
    if isinstance(args, str):
        try:
            parsed = json.loads(args)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return args if isinstance(args, dict) else {}


def _tool_calls_touch_bound_collab_task(tool_calls: list[Any] | None, bound_task_id: str) -> bool:
    """本轮是否已通过 supervisor 读写过当前绑定的协作主任务（防止只调 web_search 等就结束一轮）。"""
    bid = str(bound_task_id or "").strip()
    if not bid:
        return False
    for tc in tool_calls or []:
        d = _tool_call_as_dict(tc)
        if str(d.get("name", "")).strip() != "supervisor":
            continue
        args = _normalize_tool_call_args(d)
        action = str(args.get("action", "")).strip()
        if action not in _SUPERVISOR_ACTIONS_TOUCHING_BOUND_TASK:
            continue
        tid = str(args.get("task_id", "")).strip()
        if tid == bid:
            return True
    return False


def _effective_collab_for_hints(ctx: dict[str, Any]) -> tuple[str | None, str | None, str | None]:
    """Resolve phase + bound ids for hints.

    Run context is fixed for the whole LangGraph stream, but ``supervisor(start_execution)``
    and HTTP authorize update ``collab_state.json`` on disk. Re-read per model step so the lead
    model sees ``executing`` and ``bound_task_id`` immediately after authorization.
    """
    ctx_phase_raw = ctx.get("collab_phase")
    ctx_phase = str(ctx_phase_raw).strip() if ctx_phase_raw not in (None, "") else None
    ctx_ct = str(ctx.get("collab_task_id") or "").strip() or None
    ctx_bp = str(ctx.get("bound_project_id") or "").strip() or None
    tid = str(ctx.get("thread_id") or "").strip() or None

    eff_phase = ctx_phase
    eff_ct = ctx_ct
    eff_bp = ctx_bp

    if tid:
        try:
            disk = load_thread_collab_state(get_paths(), tid)
            d_phase = disk.collab_phase
            d_phase_str = d_phase.value if isinstance(d_phase, CollabPhase) else str(d_phase)
            d_bt = str(disk.bound_task_id or "").strip() or None
            d_bp = str(disk.bound_project_id or "").strip() or None
            if d_phase != CollabPhase.IDLE:
                eff_phase = d_phase_str
            # 流式 run 的 context 整轮固定；start_execution 只写磁盘。executing 阶段必须以磁盘绑定为准，
            # 否则 ctx 里旧的 collab_task_id 会盖住 bound_task_id，模型一直拿不到正确主任务 id。
            if d_phase == CollabPhase.EXECUTING:
                eff_ct = d_bt or ctx_ct
                eff_bp = d_bp or ctx_bp
            else:
                eff_ct = ctx_ct or d_bt
                eff_bp = ctx_bp or d_bp
        except Exception:
            pass

    if not eff_phase or eff_phase == CollabPhase.IDLE.value:
        return None, None, None
    return eff_phase, eff_ct, eff_bp


def _live_task_snapshot_for_hint(main_task_id: str) -> str:
    """从项目存储重读主/子任务状态，注入到每轮模型调用前。

    解决：长监控链路里若开启摘要或上下文截断，较早的 ``ToolMessage`` 可能丢失，
    模型仍能看到当前子任务进度（与上一轮调度说明互补，减少「重复同一句话」）。
    """
    tid = str(main_task_id or "").strip()
    if not tid:
        return ""
    try:
        storage = get_project_storage()
        row = find_main_task(storage, tid)
        if not row:
            return ""
        _proj, task = row
        title = str(task.get("name") or task.get("id") or "")[:100]
        ms = str(task.get("status") or "")
        try:
            mp = int(task.get("progress") or 0)
        except (TypeError, ValueError):
            mp = 0
        lines: list[str] = [
            f"- 主任务：{title}",
            f"  状态 {ms} · 进度 {mp}%",
        ]
        subs = [x for x in (task.get("subtasks") or []) if isinstance(x, dict)]
        for st in subs[:20]:
            sid = str(st.get("id") or "")[:12]
            nm = str(st.get("name") or "")[:56]
            ss = str(st.get("status") or "")
            try:
                pr = int(st.get("progress") or 0)
            except (TypeError, ValueError):
                pr = 0
            lines.append(f"  - 子任务 {sid}… {nm} → {ss} ({pr}%)")
        out = "\n".join(lines)
        return out if len(out) <= 1400 else out[:1397] + "..."
    except Exception:
        return ""


def _collab_hint_text(
    phase: str,
    *,
    collab_task_id: str | None,
    bound_project_id: str | None,
    subagent_enabled: bool,
    live_snapshot: str | None = None,
) -> str:
    """Build a single system-reminder block for the current collaboration phase."""
    tid = (collab_task_id or "").strip() or None
    pid = (bound_project_id or "").strip() or None
    ctx_lines = []
    if tid:
        ctx_lines.append(f"- Bound collaborative main task id (`collab_task_id`): `{tid}`")
    if pid:
        ctx_lines.append(f"- Bound project id (`parent_project_id` / storage bucket): `{pid}`")
    ctx_block = "\n".join(ctx_lines) if ctx_lines else "- No explicit `collab_task_id` in this run context yet."

    sub = (
        "Subagent (`task`) tooling is enabled for this run — still respect the phase gates below."
        if subagent_enabled
        else "Subagent (`task`) tooling is off for this run."
    )

    common = (
        f"<collab_phase_context>\n"
        f"**Collaboration phase:** `{phase}`\n"
        f"{sub}\n"
        f"{ctx_block}\n"
    )

    if phase == CollabPhase.REQ_CONFIRM.value:
        return (
            common
            + "**Gate (phase 1 — requirements):** Prefer `ask_clarification` when requirements are missing, "
            "ambiguous, or risky. Do not launch collaborative workers via `task` with `collab_task_id` until "
            "execution is authorized and the phase allows execution.\n"
            + "</collab_phase_context>"
        )

    if phase == CollabPhase.PLANNING.value:
        return (
            common
            + "**Planning:** Use `supervisor` to structure work if needed. Do not call `task` with "
            "`collab_task_id` to spawn workers for the bound collaborative task until execution is authorized.\n"
            + "</collab_phase_context>"
        )

    if phase == CollabPhase.PLAN_READY.value:
        return (
            common
            + "**Plan ready:** Summarize the plan for the user and confirm before execution. "
            "Do not start collaborative `task` workers until execution is authorized.\n"
            + "</collab_phase_context>"
        )

    if phase == CollabPhase.AWAITING_EXEC.value:
        return (
            common
            + "**Awaiting execution:** The user should confirm start (e.g. `authorize-execution` or "
            "`supervisor` `start_execution`). Until the phase advances to `executing`, do not call `task` "
            "with `collab_task_id` for collaborative workers.\n"
            + "</collab_phase_context>"
        )

    if phase == CollabPhase.EXECUTING.value:
        snap_block = ""
        if live_snapshot and live_snapshot.strip():
            snap_block = (
                "\n**Live snapshot (storage, refreshed every model step):**\n"
                + live_snapshot.strip()
                + "\n"
            )
        return (
            common
            + "**Executing:** Delegate collaborative work with `collab_task_id` from context (and "
            "`collab_subtask_id` when scoped to one subtask).\n"
            + "**Active control (you stay in charge):** While subtasks run, each model turn should combine "
            "short reasoning in `content` with one or more `supervisor` tool calls. Examples: "
            "`monitor_execution_step` or `get_status` / `get_task_memory` for fresh facts; "
            "`update_progress` with `status=\"cancelled\"` or `failed` on a `subtask_id` (or on the main task "
            "without `subtask_id`) to stop work in storage; `create_subtask` / `create_subtasks` then "
            "`start_execution` to add and launch more work. Prose alone does not cancel or create tasks—"
            "emit the matching tools in the same assistant message when possible.\n"
            + snap_block
            + "</collab_phase_context>"
        )

    if phase == CollabPhase.DONE.value:
        return (
            common
            + "**Done:** Close out the collaboration unless the user asks for more work.\n"
            + "</collab_phase_context>"
        )

    return common + "</collab_phase_context>"


class CollabPhaseMiddleware(AgentMiddleware[AgentState]):
    """On each model call that starts from a user HumanMessage, inject phase guidance."""

    state_schema = AgentState

    @override
    def before_model(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        return self._inject(state, runtime)

    @override
    async def abefore_model(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        return self._inject(state, runtime)

    @override
    def after_model(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        return self._enforce_monitoring(state, runtime)

    @override
    async def aafter_model(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        return self._enforce_monitoring(state, runtime)

    def _inject(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        ctx = runtime.context or {}
        phase, collab_task_id, bound_project_id = _effective_collab_for_hints(ctx)
        if not phase:
            return None

        messages = state.get("messages") or []
        if not messages:
            return None
        last = messages[-1]
        # Avoid immediate self-duplication if the last injected message is already our phase hint.
        # Otherwise, allow injection on every model step (not only user turns), so executing-phase
        # snapshots keep refreshing across tool loops and long-running collaborations.
        if isinstance(last, HumanMessage) and getattr(last, "name", None) == "collab_phase_hint":
            return None

        snap: str | None = None
        if str(phase).strip().lower() == CollabPhase.EXECUTING.value and (collab_task_id or "").strip():
            snap = _live_task_snapshot_for_hint(str(collab_task_id).strip()) or None
        text = _collab_hint_text(
            phase,
            collab_task_id=collab_task_id,
            bound_project_id=bound_project_id,
            subagent_enabled=bool(ctx.get("subagent_enabled", False)),
            live_snapshot=snap,
        )
        hint = SystemMessage(
            name="collab_phase_hint",
            content=text,
        )
        return {"messages": [hint]}

    def _enforce_monitoring(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        """Hard guard while collab is executing and the bound main task is not terminal.

        1) Prose-only → inject `monitor_execution_step` (unchanged).
        2) Has tool_calls but **none** target the bound `task_id` via `supervisor` (e.g. only `web_search`) →
           **append** `monitor_execution_step` so every graph step still refreshes collaborative task state
           without relying on the model remembering to poll.
        """
        ctx = runtime.context or {}
        tid = str(ctx.get("thread_id") or "").strip()
        if not tid:
            return None
        try:
            collab = load_thread_collab_state(get_paths(), tid)
        except Exception:
            return None
        phase = collab.collab_phase
        phase_val = phase.value if isinstance(phase, CollabPhase) else str(phase or "")
        if str(phase_val).strip().lower() != CollabPhase.EXECUTING.value:
            return None

        task_id = str(collab.bound_task_id or "").strip()
        if not task_id:
            return None
        try:
            storage = get_project_storage()
            row = find_main_task(storage, task_id)
            if row is None:
                return None
            _proj, task = row
            status = str(task.get("status") or "").strip().lower()
            subtasks = [x for x in (task.get("subtasks") or []) if isinstance(x, dict)]
            main_terminal = status in {"completed", "failed", "cancelled"}
            sub_terminal = bool(subtasks) and all(
                str(st.get("status") or "").strip().lower() in {"completed", "failed", "cancelled", "timed_out"}
                for st in subtasks
            )
            if main_terminal or sub_terminal:
                return None
        except Exception:
            return None

        messages = state.get("messages") or []
        if not messages:
            return None
        last = messages[-1]
        if not isinstance(last, AIMessage):
            return None

        raw_c = getattr(last, "content", None)
        preserved = ""
        if isinstance(raw_c, str) and raw_c.strip():
            preserved = raw_c.strip()
            if len(preserved) > 6000:
                preserved = preserved[:5997] + "..."
        final_content = preserved if preserved else (raw_c if isinstance(raw_c, str) else "") or ""

        extra_monitor = {
            "id": make_formatted_id("ForcedMonitor"),
            "name": "supervisor",
            "args": {
                "action": "monitor_execution_step",
                "task_id": task_id,
                "monitor_step_seconds": 2,
            },
        }

        existing_calls = list(getattr(last, "tool_calls", None) or [])
        if existing_calls:
            # 执行阶段强约束：只要本轮没有“针对当前主任务”的 monitor 调用，就追加一次 monitor。
            # 这样即便本轮只做了 start_execution/create_subtask/update_progress，也会继续有监控数据回流。
            if _tool_calls_include_monitor_for_bound_task(existing_calls, task_id):
                return None
            forced = last.model_copy(
                update={
                    "content": final_content,
                    "tool_calls": existing_calls + [extra_monitor],
                }
            )
            return {"messages": [forced]}

        forced = last.model_copy(
            update={
                "content": final_content,
                "tool_calls": [extra_monitor],
            }
        )
        return {"messages": [forced]}
