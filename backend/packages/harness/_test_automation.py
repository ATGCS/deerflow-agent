"""Quick functional test for automation_tool core logic."""
import sys
sys.path.insert(0, ".")

from deerflow.tools.builtins.automation_tool import (
    _save_task, _load_task, _list_all_tasks, _delete_task,
    _parse_schedule, _automation_file, AutomationTask,
)

# Clean slate: remove any test files
import os
from pathlib import Path
AUTOMATIONS_DIR = Path.home() / ".deerflow" / "automations"
if AUTOMATIONS_DIR.exists():
    for f in AUTOMATIONS_DIR.glob("*.toml"):
        f.unlink()

# Test 1: Parse schedules
tests = [
    ("every hour", ("FREQ=HOURLY;INTERVAL=1", "recurring")),
    ("daily", ("FREQ=DAILY;INTERVAL=1", "recurring")),
    ("weekdays", ("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9", "recurring")),
    ("FREQ=WEEKLY;BYDAY=MO", ("FREQ=WEEKLY;BYDAY=MO", "recurring")),
]
for inp, expected in tests:
    rrule, stype = _parse_schedule(inp)
    assert (rrule, stype) == expected, f"FAIL {inp}: got ({rrue}, {stype}), expected {expected}"
print("PASS 1/6: Schedule parsing")

# Test 2: Create task
task = AutomationTask(
    name="Test task",
    prompt="Run daily health check",
    schedule_type="recurring",
    rrule="FREQ=DAILY;INTERVAL=1",
)
_save_task(task)
tid = task.id
assert _automation_file(tid).exists(), "Task file not created!"
print(f"PASS 2/6: Create - id={tid}")

# Test 3: Load task
loaded = _load_task(tid)
assert loaded is not None, "Task not loaded"
assert loaded.name == "Test task"
assert loaded.status == "active"
assert loaded.prompt == "Run daily health check"
print("PASS 3/6: Load")

# Test 4: List tasks
tasks = _list_all_tasks()
assert len(tasks) == 1
assert tasks[0].name == "Test task"
print("PASS 4/6: List")

# Test 5: Update status (pause/resume simulation)
loaded.status = "paused"
_save_task(loaded)
reloaded = _load_task(tid)
assert reloaded.status == "paused"
print("PASS 5/6: Update status")

# Test 6: Delete
deleted = _delete_task(tid)
assert deleted is True
assert not _automation_file(tid).exists()
deleted_again = _delete_task(tid)
assert deleted_again is False  # Already gone
print("PASS 6/6: Delete")

# Cleanup empty dir if created
if AUTOMATIONS_DIR.exists() and not any(AUTOMATIONS_DIR.iterdir()):
    AUTOMATIONS_DIR.rmdir()

print("\nAll 6 tests passed! Automation tool is functional.")
