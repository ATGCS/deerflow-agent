"""String replacement in files — with dry_run, regex, and multi-match support."""

import re
from pathlib import Path

from langchain.tools import tool


@tool("replace_in_file", parse_docstring=True)
def str_replace_hd(
    path: str,
    old_string: str,
    new_string: str,
    *,
    dry_run: bool = False,
    regex: bool = False,
) -> str:
    """Replace text in a file with precise matching.

    By default, old_string must appear EXACTLY ONCE in the file.
    If it appears multiple times, the tool reports all locations so you
    can provide more context for a unique match.

    Args:
        path: Absolute path to the file.
        old_string: The exact string to replace (or regex pattern if regex=True).
        new_string: The replacement string.
        dry_run: If True, show what would change without writing. Useful for preview.
        regex: If True, treat old_string as a regex pattern.
    """
    try:
        p = Path(path)
        if not p.exists():
            return f"Error: File not found: {path}"

        content = p.read_text(encoding="utf-8")

        if dry_run:
            return _preview_replace(content, old_string, new_string, path, regex=regex)

        if regex:
            compiled = re.compile(old_string, re.DOTALL)
            matches = compiled.findall(content)
            new_content = compiled.sub(new_string, content)
            count = len(matches)
        else:
            count = content.count(old_string)
            if count == 0:
                return f"Error: String not found in file: {path}\nSearched for: {old_string[:100]}{'...' if len(old_string) > 100 else ''}"
            if count > 1:
                locations = _find_all_locations(content, old_string, path)
                return (
                    f"Error: Match appears {count} times in {path}. Provide more context for uniqueness.\n"
                    f"\n{locations}\n"
                    f"To replace all occurrences, use regex=True with a precise pattern."
                )
            new_content = content.replace(old_string, new_string, 1)
            count = 1

        p.write_text(new_content, encoding="utf-8")
        added = len(new_string) - len(old_string)
        return f"OK: Replaced {count} occurrence(s) in {path} ({'+' if added >= 0 else ''}{added} chars)"

    except PermissionError:
        return f"Error: Permission denied: {path}"
    except Exception as e:
        return f"Error: Replace failed in '{path}': {e}"


def _preview_replace(content: str, old: str, new: str, path: str, *, regex: bool = False) -> str:
    """Generate a dry-run preview of changes."""
    if regex:
        matches = list(re.finditer(old, content, re.DOTALL))
        if not matches:
            return f"Dry run: No matches found for pattern in {path}"
        lines = [f"Dry Run Preview for: {path}", f"Pattern would match {len(matches)} location(s):"]
        for i, m in enumerate(matches[:5]):
            start = m.start()
            snippet = content[max(0, start - 20):start + len(m.group()) + 20].replace("\n", "\\n")
            lines.append(f"  [{i}] ...{snippet}...")
        lines.append(f"\nRun again with dry_run=False to apply.")
        return "\n".join(lines)

    count = content.count(old)
    if count == 0:
        return f"Dry run: String not found in {path}"

    lines = [
        "--- Dry Run Preview ---",
        f"File: {path}",
        "",
        f"<<<< OLD ({len(old.splitlines())} lines)",
    ]
    for line in old.splitlines():
        lines.append(f"  {line}")
    lines.append(f">>>> NEW ({len(new.splitlines())} lines)")
    for line in new.splitlines():
        lines.append(f"  {line}")
    lines.append("---")
    lines.append(f"Would {'replace all ' if count > 1 else 'change'} {count} occurrence(s). Run with dry_run=False to apply.")
    return "\n".join(lines)


def _find_all_locations(content: str, target: str, path: str) -> str:
    """Find all locations where target appears, with context."""
    lines = content.splitlines()
    locations = []
    for i, line in enumerate(lines):
        idx = 0
        while True:
            pos = line.find(target, idx)
            if pos == -1:
                break
            locations.append((i + 1, pos, line.strip()))
            idx = pos + 1

    result = [f"Match locations:"]
    for line_no, col, text in locations[:5]:
        preview = text[:80] + ("..." if len(text) > 80 else "")
        result.append(f"  Line {line_no}: {preview}")
    if len(locations) > 5:
        result.append(f"  ... and {len(locations) - 5} more")
    return "\n".join(result)
