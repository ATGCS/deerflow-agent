"""Configuration and loaders for custom agents."""

import logging
import re
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field

from deerflow.config.paths import get_paths

logger = logging.getLogger(__name__)

SOUL_FILENAME = "SOUL.md"
AGENT_NAME_PATTERN = re.compile(r"^[A-Za-z0-9-]+$")


class AgentConfig(BaseModel):
    """Unified configuration for all types of agents.
    
    Attributes:
        name: Unique identifier for the agent.
        description: What the agent does.
        model: Model to use (optional).
        tool_groups: Optional tool group whitelist.
        tools: Optional tool whitelist (builtin tool names).
        mcp_servers: Optional MCP server names.
        skills: Optional skill names (injected via skills prompt section).
        agent_type: Type of agent - 'custom', 'subagent', or 'acp'.
        system_prompt: For subagents - the system prompt.
        disallowed_tools: For subagents - optional tool blacklist.
        max_turns: For subagents - maximum number of turns.
        timeout_seconds: For subagents/ACP - timeout in seconds.
        command: For ACP - command to execute.
        args: For ACP - command arguments.
        env: For ACP - environment variables.
        auto_approve_permissions: For ACP - auto-approve permission requests.
    """

    name: str
    description: str = ""
    model: str | None = None
    tool_groups: list[str] | None = None
    
    # Tool / MCP / Skills configuration
    tools: list[str] | None = None
    mcp_servers: list[str] | None = None
    skills: list[str] | None = None
    
    # Agent type discriminator
    agent_type: Literal["custom", "subagent", "acp"] = "custom"
    
    # Subagent-specific fields
    system_prompt: str | None = None
    disallowed_tools: list[str] | None = None
    max_turns: int = 50
    timeout_seconds: int = 900
    
    # ACP-specific fields
    command: str | None = None
    args: list[str] | None = None
    env: dict[str, str] | None = None
    auto_approve_permissions: bool = False


def load_agent_config(name: str | None) -> AgentConfig | None:
    """Load the custom or default agent's config from its directory.

    Args:
        name: The agent name.

    Returns:
        AgentConfig instance.

    Raises:
        FileNotFoundError: If the agent directory or config.yaml does not exist.
        ValueError: If config.yaml cannot be parsed.
    """

    if name is None:
        return None

    if not AGENT_NAME_PATTERN.match(name):
        raise ValueError(f"Invalid agent name '{name}'. Must match pattern: {AGENT_NAME_PATTERN.pattern}")
    agent_dir = get_paths().agent_dir(name)
    config_file = agent_dir / "config.yaml"

    if not agent_dir.exists():
        raise FileNotFoundError(f"Agent directory not found: {agent_dir}")

    if not config_file.exists():
        raise FileNotFoundError(f"Agent config not found: {config_file}")

    try:
        with open(config_file, encoding="utf-8") as f:
            data: dict[str, Any] = yaml.safe_load(f) or {}
    except yaml.YAMLError as e:
        raise ValueError(f"Failed to parse agent config {config_file}: {e}") from e

    # Ensure name is set from directory name if not in file
    if "name" not in data:
        data["name"] = name

    # Strip unknown fields before passing to Pydantic (e.g. legacy prompt_file)
    known_fields = set(AgentConfig.model_fields.keys())
    data = {k: v for k, v in data.items() if k in known_fields}

    return AgentConfig(**data)


def load_agent_soul(agent_name: str | None) -> str | None:
    """Read the SOUL.md file for a custom agent, if it exists.

    SOUL.md defines the agent's personality, values, and behavioral guardrails.
    It is injected into the lead agent's system prompt as additional context.

    Args:
        agent_name: The name of the agent or None for the default agent.

    Returns:
        The SOUL.md content as a string, or None if the file does not exist.
    """
    agent_dir = get_paths().agent_dir(agent_name) if agent_name else get_paths().base_dir
    soul_path = agent_dir / SOUL_FILENAME
    if not soul_path.exists():
        return None
    content = soul_path.read_text(encoding="utf-8").strip()
    return content or None


def list_custom_agents() -> list[AgentConfig]:
    """Scan the agents directory and return all valid custom agents.

    Returns:
        List of AgentConfig for each valid agent directory found.
        Includes both 'custom' and 'subagent' types (excludes 'acp').
    """
    agents_dir = get_paths().agents_dir

    if not agents_dir.exists():
        return []

    agents: list[AgentConfig] = []

    for entry in sorted(agents_dir.iterdir()):
        if not entry.is_dir():
            continue

        config_file = entry / "config.yaml"
        if not config_file.exists():
            logger.debug(f"Skipping {entry.name}: no config.yaml")
            continue

        try:
            agent_cfg = load_agent_config(entry.name)
            # Skip 'main' — handled separately by list_agents()
            if entry.name.lower() == "main":
                continue
            # Return custom and subagent agents (exclude ACP agents from this list)
            if agent_cfg.agent_type in ("custom", "subagent"):
                agents.append(agent_cfg)
        except Exception as e:
            logger.warning(f"Skipping agent '{entry.name}': {e}")

    return agents


def list_subagents() -> list[AgentConfig]:
    """Scan the agents directory and return all subagent configurations.

    Returns:
        List of AgentConfig for each subagent found.
    """
    agents_dir = get_paths().agents_dir

    if not agents_dir.exists():
        return []

    agents: list[AgentConfig] = []

    for entry in sorted(agents_dir.iterdir()):
        if not entry.is_dir():
            continue

        config_file = entry / "config.yaml"
        if not config_file.exists():
            continue

        try:
            agent_cfg = load_agent_config(entry.name)
            # Only return subagents
            if agent_cfg.agent_type == "subagent":
                agents.append(agent_cfg)
        except Exception as e:
            logger.warning(f"Skipping agent '{entry.name}': {e}")

    return agents


def list_acp_agents() -> list[AgentConfig]:
    """Scan the agents directory and return all ACP agent configurations.

    Returns:
        List of AgentConfig for each ACP agent found.
    """
    agents_dir = get_paths().agents_dir

    if not agents_dir.exists():
        return []

    agents: list[AgentConfig] = []

    for entry in sorted(agents_dir.iterdir()):
        if not entry.is_dir():
            continue

        config_file = entry / "config.yaml"
        if not config_file.exists():
            continue

        try:
            agent_cfg = load_agent_config(entry.name)
            # Only return ACP agents
            if agent_cfg.agent_type == "acp":
                agents.append(agent_cfg)
        except Exception as e:
            logger.warning(f"Skipping agent '{entry.name}': {e}")

    return agents


def list_all_agents() -> list[AgentConfig]:
    """Scan the agents directory and return all agent configurations.

    Returns:
        List of AgentConfig for all agents found (custom + subagent + ACP).
    """
    agents_dir = get_paths().agents_dir

    if not agents_dir.exists():
        return []

    agents: list[AgentConfig] = []

    for entry in sorted(agents_dir.iterdir()):
        if not entry.is_dir():
            continue

        config_file = entry / "config.yaml"
        if not config_file.exists():
            continue

        try:
            agent_cfg = load_agent_config(entry.name)
            agents.append(agent_cfg)
        except Exception as e:
            logger.warning(f"Skipping agent '{entry.name}': {e}")

    return agents
