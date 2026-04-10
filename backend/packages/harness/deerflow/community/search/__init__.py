"""Unified Search Interface — Strategy Pattern for multi-engine web search.

Provides a consistent API across all search backends (Baidu, DDG, Bing, etc.)
with automatic strategy selection and result merging.

Architecture:
    community/search/
    ├── __init__.py       # Package exports
    ├── base.py           # SearchResult dataclass + SearchEngine ABC
    ├── registry.py       # Engine registration and discovery
    ├── orchestrator.py   # Auto-select / combine strategies
    └── strategies/
        ├── __init__.py
        ├── baidu.py      # Baidu (HTTP-first) adapter
        ├── bing.py       # Bing HTML adapter
        ├── ddg.py        # DuckDuckGo adapter
        └── advanced.py   # Advanced deep-search adapter

Usage::

    from deerflow.community.search import SearchOrchestrator
    orch = SearchOrchestrator()
    results = orch.search("Python async best practices")

Roadmap: DEERFLOW_TOOLS_REFACTORING_ROADMAP.md #18
"""

from .orchestrator import SearchOrchestrator
from .base import SearchResult, SearchEngine

__all__ = [
    "SearchOrchestrator",
    "SearchResult",
    "SearchEngine",
]
