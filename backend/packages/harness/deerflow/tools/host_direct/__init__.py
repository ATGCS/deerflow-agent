"""HostDirect tools: Zero-sandbox-overhead file operations for IDE-like experience.

These tools bypass the Sandbox abstraction layer entirely and operate directly
on the host filesystem. Designed to match CodeBuddy / Cursor / Windsurf UX.
"""

from deerflow.tools.host_direct.read_file import read_file_hd
from deerflow.tools.host_direct.write_file import write_file_hd
from deerflow.tools.host_direct.delete_file import delete_file_hd
from deerflow.tools.host_direct.list_dir import list_dir_hd
from deerflow.tools.host_direct.str_replace import str_replace_hd
from deerflow.tools.host_direct.search_content import search_content_hd
from deerflow.tools.host_direct.execute_command import execute_command_hd
from deerflow.tools.host_direct.web_fetch import web_fetch_hd

# Complete tool set — can be swapped with sandbox tools via config
HOST_DIRECT_TOOLS = [
    read_file_hd,
    write_file_hd,
    delete_file_hd,
    list_dir_hd,
    str_replace_hd,
    search_content_hd,
    execute_command_hd,
    web_fetch_hd,
]

__all__ = ["HOST_DIRECT_TOOLS"] + [t.name for t in HOST_DIRECT_TOOLS]
