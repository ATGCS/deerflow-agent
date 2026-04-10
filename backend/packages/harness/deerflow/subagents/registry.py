"""Subagent registry for managing available subagents."""

import logging
from dataclasses import replace

from deerflow.config.agents_config import list_subagents as list_file_subagents
from deerflow.config.subagents_config import get_subagents_app_config
from deerflow.sandbox.security import is_host_bash_allowed
from deerflow.subagents.config import SubagentConfig
from deerflow.subagents.builtins import BUILTIN_SUBAGENTS

logger = logging.getLogger(__name__)


def _agent_config_to_subagent_config(agent_cfg) -> SubagentConfig | None:
    """Convert AgentConfig to SubagentConfig.
    
    Args:
        agent_cfg: AgentConfig instance with agent_type='subagent'
        
    Returns:
        SubagentConfig if the agent is a valid subagent, None otherwise.
    """
    if agent_cfg.agent_type != "subagent":
        return None
    
    if not agent_cfg.system_prompt:
        logger.warning(f"Subagent '{agent_cfg.name}' missing system_prompt, skipping")
        return None
    
    return SubagentConfig(
        name=agent_cfg.name,
        description=agent_cfg.description,
        system_prompt=agent_cfg.system_prompt,
        tools=agent_cfg.tools,
        disallowed_tools=agent_cfg.disallowed_tools,
        model=agent_cfg.model or "inherit",
        max_turns=agent_cfg.max_turns,
        timeout_seconds=agent_cfg.timeout_seconds,
    )


def get_subagent_config(name: str) -> SubagentConfig | None:
    """Get a subagent configuration by name, with config.yaml overrides applied.

    Args:
        name: The name of the subagent.

    Returns:
        SubagentConfig if found (with any config.yaml overrides applied), None otherwise.
    """
    # 1) Prefer filesystem subagent overrides if present
    file_subagents = list_file_subagents()
    for agent_cfg in file_subagents:
        if agent_cfg.name != name:
            continue
        subagent_cfg = _agent_config_to_subagent_config(agent_cfg)
        if not subagent_cfg:
            return None

        # Apply timeout override from config.yaml
        app_config = get_subagents_app_config()
        effective_timeout = app_config.get_timeout_for(name)
        if effective_timeout != subagent_cfg.timeout_seconds:
            logger.debug(
                "Subagent '%s': timeout overridden by config.yaml (%ss -> %ss)",
                name,
                subagent_cfg.timeout_seconds,
                effective_timeout,
            )
            subagent_cfg = replace(subagent_cfg, timeout_seconds=effective_timeout)
        return subagent_cfg

    # 2) Fallback to built-in subagents (so registry works even without filesystem configs)
    if name in BUILTIN_SUBAGENTS:
        cfg = BUILTIN_SUBAGENTS[name]
        app_config = get_subagents_app_config()
        effective_timeout = app_config.get_timeout_for(name)
        if effective_timeout != cfg.timeout_seconds:
            cfg = replace(cfg, timeout_seconds=effective_timeout)
        return cfg

    return None


def list_subagents() -> list[SubagentConfig]:
    """List all available subagent configurations (with config.yaml overrides applied).

    Returns:
        List of all registered SubagentConfig instances.
    """
    file_subagents = list_file_subagents()
    by_name: dict[str, SubagentConfig] = {}

    # 1) filesystem configs
    for agent_cfg in file_subagents:
        subagent_cfg = _agent_config_to_subagent_config(agent_cfg)
        if subagent_cfg:
            by_name[subagent_cfg.name] = subagent_cfg

    # 2) built-ins (only when not overridden)
    for name, cfg in BUILTIN_SUBAGENTS.items():
        by_name.setdefault(name, cfg)

    # 3) apply timeout overrides
    app_config = get_subagents_app_config()
    out: list[SubagentConfig] = []
    for name, cfg in by_name.items():
        effective_timeout = app_config.get_timeout_for(name)
        if effective_timeout != cfg.timeout_seconds:
            cfg = replace(cfg, timeout_seconds=effective_timeout)
        out.append(cfg)

    return out


def get_subagent_names() -> list[str]:
    """Get all available subagent names.

    Returns:
        List of subagent names.
    """
    return [cfg.name for cfg in list_subagents()]


def get_available_subagent_names() -> list[str]:
    """Get subagent names that should be exposed to the active runtime.

    Returns:
        List of subagent names visible to the current sandbox configuration.
    """
    names = get_subagent_names()
    try:
        host_bash_allowed = is_host_bash_allowed()
    except Exception:
        logger.debug("Could not determine host bash availability; exposing all subagents")
        return names

    if not host_bash_allowed:
        names = [name for name in names if name != "bash"]
    return names
