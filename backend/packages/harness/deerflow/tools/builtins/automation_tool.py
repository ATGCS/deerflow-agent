"""Scheduled task automation tool for recurring and one-time automated tasks.

Provides the ``automation`` tool that allows creating, listing, pausing,
resuming, and deleting scheduled tasks with cron-like or human-readable
schedules.

Storage: TOML files under ``~/.deerflow/automations/``
Scheduler: Built-in timer-based scheduling (no external dependency)

Roadmap: DEERFLOW_TOOLS_REFACTORING_ROADMAP.md #19
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path

from langchain.tools import tool
from deerflow.collab.id_format import make_automation_id

logger = logging.getLogger(__name__)

# ─── Paths ────────────────────────────────────────────────────────

_AUTOMATIONS_DIR = Path.home() / ".deerflow" / "automations"


def _ensure_dir() -> Path:
    _AUTOMATIONS_DIR.mkdir(parents=True, exist_ok=True)
    return _AUTOMATIONS_DIR


def _automation_file(automation_id: str) -> Path:
    _ensure_dir()
    return _AUTOMATIONS_DIR / f"{automation_id}.toml"


# ─── Data structures ──────────────────────────────────────────────

class AutomationStatus(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class AutomationTask:
    """Represents a scheduled automation task."""
    id: str = field(default_factory=make_automation_id)
    name: str = ""
    prompt: str = ""  # Task description for execution
    schedule_type: str = "recurring"  # "recurring" or "once"
    rrule: str = ""  # iCalendar RRULE (e.g., "FREQ=HOURLY;INTERVAL=1")
    scheduled_at: str = ""  # ISO datetime for one-time tasks
    status: str = AutomationStatus.ACTIVE.value
    created_at: str = field(default_factory=lambda: datetime.now().isoformat(timespec="seconds"))
    valid_from: str | None = None
    valid_until: str | None = None
    cwds: list[str] = field(default_factory=list)  # Work directories
    max_duration_minutes: int | None = None
    last_run: str | None = None
    last_status: str | None = None
    run_count: int = 0


# ─── Persistence (TOML-style JSON for simplicity) ─────────────────

def _save_task(task: AutomationTask) -> None:
    """Save a single task to its TOML-like file."""
    filepath = _automation_file(task.id)
    data = asdict(task)
    # Write in TOML-ish format (readable key=value)
    lines: list[str] = [f"[automation]"]
    for k, v in data.items():
        if isinstance(v, list):
            val_str = ", ".join(f'"{x}"' for x in v)
            lines.append(f'{k} = [{val_str}]')
        elif v is None:
            lines.append(f'{k} = ""')
        elif isinstance(v, str):
            lines.append(f'{k} = "{v}"')
        else:
            lines.append(f'{k} = {v}')
    filepath.write_text("\n".join(lines), encoding="utf-8")


def _load_task(automation_id: str) -> AutomationTask | None:
    """Load a task by ID."""
    filepath = _automation_file(automation_id)
    if not filepath.exists():
        return None
    try:
        raw = filepath.read_text(encoding="utf-8")
        data = {}
        for line in raw.strip().splitlines():
            line = line.strip()
            if not line or line.startswith("[") or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            # Parse value
            if value.startswith("[") and value.endswith("]"):
                inner = value[1:-1].strip()
                items = []
                if inner:
                    for item in inner.split(","):
                        item = item.strip().strip('"').strip("'")
                        items.append(item)
                data[key] = items
            elif value.startswith('"') and value.endswith('"'):
                data[key] = value[1:-1]
            else:
                try:
                    data[key] = int(value)
                except ValueError:
                    data[key] = value
        return AutomationTask(**data)
    except Exception as e:
        logger.warning("Failed to load automation %s: %s", automation_id, e)
        return None


def _list_all_tasks(status_filter: str | None = None) -> list[AutomationTask]:
    """List all saved tasks, optionally filtered by status."""
    _ensure_dir()
    tasks: list[AutomationTask] = []
    for fpath in _AUTOMATIONS_DIR.glob("*.toml"):
        tid = fpath.stem
        task = _load_task(tid)
        if task is not None:
            if status_filter and task.status != status_filter:
                continue
            tasks.append(task)
    tasks.sort(key=lambda t: t.created_at, reverse=True)
    return tasks


def _delete_task(automation_id: str) -> bool:
    """Delete a task file. Returns True if existed and deleted."""
    filepath = _automation_file(automation_id)
    if not filepath.exists():
        return False
    filepath.unlink()
    return True


# ─── Schedule parsing helpers ─────────────────────────────────────

_HUMAN_SCHEDULE_MAP: dict[str, str] = {
    "every hour": "FREQ=HOURLY;INTERVAL=1",
    "every 2 hours": "FREQ=HOURLY;INTERVAL=2",
    "every 6 hours": "FREQ=HOURLY;INTERVAL=6",
    "every day": "FREQ=DAILY;INTERVAL=1",
    "daily": "FREQ=DAILY;INTERVAL=1",
    "every week": "FREQ=WEEKLY;INTERVAL=1",
    "weekly": "FREQ=WEEKLY;INTERVAL=1",
    "every monday": "FREQ=WEEKLY;BYDAY=MO",
    "weekdays": "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9",
    "workdays": "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9",
}


def _parse_schedule(schedule_input: str) -> tuple[str, str]:
    """Parse human-readable schedule into (rrule, schedule_type).

    Returns:
        Tuple of (rrule string, "recurring"|"once")
    """
    s = schedule_input.lower().strip()

    # Check for explicit ISO datetime (one-time)
    if s.startswith(("20", "21")) and ("T" in s or "-" in s):  # e.g. "2026-04-15T14:30"
        return "", "once"

    # Check for known human patterns
    for pattern, rrule in _HUMAN_SCHEDULE_MAP.items():
        if pattern == s or pattern.replace(" ", "_") == s.replace(" ", "_"):
            return rrule, "recurring"

    # If it looks like an RRULE already
    if s.upper().startswith("FREQ="):
        return s.upper(), "recurring"

    # Default: treat as RRULE
    return s, "recurring"


# ─── Tool function ────────────────────────────────────────────────

@tool("automation", parse_docstring=False)
def automation_tool(
    action: str,
    *,
    name: str | None = None,
    prompt: str | None = None,
    schedule: str | None = None,
    workspace: str | None = None,
    id: str | None = None,
    valid_from: str | None = None,
    valid_until: str | None = None,
) -> str:
    """Manage scheduled automated tasks for periodic code generation, testing, or monitoring.

    Create recurring or one-time tasks that execute automatically on your schedule.
    Tasks are persisted locally and can be listed, paused, resumed, or deleted.

    Args:
        action: Operation to perform. Valid values: 'create', 'list', 'pause',
            'resume', 'delete', 'status'.
        name: Short descriptive name (required for create).
        prompt: Task description of what to do when executed (required for create).
        schedule: When to run. Accepts human-readable schedules such as
            every hour, daily, weekdays; ISO datetime for single
            execution; or iCalendar RRULE strings like FREQ=HOURLY;INTERVAL=2.
            See Examples below for concrete schedule formats.
        workspace: Working directory path(s) for the task.
        id: Automation ID string (required for pause/resume/delete/status).
        valid_from: Start date for validity window, e.g. '2026-04-01'.
        valid_until: End date for validity window, e.g. '2026-06-30'.

    Returns:
        Confirmation message with task details or error description.

    Examples:
        automation_tool(action='create',
                         name='Daily health check',
                         prompt='Run tests and report results',
                         schedule='daily')

        automation_tool(action='list')

        automation_tool(action='pause', id='abc123')

        automation_tool(action='resume', id='abc123')

        automation_tool(action='delete', id='abc123')
    """
    action_lower = (action or "").strip().lower()

    # ── CREATE ──
    if action_lower == "create":
        if not name or not name.strip():
            return 'Error: "name" is required for action=create.'
        if not prompt or not prompt.strip():
            return 'Error: "prompt" is required for action=create.'
        if not schedule or not schedule.strip():
            return 'Error: "schedule" is required for action=create.'

        rrule, sched_type = _parse_schedule(schedule)

        task = AutomationTask(
            name=name.strip(),
            prompt=prompt.strip(),
            schedule_type=sched_type,
            rrule=rrule,
            scheduled_at=schedule.strip() if sched_type == "once" else "",
            cwds=[workspace.strip()] if workspace else [],
            valid_from=valid_from,
            valid_until=valid_until,
        )
        _save_task(task)

        logger.info(
            "Created automation: id=%s name=%r schedule=%s type=%s",
            task.id, task.name, schedule.strip(), sched_type,
        )
        return (
            f"OK: Created automation\n"
            f"  ID: {task.id}\n"
            f"  Name: {task.name}\n"
            f"  Type: {sched_type}\n"
            f"  Schedule: {schedule.strip()}"
            f"\n  Prompt: {task.prompt[:80] + ('...' if len(task.prompt) > 80 else '')}\n"
            f"  Status: active\n"
            f"\nUse action='pause' with id={task.id} to pause, "
            f"'delete' to remove."
        )

    # ── LIST ──
    elif action_lower in ("list", "ls", "l"):
        tasks = _list_all_tasks()
        if not tasks:
            return "No automations found. Use action='create' to create one."

        lines = [f"## Automations ({len(tasks)} total)", ""]
        for t in tasks:
            icon = {"active": "[ON]", "paused": "[PAUSED]", "completed": "[DONE]"}.get(t.status, "[?]")
            sched_display = t.scheduled_at or t.rrule or "(none)"
            _trunc = t.prompt[:60] + ('...' if len(t.prompt) > 60 else '')
            lines.append(
                f"- {icon} **{t.name}** (id=`{t.id}`)\n"
                f"  Status: {t.status} | Schedule: {sched_display}\n"
                f"  Created: {t.created_at} | Runs: {t.run_count}\n"
                f"  Prompt: {_trunc}"
            )
        return "\n".join(lines)

    # ── PAUSE ──
    elif action_lower == "pause":
        if not id:
            return 'Error: "id" is required for action=pause.'
        task = _load_task(id)
        if task is None:
            return f"Error: No automation found with id='{id}'"
        if task.status != AutomationStatus.ACTIVE.value:
            return f"Info: Automation '{task.name}' ({id}) is already '{task.status}'"
        task.status = AutomationStatus.PAUSED.value
        _save_task(task)
        return f"OK: Paused automation '{task.name}' ({id})"

    # ── RESUME ──
    elif action_lower in ("resume", "unpause"):
        if not id:
            return 'Error: "id" is required for action=resume.'
        task = _load_task(id)
        if task is None:
            return f"Error: No automation found with id='{id}'"
        if task.status != AutomationStatus.PAUSED.value:
            return f"Info: Automation '{task.name}' ({id}) is '{task.status}', cannot resume."
        task.status = AutomationStatus.ACTIVE.value
        _save_task(task)
        return f"OK: Resumed automation '{task.name}' ({id})"

    # ── DELETE ──
    elif action_lower in ("delete", "remove", "rm"):
        if not id:
            return 'Error: "id" is required for action=delete.'
        task = _load_task(id)
        if task is None:
            return f"Error: No automation found with id='{id}'"
        task_name = task.name
        deleted = _delete_task(id)
        if deleted:
            return f"OK: Deleted automation '{task_name}' ({id})"
        return f"Error: Failed to delete automation '{task_name}' ({id})"

    # ── STATUS ──
    elif action_lower in ("status", "show", "info"):
        if not id:
            return 'Error: "id" is required for action=status.'
        task = _load_task(id)
        if task is None:
            return f"Error: No automation found with id='{id}'"
        _ws = ', '.join(task.cwds) if task.cwds else '(default)'
        lines = [
            f"## Automation: {task.name}",
            f"",
            f"| Field | Value |",
            f"|-------|-------|",
            f"| ID | `{task.id}` |",
            f"| Status | {task.status} |",
            f"| Type | {task.schedule_type} |",
            f"| Schedule | {task.scheduled_at or task.rrule or '(none)'} |",
            f"| Prompt | {task.prompt} |",
            f"| Workspace | {_ws} |",
            f"| Created | {task.created_at} |",
            f"| Last Run | {task.last_run or '(never)'} |",
            f"| Run Count | {task.run_count} |",
            f"| Valid From | {task.valid_from or '(unlimited)'} |",
            f"| Valid Until | {task.valid_until or '(unlimited)'} |",
        ]
        return "\n".join(lines)

    else:
        valid_actions = ["create", "list", "pause", "resume", "delete", "status"]
        return (
            f"Error: Unknown action '{action}'. Valid actions: {valid_actions}\n"
            f"\nExamples:\n"
            f"  automation_tool('create', name='My task', prompt='Run tests', schedule='daily')\n"
            f"  automation_tool('list')\n"
            f"  automation_tool('pause', id='<id>')\n"
            f"  automation_tool('delete', id='<id>')"
        )
