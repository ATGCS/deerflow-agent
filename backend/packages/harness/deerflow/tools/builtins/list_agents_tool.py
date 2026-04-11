"""Tool for listing all available custom agents."""

import json
import logging
from typing import Annotated, Any

from langchain.tools import InjectedToolCallId, ToolRuntime, tool
from langgraph.typing import ContextT

from deerflow.config.agents_config import list_all_agents

logger = logging.getLogger(__name__)


# UI metadata for tool discovery (attached to function, not tool object)
list_agents_tool_ui_metadata = {
    "label": "查询智能体",
    "icon": "📋",
    "group": "agent_management",
    "description": "列出所有可用智能体及其配置信息"
}


@tool("list_agents")
async def list_agents_tool(
    runtime: ToolRuntime[ContextT, dict],
    tool_call_id: Annotated[str, InjectedToolCallId],
) -> str:
    """List all available custom agents with their configurations."""
    logger.info("list_agents_tool: listing all agents")

    try:
        agents = list_all_agents()
        
        # Convert to serializable format
        agent_list = []
        for agent in agents:
            agent_dict = {
                "name": agent.name,
                "name_cn": agent.name_cn,
                "type": agent.agent_type,
                "description": agent.description,
                "model": agent.model,
                "tools": agent.tools,
                "skills": agent.skills,
                "disallowed_tools": agent.disallowed_tools,
                "max_turns": agent.max_turns,
                "timeout_seconds": agent.timeout_seconds,
            }
            agent_list.append(agent_dict)

        logger.info(f"Listed {len(agent_list)} agents")

        return json.dumps({
            "success": True,
            "agents": agent_list,
            "count": len(agent_list),
            "message": f"Found {len(agent_list)} agent(s). Use the 'name' field for assigned_agent when creating subtasks."
        }, ensure_ascii=False, default=str)
    except Exception as e:
        logger.error(f"Failed to list agents: {str(e)}")
        return json.dumps({
            "success": False,
            "error": f"Failed to list agents: {str(e)}"
        }, ensure_ascii=False)
