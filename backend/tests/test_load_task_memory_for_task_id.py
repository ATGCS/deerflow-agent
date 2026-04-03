"""Tests for load_task_memory_for_task_id (main + subtask ids)."""

from unittest.mock import MagicMock

from deerflow.collab.storage import load_task_memory_for_task_id


def test_resolves_main_task_same_as_before():
    ps = MagicMock()
    ms = MagicMock()
    ms.load_task_memory.return_value = {"task_id": "main1", "facts": [], "output_summary": "x"}
    project = {"id": "p1", "tasks": [{"id": "main1", "assigned_to": "lead"}]}
    ps.list_projects.return_value = [{"id": "p1"}]
    ps.load_project.return_value = project

    out = load_task_memory_for_task_id(ps, ms, "main1")
    assert out is not None
    mem, project_id, agent_id, parent = out
    assert parent is None
    assert project_id == "p1"
    assert agent_id == "lead"
    assert mem["output_summary"] == "x"
    ms.load_task_memory.assert_called_once_with("p1", "lead", "main1")


def test_resolves_subtask_and_uses_subtask_agent():
    ps = MagicMock()
    ms = MagicMock()
    ms.load_task_memory.return_value = {"task_id": "st1", "facts": [{"content": "sub fact"}], "progress": 42}
    project = {
        "id": "proj9",
        "tasks": [
            {
                "id": "main9",
                "assigned_to": "lead",
                "subtasks": [{"id": "st1", "assigned_to": "worker-a", "name": "step"}],
            }
        ],
    }
    ps.list_projects.return_value = [{"id": "proj9"}]
    ps.load_project.return_value = project

    out = load_task_memory_for_task_id(ps, ms, "st1")
    assert out is not None
    mem, project_id, agent_id, parent = out
    assert parent == "main9"
    assert project_id == "proj9"
    assert agent_id == "worker-a"
    assert mem["progress"] == 42
    ms.load_task_memory.assert_called_once_with("proj9", "worker-a", "st1")


def test_subtask_falls_back_to_main_assigned_to():
    ps = MagicMock()
    ms = MagicMock()
    ms.load_task_memory.return_value = {"task_id": "st2"}
    project = {
        "id": "p2",
        "tasks": [
            {
                "id": "m2",
                "assigned_to": "fallback-agent",
                "subtasks": [{"id": "st2", "name": "n"}],
            }
        ],
    }
    ps.list_projects.return_value = [{"id": "p2"}]
    ps.load_project.return_value = project

    out = load_task_memory_for_task_id(ps, ms, "st2")
    assert out is not None
    _mem, _pid, agent_id, parent = out
    assert parent == "m2"
    assert agent_id == "fallback-agent"
    ms.load_task_memory.assert_called_once_with("p2", "fallback-agent", "st2")


def test_unknown_id_returns_none():
    ps = MagicMock()
    ms = MagicMock()
    ps.list_projects.return_value = []
    assert load_task_memory_for_task_id(ps, ms, "nope") is None
    ms.load_task_memory.assert_not_called()
