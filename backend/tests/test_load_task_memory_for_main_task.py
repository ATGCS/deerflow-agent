"""Tests for load_task_memory_for_main_task (shared by HTTP and supervisor)."""

from unittest.mock import MagicMock

from deerflow.collab.storage import load_task_memory_for_main_task


def test_load_task_memory_returns_none_when_main_task_missing():
    ps = MagicMock()
    ms = MagicMock()
    ps.list_projects.return_value = []
    assert load_task_memory_for_main_task(ps, ms, "missing") is None
    ms.load_task_memory.assert_not_called()


def test_load_task_memory_uses_assigned_to_and_storage_path():
    ps = MagicMock()
    ms = MagicMock()
    ms.load_task_memory.return_value = {
        "task_id": "t1",
        "facts": [{"content": "a"}],
        "output_summary": "done",
    }
    project = {"id": "p9", "tasks": [{"id": "t1", "assigned_to": "ag2"}]}
    ps.list_projects.return_value = [{"id": "p9"}]
    ps.load_project.return_value = project

    out = load_task_memory_for_main_task(ps, ms, "t1")
    assert out is not None
    mem, project_id, agent_id = out
    assert project_id == "p9"
    assert agent_id == "ag2"
    assert mem["output_summary"] == "done"
    ms.load_task_memory.assert_called_once_with("p9", "ag2", "t1")


def test_load_task_memory_empty_string_agent_when_unassigned():
    ps = MagicMock()
    ms = MagicMock()
    ms.load_task_memory.return_value = {"task_id": "t1"}
    project = {"id": "p1", "tasks": [{"id": "t1"}]}
    ps.list_projects.return_value = [{"id": "p1"}]
    ps.load_project.return_value = project

    out = load_task_memory_for_main_task(ps, ms, "t1")
    assert out is not None
    _mem, _pid, agent_id = out
    assert agent_id == ""
    ms.load_task_memory.assert_called_once_with("p1", "", "t1")
