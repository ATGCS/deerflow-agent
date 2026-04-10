"""Content search using regex — ripgrep-style, no sandbox overhead."""

import re
import fnmatch
from pathlib import Path
from typing import Literal

from langchain.tools import tool

_SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv",
    ".idea", ".vscode", "dist", "build", ".next", ".turbo",
    ".tox", ".eggs", ".mypy_cache", "site-packages",
}
_MAX_FILE_SIZE = 1_000_000  # 1MB — skip larger files


@tool("search_content", parse_docstring=True)
def search_content_hd(
    pattern: str,
    path: str,
    *,
    context_before: int = 0,
    context_after: int = 0,
    case_sensitive: bool = False,
    output_mode: Literal["content", "count", "files_with_matches"] = "content",
    glob_pattern: str | None = None,
    max_results: int = 50,
    max_depth: int = 10,
) -> str:
    """Search file contents using regex patterns (like ripgrep).

    This is the primary code exploration tool. Much more efficient than
    using bash + grep because results are structured and include context lines.

    Args:
        pattern: Regular expression pattern to search for.
        path: Directory or file to search in (absolute path).
        context_before: Lines before each match (like rg -B). Default 0.
        context_after: Lines after each match (like rg -A). Default 0.
        case_sensitive: Case-sensitive search? Default False.
        output_mode: 'content'=show matches, 'count'=per-file counts,
                     'files_with_matches'=list matching files only.
        glob_pattern: Filter files by glob pattern, e.g. "*.py".
        max_results: Maximum number of results to return.
        max_depth: Maximum directory recursion depth. Default 10.

    Examples:
        - Find function defs: pattern="def \\w+\\(", path="D:/project", glob_pattern="*.py"
        - Find TODO comments: pattern="TODO|FIXME|HACK|XXX", path="D:/project"
        - Count imports: pattern="^import |^from .*import", output_mode="count", glob_pattern="*.py"
    """
    try:
        root = Path(path).resolve()

        # Compile regex first (fail fast on invalid patterns)
        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            regex = re.compile(pattern, flags)
        except re.error as e:
            return f"Error: Invalid regex '{pattern}': {e}"

        # Collect files
        if root.is_file():
            files = [root]
        elif root.is_dir():
            files = _collect_files(root, glob_pattern, max_depth)
        else:
            return f"Error: Not a valid path: {path}"

        # Search based on mode
        if output_mode == "files_with_matches":
            return _search_files_only(files, regex, max_results)
        elif output_mode == "count":
            return _search_count(files, regex, max_results)
        else:
            return _search_content(files, regex, context_before, context_after, max_results)

    except Exception as e:
        return f"Error: searching content: {e}"


def _collect_files(root: Path, glob_pattern: str | None, max_depth: int) -> list[Path]:
    """Recursively collect files respecting ignores and depth limits."""
    results = []

    def _walk(current: Path, depth: int):
        if depth > max_depth:
            return
        try:
            entries = sorted(current.iterdir())
        except PermissionError:
            return

        for entry in entries:
            if entry.name.startswith(".") or entry.name in _SKIP_DIRS:
                continue
            if entry.is_dir():
                _walk(entry, depth + 1)
            elif entry.is_file():
                if entry.stat().st_size > _MAX_FILE_SIZE:
                    continue
                if _is_binary(entry):
                    continue
                if glob_pattern and not fnmatch.fnmatch(entry.name, glob_pattern):
                    continue
                results.append(entry)

    _walk(root, 1)
    return results


def _is_binary(p: Path) -> bool:
    """Quick check for binary files (null byte detection)."""
    try:
        with open(p, "rb") as f:
            chunk = f.read(8192)
        return b"\x00" in chunk
    except (OSError, IOError):
        return True


def _search_files_only(files: list[Path], regex, max_results: int) -> str:
    matched = []
    for f in files[:max_results * 3]:
        try:
            content = f.read_text(encoding="utf-8", errors="skip")
            if regex.search(content):
                rel_path = str(f)
                matched.append(rel_path)
        except (OSError, UnicodeDecodeError):
            continue
        if len(matched) >= max_results:
            break
    return "\n".join(matched) if matched else "(no matches)"


def _search_count(files: list[Path], regex, max_results: int) -> str:
    counts = []
    for f in files[:max_results * 3]:
        try:
            content = f.read_text(encoding="utf-8", errors="skip")
            matches = regex.findall(content)
            if matches:
                counts.append(f"{f}: {len(matches)} match(es)")
        except (OSError, UnicodeDecodeError):
            continue
    return "\n".join(counts) if counts else "(no matches)"


def _search_content(files: list[Path], regex, ctx_b: int, ctx_a: int, max_r: int) -> str:
    results = []
    total = 0
    for f in files[:max_r * 2]:
        try:
            content = f.read_text(encoding="utf-8", errors="skip")
            lines = content.splitlines()
            for i, line in enumerate(lines):
                if regex.search(line):
                    total += 1
                    if len(results) >= max_r:
                        results.append(f"... (truncated, {total} total matches)")
                        return "\n".join(results)

                    start = max(0, i - ctx_b)
                    end = min(len(lines), i + 1 + ctx_a)
                    nums = ",".join(str(n + 1) for n in range(start, end))
                    snippet = "\n".join(lines[start:end])
                    results.append(f"{f}:{nums}:\n{snippet}")
        except (OSError, UnicodeDecodeError):
            continue
    return "\n".join(results) if results else "(no matches)"
