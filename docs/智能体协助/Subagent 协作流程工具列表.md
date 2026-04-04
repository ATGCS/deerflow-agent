# Subagent 协作流程工具列表

## 📋 总览

本文档列出实时对话多智能体协作流程中，主智能体（Lead Agent）在各个阶段可以调用的所有工具。

### 🎯 设计理念：纯监督模式

**核心原则**：主智能体（Lead Agent）**不直接执行具体任务**，只负责：
- ✅ 需求分析和澄清
- ✅ 任务规划和拆解
- ✅ 选择合适的子智能体
- ✅ 分配任务给子智能体
- ✅ 监督执行进度
- ✅ 汇总交付结果

**具体执行工作**（如文件操作、代码执行、网络搜索等）**全部由子智能体完成**：
- ✅ 子智能体通过 `task` 工具启动
- ✅ 每个子智能体有独立的 `worker_profile`（工具白名单、技能、指令）
- ✅ 子智能体在自己的执行环境中工作
- ✅ 主智能体不直接调用具体工具（如 `read_file`, `bash` 等）

**好处**：
1. **职责清晰**：主智能体专注规划和协调，子智能体专注执行
2. **安全隔离**：子智能体有独立的工具白名单，权限可控
3. **并行执行**：多个子智能体可以同时工作
4. **可追溯**：每个子任务的结果独立记录和记忆

---

## 🎯 阶段 1：需求确认（ReqConfirm）

**目标**：确认用户需求，明确任务范围、交付物、约束条件

### 可用工具

| 工具名 | 来源 | 用途 | 参数示例 |
|--------|------|------|----------|
| **`ask_clarification`** | Lead Agent 内置 | 向用户提问以澄清需求 | ```python<br>ask_clarification(<br>    clarification_type="missing_info",<br>    question="请告诉我您想学习的具体主题是什么？",<br>    context="您确认了要开始学习，但还没有指定具体的学习主题"<br>)<br>``` |
| **`supervisor(list_agents)`** | supervisor | 查询可用智能体列表 | ```python<br>supervisor(<br>    action="list_agents",<br>    type="subagent"  # 可选，过滤类型<br>)<br>``` |
| **`supervisor(get_agent_config)`** | supervisor | 获取智能体详细配置 | ```python<br>supervisor(<br>    action="get_agent_config",<br>    agent_name="general-purpose"<br>)<br>``` |
| **纯文本回复** | - | 直接追问或确认 | 无需参数 |

### 禁止使用的工具

- ❌ `supervisor(create_task)` - 不得在需求确认前创建持久化任务
- ❌ `task` - 不得启动子智能体执行

---

## 📝 阶段 2：规划（Planning）

**目标**：拆解任务，定义子任务、Worker Profile、依赖关系

### 规划流程

```
1. 查询可用智能体
   └─► supervisor(list_agents, type="subagent")
   
2. 查看智能体详情（可选）
   └─► supervisor(get_agent_config, agent_name="general-purpose")
   
3. 创建主任务
   └─► supervisor(create_task, name="...", description="...")
   
4. 为每个子任务创建并分配
   └─► supervisor(create_subtask, task_id=..., name="...", worker_profile={...})
   └─► supervisor(assign_subtask, task_id=..., subtask_id=..., agent_id=...)
```

### 核心工具：`supervisor`

**工具来源**：`deerflow/tools/builtins/supervisor_tool.py`

#### Actions 列表

##### 智能体管理（新增）

| Action | 用途 | 必填参数 | 可选参数 | 返回示例 |
|--------|------|----------|----------|----------|
| **`list_agents`** | 查询所有可用智能体 | - | `type` (string: "custom", "subagent", "acp") | ```json<br>[<br>  {"name": "general-purpose", "description": "通用智能体", "type": "subagent"},<br>  {"name": "bash", "description": "Bash 执行专家", "type": "subagent"},<br>  {"name": "code-reviewer", "description": "代码审查专家", "type": "custom"}<br>]``` |
| **`get_agent_config`** | 获取智能体详细配置 | `agent_name` (string) | - | ```json<br>{<br>  "name": "general-purpose",<br>  "description": "...",<br>  "agent_type": "subagent",<br>  "system_prompt": "...",<br>  "tools": [...],<br>  "skills": [...]<br>}<br>``` |
| **`create_agent`** | 创建新智能体 | `name` (string)<br>`agent_type` (string) | `description` (string)<br>`system_prompt` (string)<br>`tools` (string[])<br>`skills` (string[]) | ```json<br>{<br>  "success": true,<br>  "agent_name": "my-agent"<br>}<br>``` |

##### 任务管理

| Action | 用途 | 必填参数 | 可选参数 | 返回示例 |
|--------|------|----------|----------|----------|
| **`create_task`** | 创建主任务 | `name` (string) | `description` (string)<br>`thread_id` (string) - 运行时注入 | ```json<br>{<br>  "id": "task_001",<br>  "name": "公司官网重构",<br>  "status": "planning",<br>  "subtasks": []<br>}<br>``` |
| **`create_subtask`** | 创建子任务 | `task_id` (string)<br>`name` (string) | `description` (string)<br>`dependencies` (string[])<br>`worker_profile` (object) - **目标** | ```json<br>{<br>  "id": "subtask_001",<br>  "name": "前端开发",<br>  "status": "pending",<br>  "worker_profile": {...}<br>}<br>``` |
| **`assign_subtask`** | 分配子任务给智能体 | `task_id` (string)<br>`subtask_id` (string)<br>`agent_id` (string) | - | ```json<br>{"success": true}<br>``` |
| **`list_subtasks`** | 查询子任务列表 | `task_id` (string) | - | ```json<br>[<br>  {"id": "sub_001", "name": "前端", "status": "pending"},<br>  {"id": "sub_002", "name": "后端", "status": "pending"}<br>]``` |
| **`get_status`** | 获取主任务状态 | `task_id` (string) | - | ```json<br>{<br>  "task_id": "task_001",<br>  "status": "planning",<br>  "progress": 0,<br>  "subtasks_count": 3<br>}<br>``` |
| **`update_progress`** | 更新进度 | `task_id` (string)<br>`progress` (int) | `message` (string) | ```json<br>{"success": true}<br>``` |
| **`start_execution`** | 门闩 2：授权执行 | `task_id` (string) | `authorized_by` (string, 默认 `"lead"`) | ```json<br>{<br>  "success": true,<br>  "execution_authorized": true,<br>  "authorized_at": "2026-04-04T..."<br>}<br>``` |
| **`read_memory`** | 读取任务记忆 | `task_id` (string) | - | ```json<br>{<br>  "output_summary": "...",<br>  "current_step": "...",<br>  "facts": [...]<br>}<br>``` |

### Worker Profile 结构（规划时写入）

```json
{
  "base_subagent": "general-purpose",
  "tools": ["read_file", "write_file", "bash"],
  "skills": ["react", "typescript"],
  "instruction": "你是一位前端开发专家，负责使用 React 和 TypeScript 开发响应式网站...",
  "depends_on": []
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `base_subagent` | string | ✅ | 子智能体模板名（从文件系统加载） |
| `tools` | string[] | ❌ | 工具白名单（缺省用模板默认） |
| `skills` | string[] | ❌ | 技能白名单（缺省注入全部） |
| `instruction` | string | ❌ | 附加系统指令 |
| `depends_on` | string[] | ❌ | 依赖的子任务 ID 列表 |

---

## ✅ 阶段 3：执行授权（AwaitingExec）

**目标**：获得执行授权（门闩 2）

### 授权方式（任一即可）

| 方式 | 工具/API | 调用方 | 说明 |
|------|----------|--------|------|
| **用户确认** | `POST /api/tasks/{task_id}/authorize-execution` | 前端/用户 | 用户点击确认按钮 |
| **主智能体命令** | `supervisor(start_execution, task_id=...)` | Lead Agent | 主智能体显式下达执行指令 |

### 授权后状态

```json
{
  "id": "task_001",
  "status": "planned",
  "execution_authorized": true,
  "authorized_at": "2026-04-04T10:30:00Z",
  "authorized_by": "lead"
}
```

---

## 🚀 阶段 4：执行（Executing）

**目标**：按依赖顺序启动子智能体执行任务

### 核心原则

**主智能体只调用 `task` 工具启动子智能体，不直接执行具体操作**

```python
# ✅ 正确：主智能体启动子智能体
task(
    description="前端开发",
    prompt="使用 React + TypeScript 开发公司官网...",
    subagent_type="general-purpose",
    collab_task_id="task_001",
    collab_subtask_id="sub_001"
)
# 返回：子智能体执行结果

# ❌ 错误：主智能体直接执行（不允许）
read_file("src/App.tsx")  # 主智能体不应该直接调用
bash("npm install")       # 主智能体不应该直接调用
```

### 核心工具：`task`

**工具来源**：`deerflow/tools/builtins/task_tool.py`

#### 调用签名

```python
task(
    description: str,           # 短标签
    prompt: str,                # 任务详细说明
    subagent_type: str,         # 子智能体类型（从文件系统加载）
    collab_task_id: str,        # 协作主任务 ID（门闩校验用）
    collab_subtask_id: str,     # 协作子任务 ID
    allowed_tool_names: str,    # JSON string - 工具白名单（可选）
    allowed_skill_names: str,   # JSON string - 技能白名单（可选）
    worker_instructions: str    # 附加指令（可选）
) -> str
```

#### 参数映射（从 Worker Profile）

| Worker Profile 字段 | task 参数 | 说明 |
|---------------------|-----------|------|
| `base_subagent` | `subagent_type` | 直接使用 |
| `tools` | `allowed_tool_names` | JSON 序列化 |
| `skills` | `allowed_skill_names` | JSON 序列化 |
| `instruction` | `worker_instructions` | 直接使用 |

#### 执行流程（工具内部）

```
1. 验证协作任务
   └─► 检查 execution_authorized === true
   └─► 检查 thread_id 绑定（如有）

2. 加载 Worker Profile
   └─► 从存储读取子任务的 worker_profile

3. 获取子智能体配置
   └─► get_subagent_config(subagent_type)
   └─► 从文件系统加载 {base_dir}/agents/{type}/config.yaml

4. 应用工具白名单
   └─► 过滤全局工具列表

5. 创建 SubagentExecutor
   └─► 注入配置、工具、技能

6. 启动后台执行
   └─► executor.execute_async(prompt)

7. 轮询结果（后端轮询，每 2 秒）
   └─► get_background_task_result(task_id)

8. 持久化任务记忆
   └─► persist_task_memory_after_subagent_run()

9. 广播 SSE 事件
   └─► broadcast_project_event()

10. 返回结果
    └─► "Task Succeeded: {result}"
```

#### 返回格式

```text
[Subagent: general-purpose]

任务执行结果摘要...
```

### 辅助工具：`task_memory`

**工具来源**：`deerflow/tools/builtins/task_memory_tool.py`

| Action | 用途 | 参数 | 说明 |
|--------|------|------|------|
| **`add_fact`** | 添加事实到记忆 | `task_id`, `content`, `category`, `confidence` | 子智能体或 Lead 添加发现 |
| **`update_progress`** | 更新进度 | `task_id`, `progress`, `current_step` | 同步进度到记忆 |
| **`read_memory`** | 读取记忆 | `task_id` | 获取 facts、summary、current_step |

---

## 📊 阶段 5：监控与汇总（Synthesis）

**目标**：监控执行进度，汇总所有子任务结果

### 监控工具

| 工具名 | 用途 | 调用示例 |
|--------|------|----------|
| **`supervisor(list_subtasks)`** | 查询子任务状态 | ```python<br>supervisor(<br>    action="list_subtasks",<br>    task_id="task_001"<br>)<br>``` |
| **`supervisor(get_status)`** | 获取主任务状态 | ```python<br>supervisor(<br>    action="get_status",<br>    task_id="task_001"<br>)<br>``` |
| **`supervisor(read_memory)`** | 读取任务记忆 | ```python<br>supervisor(<br>    action="read_memory",<br>    task_id="task_001"<br>)<br>``` |

### HTTP API（非工具，供前端查询）

| 端点 | 用途 |
|------|------|
| `GET /api/tasks/{task_id}` | 查询任务详情（含 subtasks） |
| `GET /api/tasks/{task_id}/subtasks` | 查询子任务列表 |
| `GET /api/task-memory/tasks/{task_id}` | 查询任务记忆 |
| `GET /api/events/projects/{project_id}/stream` | SSE 实时事件流 |

### 汇总工具

| 工具名 | 用途 | 说明 |
|--------|------|------|
| **纯文本回复** | 汇总交付 | Lead Agent 聚合所有子任务结果，向用户交付最终成果 |

---

## 🔧 其他辅助工具

### 上下文管理

| 工具名 | 用途 | 参数 |
|--------|------|------|
| **`/context`** (指令) | 查看当前上下文 | 无 |
| **`/collab`** (指令) | 显式开启复杂任务模式 | 无 |

### 调试工具

| 工具名 | 用途 | 说明 |
|--------|------|------|
| **`task_status`** | 查询后台任务状态 | **已从 LLM 工具移除**，仅内部使用 |

---

## 📊 工具使用矩阵

| 阶段 | ask_clarification | supervisor | task | task_memory | 具体工具<br>(read_file, bash 等) |
|------|-------------------|------------|------|-------------|-------------------|
| **1. 需求确认** | ✅ | ✅ (list_agents, get_agent_config) | ❌ | ❌ | ❌ |
| **2. 规划** | ✅ | ✅ (list_agents, get_agent_config, create_task, create_subtask, assign_subtask) | ❌ | ❌ | ❌ |
| **3. 执行授权** | ✅ | ✅ (start_execution) | ❌ | ❌ | ❌ |
| **4. 执行** | ✅ | ✅ (list_subtasks, get_status) | ✅ | ✅ | ❌<br>(子智能体执行) |
| **5. 汇总** | ✅ | ✅ (read_memory) | ❌ | ✅ | ❌ |

**说明**：
- 主智能体**从不直接调用具体工具**（如 `read_file`, `bash`, `web_search` 等）
- 所有具体操作都由子智能体通过 `task` 工具执行
- 主智能体只负责规划、分配、监督和汇总

---

## 🎯 Worker Profile 传递路径

```
Lead Agent 规划
  │
  ├─► supervisor(create_subtask, worker_profile={...})
  │     └─► 写入存储桶 JSON
  │           └─► tasks[].subtasks[].worker_profile
  │
  ▼
Lead Agent 执行
  │
  ├─► task(collab_subtask_id="sub_001", ...)
  │     └─► task_tool 内部读取存储
  │           └─► 提取 worker_profile
  │                 └─► 映射到 task 参数
  │                       ├─► subagent_type
  │                       ├─► allowed_tool_names
  │                       ├─► allowed_skill_names
  │                       └─► worker_instructions
  │
  ▼
SubagentExecutor 执行
  │
  └─► 应用配置执行任务
```

---

## 📚 相关文档

- [`实时对话多智能体协作设计.md`](d:\github\deerflaw\docs\智能体协助\实时对话多智能体协作设计.md) - 阶段机详细设计
- [`主智能体工具调用与阶段说明.md`](d:\github\deerflaw\docs\智能体协助\主智能体工具调用与阶段说明.md) - 工具参数详解
- [`task_tool_improvements.md`](d:\github\deerflaw\backend\docs\task_tool_improvements.md) - Task 工具改进

---

**文档版本**: 1.0  
**最后更新**: 2026-04-04  
**状态**: ✅ 完成
