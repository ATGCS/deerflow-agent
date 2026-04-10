"""
Compatibility shim.

The implementation was moved to `deerflow.community.baidu_search`.
Keep this module to avoid breaking old imports.
"""

from deerflow.community.baidu_search.tools import web_search_tool

__all__ = ["web_search_tool"]
