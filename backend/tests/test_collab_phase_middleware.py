"""Tests for CollabPhaseMiddleware (G-02)."""

from langchain_core.messages import AIMessage, HumanMessage
from langgraph.runtime import Runtime

from deerflow.agents.middlewares.collab_phase_middleware import CollabPhaseMiddleware
from deerflow.collab.models import CollabPhase, ThreadCollabState


class TestCollabPhaseMiddleware:
    def test_skips_when_idle_or_missing_phase(self):
        m = CollabPhaseMiddleware()
        state = {"messages": [HumanMessage(content="hi")]}
        assert m.before_model(state, Runtime(context={})) is None
        assert m.before_model(state, Runtime(context={"collab_phase": "idle"})) is None
        assert m.before_model(state, Runtime(context={"collab_phase": ""})) is None

    def test_skips_when_last_message_not_human(self):
        m = CollabPhaseMiddleware()
        state = {"messages": [HumanMessage(content="hi"), AIMessage(content="ok")]}
        assert m.before_model(state, Runtime(context={"collab_phase": "req_confirm"})) is None

    def test_injects_req_confirm(self):
        m = CollabPhaseMiddleware()
        state = {"messages": [HumanMessage(content="plan something")]}
        out = m.before_model(state, Runtime(context={"collab_phase": "req_confirm", "subagent_enabled": True}))
        assert out is not None
        msg = out["messages"][0]
        assert msg.name == "collab_phase_hint"
        assert "ask_clarification" in msg.content
        assert "req_confirm" in msg.content

    def test_injects_executing_with_task_ids(self):
        m = CollabPhaseMiddleware()
        state = {"messages": [HumanMessage(content="go")]}
        out = m.before_model(
            state,
            Runtime(
                context={
                    "collab_phase": "executing",
                    "collab_task_id": "task-1",
                    "bound_project_id": "proj-9",
                }
            ),
        )
        assert out is not None
        assert "task-1" in out["messages"][0].content
        assert "proj-9" in out["messages"][0].content

    def test_skips_duplicate_collab_hint_name(self):
        m = CollabPhaseMiddleware()
        state = {"messages": [HumanMessage(content="x", name="collab_phase_hint")]}
        assert m.before_model(state, Runtime(context={"collab_phase": "executing"})) is None

    def test_disk_collab_overrides_stale_run_context(self, monkeypatch):
        """After start_execution, collab_state.json is executing but stream context may still say awaiting_exec."""

        def fake_load(_paths, tid):
            assert tid == "th-1"
            return ThreadCollabState(
                collab_phase=CollabPhase.EXECUTING,
                bound_task_id="task-from-disk",
                bound_project_id="proj-disk",
            )

        monkeypatch.setattr(
            "deerflow.agents.middlewares.collab_phase_middleware.load_thread_collab_state",
            fake_load,
        )
        m = CollabPhaseMiddleware()
        state = {"messages": [HumanMessage(content="run workers")]}
        out = m.before_model(
            state,
            Runtime(
                context={
                    "thread_id": "th-1",
                    "collab_phase": "awaiting_exec",
                    "subagent_enabled": True,
                }
            ),
        )
        assert out is not None
        content = out["messages"][0].content
        assert "executing" in content
        assert "task-from-disk" in content
        assert "proj-disk" in content

    def test_executing_phase_prefers_disk_bound_task_over_stale_context(self, monkeypatch):
        """Stream context may still carry an old collab_task_id; disk bound_task_id wins in executing."""

        def fake_load(_paths, tid):
            assert tid == "th-1"
            return ThreadCollabState(
                collab_phase=CollabPhase.EXECUTING,
                bound_task_id="new-main",
                bound_project_id="proj-99",
            )

        monkeypatch.setattr(
            "deerflow.agents.middlewares.collab_phase_middleware.load_thread_collab_state",
            fake_load,
        )
        m = CollabPhaseMiddleware()
        state = {"messages": [HumanMessage(content="go")]}
        out = m.before_model(
            state,
            Runtime(
                context={
                    "thread_id": "th-1",
                    "collab_phase": "executing",
                    "collab_task_id": "old-main",
                    "bound_project_id": "proj-old",
                    "subagent_enabled": True,
                }
            ),
        )
        assert out is not None
        content = out["messages"][0].content
        assert "new-main" in content
        assert "old-main" not in content
        assert "proj-99" in content
