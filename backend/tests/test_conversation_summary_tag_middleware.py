"""Tests for ConversationSummaryTagMiddleware."""

from unittest.mock import MagicMock

from langchain_core.messages import HumanMessage

from deerflow.agents.middlewares.conversation_summary_tag_middleware import (
    ConversationSummaryTagMiddleware,
)


def test_tags_unnamed_summary_human_by_id():
    summary = HumanMessage(
        id="s1",
        content="Here is a summary of the conversation to date:\n\nhello",
    )
    other = HumanMessage(id="u1", content="real user")
    mw = ConversationSummaryTagMiddleware()
    out = mw.before_model({"messages": [summary, other]}, MagicMock())
    assert out is not None
    updated = out["messages"]
    assert len(updated) == 1
    assert updated[0].id == "s1"
    assert updated[0].name == "conversation_summary"
    assert updated[0].content == summary.content


def test_apostrophe_prefix_variant():
    summary = HumanMessage(
        id="s2",
        content="Here's a summary of the conversation to date:\n\nx",
    )
    mw = ConversationSummaryTagMiddleware()
    out = mw.before_model({"messages": [summary]}, MagicMock())
    assert out["messages"][0].name == "conversation_summary"


def test_skips_normal_user_and_named_human():
    user = HumanMessage(id="u", content="What is the weather?")
    named = HumanMessage(
        id="n",
        name="something",
        content="Here is a summary of the conversation to date:\n\nx",
    )
    mw = ConversationSummaryTagMiddleware()
    assert mw.before_model({"messages": [user, named]}, MagicMock()) is None


def test_does_not_retag_named_summary():
    already = HumanMessage(
        id="s",
        name="conversation_summary",
        content="Here is a summary of the conversation to date:\n\nx",
    )
    mw = ConversationSummaryTagMiddleware()
    assert mw.before_model({"messages": [already]}, MagicMock()) is None
