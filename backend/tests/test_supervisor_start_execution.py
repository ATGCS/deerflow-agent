"""Regression tests for supervisor(action=start_execution) — payload/result shape and collab_state."""

from __future__ import annotations

import asyncio
import importlib
import json
from pathlib import Path
from types import SimpleNamespace
import pytest

from deerflow.collab.models import CollabPhase
from deerflow.collab.storage import ProjectStorage, find_main_task
from deerflow.collab.thread_collab import load_thread_collab_state
from deerflow.config.paths import Paths

supervisor_mod = importlib.import_module("deerflow.tools.builtins.supervisor_tool")


THREAD_ID = "78763f3b-01c6-4050-8d27-7475e05b266d"
TASK_ID = "e5474ff2"
SUBTASK_ID = "80c55de3"
PROJECT_ID = "6dd3ec04"


def _run_supervisor(**kwargs) -> str:
    tool = supervisor_mod.supervisor_tool
    coro = getattr(tool, "coroutine", None)
    if coro is not None:
        return asyncio.run(coro(**kwargs))
    return tool.func(**kwargs)  # type: ignore[union-attr]


def _seed_project(storage: ProjectStorage) -> None:
    now = "2026-04-06T00:00:00Z"
    subtask = {
        "id": SUBTASK_ID,
        "name": "写入文件记录agent身份",
        "description": "test",
        "status": "pending",
        "dependencies": [],
        "assigned_to": "general-purpose",
        "result": None,
        "error": None,
        "created_at": now,
        "started_at": None,
        "completed_at": None,
        "progress": 0,
    }
    task = {
        "id": TASK_ID,
        "name": "本地文件写入测试任务-第36次",
        "description": "full flow",
        "status": "pending",
        "parent_id": None,
        "dependencies": [],
        "assigned_to": None,
        "result": None,
        "error": None,
        "created_at": now,
        "started_at": None,
        "completed_at": None,
        "progress": 0,
        "execution_authorized": False,
        "thread_id": THREAD_ID,
        "authorized_at": None,
        "authorized_by": None,
        "subtasks": [subtask],
    }
    project = {
        "id": PROJECT_ID,
        "name": "任务: 测试",
        "description": "",
        "tasks": [task],
        "status": "pending",
        "supervisor_session_id": None,
        "created_at": now,
        "updated_at": now,
    }
    assert storage.save_project(project)


@pytest.fixture
def isolated_supervisor_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Fresh project storage + DeerFlow home so collab_state.json is assertable."""
    home = tmp_path / "deerflow_home"
    home.mkdir(parents=True, exist_ok=True)
    proj_dir = tmp_path / "projects"
    storage = ProjectStorage(proj_dir)
    paths = Paths(base_dir=str(home))

    def _get_storage() -> ProjectStorage:
        return storage

    monkeypatch.setattr(supervisor_mod, "get_project_storage", _get_storage)
    monkeypatch.setattr("deerflow.collab.storage.get_project_storage", _get_storage)
    monkeypatch.setattr(supervisor_mod, "get_paths", lambda: paths)

    async def _fake_delegate(_runtime, _storage, _main_task_id, subtask_ids):
        return [
            {"subtaskId": sid, "ok": True, "result": "Task Succeeded. Result: ok"}
            for sid in subtask_ids
        ]

    monkeypatch.setattr(
        supervisor_mod,
        "delegate_collab_subtasks_for_start_execution",
        _fake_delegate,
    )

    _seed_project(storage)
    return {"home": home, "storage": storage, "paths": paths}


def test_start_execution_success_shape_matches_user_payload(isolated_supervisor_env, monkeypatch):
    monkeypatch.setattr(supervisor_mod, "get_available_subagent_names", lambda: ["general-purpose"])

    runtime = SimpleNamespace(
        context={"thread_id": THREAD_ID},
        config={"configurable": {"thread_id": THREAD_ID}},
    )
    out = _run_supervisor(
        runtime=runtime,
        action="start_execution",
        tool_call_id="call-test-1",
        task_id=TASK_ID,
        subtask_ids=[SUBTASK_ID],
        authorized_by="user",
    )
    data = json.loads(out)
    assert data["success"] is True
    assert data["action"] == "start_execution"
    assert data["taskId"] == TASK_ID
    assert data["authorizedBy"] == "user"
    assert data["collabPhaseAdvanced"] is True
    assert data.get("waitForCompletion") is False
    assert data["subtaskIds"] == [SUBTASK_ID]
    assert data.get("delegationAllSucceeded") is True
    assert len(data.get("delegatedSubtasks") or []) == 1
    assert (data["delegatedSubtasks"][0].get("subtaskId")) == SUBTASK_ID
    assert (data["delegatedSubtasks"][0].get("ok")) is True
    assert "Execution authorized" in (data.get("message") or "")


def test_start_execution_writes_collab_state_executing_and_started_at(isolated_supervisor_env, monkeypatch):
    monkeypatch.setattr(supervisor_mod, "get_available_subagent_names", lambda: ["general-purpose"])
    paths: Paths = isolated_supervisor_env["paths"]
    storage: ProjectStorage = isolated_supervisor_env["storage"]

    runtime = SimpleNamespace(context={"thread_id": THREAD_ID}, config={})
    _run_supervisor(
        runtime=runtime,
        action="start_execution",
        tool_call_id="call-test-2",
        task_id=TASK_ID,
        subtask_ids=[SUBTASK_ID],
        authorized_by="user",
    )

    disk = load_thread_collab_state(paths, THREAD_ID)
    assert disk.collab_phase == CollabPhase.EXECUTING
    assert disk.bound_task_id == TASK_ID
    assert disk.bound_project_id == PROJECT_ID

    row = find_main_task(storage, TASK_ID)
    assert row is not None
    _proj, main_task = row
    assert main_task.get("execution_authorized") is True
    subs = main_task.get("subtasks") or []
    assert len(subs) == 1
    assert subs[0].get("id") == SUBTASK_ID
    assert subs[0].get("started_at"), "start_execution should set started_at on listed subtasks"


def test_start_execution_fails_when_subtask_id_not_under_task(isolated_supervisor_env, monkeypatch):
    monkeypatch.setattr(supervisor_mod, "get_available_subagent_names", lambda: ["general-purpose"])
    runtime = SimpleNamespace(context={"thread_id": THREAD_ID}, config={})

    out = _run_supervisor(
        runtime=runtime,
        action="start_execution",
        tool_call_id="call-test-3",
        task_id=TASK_ID,
        subtask_ids=["ffffffff"],
        authorized_by="user",
    )
    data = json.loads(out)
    assert data["success"] is False
    err = (data.get("error") or "").lower()
    assert "not under" in err or "subtask" in err


def test_start_execution_collab_phase_false_without_thread_binding(isolated_supervisor_env, monkeypatch):
    """Authorize still succeeds; advance_collab skips when task has no thread_id and runtime has no thread."""
    monkeypatch.setattr(supervisor_mod, "get_available_subagent_names", lambda: ["general-purpose"])
    storage: ProjectStorage = isolated_supervisor_env["storage"]
    row = storage.load_project(PROJECT_ID)
    assert row is not None
    row["tasks"][0]["thread_id"] = None
    assert storage.save_project(row)

    runtime = SimpleNamespace(context={}, config={})
    out = _run_supervisor(
        runtime=runtime,
        action="start_execution",
        tool_call_id="call-test-4",
        task_id=TASK_ID,
        subtask_ids=None,
        authorized_by="user",
    )
    data = json.loads(out)
    assert data["success"] is True
    assert data["collabPhaseAdvanced"] is False
    # 未传 subtask_ids 时默认跑所有已分配未终态子任务
    assert data["subtaskIds"] == [SUBTASK_ID]
    assert data.get("delegationAllSucceeded") is True
