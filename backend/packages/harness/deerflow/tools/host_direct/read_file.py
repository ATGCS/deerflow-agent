"""Read file contents — direct filesystem access, no sandbox overhead."""

import base64
import mimetypes
from pathlib import Path

from langchain.tools import tool

_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}


@tool("read_file", parse_docstring=True)
def read_file_hd(
    path: str,
    *,
    offset: int | None = None,
    limit: int | None = None,
) -> str:
    """Read a file from the local filesystem.

    Args:
        path: Absolute path to the file to read.
        offset: Optional starting line number (1-indexed). Use with limit.
        limit: Optional number of lines to read.

    Supports:
    - Text files: Returns content with optional line range slicing.
    - Image files: Returns base64-encoded data URI for vision models.

    Examples:
        - Read entire file: read_file(path="D:/project/main.py")
        - Read lines 10-30: read_file(path="D:/project/main.py", offset=10, limit=20)
    """
    try:
        p = Path(path)

        if not p.exists():
            return f"Error: File not found: {path}"

        if not p.is_file():
            return f"Error: Path is a directory, not a file: {path}"

        # Image files → base64 data URI
        if p.suffix.lower() in _IMAGE_EXTENSIONS:
            mime_type = mimetypes.guess_type(str(p))[0] or "image/png"
            with open(p, "rb") as f:
                b64 = base64.b64encode(f.read()).decode("ascii")
            return f"data:{mime_type};base64,{b64}"

        # Text file reading
        content = p.read_text(encoding="utf-8", errors="replace")
        lines = content.splitlines()

        if offset is not None or limit is not None:
            start = max(0, (offset or 1) - 1)
            end = start + limit if limit is not None else len(lines)
            lines = lines[start:end]
            numbered = "\n".join(
                f"{start + i + 1}:{line}" for i, line in enumerate(lines)
            )
            return numbered

        return content

    except PermissionError:
        return f"Error: Permission denied reading file: {path}"
    except Exception as e:
        return f"Error: Failed to read file '{path}': {e}"
