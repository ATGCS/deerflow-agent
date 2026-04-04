#!/usr/bin/env python3
"""Migration script for WorkerProfile data structure changes.

This script migrates existing task data to the new WorkerProfile structure:
- Ensures base_subagent is set (required in new structure)
- Adds model field if not present
- Converts tools/skills to optional (will load from AgentConfig if None)
- Ensures depends_on is a list (not None)

Usage:
    python migrate_worker_profiles.py [--dry-run]
    
Options:
    --dry-run: Show what would be changed without modifying data
"""

import argparse
import json
import logging
from pathlib import Path
from typing import Any

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def find_project_storage_dirs(base_dir: Path | None = None) -> list[Path]:
    """Find all project storage directories."""
    if base_dir is None:
        # Default to backend storage directory
        base_dir = Path(__file__).parent / "storage"
    
    projects_dir = base_dir / "projects"
    if not projects_dir.exists():
        logger.warning(f"Projects directory not found: {projects_dir}")
        return []
    
    project_dirs = [d for d in projects_dir.iterdir() if d.is_dir()]
    logger.info(f"Found {len(project_dirs)} project directories")
    return project_dirs


def migrate_worker_profile(wp_data: dict[str, Any], dry_run: bool = False) -> tuple[dict[str, Any], bool]:
    """Migrate a single WorkerProfile to the new structure.
    
    Args:
        wp_data: Original WorkerProfile dictionary
        dry_run: If True, don't modify the data
        
    Returns:
        Tuple of (migrated_data, was_modified)
    """
    migrated = wp_data.copy()
    was_modified = False
    
    # Ensure base_subagent is set (required field now)
    if not migrated.get("base_subagent"):
        migrated["base_subagent"] = "general-purpose"
        was_modified = True
        logger.info(f"  - Set base_subagent to 'general-purpose'")
    
    # Add model field if not present (optional, default None)
    if "model" not in migrated:
        # Don't add it - let it be absent (will be None in Pydantic)
        # migrated["model"] = None  # Not needed
        pass
    
    # Ensure depends_on is a list (not None)
    if "depends_on" not in migrated or migrated["depends_on"] is None:
        migrated["depends_on"] = []
        was_modified = True
        logger.info(f"  - Set depends_on to empty list")
    
    # tools and skills are now optional (None means load from AgentConfig)
    # No migration needed - just leave them as-is if present
    
    return migrated, was_modified


def migrate_project_tasks(project_dir: Path, dry_run: bool = False) -> int:
    """Migrate WorkerProfiles in a project's tasks.
    
    Args:
        project_dir: Path to project directory
        dry_run: If True, don't modify files
        
    Returns:
        Number of WorkerProfiles migrated
    """
    project_file = project_dir / "project.json"
    if not project_file.exists():
        return 0
    
    try:
        with open(project_file, "r", encoding="utf-8") as f:
            project_data = json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        logger.error(f"Failed to load project {project_dir.name}: {e}")
        return 0
    
    migrated_count = 0
    tasks = project_data.get("tasks", [])
    
    for task_idx, task in enumerate(tasks):
        subtasks = task.get("subtasks", [])
        
        for subtask_idx, subtask in enumerate(subtasks):
            worker_profile = subtask.get("worker_profile")
            if not worker_profile:
                continue
            
            # Migrate the WorkerProfile
            migrated_wp, was_modified = migrate_worker_profile(worker_profile, dry_run)
            
            if was_modified:
                migrated_count += 1
                logger.info(
                    f"Migrating WorkerProfile in {project_dir.name}/task[{task_idx}]/subtask[{subtask_idx}]"
                )
                
                if not dry_run:
                    subtasks[subtask_idx]["worker_profile"] = migrated_wp
        
        # Update subtasks in task
        if migrated_count > 0 and not dry_run:
            tasks[task_idx]["subtasks"] = subtasks
    
    # Save project if modified
    if migrated_count > 0 and not dry_run:
        project_data["tasks"] = tasks
        try:
            with open(project_file, "w", encoding="utf-8") as f:
                json.dump(project_data, f, indent=2, ensure_ascii=False)
            logger.info(f"Saved migrated project: {project_dir.name}")
        except IOError as e:
            logger.error(f"Failed to save project {project_dir.name}: {e}")
            return 0
    
    return migrated_count


def main():
    parser = argparse.ArgumentParser(
        description="Migrate WorkerProfile data structures to new format"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be changed without modifying data"
    )
    parser.add_argument(
        "--storage-dir",
        type=Path,
        default=None,
        help="Custom storage directory (default: ./storage)"
    )
    
    args = parser.parse_args()
    
    if args.dry_run:
        logger.info("DRY RUN MODE - No changes will be made")
    
    project_dirs = find_project_storage_dirs(args.storage_dir)
    
    total_migrated = 0
    for project_dir in project_dirs:
        migrated = migrate_project_tasks(project_dir, dry_run=args.dry_run)
        total_migrated += migrated
    
    if args.dry_run:
        logger.info(
            f"\n[DRY RUN] Would migrate {total_migrated} WorkerProfile(s)"
        )
    else:
        logger.info(f"\nMigration complete! Migrated {total_migrated} WorkerProfile(s)")


if __name__ == "__main__":
    main()
