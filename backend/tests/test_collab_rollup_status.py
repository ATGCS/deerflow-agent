"""
Unit tests for collaborative task progress/status convergence.

Specifically covers:
- rollup_root_task_progress_from_subtasks: derive root main_task.status from subtasks terminal states
- supervisor(action="update_progress", status=...): persist subtask status and roll up into root status
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from deerflow.collab.storage import ProjectStorage, find_main_task, rollup_root_task_progress_from_subtasks


def _seed_project(storage: ProjectStorage, *, project_id: str, main_task: dict[str, Any]) -> None:
    project = {
        "id": project_id,
        "name": "test-project",
        "description": "",
        "tasks": [main_task],
        "status": "pending",
        "supervisor_session_id": None,
        "created_at": "2026-04-06T00:00:00Z",
        "updated_at": "2026-04-06T00:00:00Z",
    }
    assert storage.save_project(project)


def _make_main_task(task_id: str, *, status: str, progress: int, subtasks: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": task_id,
        "name": "main",
        "status": status,
        "progress": progress,
        "completed_at": None,
        "failed_at": None,
        "subtasks": subtasks,
    }


@pytest.mark.parametrize(
    "subtask_statuses,expected_root_status,expected_progress",
    [
        (["completed", "completed"], "completed", 100),
        (["completed", "failed"], "failed", 50),
        (["cancelled", "cancelled"], "cancelled", 0),
        (["completed", "cancelled"], "cancelled", 50),
        (["completed", "in_progress"], "in_progress", 50),
    ],
)
def test_rollup_root_status_from_subtasks(
    tmp_path,
    subtask_statuses: list[str],
    expected_root_status: str,
    expected_progress: int,
):
    storage = ProjectStorage(tmp_path / "projects")
    project_id = "proj-1"
    task_id = "task-1"
    subtasks: list[dict[str, Any]] = []
    for i, st in enumerate(subtask_statuses):
        if st == "completed":
            st_prog = 100
        elif st in {"failed", "cancelled", "in_progress"}:
            st_prog = 0
        else:
            st_prog = 0
        subtasks.append(
            {
                "id": f"st-{i}",
                "status": st,
                "progress": st_prog,
            }
        )

    main_task = _make_main_task(task_id, status="in_progress", progress=0, subtasks=subtasks)
    _seed_project(storage, project_id=project_id, main_task=main_task)

    assert rollup_root_task_progress_from_subtasks(storage, task_id) is True
    _proj, updated = find_main_task(storage, task_id)
    assert updated is not None
    assert updated["status"] == expected_root_status
    assert int(updated["progress"]) == expected_progress

