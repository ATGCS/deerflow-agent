# 统一智能体管理系统重构文档

## 📋 重构概述

本次重构将分散的智能体管理系统（Custom Agents、Subagents、ACP Agents）统一到一个基于文件系统的管理系统中，实现了智能体创建、查询、记忆的集中化管理。

## 🎯 重构目标

1. **统一存储**：所有智能体配置都存储在文件系统中
2. **统一查询**：通过统一的 API 接口管理所有智能体
3. **分离记忆**：智能体记忆与任务记忆分离

## 🏗️ 架构变更

### 1. 统一的智能体配置结构

**文件位置**: [`agents_config.py`](d:\github\deerflaw\backend\packages\harness\deerflow\config\agents_config.py)

扩展 `AgentConfig` 类以支持所有类型的智能体：

```python
class AgentConfig(BaseModel):
    """Unified configuration for all types of agents."""
    
    # 基础字段（所有智能体共有）
    name: str
    description: str = ""
    model: str | None = None
    tool_groups: list[str] | None = None
    
    # 智能体类型标识
    agent_type: Literal["custom", "subagent", "acp"] = "custom"
    
    # Subagent 特有字段
    system_prompt: str | None = None
    tools: list[str] | None = None
    disallowed_tools: list[str] | None = None
    max_turns: int = 50
    timeout_seconds: int = 900
    
    # ACP 特有字段
    command: str | None = None
    args: list[str] | None = None
    env: dict[str, str] | None = None
    auto_approve_permissions: bool = False
```

### 2. 文件系统布局

```
{base_dir}/
├── agents/
│   ├── {agent_name}/
│   │   ├── config.yaml          # 智能体配置
│   │   ├── SOUL.md              # 智能体人格
│   │   └── memory.json          # 智能体长期记忆
│   ├── general-purpose/         # 子智能体示例
│   │   └── config.yaml
│   └── bash/                    # 子智能体示例
│       └── config.yaml
├── USER.md                       # 全局用户画像
├── memory.json                   # 全局记忆
└── threads/
    └── {thread_id}/
        └── agent_memory/
            └── {agent_name}.json # 任务记忆
```

### 3. 智能体类型说明

#### **Custom Agents** (`agent_type: custom`)
- **用途**: 个性化智能体，通过 REST API 创建
- **配置**: `config.yaml` + `SOUL.md`
- **管理**: `POST/PUT/DELETE /api/agents`
- **记忆**: `{base_dir}/agents/{name}/memory.json`

#### **Subagents** (`agent_type: subagent`)
- **用途**: 任务委托，通过 `task` 工具调用
- **配置**: `config.yaml` (包含 `system_prompt`)
- **管理**: 文件系统配置，重启加载
- **记忆**: 独立的智能体记忆 + 任务记忆
- **示例**: `general-purpose`, `bash`

#### **ACP Agents** (`agent_type: acp`)
- **用途**: 外部 ACP 智能体，通过 `invoke_acp_agent` 调用
- **配置**: `config.yaml` (包含 `command`, `args` 等)
- **管理**: 文件系统配置，重启加载
- **记忆**: 独立工作空间

## 📝 配置文件示例

### Subagent 配置示例

**文件**: `{base_dir}/agents/bash/config.yaml`

```yaml
name: bash
description: Command execution specialist for running bash commands
agent_type: subagent
system_prompt: |
  You are a bash command execution specialist...
tools:
  - bash
  - ls
  - read_file
  - write_file
  - str_replace
disallowed_tools:
  - task
  - ask_clarification
  - present_files
max_turns: 30
timeout_seconds: 900
```

### ACP Agent 配置示例

**文件**: `{base_dir}/agents/codex/config.yaml`

```yaml
name: codex
description: Codex CLI for code analysis
agent_type: acp
command: codex-acp
args: []
model: gpt-4
auto_approve_permissions: true
env:
  OPENAI_API_KEY: $OPENAI_API_KEY
```

### Custom Agent 配置示例

**文件**: `{base_dir}/agents/code-reviewer/config.yaml`

```yaml
name: code-reviewer
description: Code review expert
agent_type: custom
model: gpt-4
tool_groups:
  - file_read
  - file_write
```

## 🔧 核心 API 变更

### 1. 智能体查询接口

**文件**: [`agents_config.py`](d:\github\deerflaw\backend\packages\harness\deerflow\config\agents_config.py)

```python
# 查询所有智能体
def list_all_agents() -> list[AgentConfig]

# 只查询 Custom Agents
def list_custom_agents() -> list[AgentConfig]

# 只查询 Subagents
def list_subagents() -> list[AgentConfig]

# 只查询 ACP Agents
def list_acp_agents() -> list[AgentConfig]
```

### 2. Subagent 注册表

**文件**: [`subagents/registry.py`](d:\github\deerflaw\backend\packages\harness\deerflow\subagents\registry.py)

**变更前**:
```python
from deerflow.subagents.builtins import BUILTIN_SUBAGENTS

def get_subagent_config(name: str):
    return BUILTIN_SUBAGENTS.get(name)
```

**变更后**:
```python
from deerflow.config.agents_config import list_subagents

def get_subagent_config(name: str):
    file_subagents = list_subagents()
    for agent_cfg in file_subagents:
        if agent_cfg.name == name:
            return _agent_config_to_subagent_config(agent_cfg)
    return None
```

### 3. ACP Agent 加载

**文件**: [`invoke_acp_agent_tool.py`](d:\github\deerflaw\backend\packages\harness\deerflow\tools\builtins\invoke_acp_agent_tool.py)

**变更前**:
```python
def build_invoke_acp_agent_tool(agents: dict):
    # agents 从 config.yaml 加载
```

**变更后**:
```python
def build_invoke_acp_agent_tool():
    from deerflow.config.agents_config import list_acp_agents
    acp_agent_configs = list_acp_agents()
    agents = {cfg.name: cfg for cfg in acp_agent_configs}
```

## 🧠 记忆系统重构

### 1. 新的记忆管理器

**文件**: [`agent_memory.py`](d:\github\deerflaw\backend\packages\harness\deerflow\agents\memory\agent_memory.py)

```python
class AgentMemoryManager:
    """Manages agent memory with separation between agent memory and task memory."""
    
    def __init__(self, agent_name: str | None = None):
        self.agent_name = agent_name
    
    # 智能体长期记忆
    def load_agent_memory() -> dict
    def save_agent_memory(memory: dict)
    def add_fact_to_agent_memory(fact: str, confidence: float)
    
    # 任务特定记忆
    def load_task_memory(thread_id: str) -> dict
    def save_task_memory(thread_id: str, memory: dict)
    def add_to_task_history(thread_id: str, role: str, content: str)
    
    # 组合记忆
    def get_combined_memory(thread_id: str | None = None) -> dict
```

### 2. 记忆结构

**智能体记忆** (`{base_dir}/agents/{name}/memory.json`):
```json
{
  "facts": [
    {
      "text": "用户偏好使用 TypeScript",
      "confidence": 0.95,
      "created_at": 1234567890
    }
  ],
  "context": {
    "user_preferences": {...}
  }
}
```

**任务记忆** (`{base_dir}/threads/{thread_id}/agent_memory/{name}.json`):
```json
{
  "conversation_history": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ],
  "task_context": {
    "current_goal": "...",
    "completed_steps": [...]
  }
}
```

## 🚀 迁移指南

### 自动迁移

已提供迁移脚本：

```bash
cd backend
python migrate_subagents.py
```

该脚本会自动将内置的 `general-purpose` 和 `bash` 子智能体迁移到文件系统。

### 手动迁移

1. **创建智能体目录**:
   ```bash
   mkdir -p {base_dir}/agents/{agent_name}
   ```

2. **创建配置文件**:
   ```yaml
   # config.yaml
   name: my-agent
   description: My custom agent
   agent_type: subagent  # 或 custom/acp
   system_prompt: |
     You are...
   ```

3. **创建 SOUL.md** (可选):
   ```markdown
   # my-agent
   
   Agent personality and guidelines...
   ```

4. **重启后端**:
   ```bash
   # 重启后端服务
   ```

5. **验证加载**:
   ```bash
   curl http://localhost:1420/api/agents
   ```

## 📊 对比表

| 特性 | 重构前 | 重构后 |
|------|--------|--------|
| **存储位置** | 分散（代码 + 配置 + 文件系统） | 统一（文件系统） |
| **Custom Agents** | ✅ 文件系统 | ✅ 文件系统 |
| **Subagents** | ❌ 代码硬编码 | ✅ 文件系统 |
| **ACP Agents** | ❌ config.yaml | ✅ 文件系统 |
| **统一查询** | ❌ 多个接口 | ✅ `/api/agents` |
| **动态创建** | ✅ Custom only | ✅ 所有类型 |
| **记忆分离** | ❌ 混合 | ✅ 智能体 + 任务 |
| **热加载** | ❌ 需要重启 | ⚠️ 需要重启 |

## ⚠️ 注意事项

### 1. 循环导入问题

重构后需要注意导入顺序，避免循环导入：

```python
# ❌ 错误：循环导入
# subagents/registry.py 导入 agents_config
# agents_config 导入 subagents

# ✅ 正确：延迟导入
def get_subagent_config(name: str):
    from deerflow.config.agents_config import list_subagents
    # ...
```

### 2. 配置验证

所有智能体配置在加载时会自动验证：

- 名称格式：`^[A-Za-z0-9-]+$`
- `agent_type` 必须是 `custom`、`subagent` 或 `acp`
- Subagent 必须有 `system_prompt`
- ACP Agent 必须有 `command`

### 3. 记忆文件清理

任务记忆文件在删除线程时不会自动清理，需要手动处理：

```python
# 清理任务记忆
import shutil
from deerflow.config.paths import get_paths

paths = get_paths()
thread_memory_dir = paths.thread_dir(thread_id) / "agent_memory"
if thread_memory_dir.exists():
    shutil.rmtree(thread_memory_dir)
```

## 🎉 后续优化方向

1. **智能体热加载**: 监听文件系统变化，自动重新加载配置
2. **智能体版本管理**: 支持智能体配置版本控制
3. **智能体市场**: 提供预配置智能体模板
4. **记忆压缩**: 自动清理过期任务记忆
5. **智能体依赖**: 支持智能体之间的依赖关系

## 📚 相关文件

- [`agents_config.py`](d:\github\deerflaw\backend\packages\harness\deerflow\config\agents_config.py) - 统一配置结构
- [`subagents/registry.py`](d:\github\deerflaw\backend\packages\harness\deerflow\subagents\registry.py) - Subagent 注册表
- [`invoke_acp_agent_tool.py`](d:\github\deerflaw\backend\packages\harness\deerflow\tools\builtins\invoke_acp_agent_tool.py) - ACP Agent 工具
- [`agent_memory.py`](d:\github\deerflaw\backend\packages\harness\deerflow\agents\memory\agent_memory.py) - 记忆管理器
- [`agents.py`](d:\github\deerflaw\backend\app\gateway\routers\agents.py) - REST API
- [`migrate_subagents.py`](d:\github\deerflaw\backend\migrate_subagents.py) - 迁移脚本

## ✅ 验证清单

- [x] 统一 AgentConfig 结构
- [x] Subagents 从文件系统加载
- [x] ACP Agents 从文件系统加载
- [x] 记忆系统分离（智能体 + 任务）
- [x] 迁移脚本测试通过
- [x] 内置智能体迁移完成
- [ ] 后端重启验证
- [ ] 前端联调测试
- [ ] 单元测试更新

---

**重构完成时间**: 2026-04-04  
**重构负责人**: Assistant  
**状态**: ✅ 代码重构完成，待重启验证
