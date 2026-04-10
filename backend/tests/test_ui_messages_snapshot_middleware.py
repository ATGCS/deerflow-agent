"""Tests for UiMessagesSnapshotMiddleware."""

from unittest.mock import MagicMock

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from deerflow.agents.middlewares.ui_messages_snapshot_middleware import UiMessagesSnapshotMiddleware


def test_snapshot_copies_messages_before_summarization_can_run():
    snap = UiMessagesSnapshotMiddleware()
    h = HumanMessage(content="hello")
    a = AIMessage(content="hi")
    t = ToolMessage(content="tool ok", tool_call_id="tc1")
    state = {"messages": [h, a, t]}
    out = snap.before_model(state, MagicMock())
    assert out is not None
    assert "ui_messages" in out
    ui = out["ui_messages"]
    assert len(ui) == 3
    assert ui[0].content == "hello"
    assert ui[1].content == "hi"
    assert ui[0] is h


def test_empty_messages_returns_empty_ui_messages():
    snap = UiMessagesSnapshotMiddleware()
    out = snap.before_model({"messages": []}, MagicMock())
    assert out is None or out == {"ui_messages": []}


def test_replaces_existing_message_by_id():
    snap = UiMessagesSnapshotMiddleware()
    t1_old = ToolMessage(id="t1", content="old", tool_call_id="tc1")
    t1_new = ToolMessage(id="t1", content="new", tool_call_id="tc1")
    # First pass seeds ui_messages with old tool output.
    out1 = snap.before_model({"messages": [t1_old]}, MagicMock())
    assert out1 and out1["ui_messages"][0].content == "old"
    # Second pass should overwrite same-id entry with new content.
    out2 = snap.before_model({"messages": [t1_new], "ui_messages": out1["ui_messages"]}, MagicMock())
    assert out2 and out2["ui_messages"][0].content == "new"
