"""Tests for deerflow.tools.ui_metadata (role editor tool catalog)."""

from __future__ import annotations


def test_collect_native_tool_specs_merges_modes(monkeypatch):
    from deerflow.tools import ui_metadata as um

    class _T:
        def __init__(self, name: str, description: str = "", group: str = "") -> None:
            self.name = name
            self.description = description
            self.group = group

    def fake_get_available_tools(**kwargs):
        mode = kwargs.get("tools_mode")
        if mode == "sandbox":
            return [_T("bash", "Run shell", "bash")]
        if mode == "host_direct":
            return [_T("read_file", "Read path", "")]
        return []

    monkeypatch.setattr(um, "get_available_tools", fake_get_available_tools)

    out = um.collect_native_tool_specs_for_role_ui(model_name=None)
    names = [x["name"] for x in out]
    assert names == ["bash", "read_file"]


def test_collect_skips_mcp_prefixed_names(monkeypatch):
    from deerflow.tools import ui_metadata as um

    class _T:
        name = "github__search"
        description = ""
        group = ""

    monkeypatch.setattr(um, "get_available_tools", lambda **_: [_T()])

    out = um.collect_native_tool_specs_for_role_ui(model_name=None)
    assert out == []
