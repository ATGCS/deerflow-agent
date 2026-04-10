"""Task executor for automation tasks.

Handles execution of scheduled task prompts and records run history.

Roadmap: DEERFLOW_TOOLS_REFACTORING_ROADMAP.md #19 (远期规划)
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import traceback
from dataclasses import asdict, dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path

logger = logging.getLogger(__name__)

# ─── Paths ────────────────────────────────────────────────────────

_AUTOMATIONS_DIR = Path.home() / ".deerflow" / "automations"


def _history_file(automation_id: str) -> Path:
    _AUTOMATIONS_DIR.mkdir(parents=True, exist_ok=True)
    return _AUTOMATIONS_DIR / f"{automation_id}_history.jsonl"


def _ensure_dir() -> Path:
    _AUTOMATIONS_DIR.mkdir(parents=True, exist_ok=True)
    return _AUTOMATIONS_DIR


# ─── Run result ──────────────────────────────────────────────────


class ExecutionStatus(str, Enum):
    SUCCESS = "success"
    FAILURE = "failure"
    TIMEOUT = "timeout"
    SKIPPED = "skipped"  # Validity window or paused


@dataclass
class RunRecord:
    """A single execution record for an automation."""
    run_id: str = field(default_factory=lambda: f"{datetime.now().strftime('%Y%m%d%H%M%S')}")
    started_at: str = field(default_factory=lambda: datetime.now().isoformat(timespec="seconds"))
    finished_at: str | None = None
    status: str = ExecutionStatus.SUCCESS.value
    duration_seconds: float = 0.0
    output: str = ""
    error: str = ""
    trigger_type: str = "scheduled"  # "scheduled" | "manual"
    workspace: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


# ─── Executor ────────────────────────────────────────────────────


@dataclass
class AutomationExecutorConfig:
    """Configuration for the executor."""
    timeout_seconds: int = 300  # Max 5 min per execution
    max_output_chars: int = 10000  # Truncate long output
    python_exe: str | None = None  # Auto-detect if None


class AutomationExecutor:
    """Executes automation prompts and records results.

    The executor is designed to be pluggable:
    - Default: subprocess-based (runs prompt via CLI)
    - Future: in-process agent invocation, MCP tool calls, etc.
    """

    def __init__(self, config: AutomationExecutorConfig | None = None):
        self.config = config or AutomationExecutorConfig()
        self._python = config.python_exe if config else sys.executable

    def execute(
        self,
        task_id: str,
        task_name: str,
        prompt: str,
        workspace: str | None = None,
        *,
        manual: bool = False,
    ) -> RunRecord:
        """Execute a single automation task.

        Args:
            task_id: Automation task ID.
            task_name: Human-readable name.
            prompt: Task description/prompt to execute.
            workspace: Optional working directory.
            manual: If True, this is a manual (non-scheduled) trigger.

        Returns:
            RunRecord with execution details.
        """
        record = RunRecord(
            trigger_type="manual" if manual else "scheduled",
            workspace=workspace,
        )

        start_time = time.time()

        try:
            output = self._run_subprocess(prompt, workspace, record)
            record.status = ExecutionStatus.SUCCESS.value
            record.output = output[:self.config.max_output_chars]

        except TimeoutError:
            record.status = ExecutionStatus.TIMEOUT.value
            record.error = f"Execution timed out after {self.config.timeout_seconds}s"

        except Exception as e:
            record.status = ExecutionStatus.FAILURE.value
            record.error = f"{type(e).__name__}: {e}\n{traceback.format_exc()}"

        finally:
            record.duration_seconds = round(time.time() - start_time, 2)
            record.finished_at = datetime.now().isoformat(timespec="seconds")

        # Append to history file
        self._append_history(task_id, record)

        logger.info(
            "Automation exec: id=%s name=%r status=%s duration=%.1fs",
            task_id, task_name, record.status, record.duration_seconds,
        )

        return record

    def _run_subprocess(
        self, prompt: str, workspace: str | None, record: RunRecord
    ) -> str:
        """Run the prompt via subprocess (placeholder implementation).

        In production this would invoke the actual agent/LLM with the prompt.
        For now it simulates execution by logging the prompt intent.
        """
        # Build command — this is the hook point for real agent invocation
        cmd = [self._python, "-c", f'print("Automation: {prompt[:100]}")']

        env = os.environ.copy()
        cwd = workspace if workspace and os.path.isdir(workspace) else None

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self.config.timeout_seconds,
                env=env,
                cwd=cwd,
            )
            output = result.stdout or ""
            if result.returncode != 0:
                err = result.stderr or f"Exit code {result.returncode}"
                raise RuntimeError(err)
            return output.strip()
        except subprocess.TimeoutExpired:
            raise TimeoutError(f"Timed out after {self.config.timeout_seconds}s")

    @staticmethod
    def _append_history(automation_id: str, record: RunRecord) -> None:
        """Append a run record to the history JSONL file."""
        history_path = _history_file(automation_id)
        try:
            with open(history_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(record.to_dict(), ensure_ascii=False) + "\n")
        except OSError as e:
            logger.warning("Failed to write history for %s: %s", automation_id, e)

    @staticmethod
    def get_history(automation_id: str, limit: int = 50) -> list[RunRecord]:
        """Read execution history for a task."""
        history_path = _history_file(automation_id)
        if not history_path.exists():
            return []

        records: list[RunRecord] = []
        try:
            lines = history_path.read_text(encoding="utf-8").strip().splitlines()
            for line in lines[-limit:]:
                try:
                    data = json.loads(line)
                    records.append(RunRecord(**data))
                except (json.JSONDecodeError, TypeError):
                    continue
        except OSError as e:
            logger.warning("Failed to read history for %s: %s", automation_id, e)

        return list(reversed(records))  # Most recent first


import time  # noqa: E402
