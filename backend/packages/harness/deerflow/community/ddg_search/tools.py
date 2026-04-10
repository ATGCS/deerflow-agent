"""DuckDuckGo search using ddgs (duckduckgo-search v8+) library."""

import json
import logging

from langchain.tools import tool

logger = logging.getLogger(__name__)


@tool("ddg_search", parse_docstring=True)
def ddg_search_tool(
    query: str,
    *,
    max_results: int = 5,
) -> str:
    """Search the web using DuckDuckGo.
    
    Args:
        query: Search keywords or question.
        max_results: Maximum number of results to return (default 5).
    
    Returns:
        JSON array of search results with title, url, and snippet.
    """
    try:
        from ddgs import DDGS
        
        results = []
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=max_results):
                results.append({
                    "title": r.get("title", ""),
                    "url": r.get("href", ""),
                    "snippet": r.get("body", ""),
                })
        
        if not results:
            return json.dumps({
                "query": query,
                "total_results": 0,
                "results": [],
                "message": "No results found",
            }, ensure_ascii=False, indent=2)
        
        return json.dumps({
            "query": query,
            "total_results": len(results),
            "source": "duckduckgo",
            "results": results,
        }, ensure_ascii=False, indent=2)
        
    except ImportError as e:
        return f"Error: Install dependency: pip install 'ddgs>=6.0'. Details: {e}"
    except Exception as e:
        logger.exception("DDG search failed")
        return f"Error: DuckDuckGo search failed for query '{query}': {e}"
