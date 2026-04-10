"""CRUD API for custom agents."""

from __future__ import annotations

import logging
import re
import shutil

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from deerflow.config import get_app_config
from deerflow.config.agents_config import AgentConfig, list_custom_agents, load_agent_config, load_agent_soul
from deerflow.config.extensions_config import ExtensionsConfig
from deerflow.config.paths import get_paths
from deerflow.sandbox.security import is_host_bash_allowed
from deerflow.tools.builtins import ask_clarification_tool, present_file_tool, supervisor_tool, task_tool, view_image_tool
from deerflow.tools.builtins.invoke_acp_agent_tool import build_invoke_acp_agent_tool
from deerflow.tools.builtins.tool_search import tool_search as tool_search_tool

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["agents"])

AGENT_NAME_PATTERN = re.compile(r"^[A-Za-z0-9-]+$")


def _load_main_agent_config() -> AgentConfig | None:
    """Load main agent config from agents/main/config.yaml.

    Returns:
        AgentConfig instance, or None if not found.
    """
    try:
        return load_agent_config("main")
    except (FileNotFoundError, ValueError) as e:
        logger.debug(f"Main agent config not found: {e}")
        return None


def _save_main_agent_config(updates: dict) -> None:
    """Save main agent config to agents/main/config.yaml.

    Args:
        updates: Dict with fields to update.
    """
    agent_dir = get_paths().agent_dir("main")
    agent_dir.mkdir(parents=True, exist_ok=True)

    # Load existing config
    config_file = agent_dir / "config.yaml"
    existing = {}
    if config_file.exists():
        try:
            with open(config_file, encoding="utf-8") as f:
                existing = yaml.safe_load(f) or {}
        except Exception as e:
            logger.warning(f"Failed to load main agent config.yaml: {e}")

    # Update fields
    if "description" in updates and updates["description"] is not None:
        existing["description"] = updates["description"]
    if "model" in updates:
        if updates["model"]:
            existing["model"] = updates["model"]
        elif "model" in existing:
            del existing["model"]
    if "tool_groups" in updates:
        if updates["tool_groups"] is not None:
            existing["tool_groups"] = updates["tool_groups"]
        elif "tool_groups" in existing:
            del existing["tool_groups"]
    if "tools" in updates:
        if updates["tools"] is not None:
            existing["tools"] = updates["tools"]
        elif "tools" in existing:
            del existing["tools"]
    if "mcp_servers" in updates:
        if updates["mcp_servers"] is not None:
            existing["mcp_servers"] = updates["mcp_servers"]
        elif "mcp_servers" in existing:
            del existing["mcp_servers"]
    if "skills" in updates:
        if updates["skills"] is not None:
            existing["skills"] = updates["skills"]
        elif "skills" in existing:
            del existing["skills"]

    # Ensure name
    if "name" not in existing:
        existing["name"] = "main"

    with open(config_file, "w", encoding="utf-8") as f:
        yaml.dump(existing, f, default_flow_style=False, allow_unicode=True)


def _main_agent_to_response(include_soul: bool = False) -> AgentResponse:
    """Convert main agent config (from agents/main/config.yaml) to AgentResponse."""
    agent_cfg = _load_main_agent_config()

    soul = None
    if include_soul:
        soul = load_agent_soul("main")

    model = agent_cfg.model if agent_cfg else None

    return AgentResponse(
        name="main",
        description=agent_cfg.description if agent_cfg else "",
        model=model,
        tool_groups=agent_cfg.tool_groups if agent_cfg else None,
        tools=agent_cfg.tools if agent_cfg else None,
        mcp_servers=agent_cfg.mcp_servers if agent_cfg else None,
        skills=agent_cfg.skills if agent_cfg else None,
        soul=soul,
    )


class AgentResponse(BaseModel):
    """Response model for a custom agent."""

    name: str = Field(..., description="Agent name (hyphen-case)")
    description: str = Field(default="", description="Agent description")
    model: str | None = Field(default=None, description="Optional model override")
    tool_groups: list[str] | None = Field(default=None, description="Optional tool group whitelist")
    tools: list[str] | None = Field(default=None, description="Optional builtin tool whitelist")
    mcp_servers: list[str] | None = Field(default=None, description="Optional MCP server names")
    skills: list[str] | None = Field(default=None, description="Optional skill names")
    soul: str | None = Field(default=None, description="SOUL.md content (included on GET /{name})")


class AgentsListResponse(BaseModel):
    """Response model for listing all custom agents."""

    agents: list[AgentResponse]


class AgentCreateRequest(BaseModel):
    """Request body for creating a custom agent."""

    name: str = Field(..., description="Agent name (must match ^[A-Za-z0-9-]+$, stored as lowercase)")
    description: str = Field(default="", description="Agent description")
    model: str | None = Field(default=None, description="Optional model override")
    tool_groups: list[str] | None = Field(default=None, description="Optional tool group whitelist")
    tools: list[str] | None = Field(default=None, description="Optional builtin tool whitelist")
    mcp_servers: list[str] | None = Field(default=None, description="Optional MCP server names")
    skills: list[str] | None = Field(default=None, description="Optional skill names")
    soul: str = Field(default="", description="SOUL.md content — agent personality and behavioral guardrails")


class AgentUpdateRequest(BaseModel):
    """Request body for updating a custom agent."""

    description: str | None = Field(default=None, description="Updated description")
    model: str | None = Field(default=None, description="Updated model override")
    tool_groups: list[str] | None = Field(default=None, description="Updated tool group whitelist")
    tools: list[str] | None = Field(default=None, description="Updated builtin tool whitelist")
    mcp_servers: list[str] | None = Field(default=None, description="Updated MCP server names")
    skills: list[str] | None = Field(default=None, description="Updated skill names")
    soul: str | None = Field(default=None, description="Updated SOUL.md content")


def _validate_agent_name(name: str) -> None:
    """Validate agent name against allowed pattern.

    Args:
        name: The agent name to validate.

    Raises:
        HTTPException: 422 if the name is invalid.
    """
    if not AGENT_NAME_PATTERN.match(name):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid agent name '{name}'. Must match ^[A-Za-z0-9-]+$ (letters, digits, and hyphens only).",
        )


def _normalize_agent_name(name: str) -> str:
    """Normalize agent name to lowercase for filesystem storage."""
    return name.lower()


def _agent_config_to_response(agent_cfg: AgentConfig, include_soul: bool = False) -> AgentResponse:
    """Convert AgentConfig to AgentResponse."""
    soul: str | None = None
    if include_soul:
        soul = load_agent_soul(agent_cfg.name) or ""

    return AgentResponse(
        name=agent_cfg.name,
        description=agent_cfg.description,
        model=agent_cfg.model,
        tool_groups=agent_cfg.tool_groups,
        tools=agent_cfg.tools,
        mcp_servers=agent_cfg.mcp_servers,
        skills=agent_cfg.skills,
        soul=soul,
    )


@router.get(
    "/agents",
    response_model=AgentsListResponse,
    summary="List Custom Agents",
    description="List all custom agents available in the agents directory, including the main agent.",
)
async def list_agents() -> AgentsListResponse:
    """List all custom agents.

    Returns:
        List of all custom agents with their metadata (without soul content).
        Includes the main (default) agent as the first entry.
    """
    try:
        # Get main agent first
        main_agent = _main_agent_to_response(include_soul=False)
        
        # Get custom agents
        custom_agents = list_custom_agents()
        custom_responses = [_agent_config_to_response(a) for a in custom_agents]
        
        # Combine: main agent first, then custom agents
        all_agents = [main_agent] + custom_responses
        return AgentsListResponse(agents=all_agents)
    except Exception as e:
        logger.error(f"Failed to list agents: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list agents: {str(e)}")


@router.get(
    "/agents/check",
    summary="Check Agent Name",
    description="Validate an agent name and check if it is available (case-insensitive).",
)
async def check_agent_name(name: str) -> dict:
    """Check whether an agent name is valid and not yet taken.

    Args:
        name: The agent name to check.

    Returns:
        ``{"available": true/false, "name": "<normalized>"}``

    Raises:
        HTTPException: 422 if the name is invalid.
    """
    _validate_agent_name(name)
    normalized = _normalize_agent_name(name)
    available = not get_paths().agent_dir(normalized).exists()
    return {"available": available, "name": normalized}


@router.get(
    "/agents/{name}",
    response_model=AgentResponse,
    summary="Get Custom Agent",
    description="Retrieve details and SOUL.md content for a specific custom agent. Use 'main' for the default agent.",
)
async def get_agent(name: str) -> AgentResponse:
    """Get a specific custom agent by name.

    Args:
        name: The agent name. Use 'main' for the default agent.

    Returns:
        Agent details including SOUL.md content.

    Raises:
        HTTPException: 404 if agent not found.
    """
    # Special handling for main agent
    if name.lower() == "main":
        return _main_agent_to_response(include_soul=True)
    
    _validate_agent_name(name)
    name = _normalize_agent_name(name)

    try:
        agent_cfg = load_agent_config(name)
        return _agent_config_to_response(agent_cfg, include_soul=True)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Agent '{name}' not found")
    except Exception as e:
        logger.error(f"Failed to get agent '{name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get agent: {str(e)}")


@router.post(
    "/agents",
    response_model=AgentResponse,
    status_code=201,
    summary="Create Custom Agent",
    description="Create a new custom agent with its config and SOUL.md.",
)
async def create_agent_endpoint(request: AgentCreateRequest) -> AgentResponse:
    """Create a new custom agent.

    Args:
        request: The agent creation request.

    Returns:
        The created agent details.

    Raises:
        HTTPException: 409 if agent already exists, 422 if name is invalid.
    """
    _validate_agent_name(request.name)
    normalized_name = _normalize_agent_name(request.name)

    agent_dir = get_paths().agent_dir(normalized_name)

    if agent_dir.exists():
        raise HTTPException(status_code=409, detail=f"Agent '{normalized_name}' already exists")

    try:
        agent_dir.mkdir(parents=True, exist_ok=True)

        # Write config.yaml
        config_data: dict = {"name": normalized_name}
        if request.description:
            config_data["description"] = request.description
        if request.model is not None:
            config_data["model"] = request.model
        if request.tool_groups is not None:
            config_data["tool_groups"] = request.tool_groups
        if request.tools is not None:
            config_data["tools"] = request.tools
        if request.mcp_servers is not None:
            config_data["mcp_servers"] = request.mcp_servers
        if request.skills is not None:
            config_data["skills"] = request.skills

        config_file = agent_dir / "config.yaml"
        with open(config_file, "w", encoding="utf-8") as f:
            yaml.dump(config_data, f, default_flow_style=False, allow_unicode=True)

        # Write SOUL.md
        soul_file = agent_dir / "SOUL.md"
        soul_file.write_text(request.soul, encoding="utf-8")

        logger.info(f"Created agent '{normalized_name}' at {agent_dir}")

        agent_cfg = load_agent_config(normalized_name)
        return _agent_config_to_response(agent_cfg, include_soul=True)

    except HTTPException:
        raise
    except Exception as e:
        # Clean up on failure
        if agent_dir.exists():
            shutil.rmtree(agent_dir)
        logger.error(f"Failed to create agent '{request.name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create agent: {str(e)}")


@router.put(
    "/agents/{name}",
    response_model=AgentResponse,
    summary="Update Custom Agent",
    description="Update an existing custom agent's config and/or SOUL.md. Use 'main' for the default agent.",
)
async def update_agent(name: str, request: AgentUpdateRequest) -> AgentResponse:
    """Update an existing custom agent.

    Args:
        name: The agent name. Use 'main' for the default agent.
        request: The update request (all fields optional).

    Returns:
        The updated agent details.

    Raises:
        HTTPException: 404 if agent not found.
    """
    # Special handling for main agent
    if name.lower() == "main":
        updates = {}
        if request.description is not None:
            updates["description"] = request.description
        if request.model is not None:
            updates["model"] = request.model
        if request.tools is not None:
            updates["tools"] = request.tools
        if request.mcp_servers is not None:
            updates["mcp_servers"] = request.mcp_servers
        if request.skills is not None:
            updates["skills"] = request.skills

        _save_main_agent_config(updates)

        # Save SOUL.md to agents/main/SOUL.md (same as custom agents)
        if request.soul is not None:
            soul_path = get_paths().agent_dir("main") / "SOUL.md"
            if request.soul.strip():
                soul_path.write_text(request.soul, encoding="utf-8")
            elif soul_path.exists():
                soul_path.unlink()

        return _main_agent_to_response(include_soul=True)
    
    _validate_agent_name(name)
    name = _normalize_agent_name(name)

    try:
        agent_cfg = load_agent_config(name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Agent '{name}' not found")

    agent_dir = get_paths().agent_dir(name)

    try:
        # Update config if any config fields changed
        config_fields = [request.description, request.model, request.tool_groups, 
                        request.tools, request.mcp_servers, request.skills]
        config_changed = any(v is not None for v in config_fields)

        if config_changed:
            updated: dict = {
                "name": agent_cfg.name,
                "description": request.description if request.description is not None else agent_cfg.description,
            }
            new_model = request.model if request.model is not None else agent_cfg.model
            if new_model is not None:
                updated["model"] = new_model

            new_tool_groups = request.tool_groups if request.tool_groups is not None else agent_cfg.tool_groups
            if new_tool_groups is not None:
                updated["tool_groups"] = new_tool_groups
            
            # New fields: tools, mcp_servers, skills
            new_tools = request.tools if request.tools is not None else agent_cfg.tools
            if new_tools is not None:
                updated["tools"] = new_tools
            
            new_mcp = request.mcp_servers if request.mcp_servers is not None else agent_cfg.mcp_servers
            if new_mcp is not None:
                updated["mcp_servers"] = new_mcp
            
            new_skills = request.skills if request.skills is not None else agent_cfg.skills
            if new_skills is not None:
                updated["skills"] = new_skills

            config_file = agent_dir / "config.yaml"
            with open(config_file, "w", encoding="utf-8") as f:
                yaml.dump(updated, f, default_flow_style=False, allow_unicode=True)

        # Update SOUL.md if provided
        if request.soul is not None:
            soul_path = agent_dir / "SOUL.md"
            soul_path.write_text(request.soul, encoding="utf-8")

        logger.info(f"Updated agent '{name}'")

        refreshed_cfg = load_agent_config(name)
        return _agent_config_to_response(refreshed_cfg, include_soul=True)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update agent '{name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update agent: {str(e)}")


class UserProfileResponse(BaseModel):
    """Response model for the global user profile (USER.md)."""

    content: str | None = Field(default=None, description="USER.md content, or null if not yet created")


class UserProfileUpdateRequest(BaseModel):
    """Request body for setting the global user profile."""

    content: str = Field(default="", description="USER.md content — describes the user's background and preferences")


@router.get(
    "/user-profile",
    response_model=UserProfileResponse,
    summary="Get User Profile",
    description="Read the global USER.md file that is injected into all custom agents.",
)
async def get_user_profile() -> UserProfileResponse:
    """Return the current USER.md content.

    Returns:
        UserProfileResponse with content=None if USER.md does not exist yet.
    """
    try:
        user_md_path = get_paths().user_md_file
        if not user_md_path.exists():
            return UserProfileResponse(content=None)
        raw = user_md_path.read_text(encoding="utf-8").strip()
        return UserProfileResponse(content=raw or None)
    except Exception as e:
        logger.error(f"Failed to read user profile: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to read user profile: {str(e)}")


@router.put(
    "/user-profile",
    response_model=UserProfileResponse,
    summary="Update User Profile",
    description="Write the global USER.md file that is injected into all custom agents.",
)
async def update_user_profile(request: UserProfileUpdateRequest) -> UserProfileResponse:
    """Create or overwrite the global USER.md.

    Args:
        request: The update request with the new USER.md content.

    Returns:
        UserProfileResponse with the saved content.
    """
    try:
        paths = get_paths()
        paths.base_dir.mkdir(parents=True, exist_ok=True)
        paths.user_md_file.write_text(request.content, encoding="utf-8")
        logger.info(f"Updated USER.md at {paths.user_md_file}")
        return UserProfileResponse(content=request.content or None)
    except Exception as e:
        logger.error(f"Failed to update user profile: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update user profile: {str(e)}")


@router.delete(
    "/agents/{name}",
    status_code=204,
    summary="Delete Custom Agent",
    description="Delete a custom agent and all its files (config, SOUL.md, memory).",
)
async def delete_agent(name: str) -> None:
    """Delete a custom agent.

    Args:
        name: The agent name.

    Raises:
        HTTPException: 404 if agent not found.
    """
    _validate_agent_name(name)
    name = _normalize_agent_name(name)

    agent_dir = get_paths().agent_dir(name)

    if not agent_dir.exists():
        raise HTTPException(status_code=404, detail=f"Agent '{name}' not found")

    try:
        shutil.rmtree(agent_dir)
        logger.info(f"Deleted agent '{name}' from {agent_dir}")
    except Exception as e:
        logger.error(f"Failed to delete agent '{name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete agent: {str(e)}")


# ============================================================
# Tools / MCP / Skills metadata API
# ============================================================

class ToolInfo(BaseModel):
    """Single tool info for frontend display."""
    name: str = Field(..., description="Tool name (identifier)")
    label: str = Field(..., description="Display label")
    icon: str = Field(default="", description="Emoji icon")
    group: str = Field(default="", description="Tool group")
    description: str = Field(default="", description="Tool description")


class McpServerInfo(BaseModel):
    """MCP server info for frontend display."""
    value: str = Field(description="Server name (used as form value)")
    label: str = Field(description="Display label")
    icon: str = Field(default="🔌", description="Emoji icon")
    enabled: bool


class SkillInfo(BaseModel):
    """Single skill info for frontend display."""
    name: str = Field(description="Skill identifier / directory name")
    label: str = Field(description="Display name")
    description: str = Field(default="", description="Skill description from SKILL.md frontmatter")
    icon: str = Field(default="🧩", description="Emoji icon")


class ToolListResponse(BaseModel):
    """Response containing available tools, MCP servers and skills."""
    tools: list[ToolInfo]
    mcp_servers: list[McpServerInfo]
    skills: list[SkillInfo]


# Map tool names to display labels/icons for built-in tools that are not in config.yaml
_BUILTIN_TOOL_DISPLAY: dict[str, dict] = {
    "present_files": {"label": "展示文件", "icon": "📎", "description": "向用户展示文件内容"},
    "ask_clarification": {"label": "等待确认", "icon": "❔", "description": "等待用户确认后再继续"},
    "supervisor": {"label": "任务调度", "icon": "🧭", "description": "创建和管理子任务调度"},
    "task": {"label": "子任务", "icon": "⚡", "description": "委派子任务给其他智能体执行"},
    "view_image": {"label": "查看图片", "icon": "🖼️", "description": "查看和分析图片文件"},
    "invoke_acp_agent": {"label": "ACP 子代理", "icon": "🤖", "description": "调用 ACP 外部代理"},
    "tool_search": {"label": "查找工具", "icon": "🔎", "description": "搜索并调用延迟加载的工具"},
}


def _get_all_tools() -> list[ToolInfo]:
    """Get all available builtin tools from config + hardcoded builtins."""
    config = get_app_config()
    results: list[ToolInfo] = []

    # 1. Tools from config.yaml
    seen: set[str] = set()
    for t in config.tools:
        # Skip jina_ai tools (disabled)
        if "jina_ai" in getattr(t, 'use', ''):
            continue
        name = t.name or ""
        if not name:
            continue
        seen.add(name)
        results.append(ToolInfo(
            name=name,
            label=name.replace("_", " ").title(),
            group=t.group or "",
            description=f"Group: {t.group}",
        ))

    # 2. Built-in tools (not from config)
    builtin_instances = [
        ("present_files", present_file_tool),
        ("ask_clarification", ask_clarification_tool),
        ("supervisor", supervisor_tool),
        ("task", task_tool),
        ("view_image", view_image_tool),
    ]

    for display_name, tool_instance in builtin_instances:
        if display_name in seen:
            continue
        seen.add(display_name)
        info = _BUILTIN_TOOL_DISPLAY.get(display_name, {})
        results.append(ToolInfo(
            name=display_name,
            label=info.get("label", display_name),
            icon=info.get("icon", ""),
            group=getattr(tool_instance, "group", "") or "",
            description=info.get("description", ""),
        ))

    # 3. Conditional tools
    # view_image - already added above, but check vision support
    # invoke_acp_agent - always show option
    if "invoke_acp_agent" not in seen:
        try:
            build_invoke_acp_agent_tool()  # verify it works
            info = _BUILTIN_TOOL_DISPLAY.get("invoke_acp_agent", {})
            results.append(ToolInfo(
                name="invoke_acp_agent",
                label=info.get("label", "ACP 子代理"),
                icon=info.get("icon", "🤖"),
                group="acp",
                description=info.get("description", ""),
            ))
            seen.add("invoke_acp_agent")
        except Exception:
            pass

    # tool_search - show if enabled in config
    if "tool_search" not in seen and getattr(config.tool_search, 'enabled', False):
        info = _BUILTIN_TOOL_DISPLAY.get("tool_search", {})
        results.append(ToolInfo(
            name="tool_search",
            label=info.get("label", "查找工具"),
            icon=info.get("icon", "🔎"),
            group="builtin",
            description=info.get("description", ""),
        ))
        seen.add("tool_search")

    return results


def _get_mcp_servers() -> list[McpServerInfo]:
    """Get configured MCP servers."""
    servers: list[McpServerInfo] = []
    try:
        extensions_config = ExtensionsConfig.from_file()
        for name, cfg in extensions_config.mcp_servers.items():
            servers.append(McpServerInfo(
                value=name,
                label=cfg.description or name,
                icon="🔌",
                enabled=cfg.enabled,
            ))
    except Exception as e:
        logger.warning(f"Failed to load MCP server configs: {e}")
    return servers


def _get_skill_metadata() -> list[SkillInfo]:
    """Get available skill metadata from skills directory, parsing SKILL.md frontmatter."""
    import re
    _SKILL_ICON_MAP: dict[str, str] = {
        "deep-research": "🔬", "data-analysis": "📊", "frontend-design": "🎨",
        "pdf": "📄", "docx": "📝", "pptx": "📽️", "xlsx": "📈",
        "video-generation": "🎬", "image-generation": "🖼️", "ppt-generation": "📊",
        "browser": "🌐", "github-deep-research": "💻", "consulting-analysis": "📋",
        "chart-visualization": "📉", "coding-agent": "💻", "playwright": "🎭",
    }
    skills: list[SkillInfo] = []
    try:
        skills_dir = get_paths().base_dir / "skills"
        if not skills_dir.exists():
            return skills
        for item in sorted(skills_dir.iterdir()):
            if not item.is_dir():
                continue
            # Check if it's a valid skill (has manifest or main file)
            has_manifest = (item / "skill.json").exists() or (item / "manifest.json").exists()
            has_main = (item / "main.js").exists() or (item / "main.py").exists()
            has_skill_md = (item / "SKILL.md").exists()
            if not (has_manifest or has_main or has_skill_md):
                continue

            name = item.name
            label = name.replace("-", " ").title()
            description = ""
            icon = _SKILL_ICON_MAP.get(name, "🧩")

            # Parse SKILL.md frontmatter for description
            if has_skill_md:
                try:
                    md_content = (item / "SKILL.md").read_text(encoding="utf-8")
                    # Extract YAML frontmatter between --- delimiters
                    fm_match = re.match(r"^---\s*\n(.*?)\n---\s*\n", md_content, re.DOTALL)
                    if fm_match:
                        fm_text = fm_match.group(1)
                        for line in fm_text.splitlines():
                            line = line.strip()
                            if line.startswith("description:"):
                                desc_val = line.split(":", 1)[1].strip().strip('"').strip("'")
                                if desc_val:
                                    description = desc_val
                            elif line.startswith("name:") and ":" in line[5:]:
                                name_val = line.split(":", 1)[1].strip().strip('"').strip("'")
                                if name_val:
                                    label = name_val
                except Exception:
                    pass

            skills.append(SkillInfo(
                name=name,
                label=label,
                description=description,
                icon=icon,
            ))
    except Exception as e:
        logger.warning(f"Failed to load skill metadata: {e}")
    return skills


@router.get(
    "/tools/metadata",
    response_model=ToolListResponse,
    summary="Get Available Tools Metadata",
    description="Return lists of available builtin tools, MCP servers, and skills for agent configuration UI.",
)
async def get_tools_metadata() -> ToolListResponse:
    """Get metadata about all configurable tools/MCP/skills.

    Returns:
        ToolListResponse with tools, mcp_servers, and skills arrays.
    """
    try:
        return ToolListResponse(
            tools=_get_all_tools(),
            mcp_servers=_get_mcp_servers(),
            skills=_get_skill_metadata(),
        )
    except Exception as e:
        logger.error(f"Failed to get tools metadata: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
