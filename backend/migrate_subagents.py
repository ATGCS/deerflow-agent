#!/usr/bin/env python3
"""Migration script to move built-in subagents from code to filesystem.

This script creates agent configuration files in the agents directory
based on the existing built-in subagent configurations.
"""

import sys
import yaml
from pathlib import Path

# Simple migration without importing deerflow modules
def migrate_general_purpose():
    """Migrate general-purpose subagent."""
    agent_dir = Path(__file__).parent / ".deer-flow" / "agents" / "general-purpose"
    agent_dir.mkdir(parents=True, exist_ok=True)
    
    config_data = {
        "name": "general-purpose",
        "description": """A capable agent for complex, multi-step tasks that require both exploration and action.

Use this subagent when:
- The task requires both exploration and modification
- Complex reasoning is needed to interpret results
- Multiple dependent steps must be executed
- The task would benefit from isolated context management

Do NOT use for simple, single-step operations.""",
        "agent_type": "subagent",
        "system_prompt": """You are a general-purpose subagent working on a delegated task. Your job is to complete the task autonomously and return a clear, actionable result.

<guidelines>
- Focus on completing the delegated task efficiently
- Use available tools as needed to accomplish the goal
- Think step by step but act decisively
- If you encounter issues, explain them clearly in your response
- Return a concise summary of what you accomplished
- Do NOT ask for clarification - work with the information provided
</guidelines>

<output_format>
When you complete the task, provide:
1. A brief summary of what was accomplished
2. Key findings or results
3. Any relevant file paths, data, or artifacts created
4. Issues encountered (if any)
5. Citations: Use `[citation:Title](URL)` format for external sources
</output_format>

<working_directory>
You have access to the same sandbox environment as the parent agent:
- User uploads: `/mnt/user-data/uploads`
- User workspace: `/mnt/user-data/workspace`
- Output files: `/mnt/user-data/outputs`
</working_directory>
""",
        "disallowed_tools": ["task", "ask_clarification", "present_files"],
        "max_turns": 50,
    }
    
    config_file = agent_dir / "config.yaml"
    with open(config_file, "w", encoding="utf-8") as f:
        yaml.dump(config_data, f, default_flow_style=False, allow_unicode=True)
    
    soul_file = agent_dir / "SOUL.md"
    soul_file.write_text("# general-purpose\n\nGeneral-purpose subagent for complex tasks.", encoding="utf-8")
    
    print(f"✓ Migrated general-purpose subagent to {agent_dir}")


def migrate_bash_agent():
    """Migrate bash subagent."""
    agent_dir = Path(__file__).parent / ".deer-flow" / "agents" / "bash"
    agent_dir.mkdir(parents=True, exist_ok=True)
    
    config_data = {
        "name": "bash",
        "description": """Command execution specialist for running bash commands in a separate context.

Use this subagent when:
- You need to run a series of related bash commands
- Terminal operations like git, npm, docker, etc.
- Command output is verbose and would clutter main context
- Build, test, or deployment operations

Do NOT use for simple single commands - use bash tool directly instead.""",
        "agent_type": "subagent",
        "system_prompt": """You are a bash command execution specialist. Execute the requested commands carefully and report results clearly.

<guidelines>
- Execute commands one at a time when they depend on each other
- Use parallel execution when commands are independent
- Report both stdout and stderr when relevant
- Handle errors gracefully and explain what went wrong
- Use absolute paths for file operations
- Be cautious with destructive operations (rm, overwrite, etc.)
</guidelines>

<output_format>
For each command or group of commands:
1. What was executed
2. The result (success/failure)
3. Relevant output (summarized if verbose)
4. Any errors or warnings
</output_format>

<working_directory>
You have access to the sandbox environment:
- User uploads: `/mnt/user-data/uploads`
- User workspace: `/mnt/user-data/workspace`
- Output files: `/mnt/user-data/outputs`
</working_directory>
""",
        "tools": ["bash", "ls", "read_file", "write_file", "str_replace"],
        "disallowed_tools": ["task", "ask_clarification", "present_files"],
        "max_turns": 30,
    }
    
    config_file = agent_dir / "config.yaml"
    with open(config_file, "w", encoding="utf-8") as f:
        yaml.dump(config_data, f, default_flow_style=False, allow_unicode=True)
    
    soul_file = agent_dir / "SOUL.md"
    soul_file.write_text("# bash\n\nBash command execution specialist.", encoding="utf-8")
    
    print(f"✓ Migrated bash subagent to {agent_dir}")


if __name__ == "__main__":
    print("=" * 60)
    print("Migrating built-in subagents to filesystem")
    print("=" * 60)
    print()
    
    migrate_general_purpose()
    migrate_bash_agent()
    
    print()
    print("=" * 60)
    print("Migration complete!")
    print("=" * 60)
    print()
    print("Next steps:")
    print("1. Restart the backend to load agents from filesystem")
    print("2. Verify agents are loaded: curl http://localhost:1420/api/agents")
    print("3. Test subagent functionality")
    print()
