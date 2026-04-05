# Supervisor 工具新增：set_task_planned

## 问题背景

在测试中发现，supervisor 工具创建的任务默认状态为 `pending`，但 `start_execution` 要求任务状态必须是 `planned` 或 `planning`。这导致无法直接执行新创建的任务。

## 解决方案

### 1. 新增工具：set_task_planned

已在 `supervisor_tool.py` 中添加新的 action：`set_task_planned`

**使用方法：**
```python
supervisor(action="set_task_planned", task_id="任务 ID")
```

**返回格式：**
```json
{
  "success": true,
  "action": "set_task_planned",
  "taskId": "任务 ID",
  "status": "planned",
  "message": "Task xxx status set to planned"
}
```

### 2. 完整工作流程

现在完整的工作流程是：

1. **创建任务**
   ```python
   supervisor(action="create_task", task_name="任务名称", task_description="任务描述")
   ```
   - 返回：任务 ID，状态为 `pending`

2. **设置任务为 planned**
   ```python
   supervisor(action="set_task_planned", task_id="上一步的任务 ID")
   ```
   - 返回：状态更新为 `planned`

3. **创建子任务**（可选）
   ```python
   supervisor(action="create_subtask", task_id="任务 ID", subtask_name="子任务名称")
   ```

4. **分配子任务**（可选）
   ```python
   supervisor(action="assign_subtask", task_id="任务 ID", subtask_id="子任务 ID", assigned_agent="agent 名称")
   ```

5. **启动执行**
   ```python
   supervisor(action="start_execution", task_id="任务 ID", subtask_ids=["子任务 ID"])
   ```
   - 现在可以成功执行了！

## 代码修改

### 修改的文件

1. **`packages/harness/deerflow/tools/builtins/supervisor_tool.py`**
   - 添加 `set_task_planned` action 的实现
   - 更新文档字符串
   - 更新错误消息中的可用 actions 列表

2. **`packages/harness/deerflow/collab/storage.py`**（已修改但未生效）
   - 修改 `authorize_main_task_execution` 函数
   - 允许 `pending` 状态的任务也被授权
   - `allowed_status = ("planned", "planning", "pending")`

## 测试方法

### 方法 1：在聊天中测试

告诉模型：
> "帮我创建一个任务，然后使用 set_task_planned 工具将状态设为 planned，再启动执行"

模型会自动调用：
1. `supervisor(action="create_task", ...)`
2. `supervisor(action="set_task_planned", task_id="...")`
3. `supervisor(action="start_execution", task_id="...")`

### 方法 2：使用测试脚本

```bash
cd backend
python test_set_task_planned.py
```

## 重启后端服务

**重要**：修改后需要重启后端服务才能生效。

### Windows 方法：

1. **以管理员身份打开 PowerShell**
2. **运行：**
   ```powershell
   cd d:\github\deerflaw
   .\scripts\dev-windows.ps1
   ```

或者：

1. **打开任务管理器** (Ctrl+Shift+Esc)
2. **找到所有 python.exe 进程**
3. **结束任务**
4. **重新运行** `.\scripts\dev-windows.ps1`

## 验证修复

重启后，在聊天中测试：

> "帮我创建一个任务，让他去操作本地写入一个文件，并且在文件中说明自己的 agent name 是什么，让子任务立即执行"

这次应该可以成功执行了！
