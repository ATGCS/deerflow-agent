# Lead Agent 提示词更新 - 添加 set_task_planned 工具

## 更新内容

已在 Lead Agent 的系统提示词中添加 `set_task_planned` 工具的说明和使用示例。

## 修改位置

**文件**：`backend/packages/harness/deerflow/agents/lead_agent/prompt.py`

**章节**：`<supervisor_system>` 部分

## 新增内容

### 1. 工具列表中添加

```markdown
7. **设置任务状态为 planned（启动执行前必需）：**
   `supervisor(action="set_task_planned", task_id="ID")`  
   **重要**：新创建的任务状态为 `pending`，必须先用此操作将状态改为 `planned`，然后才能调用 `start_execution`

10. **启动任务执行：**
    `supervisor(action="start_execution", task_id="ID", subtask_ids=["SubID1", "SubID2"], authorized_by="user")`  
    **前提条件**：任务状态必须是 `planned` 或 `planning`，如果是 `pending` 状态会失败
```

### 2. 工作流示例更新

完整的工作流示例现在包含 8 个步骤：

```markdown
# 步骤 1：创建主任务
supervisor(action="create_task", task_name="竞品分析报告", task_description="...")
# 注意：任务创建后状态为 pending

# 步骤 2：设置任务状态为 planned（启动执行前必需）
supervisor(action="set_task_planned", task_id="abc123")
# 现在任务状态已改为 planned，可以启动执行了

# 步骤 3：列出子任务以避免重复
supervisor(action="list_subtasks", task_id="abc123")

# 步骤 4：添加子任务
supervisor(action="create_subtask", ...)

# 步骤 5：分配子任务
supervisor(action="assign_subtask", ...)

# 步骤 6：启动任务执行
supervisor(action="start_execution", task_id="abc123", subtask_ids=[...], authorized_by="user")

# 步骤 7：告知用户
"好的！我已将任务拆解为 4 个子任务，正在分配给合适的 Agent 执行..."

# 步骤 8：更新用户进度
"子任务 1「搜索竞品信息」已完成，正在进行子任务 2..."
```

## 完整工作流程

现在 Lead Agent 会按照以下完整流程执行任务：

1. **创建任务** → 状态：`pending`
2. **设置状态为 planned** → 状态：`planned` ✅
3. **创建子任务** → 添加子任务列表
4. **分配子任务** → 分配给合适的 agent
5. **启动执行** → 开始执行子任务（前提：状态必须是 planned）
6. **监控进度** → 更新用户进度
7. **完成任务** → 所有子任务完成

## 关键改进

### 修改前的问题
- 任务创建后状态为 `pending`
- 直接调用 `start_execution` 会失败
- Lead Agent 不知道如何转换状态
- 无法完成"创建→执行"的完整流程

### 修改后的解决方案
- ✅ 明确告知 Lead Agent 需要调用 `set_task_planned`
- ✅ 说明状态转换的必要性（pending → planned）
- ✅ 提供完整的工作流示例
- ✅ 强调启动执行的前提条件

## 测试方法

重启后端服务后，在聊天中测试：

**"帮我创建一个任务，让他去操作本地写入一个文件，并且在文件中说明自己的 agent name 是什么，让子任务立即执行"**

Lead Agent 现在应该能够：
1. 创建任务
2. **自动调用 `set_task_planned` 将状态改为 planned**
3. 创建子任务
4. 分配子任务
5. 启动执行
6. 完成整个流程

## 相关文件

已修改的文件：
- `backend/packages/harness/deerflow/agents/lead_agent/prompt.py`
- `backend/packages/harness/deerflow/tools/builtins/supervisor_tool.py` (添加 set_task_planned 实现)
- `backend/packages/harness/deerflow/collab/storage.py` (允许 pending 状态授权 - 备用方案)

## 预期行为

Lead Agent 在收到创建并执行任务的请求时，会自动按照以下顺序调用工具：

1. `supervisor(action="create_task", ...)`
2. `supervisor(action="set_task_planned", task_id="...")` ← **新增的关键步骤**
3. `supervisor(action="create_subtask", ...)`
4. `supervisor(action="assign_subtask", ...)`
5. `supervisor(action="start_execution", ...)`

所有工具返回现在都是结构化 JSON 格式，便于前端解析和展示。
