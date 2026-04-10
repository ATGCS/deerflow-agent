"""Strategy adapters for individual search backends."""

from __future__ import annotations

import logging
import time

from .base import SearchEngine, SearchResult, SearchResults
from .registry import register

logger = logging.getLogger(__name__)


# ─── Baidu Adapter ────────────────────────────────────────────────

class _BaiduEngine(SearchEngine):
    """Baidu search using the existing baidu_search module."""

    @property
    def name(self) -> str:
        return "baidu"

    @property
    def tier(self) -> int:
        return 2  # Deep engine (may use Playwright fallback)

    def search(self, query: str, *, max_results: int = 5) -> SearchResults:
        t0 = time.monotonic()
        try:
            from deerflow.community.baidu_search.tools import (
                _baidu_html_search,  # noqa: F401
                web_search_tool,
            )
            # Use the full tool to get JSON output
            raw = web_search_tool(query, max_results=max_results)
            import json
            data = json.loads(raw) if isinstance(raw, str) else raw
            results = [
                SearchResult(
                    title=r.get("title", ""),
                    url=r.get("href", r.get("url", "")),
                    snippet=r.get("body", r.get("snippet", "")),
                    engine="baidu",
                )
                for r in data.get("results", data.get("data", []))
            ]
            elapsed_ms = (time.monotonic() - t0) * 1000
            return SearchResults(
                query=query,
                results=results[:max_results],
                engines_used={"baidu"},
                total_ms=elapsed_ms,
            )
        except Exception as e:
            elapsed_ms = (time.monotonic() - t0) * 1000
            logger.debug("Baidu search failed: %s", e)
            return SearchResults(
                query=query,
                results=[],
                engines_used=set(),
                total_ms=elapsed_ms,
            )


def _make_baidu() -> SearchEngine | None:
    try:
        from deerflow.community.baidu_search import web_search_tool  # noqa: F401
        return _BaiduEngine()
    except ImportError:
        return None


register("baidu", _make_baidu)


# ─── DuckDuckGo Adapter ───────────────────────────────────────────

class _DDGEngine(SearchEngine):
    """DuckDuckGo search using ddgs library."""

    @property
    def name(self) -> str:
        return "ddg"

    @property
    def tier(self) -> int:
        return 1  # Fast HTTP-based engine

    def search(self, query: str, *, max_results: int = 5) -> SearchResults:
        t0 = time.monotonic()
        try:
            from ddgs import DDGS

            results: list[SearchResult] = []
            with DDGS() as ddgs:
                for r in ddgs.text(query, max_results=max_results):
                    results.append(SearchResult(
                        title=r.get("title", ""),
                        url=r.get("href", r.get("url", "")),
                        snippet=r.get("body", r.get("snippet", "")),
                        engine="ddg",
                    ))
            elapsed_ms = (time.monotonic() - t0) * 1000
            return SearchResults(
                query=query,
                results=results,
                engines_used={"ddg"},
                total_ms=elapsed_ms,
            )
        except Exception as e:
            elapsed_ms = (time.monotonic() - t0) * 1000
            logger.debug("DDG search failed: %s", e)
            return SearchResults(
                query=query,
                results=[],
                engines_used=set(),
                total_ms=elapsed_ms,
            )


def _make_ddg() -> SearchEngine | None:
    try:
        import ddgs  # noqa: F401
        return _DDGEngine()
    except ImportError:
        return None


register("ddg", _make_ddg)


# ─── Bing Adapter ────────────────────────────────────────────────

class _BingEngine(SearchEngine):
    """Bing HTML search (no API key required)."""

    @property
    def name(self) -> str:
        return "bing"

    @property
    def tier(self) -> int:
        return 1  # Fast HTTP-based engine

    def search(self, query: str, *, max_results: int = 5) -> SearchResults:
        t0 = time.monotonic()
        try:
            from deerflow.community.baidu_search.tools import _bing_html_search
            raw = _bing_html_search(query, max_results=max_results)
            results = [
                SearchResult(
                    title=r.get("title", ""),
                    url=r.get("href", r.get("url", "")),
                    snippet=r.get("body", r.get("snippet", "")),
                    engine="bing",
                )
                for r in raw
            ]
            elapsed_ms = (time.monotonic() - t0) * 1000
            return SearchResults(
                query=query,
                results=results[:max_results],
                engines_used={"bing"},
                total_ms=elapsed_ms,
            )
        except Exception as e:
            elapsed_ms = (time.monotonic() - t0) * 1000
            logger.debug("Bing search failed: %s", e)
            return SearchResults(
                query=query,
                results=[],
                engines_used=set(),
                total_ms=elapsed_ms,
            )


def _make_bing() -> SearchEngine | None:
    try:
        from deerflow.community.baidu_search.tools import _bing_html_search  # noqa: F401
        return _BingEngine()
    except ImportError:
        return None


register("bing", _make_bing)


# ─── Advanced Deep-Search Adapter ─────────────────────────────────

class _AdvancedEngine(SearchEngine):
    """Advanced deep-search (multi-engine + cache)."""

    @property
    def name(self) -> str:
        return "advanced"

    @property
    def tier(self) -> int:
        return 2  # Deep engine

    def search(self, query: str, *, max_results: int = 5) -> SearchResults:
        t0 = time.monotonic()
        try:
            from deerflow.community.advanced_search import fast_search_v2
            result = fast_search_v2(query, max_results=max_results)
            if hasattr(result, "results"):
                items = result.results
            elif isinstance(result, list):
                items = result
            else:
                items = []
            results = []
            for r in items:
                if isinstance(r, dict):
                    results.append(SearchResult(
                        title=r.get("title", ""),
                        url=r.get("url", r.get("href", "")),
                        snippet=r.get("snippet", r.get("content", "")),
                        engine="advanced",
                    ))
                elif hasattr(r, "title"):
                    results.append(SearchResult(
                        title=getattr(r, "title", ""),
                        url=getattr(r, "url", getattr(r, "href", "")),
                        snippet=getattr(r, "snippet", getattr(r, "content", "")),
                        engine="advanced",
                    ))
            elapsed_ms = (time.monotonic() - t0) * 1000
            return SearchResults(
                query=query,
                results=results[:max_results],
                engines_used={"advanced"} if results else set(),
                total_ms=elapsed_ms,
            )
        except Exception as e:
            elapsed_ms = (time.monotonic() - t0) * 1000
            logger.debug("Advanced search failed: %s", e)
            return SearchResults(
                query=query,
                results=[],
                engines_used=set(),
                total_ms=elapsed_ms,
            )


def _make_advanced() -> SearchEngine | None:
    try:
        from deerflow.community.advanced_search import fast_search_v2  # noqa: F401
        return _AdvancedEngine()
    except ImportError:
        return None


register("advanced", _make_advanced)
