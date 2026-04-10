"""Maintain a UI-only full transcript while model uses summarized messages.

LangChain's ``SummarizationMiddleware`` runs in ``before_model`` and *replaces*
older messages in the persisted ``messages`` list. That is correct for keeping
model context small, but it makes it impossible to reconstruct the verbatim
chat history from ``messages`` after refresh.

This middleware keeps an append-only transcript in ``ui_messages``:
- It appends new *real* Human/AI messages as they appear.
- It ignores summarization injections (summary HumanMessage) and other injected
  UI HumanMessages.
"""

from __future__ import annotations

import logging
from typing import Any, Iterable, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.runtime import Runtime

logger = logging.getLogger(__name__)

class UiMessagesSnapshotMiddleware(AgentMiddleware[AgentState]):
    """Append-only transcript for UI display.

    Should be registered *before* ``SummarizationMiddleware`` so we can capture
    user turns even if summarization triggers on the same model call.
    """

    state_schema = AgentState

    def _iter_real_messages(self, messages: Iterable[Any]) -> list[Any]:
        real: list[Any] = []
        for m in messages:
            if isinstance(m, HumanMessage):
                n = getattr(m, "name", None)
                if n is not None and str(n).strip() == "conversation_summary":
                    continue
                head = str(getattr(m, "content", "") or "").lstrip().lower()
                if head.startswith("here is a summary of the conversation to date") or head.startswith(
                    "here's a summary of the conversation to date"
                ):
                    continue
                real.append(m)
                continue
            if isinstance(m, AIMessage):
                real.append(m)
                continue
            # Tool outputs are needed for UI (tool call input lives in AIMessage.tool_calls)
            if isinstance(m, ToolMessage):
                real.append(m)
        return real

    def _msg_key(self, m: Any) -> str:
        mid = getattr(m, "id", None)
        if mid:
            return f"id:{mid}"
        # fallback: stable-ish fingerprint
        t = type(m).__name__
        c = getattr(m, "content", "")
        return f"fp:{t}:{hash(str(c))}"

    def _append_ui_messages(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        existing = state.get("ui_messages") or []
        base = list(existing) if isinstance(existing, list) else []
        index_by_key: dict[str, int] = {}
        for i, x in enumerate(base):
            k = self._msg_key(x)
            # Keep the last occurrence as the "current" slot.
            index_by_key[k] = i

        incoming = state.get("messages") or []
        real = self._iter_real_messages(incoming)

        added = 0
        updated = 0
        for m in real:
            k = self._msg_key(m)
            if k in index_by_key:
                idx = index_by_key[k]
                # Replace-by-id semantics: if upstream updated message content/tool status, keep latest.
                base[idx] = m
                updated += 1
                continue
            index_by_key[k] = len(base)
            base.append(m)
            added += 1

        if added or updated:
            tid = None
            try:
                tid = runtime.context.get("thread_id") if runtime and runtime.context else None
            except Exception:
                tid = None
            logger.info(
                "已更新 UI 对话流水：新增 %s 条，覆盖更新 %s 条，总计 %s 条（thread_id=%s）",
                added,
                updated,
                len(base),
                tid or "",
            )
        return {"ui_messages": base} if (added or updated) else None

    @override
    def before_model(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        return self._append_ui_messages(state, runtime)

    @override
    async def abefore_model(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        return self.before_model(state, runtime)

    @override
    def after_model(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        # capture assistant output added by the model call
        return self._append_ui_messages(state, runtime)

    @override
    async def aafter_model(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        return self.after_model(state, runtime)
