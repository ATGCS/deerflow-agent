"""Tool for updating existing custom agents."""

import json
import logging
from typing import Annotated, Any

from langchain.tools import InjectedToolCallId, ToolRuntime, tool
from langgraph.typing import ContextT

from deerflow.config.agents_config import load_agent_config, save_agent_config

logger = logging.getLogger(__name__)


# UI metadata for tool discovery (attached to function, not tool object)
update_agent_tool_ui_metadata = {
    "label": "更新智能体",
    "icon": "✏️",
    "group": "agent_management",
    "description": "更新现有智能体的配置，包括中文名、工具、技能等"
}


@tool("update_agent")
async def update_agent_tool(
    runtime: ToolRuntime[ContextT, dict],
    tool_call_id: Annotated[str, InjectedToolCallId],
    agent_name: str,
    agent_name_cn: str | None = None,
    agent_type: str | None = None,
    description: str | None = None,
    model: str | None = None,
    system_prompt: str | None = None,
    tools: list[str] | None = None,
    skills: list[str] | None = None,
    disallowed_tools: list[str] | None = None,
    max_turns: int | None = None,
    timeout_seconds: int | None = None,
) -> str:
    """Update an existing custom agent's configuration."""
    # Normalize agent name
    agent_name = agent_name.strip().lower()
    
    logger.info(
        "update_agent_tool: agent_name=%s fields_to_update=%s",
        agent_name,
        [k for k, v in locals().items() if v is not None and k != "agent_name"]
    )

    # Check if agent exists
    try:
        existing_config = load_agent_config(agent_name)
        if not existing_config:
            return json.dumps({
                "success": False,
                "error": f"Agent '{agent_name}' not found. Use create_agent to create it first."
            }, ensure_ascii=False)
    except FileNotFoundError:
        return json.dumps({
            "success": False,
            "error": f"Agent '{agent_name}' not found."
        }, ensure_ascii=False)

    # Build updates dict with only provided fields
    updates = {}
    
    if agent_name_cn is not None:
        updates["name_cn"] = agent_name_cn
    if description is not None:
        updates["description"] = description
    if model is not None:
        updates["model"] = model
    if system_prompt is not None:
        updates["system_prompt"] = system_prompt
    if tools is not None:
        updates["tools"] = tools
    if skills is not None:
        updates["skills"] = skills
    if disallowed_tools is not None:
        updates["disallowed_tools"] = disallowed_tools
    if max_turns is not None:
        updates["max_turns"] = max_turns
    if timeout_seconds is not None:
        updates["timeout_seconds"] = timeout_seconds
    if agent_type is not None:
        # Validate agent type
        if agent_type not in ["custom", "subagent", "acp"]:
            return json.dumps({
                "success": False,
                "error": f"Invalid agent_type '{agent_type}'. Must be 'custom', 'subagent', or 'acp'"
            }, ensure_ascii=False)
        # Validate system_prompt for subagent
        if agent_type == "subagent" and not (system_prompt or existing_config.get("system_prompt")):
            return json.dumps({
                "success": False,
                "error": "system_prompt is required when updating agent type to 'subagent'"
            }, ensure_ascii=False)
        updates["type"] = agent_type

    if not updates:
        return json.dumps({
            "success": False,
            "error": "No update parameters provided. Specify at least one field to update."
        }, ensure_ascii=False)

    # Apply updates to existing config
    updated_config = dict(existing_config)
    updated_config.update(updates)

    # Save updated config
    try:
        save_agent_config(agent_name, updated_config)
        logger.info(f"Updated agent '{agent_name}' with fields: {list(updates.keys())}")

        return json.dumps({
            "success": True,
            "agent_name": agent_name,
            "updated_fields": list(updates.keys()),
            "message": f"Agent '{agent_name}' updated successfully. Updated fields: {', '.join(updates.keys())}"
        }, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Failed to update agent '{agent_name}': {str(e)}")
        return json.dumps({
            "success": False,
            "error": f"Failed to update agent: {str(e)}"
        }, ensure_ascii=False)
