"""Tests for persist_task_memory_after_subagent_run (F-02)."""

from unittest.mock import MagicMock

from deerflow.collab.storage import persist_task_memory_after_subagent_run


def test_persist_merges_summary_facts_and_status():
    ms = MagicMock()
    ms.load_task_memory.return_value = {
        "task_id": "t1",
        "agent_id": "a1",
        "project_id": "p1",
        "facts": [],
        "output_summary": "",
        "status": "executing",
    }
    ms.save_task_memory.return_value = True
    ms.add_fact_to_project.return_value = True

    ok, n = persist_task_memory_after_subagent_run(
        ms,
        "p1",
        "a1",
        "t1",
        outcome="completed",
        output_summary="Done.",
        current_step="Subagent completed",
        progress=100,
        source_ref="call-1",
    )
    assert ok is True
    assert n == 1
    ms.save_task_memory.assert_called_once()
    saved = ms.save_task_memory.call_args[0][0]
    assert saved["output_summary"] == "Done."
    assert saved["status"] == "completed"
    assert saved["progress"] == 100
    assert len(saved["facts"]) == 1
    assert "[subagent completed]" in saved["facts"][0]["content"]
    ms.add_fact_to_project.assert_called_once()


def test_persist_failed_outcome():
    ms = MagicMock()
    ms.load_task_memory.return_value = {"task_id": "t1", "facts": []}
    ms.save_task_memory.return_value = True
    ms.add_fact_to_project.return_value = True

    ok, n = persist_task_memory_after_subagent_run(
        ms,
        "p1",
        "",
        "t1",
        outcome="failed",
        output_summary="boom",
        current_step="Subagent failed",
        progress=0,
    )
    assert ok is True
    assert n == 1
    saved = ms.save_task_memory.call_args[0][0]
    assert saved["status"] == "failed"
    assert saved["progress"] == 0
