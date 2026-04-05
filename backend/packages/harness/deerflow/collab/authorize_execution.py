"""Authorize collaborative main-task execution (gate before workers run).

Kept in a dedicated module so LangGraph / uvicorn workers reliably load fresh logic
(avoid stale bytecode confusion with a large storage.py).
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from deerflow.collab.storage import ProjectStorage


def authorize_main_task_execution(
    storage: ProjectStorage, task_id: str, authorized_by: str
) -> tuple[bool, str]:
    """Set execution_authorized when status is planned, planning, or pending.

    Pending tasks are promoted to ``planned`` before the gate check so
    ``start_execution`` works right after ``create_task`` without a separate
    ``set_task_planned`` call.
    """
    allowed_status = ("planned", "planning", "pending")
    for summary in storage.list_projects():
        project = storage.load_project(summary["id"])
        if not project:
            continue
        for i, task in enumerate(project.get("tasks", [])):
            if task.get("id") != task_id:
                continue
            if task.get("execution_authorized"):
                return True, "Already authorized"
            status = task.get("status")
            if status == "pending":
                task["status"] = "planned"
                project["tasks"][i] = task
                if not storage.save_project(project):
                    return False, "Failed to save project while promoting task from pending to planned"
                status = "planned"
            if status not in allowed_status:
                return False, (
                    f"Task status must be one of {allowed_status!r} to authorize execution; "
                    f"got {status!r}"
                )
            now = datetime.utcnow().isoformat() + "Z"
            task["execution_authorized"] = True
            task["authorized_at"] = now
            task["authorized_by"] = authorized_by
            project["tasks"][i] = task
            if storage.save_project(project):
                return True, "Execution authorized"
            return False, "Failed to save project"
    return False, f"Task '{task_id}' not found"
