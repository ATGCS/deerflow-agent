"""Write file — direct filesystem access."""

import shutil
from pathlib import Path

from langchain.tools import tool


@tool("write_to_file", parse_docstring=True)
def write_file_hd(
    path: str,
    content: str,
    *,
    append: bool = False,
    create_line: bool = True,
    backup: bool = False,
) -> str:
    """Write content to a file on the local filesystem.

    Args:
        path: Absolute path to the file to write.
        content: The text content to write.
        append: If True, append to existing file. Default False (overwrite).
        create_line: Ensure the content ends with a newline. Default True.
        backup: Create a .bak backup before overwriting. Default False.

    Parent directories are created automatically if they don't exist.
    """
    try:
        p = Path(path)

        # Auto-create parent directories
        p.parent.mkdir(parents=True, exist_ok=True)

        # Backup existing file before overwrite
        if backup and p.exists() and not append:
            bak_path = p.with_suffix(p.suffix + ".bak")
            shutil.copy2(p, bak_path)

        # Ensure trailing newline
        if create_line and content and not content.endswith("\n"):
            content += "\n"

        mode = "a" if append else "w"
        count = len(content.encode("utf-8"))

        with open(p, mode, encoding="utf-8") as f:
            f.write(content)

        action = "appended to" if append else "wrote"
        return f"OK: {action} {count} bytes to {path}"

    except PermissionError:
        return f"Error: Permission denied writing to: {path}"
    except IsADirectoryError:
        return f"Error: Path is a directory: {path}"
    except Exception as e:
        return f"Error: Failed to write file '{path}': {e}"
