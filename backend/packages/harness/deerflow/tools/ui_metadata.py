"""Native tool names/descriptions for agent role UI (Gateway / DeerPanel).

Merges sandbox and host_direct tool surfaces so the role editor lists every name
the lead agent may bind at runtime (excluding MCP-prefixed tools).
"""

from __future__ import annotations

import logging
from typing import Any

from deerflow.tools.tools import get_available_tools

logger = logging.getLogger(__name__)


def collect_native_tool_specs_for_role_ui(*, model_name: str | None = None) -> list[dict[str, Any]]:
    """Return one entry per native tool name for the preset-role tools checklist.

    Calls ``get_available_tools`` twice (sandbox + host_direct) with ``include_mcp=False``,
    then merges by tool name. MCP tools stay on the MCP tab; deferred ``tool_search`` is
    added separately by the Gateway when enabled.
    """
    modes: tuple[str, ...] = ("sandbox", "host_direct")
    by_name: dict[str, dict[str, Any]] = {}

    for mode in modes:
        try:
            tools = get_available_tools(
                groups=None,
                include_mcp=False,
                model_name=model_name,
                subagent_enabled=True,
                include_search=True,
                tools_mode=mode,
            )
        except Exception as e:
            logger.debug("ui_metadata: skip tools_mode=%s: %s", mode, e)
            continue

        for t in tools:
            name = getattr(t, "name", None) or ""
            if not name or "__" in name:
                continue
            
            # Try to get UI metadata from module-level variable (e.g., create_agent_tool_ui_metadata)
            ui_meta = {}
            try:
                # Get the module where the tool is defined
                tool_module = getattr(t, "__module__", None)
                if tool_module:
                    import importlib
                    mod = importlib.import_module(tool_module)
                    meta_var_name = f"{name}_ui_metadata"
                    if hasattr(mod, meta_var_name):
                        ui_meta = getattr(mod, meta_var_name) or {}
            except Exception:
                # Silently ignore - UI metadata is optional
                pass
            
            # Fallback to tool object attributes if ui_meta is empty
            if not ui_meta:
                ui_meta = getattr(t, "ui_metadata", None) or {}
            
            desc_raw = getattr(t, "description", None) or ""
            desc = desc_raw.strip() if isinstance(desc_raw, str) else ""
            group = getattr(t, "group", None) or ""
            
            if name not in by_name:
                by_name[name] = {
                    "name": name,
                    "group": ui_meta.get("group") or group,
                    "description": ui_meta.get("description") or desc,
                    "label": ui_meta.get("label"),
                    "icon": ui_meta.get("icon"),
                }
            else:
                prev = by_name[name]
                # Prefer UI metadata over default values
                if not prev.get("group") and (ui_meta.get("group") or group):
                    prev["group"] = ui_meta.get("group") or group
                if not prev.get("description") and ui_meta.get("description"):
                    prev["description"] = ui_meta.get("description")
                elif not prev.get("description"):
                    prev_desc = (prev.get("description") or "").strip()
                    if len(desc) > len(prev_desc):
                        prev["description"] = desc
                # Store label and icon for UI
                if ui_meta.get("label"):
                    prev["label"] = ui_meta.get("label")
                if ui_meta.get("icon"):
                    prev["icon"] = ui_meta.get("icon")

    return sorted(by_name.values(), key=lambda x: str(x.get("name") or ""))
