# Subagent 完整使用流程文档

## 📖 概述

本文档详细说明 Subagent 的完整使用流程，并通过一个实际案例演示如何协调 3 个智能体完成复杂任务。

## 🎯 案例场景：网站重构项目

**任务描述**：重构公司官网，包括前端开发、后端 API 开发和自动化测试

**参与智能体**：
1. **frontend-dev** - 前端开发专家（React/TypeScript）
2. **backend-dev** - 后端开发专家（Python/FastAPI）
3. **qa-tester** - 测试专家（pytest/E2E 测试）

## 🏗️ 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    Lead Agent                           │
│              (主智能体 - 协调和监督)                      │
└────────────────┬────────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        │  Supervisor     │
        │  Tool           │
        │  (任务规划)      │
        └────────┬────────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
┌───▼───┐   ┌───▼───┐   ┌───▼───┐
│ Task  │   │ Task  │   │ Task  │
│ Tool  │   │ Tool  │   │ Tool  │
└───┬───┘   └───┬───┘   └───┬───┘
    │           │           │
┌───▼───┐   ┌───▼───┐   ┌───▼───┐
│Front- │   │Back-│   │  QA   │
│ end   │   │ end │   │Tester │
│ Agent │   │Agent│   │ Agent │
└───────┘   └─────┘   └───────┘
```

## 📝 完整流程

### 阶段 1：任务规划和创建

#### 1.1 用户使用自然语言描述需求

```
用户：我想重构公司官网，包括：
1. 前端用 React + TypeScript
2. 后端用 Python FastAPI
3. 需要完整的自动化测试
```

#### 1.2 Lead Agent 分析任务

**Lead Agent 思考过程**：
```
这是一个复杂的多步骤任务，需要：
- 前端开发（React/TypeScript）
- 后端开发（Python/FastAPI）
- 测试（pytest/E2E）

我应该使用 supervisor_tool 来规划和协调这个任务。
```

#### 1.3 调用 Supervisor Tool 创建项目

```python
# supervisor_tool 内部逻辑
def supervisor_tool(prompt: str):
    """监督员工具 - 用于任务规划和协调"""
    
    # 1. 创建项目
    project = new_project_bundle_root_task(
        project_name="公司官网重构",
        main_task_description="完成官网重构，包括前端、后端和测试",
        thread_id=runtime.context.thread_id
    )
    
    # 2. 规划子任务
    subtasks = [
        {
            "name": "前端开发",
            "description": "使用 React + TypeScript 开发前端界面",
            "worker_profile": {
                "base_subagent": "general-purpose",
                "tools": ["write_file", "read_file", "bash"],
                "skills": ["react", "typescript", "frontend"],
                "instruction": "你是一位前端开发专家，负责使用 React 和 TypeScript 开发响应式网站..."
            }
        },
        {
            "name": "后端开发",
            "description": "使用 Python FastAPI 开发 REST API",
            "worker_profile": {
                "base_subagent": "general-purpose",
                "tools": ["write_file", "read_file", "bash"],
                "skills": ["python", "fastapi", "backend"],
                "instruction": "你是一位后端开发专家，负责使用 Python 和 FastAPI 开发 RESTful API..."
            },
            "depends_on": ["前端开发"]  # 依赖前端定义接口
        },
        {
            "name": "自动化测试",
            "description": "编写和执行自动化测试",
            "worker_profile": {
                "base_subagent": "bash",
                "tools": ["bash", "read_file"],
                "skills": ["testing", "pytest"],
                "instruction": "你是一位测试专家，负责编写和执行自动化测试..."
            },
            "depends_on": ["前端开发", "后端开发"]  # 依赖前后端完成
        }
    ]
    
    # 3. 保存到存储
    storage = get_project_storage()
    storage.save_project(project)
    
    return f"已创建项目 '{project.name}'，包含 {len(subtasks)} 个子任务"
```

### 阶段 2：任务分配和执行

#### 2.1 授权任务执行

```python
# 用户确认后，授权执行
authorize_main_task_execution(
    project_id=project.id,
    task_id=main_task.id,
    execution_authorized=True
)
```

#### 2.2 执行第一个子任务（前端开发）

**调用 Task Tool**：

```python
# task_tool.py 内部逻辑
async def task_tool(
    description: str = "前端开发",
    prompt: str = "使用 React + TypeScript 开发公司官网前端，包括：\n"
                  "1. 首页\n"
                  "2. 关于我们\n"
                  "3. 产品展示\n"
                  "4. 联系我们\n"
                  "要求：响应式设计，使用 Tailwind CSS",
    subagent_type: str = "general-purpose",
    collab_task_id: str = project.main_task_id,
    collab_subtask_id: str = subtask_1_id,
):
    """委托任务给子智能体"""
    
    # 1. 验证协作任务
    gate = collab_execution_gate_error(collab_task_id, thread_id)
    if gate:
        return gate  # 任务不存在或未授权
    
    # 2. 加载 Worker Profile
    storage = get_project_storage()
    subtask = storage.find_subtask(collab_task_id, collab_subtask_id)
    worker_profile = WorkerProfile.model_validate(subtask.worker_profile)
    
    # 3. 获取子智能体配置
    config = get_subagent_config(worker_profile.base_subagent)
    
    # 4. 应用工具白名单
    global_tools = get_available_tools(model_name=parent_model)
    allowed_tools = [
        t for t in global_tools 
        if t.name in worker_profile.tools
    ]
    
    # 5. 创建执行器
    executor = SubagentExecutor(
        config=config,
        tools=allowed_tools,
        parent_model=parent_model,
        sandbox_state=sandbox_state,
        thread_data=thread_data,
        thread_id=thread_id,
    )
    
    # 6. 启动后台执行
    task_id = executor.execute_async(prompt)
    
    # 7. 轮询结果
    while True:
        result = get_background_task_result(task_id)
        
        if result.status == SubagentStatus.COMPLETED:
            # 8. 持久化任务记忆
            persist_task_memory_after_subagent_run(
                mem_store,
                project_id,
                agent_id,
                task_id,
                outcome="completed",
                output_summary=result.result,
                progress=100
            )
            
            # 9. 广播 SSE 事件
            await broadcast_project_event(
                project_id,
                "task:completed",
                {"task_id": collab_subtask_id, "result": result.result}
            )
            
            return f"Task Succeeded. Result: {result.result}"
        
        elif result.status == SubagentStatus.FAILED:
            # 处理失败
            ...
        
        # 等待 5 秒后轮询
        await asyncio.sleep(5)
```

#### 2.3 前端智能体执行过程

**Frontend Agent 内部循环**：

```
Frontend Agent 启动
├─ Turn 1: 分析任务需求
│   └─ 思考：需要创建哪些页面？使用什么组件库？
├─ Turn 2: 创建项目结构
│   ├─ 工具调用：bash("npm create vite@latest . -- --template react-ts")
│   └─ 工具调用：bash("npm install")
├─ Turn 3: 创建页面组件
│   ├─ 工具调用：write_file("src/pages/Home.tsx", ...)
│   ├─ 工具调用：write_file("src/pages/About.tsx", ...)
│   ├─ 工具调用：write_file("src/pages/Products.tsx", ...)
│   └─ 工具调用：write_file("src/pages/Contact.tsx", ...)
├─ Turn 4: 创建路由和布局
│   ├─ 工具调用：write_file("src/App.tsx", ...)
│   └─ 工具调用：write_file("src/main.tsx", ...)
├─ Turn 5: 添加样式
│   ├─ 工具调用：bash("npm install tailwindcss")
│   └─ 工具调用：write_file("tailwind.config.js", ...)
└─ Turn 6: 完成任务
    └─ 返回：前端开发完成，创建了 4 个页面和完整的路由系统
```

**执行中的记忆持久化**：

```python
# 每次子智能体完成一个步骤后
def persist_task_memory_after_subagent_run(
    mem_store,
    project_id,
    agent_id,
    task_id,
    outcome="completed",
    output_summary="创建了首页、关于我们、产品展示、联系我们页面",
    current_step="已完成页面组件开发",
    progress=75,
):
    """持久化任务记忆"""
    
    # 1. 加载当前任务记忆
    memory = mem_store.load_task_memory(project_id, agent_id, task_id)
    
    # 2. 更新进度
    memory["progress"] = progress
    memory["current_step"] = current_step
    memory["output_summary"] = output_summary
    
    # 3. 提取事实
    facts = extract_facts_from_summary(output_summary)
    # facts = [
    #     "项目使用 React + TypeScript",
    #     "使用 Tailwind CSS 进行样式设计",
    #     "创建了 4 个主要页面"
    # ]
    
    memory["facts"] = memory.get("facts", []) + facts
    
    # 4. 保存记忆
    mem_store.save_task_memory(project_id, agent_id, task_id, memory)
    
    # 5. 广播 SSE 事件
    await broadcast_project_event(
        project_id,
        "task_memory:updated",
        {"task_id": task_id, "facts_count": len(memory["facts"])}
    )
```

#### 2.4 执行第二个子任务（后端开发）

**依赖检查**：

```python
# 检查前置任务是否完成
storage = get_project_storage()
subtask = storage.find_subtask(project_id, backend_subtask_id)

depends_on = subtask.worker_profile.depends_on  # ["前端开发"]
for dep_name in depends_on:
    dep_subtask = storage.find_subtask_by_name(project_id, dep_name)
    if dep_subtask.status != "completed":
        return f"等待依赖任务 '{dep_name}' 完成"

# 依赖已满足，开始执行后端开发
result = await task_tool(
    description="后端开发",
    prompt="使用 Python FastAPI 开发 REST API...",
    subagent_type="general-purpose",
    collab_task_id=project_id,
    collab_subtask_id=backend_subtask_id
)
```

#### 2.5 执行第三个子任务（自动化测试）

**多依赖检查**：

```python
# 检查多个前置任务
depends_on = ["前端开发", "后端开发"]  # 依赖两个任务

all_completed = True
for dep_name in depends_on:
    dep_subtask = storage.find_subtask_by_name(project_id, dep_name)
    if dep_subtask.status != "completed":
        all_completed = False
        break

if all_completed:
    # 所有依赖满足，开始测试
    result = await task_tool(
        description="自动化测试",
        prompt="编写和执行自动化测试...",
        subagent_type="bash",
        collab_task_id=project_id,
        collab_subtask_id=qa_subtask_id
    )
```

### 阶段 3：结果聚合和反馈

#### 3.1 聚合所有子任务结果

```python
def _persist_main_task_memory_snapshot(project: dict, task: dict):
    """聚合子任务记忆到主任务"""
    
    mem_store = get_task_memory_storage()
    
    # 1. 加载主任务记忆
    main_mem = mem_store.load_task_memory(
        project_id=project.id,
        agent_id=task.assigned_to,
        task_id=task.id
    )
    
    # 2. 聚合所有子任务的事实和结果
    aggregated_facts = []
    output_parts = []
    
    for subtask in task.subtasks:
        sub_mem = mem_store.load_task_memory(
            project_id=project.id,
            agent_id=subtask.assigned_to,
            task_id=subtask.id
        )
        
        # 收集输出
        if sub_mem.get("output_summary"):
            output_parts.append(f"[{subtask.name}] {sub_mem['output_summary']}")
        
        # 收集事实（去重）
        for fact in sub_mem.get("facts", []):
            if fact not in aggregated_facts:
                aggregated_facts.append(fact)
    
    # 3. 更新主任务记忆
    main_mem["output_summary"] = "\n\n".join(output_parts)
    main_mem["facts"] = aggregated_facts
    main_mem["progress"] = 100
    main_mem["status"] = "completed"
    
    # 4. 保存
    mem_store.save_task_memory(
        project_id=project.id,
        agent_id=task.assigned_to,
        task_id=task.id,
        memory=main_mem
    )
```

#### 3.2 向用户反馈最终结果

```python
# Lead Agent 向用户反馈
final_result = """
✅ 公司官网重构项目已完成！

## 完成情况

### 1. 前端开发 ✅
- 使用 React + TypeScript
- 创建了 4 个页面（首页、关于我们、产品展示、联系我们）
- 使用 Tailwind CSS 实现响应式设计

### 2. 后端开发 ✅
- 使用 Python FastAPI
- 开发了 RESTful API
- 实现了用户认证和数据管理

### 3. 自动化测试 ✅
- 编写了 50+ 单元测试
- 执行了 E2E 测试
- 测试覆盖率：85%

## 交付物
- 前端代码：/frontend/
- 后端代码：/backend/
- 测试报告：/tests/report.html
"""

return final_result
```

## 🔍 关键代码路径

### 1. Task Tool 执行流程

```
task_tool() 调用
  ├─ 验证协作任务 (collab_execution_gate_error)
  ├─ 加载 Worker Profile
  ├─ 获取子智能体配置 (get_subagent_config)
  ├─ 创建 SubagentExecutor
  ├─ 启动后台执行 (execute_async)
  ├─ 轮询结果 (get_background_task_result)
  │   ├─ 发送 task_running 事件（实时消息）
  │   ├─ 检查完成状态
  │   └─ 等待 5 秒后重试
  ├─ 持久化任务记忆 (persist_task_memory_after_subagent_run)
  ├─ 广播 SSE 事件 (broadcast_project_event)
  └─ 清理后台任务 (cleanup_background_task)
```

### 2. SubagentExecutor 执行流程

```
SubagentExecutor.execute_async()
  ├─ 创建独立的 LangGraph 图
  ├─ 配置子智能体的系统提示
  ├─ 注入工具列表
  ├─ 在后台线程池运行
  │   ├─ Lead Agent 循环
  │   │   ├─ 思考下一步
  │   │   ├─ 选择工具
  │   │   ├─ 执行工具
  │   │   └─ 更新状态
  │   └─ 直到完成任务或超时
  ├─ 收集 AI 消息（用于实时反馈）
  └─ 设置完成状态（COMPLETED/FAILED/TIMED_OUT）
```

### 3. 记忆持久化流程

```
persist_task_memory_after_subagent_run()
  ├─ 加载任务记忆
  ├─ 提取事实（使用 LLM）
  │   └─ FACT_EXTRACTION_PROMPT
  ├─ 更新记忆数据
  │   ├─ facts: 提取的事实
  │   ├─ output_summary: 任务总结
  │   ├─ progress: 进度（0-100）
  │   └─ current_step: 当前步骤
  ├─ 保存到文件
  └─ 广播 SSE 事件
    ├─ task:progress
    ├─ task_memory:updated
    └─ task:completed/task:failed
```

## 📊 数据流图

```
用户请求
  │
  ▼
Lead Agent
  │
  ├─► Supervisor Tool ──► 创建项目/任务 ──► 保存到存储
  │                           │
  │                           ▼
  │                    ┌──────────────┐
  │                    │ 项目存储     │
  │                    │ - 项目信息   │
  │                    │ - 主任务     │
  │                    │ - 子任务     │
  │                    │ - Worker     │
  │                    └──────────────┘
  │                           │
  ▼                           ▼
Task Tool 1 ──► Frontend Agent ──► 执行任务
  │                                   │
  │                                   ▼
  │                            持久化记忆
  │                                   │
  ▼                                   ▼
Task Tool 2 ──► Backend Agent ──► 执行任务
  │                                   │
  │                                   ▼
  │                            持久化记忆
  │                                   │
  ▼                                   ▼
Task Tool 3 ──► QA Agent ─────► 执行任务
  │                                   │
  │                                   ▼
  │                            持久化记忆
  │                                   │
  ▼                                   ▼
聚合结果 ◄───────────────────────────┘
  │
  ▼
用户反馈
```

## 🎓 最佳实践

### 1. 任务分解原则

✅ **好的任务分解**：
- 每个子任务有明确的目标和交付物
- 子任务之间依赖关系清晰
- 每个子任务可以独立执行和测试

❌ **不好的任务分解**：
- 子任务目标模糊
- 依赖关系循环
- 子任务粒度太大或太小

### 2. Worker Profile 设计

```yaml
# ✅ 好的 Worker Profile
worker_profile:
  base_subagent: general-purpose
  tools:
    - write_file
    - read_file
    - bash
  skills:
    - react
    - typescript
  instruction: |
    你是一位前端专家，专注于 React 开发...
  depends_on: []

# ❌ 不好的 Worker Profile
worker_profile:
  base_subagent: general-purpose  # 太泛
  tools: []  # 没有指定工具
  instruction: ""  # 没有指导
```

### 3. 错误处理

```python
# Task Tool 内部错误处理
try:
    result = await task_tool(...)
    
    if result.startswith("Error:"):
        # 处理错误
        logger.error(result)
        return f"子任务执行失败：{result}"
    
    # 处理成功
    logger.info(result)
    return result
    
except Exception as e:
    logger.exception("Task execution failed")
    return f"任务执行异常：{str(e)}"
```

## 📚 相关文件

- [`task_tool.py`](d:\github\deerflaw\backend\packages\harness\deerflow\tools\builtins\task_tool.py) - Task 工具实现
- [`supervisor_tool.py`](d:\github\deerflaw\backend\packages\harness\deerflow\tools\builtins\supervisor_tool.py) - Supervisor 工具实现
- [`subagents/executor.py`](d:\github\deerflaw\backend\packages\harness\deerflow\subagents\executor.py) - Subagent 执行器
- [`collab/storage.py`](d:\github\deerflaw\backend\packages\harness\deerflow\collab\storage.py) - 协作存储
- [`agents/memory/agent_memory.py`](d:\github\deerflaw\backend\packages\harness\deerflow\agents\memory\agent_memory.py) - 记忆管理

---

**文档版本**: 1.0  
**最后更新**: 2026-04-04  
**状态**: ✅ 完成
