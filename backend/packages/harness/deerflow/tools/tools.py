import logging

from langchain.tools import BaseTool

from deerflow.config import get_app_config
from deerflow.reflection import resolve_variable
from deerflow.sandbox.security import is_host_bash_allowed
from deerflow.tools.builtins import ask_clarification_tool, present_file_tool, supervisor_tool, task_tool, todo_tool, view_image_tool, preview_url_tool, remember_tool, recall_tool, automation_tool, create_agent_tool, update_agent_tool, list_agents_tool
from deerflow.tools.builtins.tool_search import reset_deferred_registry
from deerflow.community.baidu_search import web_search_tool

logger = logging.getLogger(__name__)

BUILTIN_TOOLS = [
    present_file_tool,
    ask_clarification_tool,
    supervisor_tool,
    todo_tool,
    preview_url_tool,
    remember_tool,
    recall_tool,
    automation_tool,
    create_agent_tool,
    update_agent_tool,
    list_agents_tool,
]

SUBAGENT_TOOLS = [
    task_tool,
    # task_status_tool is no longer exposed to LLM (backend handles polling internally)
]


def _is_host_bash_tool(tool: object) -> bool:
    """Return True if the tool config represents a host-bash execution surface."""
    group = getattr(tool, "group", None)
    use = getattr(tool, "use", None)
    if group == "bash":
        return True
    if use == "deerflow.sandbox.tools:bash_tool":
        return True
    return False


def _is_disabled_tool(tool: object) -> bool:
    """Hard-disable unstable providers/tools at load time."""
    use = str(getattr(tool, "use", "") or "")
    # User requirement: do not expose jina_ai tools.
    if "deerflow.community.jina_ai" in use:
        return True
    return False


def get_available_tools(
    groups: list[str] | None = None,
    include_mcp: bool = True,
    model_name: str | None = None,
    subagent_enabled: bool = False,
    include_search: bool = True,
    tools_mode: str | None = None,
) -> list[BaseTool]:
    """Get all available tools from config.

    Note: MCP tools should be initialized at application startup using
    `initialize_mcp_tools()` from deerflow.mcp module.

    Args:
        groups: Optional list of tool groups to filter by.
        include_mcp: Whether to include tools from MCP servers (default: True).
        model_name: Optional model name to determine if vision tools should be included.
        subagent_enabled: Whether to include subagent tools (task, task_status).
        include_search: Whether to include web_search/tool_search and MCP tools (default: False).
        tools_mode: Tool loading mode - 'host_direct' bypasses sandbox layer with
                    direct filesystem tools; 'sandbox' or None uses default sandbox-based tools.

    Returns:
        List of available tools.
    """
    config = get_app_config()

    # Determine effective mode: explicit param > config value > default "sandbox"
    if tools_mode is None:
        tools_mode = getattr(config, "tools_mode", None) or "sandbox"

    # ── HostDirect mode: use zero-overhead IDE-style tools instead of sandbox tools ──
    if tools_mode == "host_direct":
        return _load_host_direct_tools(
            config=config,
            model_name=model_name,
            subagent_enabled=subagent_enabled,
            include_search=include_search,
            include_mcp=include_mcp,
        )

    tool_configs = [tool for tool in config.tools if groups is None or tool.group in groups]
    tool_configs = [tool for tool in tool_configs if not _is_disabled_tool(tool)]

    # Do not expose host bash by default when LocalSandboxProvider is active.
    if not is_host_bash_allowed(config):
        tool_configs = [tool for tool in tool_configs if not _is_host_bash_tool(tool)]

    loaded_tools = [resolve_variable(tool.use, BaseTool) for tool in tool_configs]

    # Always ensure Baidu-based `web_search` is available when include_search=True,
    # even if not explicitly listed in config.tools. This matches the system prompt
    # which references `web_search` as the default search surface.
    if include_search:
        names = {getattr(t, "name", "") for t in loaded_tools}
        if "web_search" not in names:
            loaded_tools.append(web_search_tool)
    if not include_search:
        loaded_tools = [t for t in loaded_tools if getattr(t, "name", "") != "web_search"]

    # Conditionally add tools based on config
    builtin_tools = BUILTIN_TOOLS.copy()

    # Add subagent tools only if enabled via runtime parameter
    if subagent_enabled:
        builtin_tools.extend(SUBAGENT_TOOLS)
        logger.info("Including subagent tools (task)")

    # If no model_name specified, use the first model (default)
    if model_name is None and config.models:
        model_name = config.models[0].name

    # Add view_image_tool only if the model supports vision
    model_config = config.get_model_config(model_name) if model_name else None
    if model_config is not None and model_config.supports_vision:
        builtin_tools.append(view_image_tool)
        logger.info(f"Including view_image_tool for model '{model_name}' (supports_vision=True)")

    # Get cached MCP tools if enabled
    # NOTE: We use ExtensionsConfig.from_file() instead of config.extensions
    # to always read the latest configuration from disk. This ensures that changes
    # made through the Gateway API (which runs in a separate process) are immediately
    # reflected when loading MCP tools.
    mcp_tools = []
    # Reset deferred registry upfront to prevent stale state from previous calls
    reset_deferred_registry()
    if include_mcp and include_search:
        try:
            from deerflow.config.extensions_config import ExtensionsConfig
            from deerflow.mcp.cache import get_cached_mcp_tools

            extensions_config = ExtensionsConfig.from_file()
            if extensions_config.get_enabled_mcp_servers():
                mcp_tools = get_cached_mcp_tools()
                if mcp_tools:
                    logger.info(f"Using {len(mcp_tools)} cached MCP tool(s)")

                    # When tool_search is enabled, register MCP tools in the
                    # deferred registry and add tool_search to builtin tools.
                    if config.tool_search.enabled:
                        from deerflow.tools.builtins.tool_search import DeferredToolRegistry, set_deferred_registry
                        from deerflow.tools.builtins.tool_search import tool_search as tool_search_tool

                        registry = DeferredToolRegistry()
                        for t in mcp_tools:
                            registry.register(t)
                        set_deferred_registry(registry)
                        builtin_tools.append(tool_search_tool)
                        logger.info(f"Tool search active: {len(mcp_tools)} tools deferred")
        except ImportError:
            logger.warning("MCP module not available. Install 'langchain-mcp-adapters' package to enable MCP tools.")
        except Exception as e:
            logger.error(f"Failed to get cached MCP tools: {e}")

    # Add invoke_acp_agent tool if any ACP agents are configured
    acp_tools: list[BaseTool] = []
    try:
        from deerflow.tools.builtins.invoke_acp_agent_tool import build_invoke_acp_agent_tool

        acp_tool = build_invoke_acp_agent_tool()
        acp_tools.append(acp_tool)
        logger.info("Including invoke_acp_agent tool")
    except Exception as e:
        logger.warning(f"Failed to load ACP tool: {e}")

    logger.info(f"Total tools loaded: {len(loaded_tools)}, built-in tools: {len(builtin_tools)}, MCP tools: {len(mcp_tools)}, ACP tools: {len(acp_tools)}")
    return loaded_tools + builtin_tools + mcp_tools + acp_tools


def _load_host_direct_tools(
    config,
    model_name: str | None = None,
    subagent_enabled: bool = False,
    include_search: bool = True,
    include_mcp: bool = True,
) -> list[BaseTool]:
    """Load tools in HostDirect mode (zero sandbox overhead).

    This replaces the sandbox-based file operation tools with direct filesystem
    tools, while preserving all higher-level tools (supervisor, task, web_search, MCP, ACP).
    """
    from deerflow.tools.host_direct import HOST_DIRECT_TOOLS

    # Core: HostDirect base tools (read/write/delete/list/replace/search/execute/web_fetch)
    tools: list[BaseTool] = list(HOST_DIRECT_TOOLS)

    # Always include BUILTIN_TOOLS (supervisor, present_file, ask_clarification)
    tools.extend(BUILTIN_TOOLS)

    # Include subagent tools if enabled
    if subagent_enabled:
        tools.extend(SUBAGENT_TOOLS)
        logger.info("HostDirect mode: Including subagent tools (task)")

    # Vision support
    if model_name is None and config.models:
        model_name = config.models[0].name
    model_config = config.get_model_config(model_name) if model_name else None
    if model_config is not None and model_config.supports_vision:
        tools.append(view_image_tool)
        logger.info(f"HostDirect mode: Including view_image_tool for '{model_name}'")

    # Web search
    if include_search:
        names = {getattr(t, "name", "") for t in tools}
        if "web_search" not in names:
            tools.append(web_search_tool)

    # MCP tools
    mcp_tools: list[BaseTool] = []
    reset_deferred_registry()
    if include_mcp and include_search:
        try:
            from deerflow.config.extensions_config import ExtensionsConfig
            from deerflow.mcp.cache import get_cached_mcp_tools

            extensions_config = ExtensionsConfig.from_file()
            if extensions_config.get_enabled_mcp_servers():
                mcp_tools = get_cached_mcp_tools()
                if mcp_tools:
                    logger.info(f"HostDirect mode: Using {len(mcp_tools)} cached MCP tool(s)")
                    if config.tool_search.enabled:
                        from deerflow.tools.builtins.tool_search import (
                            DeferredToolRegistry, set_deferred_registry,
                            tool_search as tool_search_tool,
                        )
                        registry = DeferredToolRegistry()
                        for t in mcp_tools:
                            registry.register(t)
                        set_deferred_registry(registry)
                        tools.append(tool_search_tool)
        except ImportError:
            logger.warning("MCP module not available.")
        except Exception as e:
            logger.error(f"Failed to get cached MCP tools in HostDirect mode: {e}")

    # ACP tools
    try:
        from deerflow.tools.builtins.invoke_acp_agent_tool import build_invoke_acp_agent_tool
        tools.append(build_invoke_acp_agent_tool())
        logger.info("HostDirect mode: Including invoke_acp_agent tool")
    except Exception as e:
        logger.warning(f"Failed to load ACP tool in HostDirect mode: {e}")

    total = len(tools) + len(mcp_tools)
    logger.info(
        f"HostDirect mode loaded: {len(HOST_DIRECT_TOOLS)} direct + "
        f"{len(BUILTIN_TOOLS)} builtin + {len(mcp_tools)} MCP + "
        f"{len(SUBAGENT_TOOLS) if subagent_enabled else 0} subagent = {total} total"
    )
    return tools + mcp_tools
