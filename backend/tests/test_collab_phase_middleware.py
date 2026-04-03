"""Tests for CollabPhaseMiddleware (G-02)."""

from langchain_core.messages import AIMessage, HumanMessage
from langgraph.runtime import Runtime

from deerflow.agents.middlewares.collab_phase_middleware import CollabPhaseMiddleware


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
