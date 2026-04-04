"""Memory API router for retrieving and managing global memory data."""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from deerflow.agents.memory.updater import (
    clear_memory_data,
    delete_memory_fact,
    get_memory_data,
    list_memory_agent_slots,
    reload_memory_data,
)
from deerflow.config.agents_config import AGENT_NAME_PATTERN
from deerflow.config.memory_config import get_memory_config

router = APIRouter(prefix="/api", tags=["memory"])


class ContextSection(BaseModel):
    """Model for context sections (user and history)."""

    summary: str = Field(default="", description="Summary content")
    updatedAt: str = Field(default="", description="Last update timestamp")


class UserContext(BaseModel):
    """Model for user context."""

    workContext: ContextSection = Field(default_factory=ContextSection)
    personalContext: ContextSection = Field(default_factory=ContextSection)
    topOfMind: ContextSection = Field(default_factory=ContextSection)


class HistoryContext(BaseModel):
    """Model for history context."""

    recentMonths: ContextSection = Field(default_factory=ContextSection)
    earlierContext: ContextSection = Field(default_factory=ContextSection)
    longTermBackground: ContextSection = Field(default_factory=ContextSection)


class Fact(BaseModel):
    """Model for a memory fact."""

    id: str = Field(..., description="Unique identifier for the fact")
    content: str = Field(..., description="Fact content")
    category: str = Field(default="context", description="Fact category")
    confidence: float = Field(default=0.5, description="Confidence score (0-1)")
    createdAt: str = Field(default="", description="Creation timestamp")
    source: str = Field(default="unknown", description="Source thread ID")


class MemoryResponse(BaseModel):
    """Response model for memory data."""

    version: str = Field(default="1.0", description="Memory schema version")
    lastUpdated: str = Field(default="", description="Last update timestamp")
    user: UserContext = Field(default_factory=UserContext)
    history: HistoryContext = Field(default_factory=HistoryContext)
    facts: list[Fact] = Field(default_factory=list)


class MemoryConfigResponse(BaseModel):
    """Response model for memory configuration."""

    enabled: bool = Field(..., description="Whether memory is enabled")
    storage_path: str = Field(..., description="Path to memory storage file")
    debounce_seconds: int = Field(..., description="Debounce time for memory updates")
    max_facts: int = Field(..., description="Maximum number of facts to store")
    fact_confidence_threshold: float = Field(..., description="Minimum confidence threshold for facts")
    injection_enabled: bool = Field(..., description="Whether memory injection is enabled")
    max_injection_tokens: int = Field(..., description="Maximum tokens for memory injection")


class MemoryStatusResponse(BaseModel):
    """Response model for memory status."""

    config: MemoryConfigResponse
    data: MemoryResponse


class MemoryAgentSlot(BaseModel):
    """One memory scope (global or per-agent file)."""

    id: str | None = Field(None, description="Agent id; null means global / default lead memory")
    display_name: str = Field("", description="Short label for UI")
    description: str = Field("", description="Optional subtitle from agent config")
    has_memory_file: bool = Field(False, description="Whether a JSON file already exists on disk")


class MemoryAgentsListResponse(BaseModel):
    """List of memory scopes for dashboard / settings UI."""

    agents: list[MemoryAgentSlot]


def _normalize_agent_query(agent: str | None) -> str | None:
    if agent is None:
        return None
    stripped = agent.strip()
    if not stripped:
        return None
    if not AGENT_NAME_PATTERN.match(stripped):
        raise HTTPException(status_code=400, detail=f"Invalid agent id {stripped!r}; must match {AGENT_NAME_PATTERN.pattern}")
    return stripped


@router.get(
    "/memory/agents",
    response_model=MemoryAgentsListResponse,
    summary="List Memory Scopes",
    description="List global memory plus each agent directory that has config and/or memory.json.",
)
async def list_memory_agents() -> MemoryAgentsListResponse:
    raw = list_memory_agent_slots()
    return MemoryAgentsListResponse(agents=[MemoryAgentSlot(**row) for row in raw])


@router.get(
    "/memory",
    response_model=MemoryResponse,
    summary="Get Memory Data",
    description="Retrieve memory data for the global store or a specific agent (agents/{id}/memory.json).",
)
async def get_memory(
    agent: str | None = Query(None, description="Agent id; omit for global memory"),
) -> MemoryResponse:
    """Get the current global memory data.

    Returns:
        The current memory data with user context, history, and facts.

    Example Response:
        ```json
        {
            "version": "1.0",
            "lastUpdated": "2024-01-15T10:30:00Z",
            "user": {
                "workContext": {"summary": "Working on DeerFlow project", "updatedAt": "..."},
                "personalContext": {"summary": "Prefers concise responses", "updatedAt": "..."},
                "topOfMind": {"summary": "Building memory API", "updatedAt": "..."}
            },
            "history": {
                "recentMonths": {"summary": "Recent development activities", "updatedAt": "..."},
                "earlierContext": {"summary": "", "updatedAt": ""},
                "longTermBackground": {"summary": "", "updatedAt": ""}
            },
            "facts": [
                {
                    "id": "fact_abc123",
                    "content": "User prefers TypeScript over JavaScript",
                    "category": "preference",
                    "confidence": 0.9,
                    "createdAt": "2024-01-15T10:30:00Z",
                    "source": "thread_xyz"
                }
            ]
        }
        ```
    """
    agent_name = _normalize_agent_query(agent)
    memory_data = get_memory_data(agent_name)
    return MemoryResponse(**memory_data)


@router.post(
    "/memory/reload",
    response_model=MemoryResponse,
    summary="Reload Memory Data",
    description="Reload memory data from the storage file, refreshing the in-memory cache.",
)
async def reload_memory(
    agent: str | None = Query(None, description="Agent id; omit for global memory"),
) -> MemoryResponse:
    """Reload memory data from file.

    This forces a reload of the memory data from the storage file,
    useful when the file has been modified externally.

    Returns:
        The reloaded memory data.
    """
    agent_name = _normalize_agent_query(agent)
    memory_data = reload_memory_data(agent_name)
    return MemoryResponse(**memory_data)


@router.delete(
    "/memory",
    response_model=MemoryResponse,
    summary="Clear All Memory Data",
    description="Delete all saved memory for the global store or one agent and reset to an empty structure.",
)
async def clear_memory(
    agent: str | None = Query(None, description="Agent id; omit to clear global memory"),
) -> MemoryResponse:
    """Clear all persisted memory data."""
    try:
        agent_name = _normalize_agent_query(agent)
        memory_data = clear_memory_data(agent_name)
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Failed to clear memory data.") from exc

    return MemoryResponse(**memory_data)


@router.delete(
    "/memory/facts/{fact_id}",
    response_model=MemoryResponse,
    summary="Delete Memory Fact",
    description="Delete a single saved memory fact by its fact id (global or agent scope).",
)
async def delete_memory_fact_endpoint(
    fact_id: str,
    agent: str | None = Query(None, description="Agent id; omit for global memory"),
) -> MemoryResponse:
    """Delete a single fact from memory by fact id."""
    try:
        agent_name = _normalize_agent_query(agent)
        memory_data = delete_memory_fact(fact_id, agent_name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Memory fact '{fact_id}' not found.") from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Failed to delete memory fact.") from exc

    return MemoryResponse(**memory_data)


@router.get(
    "/memory/config",
    response_model=MemoryConfigResponse,
    summary="Get Memory Configuration",
    description="Retrieve the current memory system configuration.",
)
async def get_memory_config_endpoint() -> MemoryConfigResponse:
    """Get the memory system configuration.

    Returns:
        The current memory configuration settings.

    Example Response:
        ```json
        {
            "enabled": true,
            "storage_path": ".deer-flow/memory.json",
            "debounce_seconds": 30,
            "max_facts": 100,
            "fact_confidence_threshold": 0.7,
            "injection_enabled": true,
            "max_injection_tokens": 2000
        }
        ```
    """
    config = get_memory_config()
    return MemoryConfigResponse(
        enabled=config.enabled,
        storage_path=config.storage_path,
        debounce_seconds=config.debounce_seconds,
        max_facts=config.max_facts,
        fact_confidence_threshold=config.fact_confidence_threshold,
        injection_enabled=config.injection_enabled,
        max_injection_tokens=config.max_injection_tokens,
    )


@router.get(
    "/memory/status",
    response_model=MemoryStatusResponse,
    summary="Get Memory Status",
    description="Retrieve both memory configuration and current data in a single request.",
)
async def get_memory_status(
    agent: str | None = Query(None, description="Agent id; omit for global memory in `data`"),
) -> MemoryStatusResponse:
    """Get the memory system status including configuration and data.

    Returns:
        Combined memory configuration and current data.
    """
    config = get_memory_config()
    agent_name = _normalize_agent_query(agent)
    memory_data = get_memory_data(agent_name)

    return MemoryStatusResponse(
        config=MemoryConfigResponse(
            enabled=config.enabled,
            storage_path=config.storage_path,
            debounce_seconds=config.debounce_seconds,
            max_facts=config.max_facts,
            fact_confidence_threshold=config.fact_confidence_threshold,
            injection_enabled=config.injection_enabled,
            max_injection_tokens=config.max_injection_tokens,
        ),
        data=MemoryResponse(**memory_data),
    )
