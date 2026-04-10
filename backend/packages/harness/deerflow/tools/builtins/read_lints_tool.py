"""Read and display linter errors from the current workspace or specified paths."""

from __future__ import annotations

import logging
import subprocess

from pathlib import Path
from typing import Annotated

from langchain.tools import InjectedToolCallId, ToolRuntime, tool
from langchain_core.messages import ToolMessage
from langgraph.types import Command
from langgraph.typing import ContextT

from deerflow.agents.thread_state import ThreadState
from deerflow.config.paths import get_paths

logger = logging.getLogger(__name__)

# Supported linter commands (tried in order; first available wins).
_LINTER_COMMANDS: list[list[str]] = [
    ["ruff", "check", "--output-format=concise"],
    ["pylint", "--output-format=text"],
    ["flake8"],
]


def _find_available_linter() -> str | None:
    """Return the name of the first available linter executable, or None."""
    for cmd_parts in _LINTER_COMMANDS:
        try:
            result = subprocess.run(
                [cmd_parts[0], "--version"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0:
                return cmd_parts[0]
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue
    return None


def _run_ruff(path: str) -> str:
    """Run ruff on *path* and return its output."""
    p = Path(path).expanduser().resolve()
    args = ["ruff", "check", "--output-format=concise", str(p)]
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            return "No issues found."
        return result.stdout.strip() or result.stderr.strip() or "No issues found."
    except FileNotFoundError:
        return "Error: ruff is not installed."
    except subprocess.TimeoutExpired:
        return "Error: ruff timed out after 30 seconds."
    except Exception as exc:
        return f"Error running ruff: {exc}"


@tool("read_lints", parse_docstring=False)
def read_lints_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    paths: Annotated[str | None, "File path, directory path, or omitted to lint the entire workspace"] = None,
    tool_call_id: Annotated[str, InjectedToolCallId] | None = None,
) -> Command:
    """Read and display linter/diagnostic errors for source files.

    Supports Python files via ruff (preferred), pylint, or flake8.
    When no path is given, lints the entire workspace root.
    Returns a human-readable summary of all issues found.

    Args:
        paths: Optional file or directory path to lint. If not provided,
               lints the full workspace directory.
    """
    # Resolve target directory
    if paths:
        target = Path(paths).expanduser()
        if not target.exists():
            msg = f"Path does not exist: {paths}"
            return Command(update={"messages": [ToolMessage(msg, tool_call_id=tool_call_id)]})
    else:
        # Default to workspace root
        try:
            target = get_paths().workspace_root
        except Exception:
            target = Path.cwd()

    # Try ruff first (fastest, most common)
    linter_name = _find_available_linter()

    if linter_name == "ruff":
        output = _run_ruff(str(target))
    elif linter_name is not None:
        # Fallback: run whatever we found
        try:
            result = subprocess.run(
                [linter_name, str(target)],
                capture_output=True,
                text=True,
                timeout=30,
            )
            output = result.stdout.strip() or result.stderr.strip() or "No issues found."
        except Exception as exc:
            output = f"Error running {linter_name}: {exc}"
    else:
        output = (
            "No supported Python linter found.\n"
            "Install one of: ruff (recommended), pylint, flake8\n"
            "\nExample: pip install ruff"
        )

    header = f"Linter ({linter_name or 'none'}): {target}\n{'='*60}\n"
    full_output = header + output

    return Command(
        update={"messages": [ToolMessage(full_output, tool_call_id=tool_call_id)]},
    )
