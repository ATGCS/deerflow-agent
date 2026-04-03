"""Inject collaboration phase rules into the model context (multi-agent collab design §6.1)."""

from __future__ import annotations

from typing import Any, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import HumanMessage
from langgraph.runtime import Runtime

from deerflow.collab.models import CollabPhase


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
            + "**Awaiting execution:** The user must authorize execution (e.g. `authorize-execution` API or "
            "`supervisor` `start_execution` for the main task). Until then, do not call `task` with "
            "`collab_task_id` — the tool will reject unauthorized runs.\n"
            + "</collab_phase_context>"
        )

    if phase == CollabPhase.EXECUTING.value:
        return (
            common
            + "**Executing:** When delegating collaborative work, pass `collab_task_id` from context (and "
            "`collab_subtask_id` when working on a specific subtask). The tool enforces authorization and "
            "`thread_id` binding.\n"
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
        raw_phase = ctx.get("collab_phase")
        if raw_phase is None or raw_phase == "":
            return None
        phase = str(raw_phase).strip()
        if not phase or phase == CollabPhase.IDLE.value:
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
            collab_task_id=ctx.get("collab_task_id"),
            bound_project_id=ctx.get("bound_project_id"),
            subagent_enabled=bool(ctx.get("subagent_enabled", False)),
        )
        hint = HumanMessage(
            name="collab_phase_hint",
            content=text,
        )
        return {"messages": [hint]}
