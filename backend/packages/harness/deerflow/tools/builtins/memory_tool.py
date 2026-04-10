"""Global knowledge-base memory system for cross-conversation persistence.

Provides two tools:
- ``remember`` — store information for future reference
- ``recall``   — retrieve previously stored information by keyword matching

Storage backend:
- Default: local JSON files under ``~/.deerflow/knowledge/``
- V1: keyword-based retrieval (simple, no embedding dependency)
- Data is isolated per ``thread_id`` with a global-shared namespace

Roadmap: DEERFLOW_TOOLS_REFACTORING_ROADMAP.md #17
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

from langchain.tools import tool
from deerflow.collab.id_format import make_memory_id

logger = logging.getLogger(__name__)

# ─── Storage paths ────────────────────────────────────────────────

_KNOWLEDGE_DIR = Path.home() / ".deerflow" / "knowledge"
_GLOBAL_FILE = _KNOWLEDGE_DIR / "_global.jsonl"


def _ensure_dir() -> Path:
    """Create knowledge directory if missing, return path."""
    _KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)
    return _KNOWLEDGE_DIR


# ─── Data structures ──────────────────────────────────────────────

@dataclass
class MemoryEntry:
    """Single knowledge entry."""
    id: str = field(default_factory=make_memory_id)
    title: str = ""
    knowledge: str = ""
    category: str = "general"
    created_at: str = field(default_factory=lambda: datetime.now().isoformat(timespec="seconds"))
    thread_id: str = ""  # empty = global/shared

    def matches_query(self, query: str) -> bool:
        """Case-insensitive keyword match against title, knowledge, and category."""
        query_lower = query.lower()
        keywords = query_lower.split()
        searchable = f"{self.title} {self.knowledge} {self.category}".lower()
        return all(kw in searchable for kw in keywords)


# ─── Persistence layer ───────────────────────────────────────────

def _thread_file(thread_id: str) -> Path:
    """Return the JSONL file path for a thread's memories."""
    _ensure_dir()
    safe = re.sub(r"[^a-zA-Z0-9_-]", "_", thread_id)[:64]
    return _KNOWLEDGE_DIR / f"{safe}.jsonl"


def _load_entries(filepath: Path) -> list[MemoryEntry]:
    """Load all entries from a JSONL file."""
    if not filepath.exists():
        return []
    entries: list[MemoryEntry] = []
    try:
        for line in filepath.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                entries.append(MemoryEntry(**data))
            except (json.JSONDecodeError, TypeError) as e:
                logger.debug("Skipping corrupt memory entry: %s", e)
    except OSError as e:
        logger.warning("Failed to read knowledge file %s: %s", filepath, e)
    return entries


def _save_entries(filepath: Path, entries: list[MemoryEntry]) -> None:
    """Write entries to a JSONL file (atomic via temp+rename)."""
    _ensure_dir()
    tmp = filepath.with_suffix(".tmp")
    try:
        tmp.write_text(
            "\n".join(json.dumps(asdict(e), ensure_ascii=False) for e in entries),
            encoding="utf-8",
        )
        tmp.replace(filepath)
    except OSError as e:
        logger.error("Failed to write knowledge file %s: %s", filepath, e)
        raise


def _append_entry(entry: MemoryEntry, thread_id: str | None = None) -> None:
    """Append a single entry to the appropriate file.

    Args:
        entry: The memory entry to persist.
        thread_id: If provided, store in thread-scoped file; else global.
    """
    if thread_id:
        filepath = _thread_file(thread_id)
    else:
        filepath = _GLOBAL_FILE
    entries = _load_entries(filepath)
    entries.append(entry)
    _save_entries(filepath, entries)


def _search_all(query: str, category: str | None = None, limit: int = 5,
                thread_id: str | None = None) -> list[MemoryEntry]:
    """Search across thread-scoped and global memories.

    Results are sorted by recency (newest first).
    """
    files_to_search: list[Path] = [_GLOBAL_FILE]
    if thread_id:
        files_to_search.insert(0, _thread_file(thread_id))

    results: list[MemoryEntry] = []
    seen_ids: set[str] = set()

    for fp in files_to_search:
        for entry in _load_entries(fp):
            if entry.id in seen_ids:
                continue
            if category and entry.category != category:
                continue
            if not entry.matches_query(query):
                continue
            seen_ids.add(entry.id)
            results.append(entry)

    # Sort newest first
    results.sort(key=lambda e: e.created_at, reverse=True)
    return results[:limit]


# ─── Tool functions ───────────────────────────────────────────────

@tool("remember", parse_docstring=True)
def remember_tool(
    title: str,
    knowledge: str,
    *,
    category: str = "general",
) -> str:
    """Store information for future reference across conversations.

    Persists a knowledge entry to local storage so it can be recalled later,
    even in different conversation sessions. Useful for remembering user
    preferences, project conventions, decisions, or any information that
    should persist beyond the current chat.

    Args:
        title: Short descriptive title for this memory (e.g. "User prefers dark mode").
        knowledge: The full content to remember. Can be multiple sentences or paragraphs.
        category: Category tag for organization (default "general"). Examples:
            "preference", "project", "decision", "convention", "fact".

    Returns:
        Confirmation message with the memory ID and total count.

    Examples:
        remember_tool(title="Project naming convention",
                      knowledge="All modules use snake_case. "
                                "Classes use PascalCase. Constants UPPER_CASE.",
                      category="convention")

        remember_tool(title="User prefers TypeScript",
                      knowledge="When suggesting code examples, use TypeScript first.",
                      category="preference")
    """
    entry = MemoryEntry(
        title=title.strip(),
        knowledge=knowledge.strip(),
        category=category.strip().lower() or "general",
        thread_id="",  # Global scope by default
    )
    _append_entry(entry)

    # Count total entries
    total = len(_load_entries(_GLOBAL_FILE))
    logger.info("Remembered: id=%s title=%r category=%s total=%d",
                entry.id, entry.title, entry.category, total)

    return (
        f"OK: Stored memory (id={entry.id})\n"
        f"  Title: {entry.title}\n"
        f"  Category: {entry.category}\n"
        f"  Total global memories: {total}"
    )


@tool("recall", parse_docstring=True)
def recall_tool(
    query: str,
    *,
    category: str | None = None,
    limit: int = 5,
) -> str:
    """Retrieve previously stored information by keyword matching.

    Searches through all persisted memories (both global and thread-scoped)
    to find relevant information. Results are ranked by recency.

    Args:
        query: Search terms (keywords). All keywords must appear somewhere
               in the entry's title, content, or category.
        category: Optional category filter (e.g. "preference", "project").
                  If provided, only returns entries from that category.
        limit: Maximum number of results to return (default 5).

    Returns:
        Formatted list of matching memories, or "No memories found" message.

    Examples:
        recall_tool(query="naming convention")
        recall_tool(query="TypeScript preference", category="preference", limit=3)
    """
    if not query.strip():
        return "Error: 'query' is required and cannot be empty."

    results = _search_all(query=query.strip(), category=category, limit=limit)

    if not results:
        hint = (
            f"\nHint: Try broader keywords, or use remember_tool() to store information first."
            if category else
            "\nHint: Use remember_tool() to store information first."
        )
        return f"No memories found for '{query}'.{hint}"

    _suffix = "ies" if len(results) != 1 else "y"
    lines: list[str] = [f"## Found {len(results)} memor{_suffix}"]
    if category:
        lines[0] += f" (category: {category})"
    lines.append("")

    for i, entry in enumerate(results, 1):
        scope = "[global]" if not entry.thread_id else f"[thread:{entry.thread_id[:8]}]"
        lines.append(f"### {i}. {entry.title} {scope}")
        lines.append(f"- **ID**: `{entry.id}` | **Category**: {entry.category} | **Saved**: {entry.created_at}")
        # Truncate long knowledge text for readability
        knowledge_display = entry.knowledge
        if len(knowledge_display) > 500:
            knowledge_display = knowledge_display[:497] + "..."
        lines.append(f"- **Content**:\n\n{knowledge_display}\n")

    return "\n".join(lines)
