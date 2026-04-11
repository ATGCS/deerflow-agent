"""Tool for creating new custom agents."""

import json
import logging
from typing import Annotated, Any

from langchain.tools import InjectedToolCallId, ToolRuntime, tool
from langgraph.typing import ContextT

from deerflow.config.agents_config import load_agent_config, save_agent_config

logger = logging.getLogger(__name__)


# UI metadata for tool discovery (attached to function, not tool object)
create_agent_tool_ui_metadata = {
    "label": "创建智能体",
    "icon": "🤖",
    "group": "agent_management",
    "description": "创建新的自定义智能体，支持中文名、工具/技能配置"
}


@tool("create_agent")
async def create_agent_tool(
    runtime: ToolRuntime[ContextT, dict],
    tool_call_id: Annotated[str, InjectedToolCallId],
    agent_name: str,
    agent_name_cn: str | None = None,
    agent_type: str = "subagent",
    description: str = "",
    model: str | None = None,
    system_prompt: str | None = None,
    tools: list[str] | None = None,
    skills: list[str] | None = None,
    disallowed_tools: list[str] | None = None,
    max_turns: int = 50,
    timeout_seconds: int = 900,
) -> str:
    """Create a new custom agent."""
    # Normalize agent name
    agent_name = agent_name.strip().lower()
    
    logger.info(
        "create_agent_tool: agent_name=%s agent_name_cn=%s agent_type=%s",
        agent_name,
        agent_name_cn,
        agent_type,
    )

    # Validate agent name format
    import re
    if not re.match(r"^[A-Za-z0-9-]+$", agent_name):
        return json.dumps({
            "success": False,
            "error": f"Invalid agent name '{agent_name}'. Must contain only letters, numbers, and hyphens."
        }, ensure_ascii=False)

    # Validate subagent requires system_prompt
    if agent_type == "subagent" and not system_prompt:
        return json.dumps({
            "success": False,
            "error": "system_prompt is required for subagent type. Please provide detailed instructions for the agent's behavior."
        }, ensure_ascii=False)

    # Check if agent already exists
    try:
        existing = load_agent_config(agent_name)
        if existing:
            return json.dumps({
                "success": False,
                "error": f"Agent '{agent_name}' already exists. Use update_agent to modify it."
            }, ensure_ascii=False)
    except FileNotFoundError:
        pass  # Expected - agent doesn't exist yet

    # Build agent config
    agent_config = {
        "name": agent_name,
        "name_cn": agent_name_cn,
        "type": agent_type,
        "description": description,
        "model": model,
        "system_prompt": system_prompt,
        "tools": tools or [],
        "skills": skills or [],
        "disallowed_tools": disallowed_tools or [],
        "max_turns": max_turns,
        "timeout_seconds": timeout_seconds,
    }

    # Save agent configuration
    try:
        save_agent_config(agent_name, agent_config)
        logger.info(f"Created agent '{agent_name}' successfully")

        return json.dumps({
            "success": True,
            "agent_name": agent_name,
            "agent_name_cn": agent_name_cn,
            "agent_type": agent_type,
            "description": description,
            "message": f"Agent '{agent_name}' created successfully. You can now use it by specifying assigned_agent='{agent_name}' when creating subtasks."
        }, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Failed to create agent '{agent_name}': {str(e)}")
        return json.dumps({
            "success": False,
            "error": f"Failed to create agent: {str(e)}"
        }, ensure_ascii=False)
