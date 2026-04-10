"""Bridge between task_tool and supervisor_tool for collab operations.

Breaks the circular dependency:
  - ``task_tool.py`` → ``collab_bridge`` (not → ``supervisor_tool``)
  - ``supervisor/execution.py`` → ``collab_bridge`` (not → ``task_tool``)

Both modules register their capabilities at import time; actual calls are
resolved lazily via this bridge, so no circular :pymod:`import` chain exists.

Usage::

    # In task_tool.py — register follow-up capability:
    from .collab_bridge import register_task_tool_delegate
    register_task_tool_delegate(task_tool_instance)

    # In supervisor/execution.py — invoke delegation without importing task_tool:
    from .collab_bridge import delegate_via_task_tool
    result = await delegate_via_task_tool(runtime, ...)

    # In task_tool.py — trigger follow-up wave:
    from .collab_bridge import emit_followup_wave_needed
    await emit_followup_wave_needed(runtime, main_task_id)
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, Coroutine

from langchain.tools import ToolRuntime
from langgraph.typing import ContextT

logger = logging.getLogger(__name__)

# ── Type aliases for bridge callbacks ────────────────────────────────
# The task_tool coroutine signature: (runtime, description, prompt, ...) -> str
_TaskToolCoro = Callable[..., Coroutine[Any, Any, str]]
_FollowupFn = Callable[
    [ToolRuntime[ContextT, dict] | None, str],
    Coroutine[Any, Any, None],
]

# ── Bridge state (module-level singleton) ───────────────────────────
_task_tool_coro_ref: _TaskToolCoro | None = None
_followup_handler_ref: _FollowupFn | None = None


# ════════════════════════════════════════════════════════════════════
#  Registration API — called once at module init time
# ════════════════════════════════════════════════════════════════════


def register_task_tool_delegate(coro: _TaskToolCoro) -> None:
    """Register the ``task_tool.coroutine`` callable.

    Called from ``task_tool.py`` at module level (after ``@tool`` decoration).
    This allows ``supervisor/execution.py`` to delegate subtasks *without*
    directly importing ``task_tool``.
    """
    global _task_tool_coro_ref
    _task_tool_coro_ref = coro
    logger.debug("collab_bridge: task_tool delegate registered")


def register_followup_handler(fn: _FollowupFn) -> None:
    """Register the auto-followup-wave handler.

    Called from ``supervisor/execution.py`` at module level.
    This allows ``task_tool.py`` to trigger follow-up waves *without*
    directly importing ``supervisor``.
    """
    global _followup_handler_ref
    _followup_handler_ref = fn
    logger.debug("collab_bridge: followup handler registered")


# ════════════════════════════════════════════════════════════════════
#  Invocation API — used at runtime (lazy, no circular import)
# ════════════════════════════════════════════════════════════════════


async def delegate_via_task_tool(
    runtime: ToolRuntime[ContextT, dict],
    *,
    description: str,
    prompt: str,
    subagent_type: str,
    tool_call_id: str,
    max_turns: int | None,
    collab_task_id: str,
    collab_subtask_id: str,
    detach: bool,
) -> str:
    """Invoke ``task_tool.coroutine`` via the bridge (no direct import).

    Raises:
        RuntimeError: If ``task_tool`` has not registered its delegate yet.
    """
    if _task_tool_coro_ref is None:
        raise RuntimeError(
            "collab_bridge: task_tool delegate not registered. "
            "Ensure task_tool.py calls register_task_tool_delegate() at import time."
        )
    return await _task_tool_coro_ref(
        runtime=runtime,
        description=description,
        prompt=prompt,
        subagent_type=subagent_type,
        tool_call_id=tool_call_id,
        max_turns=max_turns,
        collab_task_id=collab_task_id,
        collab_subtask_id=collab_subtask_id,
        detach=detach,
    )


async def emit_followup_wave_needed(
    runtime: ToolRuntime[ContextT, dict] | None,
    main_task_id: str,
) -> None:
    """Signal that a follow-up delegation wave should be evaluated.

    Called from ``task_tool.py`` when a subtask completes.
    Bridges to ``supervisor.auto_delegate_collab_followup_wave``
    without a direct import.
    """
    if _followup_handler_ref is None:
        logger.debug(
            "collab_bridge: followup handler not registered; skip auto-delegation for task=%s",
            main_task_id,
        )
        return
    try:
        await _followup_handler_ref(runtime, main_task_id)
    except Exception:
        logger.exception(
            "collab_bridge: followup handler raised for task=%s", main_task_id
        )


def is_bridge_ready() -> tuple[bool, bool]:
    """Check whether both sides have registered.

    Returns:
        (task_tool_registered, followup_registered)
    """
    return (_task_tool_coro_ref is not None, _followup_handler_ref is not None)


__all__ = [
    "register_task_tool_delegate",
    "register_followup_handler",
    "delegate_via_task_tool",
    "emit_followup_wave_needed",
    "is_bridge_ready",
]
