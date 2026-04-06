"""Inject collaboration phase rules into the model context (multi-agent collab design §6.1)."""

from __future__ import annotations

from typing import Any, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import HumanMessage
from langgraph.runtime import Runtime

from deerflow.collab.models import CollabPhase
from deerflow.collab.thread_collab import load_thread_collab_state
from deerflow.config.paths import get_paths


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


def _collab_hint_text(
    phase: str,
    *,
    collab_task_id: str | None,
    bound_project_id: str | None,
    subagent_enabled: bool,
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
        return (
            common
            + "**Executing:** Delegate collaborative work with `collab_task_id` from context (and "
            "`collab_subtask_id` when scoped to one subtask).\n"
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

    def _inject(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        ctx = runtime.context or {}
        phase, collab_task_id, bound_project_id = _effective_collab_for_hints(ctx)
        if not phase:
            return None

        messages = state.get("messages") or []
        if not messages:
            return None
        last = messages[-1]
        if not isinstance(last, HumanMessage):
            return None
        if getattr(last, "name", None) == "collab_phase_hint":
            return None

        text = _collab_hint_text(
            phase,
            collab_task_id=collab_task_id,
            bound_project_id=bound_project_id,
            subagent_enabled=bool(ctx.get("subagent_enabled", False)),
        )
        hint = HumanMessage(
            name="collab_phase_hint",
            content=text,
        )
        return {"messages": [hint]}
