"""Delete file — direct filesystem access with safety guards."""

from pathlib import Path

from langchain.tools import tool

# Paths that should never be deleted via this tool (normalized lowercase)
_PROTECTED_PREFIXES = {
    "/windows", "/program files", "/program files (x86)",
    "/programdata", "/users/all users", "/users/default",
    "/bin", "/usr/bin", "/usr/sbin", "/sbin", "/etc",
    "/sys", "/proc", "/boot", "/lib", "/lib64", "/dev",
}


def _is_protected(path: str) -> bool:
    """Check if path is under a protected system directory."""
    try:
        normalized = str(Path(path).resolve()).lower()
        for prefix in _PROTECTED_PREFIXES:
            if normalized.startswith(prefix.lower()):
                return True
    except (OSError, ValueError):
        pass
    return False


@tool("delete_file", parse_docstring=True)
def delete_file_hd(
    path: str,
    *,
    reason: str = "",
) -> str:
    """Delete a file from the local filesystem.

    WARNING: This operation cannot be undone. Use with caution.
    System-protected paths are blocked automatically.

    Args:
        path: Absolute path to the file to delete.
        reason: Reason for deletion (optional, for logging).
    """
    try:
        p = Path(path)

        if not p.exists():
            return f"Error: File not found: {path}"

        if not p.is_file():
            return (
                f"Error: Not a file (directory?): {path}. "
                "Use execute_command 'rm -rf' for directories."
            )

        if _is_protected(path):
            return f"Error: Protected system path, deletion blocked: {path}"

        size = p.stat().st_size
        p.unlink()

        return f"OK: Deleted {path} ({size} bytes)"

    except PermissionError:
        return f"Error: Permission denied: {path}"
    except Exception as e:
        return f"Error: Failed to delete '{path}': {e}"
