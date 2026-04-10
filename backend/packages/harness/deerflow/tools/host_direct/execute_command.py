"""Execute shell commands — auto-detects OS and available shell."""

import os
import shutil
import subprocess
from pathlib import Path

from langchain.tools import tool


@tool("execute_command", parse_docstring=True)
def execute_command_hd(
    command: str,
    *,
    timeout: int = 300,
    workdir: str | None = None,
) -> str:
    """Execute a shell command on the host machine.

    Automatically detects the best available shell:
    - Windows: PowerShell → cmd.exe fallback
    - Linux/macOS: bash → sh fallback

    Args:
        command: The shell command to execute.
        timeout: Maximum execution time in seconds (default 300).
        workdir: Working directory for command execution.

    WARNING: Commands run on the host machine with current user privileges.
    Be cautious with destructive commands (rm, del, format, etc.)
    """
    try:
        cwd = Path(workdir) if workdir else None

        # Auto-detect best shell
        shell_cmd, shell_args, use_shell = _detect_shell()

        if use_shell:
            # Unix: pass command as string with shell=True
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=cwd,
            )
        else:
            # Windows: build command list
            full_cmd = [shell_cmd] + shell_args + [command]
            result = subprocess.run(
                full_cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=cwd,
            )

        output_parts = []
        if result.stdout:
            output_parts.append(result.stdout.rstrip())
        if result.stderr:
            output_parts.append(f"[stderr]\n{result.stderr.rstrip()}")
        if result.returncode != 0:
            output_parts.append(f"[exit code: {result.returncode}]")

        return "\n".join(output_parts) if output_parts else "(no output)"

    except subprocess.TimeoutExpired:
        return f"Error: Command timed out after {timeout} seconds"
    except FileNotFoundError:
        return f"Error: Shell executable not found"
    except Exception as e:
        return f"Error: executing command: {e}"


def _detect_shell() -> tuple[str, list[str], bool]:
    """Auto-detect available shell.

    Returns:
        Tuple of (executable_path_or_name, args_list, use_shell_bool).
    """
    if os.name == "nt":
        # Windows priority: pwsh > powershell > cmd
        for candidate in ("pwsh.exe", "powershell.exe", "cmd.exe"):
            full = shutil.which(candidate)
            if full:
                if "powershell" in candidate.lower():
                    return full, ["-NoProfile", "-Command"], False
                elif candidate == "cmd.exe":
                    return full, ["/c"], False
        raise RuntimeError("No shell found on Windows")
    else:
        # Unix: bash > zsh > sh
        for candidate in ("/bin/bash", "/bin/zsh", "/bin/sh"):
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return candidate, [], True  # shell=True for unix
        raise RuntimeError("No shell found")
