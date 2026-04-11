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
        agent_code: Unique identifier for the agent (hyphen-case, e.g. "online-search-genius").
        agent_name: Chinese display name for UI (e.g. "在线搜索天才").
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

    agent_code: str
    agent_name: str | None = None
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

    # Ensure agent_code is set from directory name if not in file
    if "agent_code" not in data and "name" not in data:
        data["agent_code"] = name
    elif "name" in data:
        # Backward compatibility: rename 'name' to 'agent_code'
        data["agent_code"] = data.pop("name")
    
    # Backward compatibility: rename 'name_cn' to 'agent_name'
    if "name_cn" in data:
        data["agent_name"] = data.pop("name_cn")

    # Strip unknown fields before passing to Pydantic (e.g. legacy prompt_file)
    known_fields = set(AgentConfig.model_fields.keys())
    data = {k: v for k, v in data.items() if k in known_fields}

    return AgentConfig(**data)


def save_agent_config(agent_code: str, config_data: dict) -> None:
    """Save agent configuration to config.yaml.

    Args:
        agent_code: The agent code (will be normalized to lowercase).
        config_data: Dictionary containing agent configuration fields.

    Raises:
        ValueError: If the agent code is invalid.
    """
    if not AGENT_NAME_PATTERN.match(agent_code):
        raise ValueError(f"Invalid agent code '{agent_code}'. Must match pattern: {AGENT_NAME_PATTERN.pattern}")
    
    agent_code = agent_code.lower()
    agent_dir = get_paths().agent_dir(agent_code)
    config_file = agent_dir / "config.yaml"

    # Create directory if it doesn't exist
    agent_dir.mkdir(parents=True, exist_ok=True)

    # Ensure agent_code field is set
    config_data = config_data.copy()
    config_data["agent_code"] = agent_code

    # Write config file
    with open(config_file, "w", encoding="utf-8") as f:
        yaml.dump(config_data, f, default_flow_style=False, allow_unicode=True)


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
