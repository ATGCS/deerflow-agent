"""Unified human-readable ID generation for collaboration entities."""

from __future__ import annotations

import random
from datetime import datetime


def _ts_compact() -> str:
    # YYYYMMDDHHMMSS
    return datetime.utcnow().strftime("%Y%m%d%H%M%S")


def _rand6() -> str:
    return f"{random.randint(0, 999999):06d}"


def make_formatted_id(prefix: str) -> str:
    """Return `{Prefix}_YYYYMMDDHHMMSS_XXXXXX`."""
    p = str(prefix or "").strip() or "ID"
    return f"{p}_{_ts_compact()}_{_rand6()}"


def make_project_id() -> str:
    return make_formatted_id("Project")


def make_task_id() -> str:
    return make_formatted_id("Task")


def make_subtask_id() -> str:
    return make_formatted_id("Subtask")


def make_thread_id() -> str:
    return make_formatted_id("Thread")


def make_trace_id() -> str:
    return make_formatted_id("Trace")


def make_fact_id() -> str:
    return make_formatted_id("Fact")


def make_todo_id() -> str:
    return make_formatted_id("Todo")


def make_memory_id() -> str:
    return make_formatted_id("Memory")


def make_automation_id() -> str:
    return make_formatted_id("Automation")

