"""Utility and helper functions for supervisor tool.

Provides:
- _runtime_thread_id — extract thread_id from ToolRuntime context
- _dbg_enabled — opt-in noisy debug logs
- _repr_with_invisibles — make whitespace visible in debug logs
- _clamp_progress — clamp value to 0..100 range
"""

from __future__ import annotations

import logging
import os
from typing import Any

from langchain.tools import ToolRuntime
from langgraph.typing import ContextT

logger = logging.getLogger(__name__)


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
        .replace(" ", "\u00b7")
    )


def _clamp_progress(value: int | None) -> int:
    if value is None:
        return 0
    return max(0, min(100, int(value)))


__all__ = [
    "_runtime_thread_id",
    "_dbg_enabled",
    "_repr_with_invisibles",
    "_clamp_progress",
]
