# DeerFlow 任务进度系统 - 补充设计方案

## 📋 目录

1. [聊天页面刷新后的状态恢复](#1-聊天页面刷新后的状态恢复)
2. [Lead Agent 任务协调机制](#2-lead-agent-任务协调机制)
3. [任务管理中心设计](#3-任务管理中心设计)
4. [完整的状态同步流程](#4-完整的状态同步流程)

---

## 1. 聊天页面刷新后的状态恢复

### 1.1 问题场景

**用户操作流程**：
```
1. 用户在聊天中创建任务 → "分析特斯拉股票"
2. Lead Agent 创建 3 个子任务：
   - 市场分析（执行中 45%）
   - 基本面分析（执行中 30%）
   - 新闻分析（待开始）
3. 用户刷新页面 ❓
4. 子任务进度信息是否还在？❓
```

### 1.2 解决方案：三层状态恢复机制

#### **方案架构**

```
┌─────────────────────────────────────────────────────────┐
│                   前端状态恢复流程                        │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  Layer 1: localStorage (即时恢复)                        │
│  - 保存 runningTasks 状态                                │
│  - 保存 eventStream 连接信息                              │
│  - 保存浮动面板状态                                       │
│  恢复时间：< 100ms                                        │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  Layer 2: API 拉取 (完整恢复)                             │
│  - GET /api/tasks?thread_id={threadId}                   │
│  - 获取所有任务及其子任务的最新状态                        │
│  - 恢复 EmbeddedDashboard 和 FloatingTaskPanel           │
│  恢复时间：200-500ms                                      │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  Layer 3: SSE 重连 (实时更新)                             │
│  - 重新连接 /api/events/projects/{projectId}/stream     │
│  - 订阅任务进度事件                                       │
│  - 持续接收实时更新                                       │
│  恢复时间：即时                                           │
└─────────────────────────────────────────────────────────┘
```

### 1.3 实现方案

#### **状态持久化管理器**

**文件位置**: `deerpanel/src/lib/state-persistence.js`

```javascript
/**
 * 状态持久化管理器
 * 负责保存和恢复任务状态
 */
export class StatePersistence {
  constructor(threadId) {
    this.threadId = threadId
    this.storageKey = `deerflow_state_${threadId}`
    this.saveInterval = null
  }

  /**
   * 保存状态到 localStorage
   */
  saveState(state) {
    try {
      const stateToSave = {
        timestamp: Date.now(),
        runningTasks: Array.from(state.runningTasks.entries()),
        taskStats: state.taskStats,
        floatingPanelOpen: state.floatingPanelOpen,
        embeddedDashboardVisible: state.embeddedDashboardVisible,
        eventStreamConnected: state.eventStreamConnected,
        projectId: state.projectId
      }
      
      localStorage.setItem(this.storageKey, JSON.stringify(stateToSave))
    } catch (error) {
      console.error('Failed to save state:', error)
    }
  }

  /**
   * 从 localStorage 恢复状态
   */
  async restoreState() {
    try {
      const saved = localStorage.getItem(this.storageKey)
      if (!saved) return null

      const parsed = JSON.parse(saved)
      
      // 检查缓存是否过期（5 分钟）
      const isExpired = Date.now() - parsed.timestamp > 5 * 60 * 1000
      if (isExpired) {
        console.log('State cache expired, will fetch from API')
        return null
      }

      // 恢复 runningTasks Map
      const runningTasks = new Map(parsed.runningTasks)
      
      return {
        runningTasks,
        taskStats: parsed.taskStats,
        floatingPanelOpen: parsed.floatingPanelOpen,
        embeddedDashboardVisible: parsed.embeddedDashboardVisible,
        eventStreamConnected: false, // 需要重新连接
        projectId: parsed.projectId
      }
    } catch (error) {
      console.error('Failed to restore state:', error)
      return null
    }
  }

  /**
   * 从 API 获取最新状态
   */
  async fetchLatestState() {
    try {
      const response = await fetch(`http://localhost:8000/api/tasks?thread_id=${this.threadId}`)
      if (!response.ok) throw new Error('Failed to fetch tasks')
      
      const tasks = await response.json()
      
      // 筛选执行中的任务
      const runningTasks = new Map(
        tasks
          .filter(t => t.status === 'executing' || t.status === 'planning')
          .map(t => [t.id, t])
      )
      
      const taskStats = {
        total: tasks.length,
        completed: tasks.filter(t => t.status === 'completed').length,
        running: runningTasks.size,
        failed: tasks.filter(t => t.status === 'failed').length
      }
      
      return { runningTasks, taskStats }
    } catch (error) {
      console.error('Failed to fetch latest state:', error)
      return null
    }
  }

  /**
   * 清除保存的状态
   */
  clearState() {
    localStorage.removeItem(this.storageKey)
  }
}
```

#### **增强的聊天页面**

**文件位置**: `deerpanel/src/pages/chat.js` (修改版)

```javascript
import { StatePersistence } from '../lib/state-persistence.js'

class ChatPage {
  constructor() {
    this.threadId = this.getThreadIdFromURL()
    this.statePersistence = new StatePersistence(this.threadId)
    this.isRestoring = false
    
    this.init()
  }

  /**
   * 初始化
   */
  async init() {
    // 1. 尝试从 localStorage 恢复状态
    await this.restoreState()
    
    // 2. 初始化组件
    this.floatingPanel = new FloatingTaskPanel()
    this.setupEventListeners()
    
    // 3. 连接事件流
    this.connectEventStream()
    
    // 4. 启动定时保存
    this.startAutoSave()
  }

  /**
   * 恢复状态
   */
  async restoreState() {
    this.isRestoring = true
    
    // Layer 1: 从 localStorage 快速恢复
    const savedState = await this.statePersistence.restoreState()
    if (savedState) {
      console.log('Restored state from localStorage')
      this.runningTasks = savedState.runningTasks
      this.taskStats = savedState.taskStats
      
      // 恢复 UI 状态
      if (savedState.floatingPanelOpen) {
        this.floatingPanel.open()
      }
      
      if (savedState.embeddedDashboardVisible && this.runningTasks.size >= 2) {
        this.showEmbeddedDashboard()
      }
      
      this.updateTaskBadge()
    }
    
    // Layer 2: 从 API 获取最新状态
    const latestState = await this.statePersistence.fetchLatestState()
    if (latestState) {
      console.log('Fetched latest state from API')
      this.runningTasks = latestState.runningTasks
      this.taskStats = latestState.taskStats
      
      // 更新 UI
      if (this.floatingPanel.isOpen) {
        await this.floatingPanel.update()
      }
      
      if (this.embeddedDashboard) {
        this.embeddedDashboard.loadTasks()
      }
    }
    
    this.isRestoring = false
  }

  /**
   * 启动自动保存
   */
  startAutoSave() {
    // 每 5 秒保存一次状态
    this.saveTimer = setInterval(() => {
      if (!this.isRestoring) {
        this.statePersistence.saveState({
          runningTasks: this.runningTasks,
          taskStats: this.taskStats,
          floatingPanelOpen: this.floatingPanel.isOpen,
          embeddedDashboardVisible: this.embeddedDashboard !== null,
          eventStreamConnected: this.eventStream?.eventSource?.readyState === WebSocket.OPEN,
          projectId: this.getProjectId()
        })
      }
    }, 5000)
  }

  /**
   * 处理任务进度更新
   */
  async handleTaskProgress(taskId, progress, currentStep) {
    const task = this.runningTasks.get(taskId)
    if (task) {
      task.progress = progress
      task.current_step = currentStep
      
      // 立即保存到 localStorage
      this.statePersistence.saveState({
        runningTasks: this.runningTasks,
        taskStats: this.taskStats,
        floatingPanelOpen: this.floatingPanel.isOpen,
        embeddedDashboardVisible: this.embeddedDashboard !== null,
        eventStreamConnected: true,
        projectId: this.getProjectId()
      })
      
      // 更新 UI
      if (this.embeddedDashboard) {
        this.embeddedDashboard.updateTaskProgress(taskId, progress, currentStep)
      }
      
      if (this.floatingPanel.isOpen) {
        await this.floatingPanel.update()
      }
    }
  }

  /**
   * 页面卸载
   */
  destroy() {
    if (this.saveTimer) {
      clearInterval(this.saveTimer)
    }
    // ... 其他清理逻辑 ...
  }
}
```

### 1.4 状态恢复流程图

```
用户刷新页面
  ↓
ChatPage 初始化
  ↓
┌─────────────────────────────────┐
│ StatePersistence.restoreState() │
│ - 读取 localStorage             │
│ - 检查是否过期 (<5 分钟)          │
│ - 恢复 runningTasks Map         │
└─────────────────────────────────┘
  ↓
恢复 UI 状态
- 浮动面板（如之前打开）
- 嵌入式仪表板（如≥2 任务）
- 任务徽章计数
  ↓
┌─────────────────────────────────┐
│ StatePersistence.fetchLatestState() │
│ - GET /api/tasks?thread_id=xxx      │
│ - 获取最新任务状态                   │
│ - 更新 runningTasks                 │
└─────────────────────────────────┘
  ↓
更新 UI 组件
- EmbeddedDashboard.refresh()
- FloatingTaskPanel.update()
  ↓
┌─────────────────────────────────┐
│ EventStream.connect()           │
│ - 重新连接 SSE                   │
│ - 订阅任务事件                   │
│ - 开始接收实时更新               │
└─────────────────────────────────┘
  ↓
状态恢复完成
用户看到完整的任务进度信息
```

---

## 2. Lead Agent 任务协调机制

### 2.1 Lead Agent 的核心职责

基于 [`agent.py`](backend/packages/harness/deerflow/agents/lead_agent/agent.py) 分析：

**Lead Agent 职责**：
1. **任务规划** - 分析用户需求，创建子任务计划
2. **子任务分配** - 为每个子任务分配合适的子智能体
3. **进度收集** - 接收子任务的进度更新
4. **状态汇总** - 汇总所有子任务状态，更新主任务进度
5. **线程绑定** - 与聊天线程绑定，保持上下文连续性

### 2.2 任务规划流程

```
用户请求："分析特斯拉股票"
  ↓
Lead Agent 接收请求
  ↓
【阶段 1: 任务规划】
1. 分析任务复杂度
2. 确定需要的子任务
3. 创建子任务列表
   - 市场分析 → market_analyst
   - 基本面分析 → fundamentals_analyst
   - 新闻分析 → news_analyst
  ↓
【阶段 2: 子任务分配】
1. 为每个子任务创建 WorkerProfile
2. 配置工具、技能、模型
3. 设置依赖关系
  ↓
【阶段 3: 任务执行】
1. 并行启动子任务（最多 3 个）
2. 监控子任务进度
3. 收集子任务结果
  ↓
【阶段 4: 进度汇总】
1. 计算总体进度 = 已完成子任务 / 总子任务数
2. 更新主任务状态和进度
3. 触发 SSE 事件推送
  ↓
【阶段 5: 结果整合】
1. 整合所有子任务报告
2. 生成最终投资建议
3. 更新任务状态为 completed
```

### 2.3 Lead Agent 实现逻辑

**文件位置**: `backend/packages/harness/deerflow/agents/lead_agent/agent.py`

```python
class LeadAgent:
    """Lead Agent - 任务协调器"""
    
    async def execute(self, task_id: str, thread_id: str):
        """执行任务协调"""
        
        # 1. 加载任务
        storage = get_project_storage()
        task = await storage.load_task(task_id)
        
        # 2. 任务规划（如未规划）
        if not task.subtasks:
            task.subtasks = await self._plan_task(task)
            await storage.save_task(task)
        
        # 3. 分配子任务
        for subtask in task.subtasks:
            worker_profile = self._create_worker_profile(subtask)
            subtask.worker_profile = worker_profile
        
        # 4. 启动子任务执行
        execution_tasks = []
        for subtask in task.subtasks:
            exec_task = asyncio.create_task(
                self._execute_subtask(subtask, thread_id)
            )
            execution_tasks.append(exec_task)
        
        # 5. 监控进度
        completed = 0
        for future in asyncio.as_completed(execution_tasks):
            result = await future
            completed += 1
            
            # 更新主任务进度
            progress = int((completed / len(task.subtasks)) * 100)
            await self._update_task_progress(task_id, progress)
            
            # 发送 SSE 事件
            await emit_task_progress(
                task.project_id,
                task_id,
                progress,
                f"已完成 {completed}/{len(task.subtasks)} 个子任务"
            )
        
        # 6. 整合结果
        final_result = self._aggregate_results(execution_tasks)
        await self._complete_task(task_id, final_result)
    
    async def _execute_subtask(self, subtask, thread_id):
        """执行子任务"""
        
        # 1. 创建子智能体执行器
        executor = SubagentExecutor(
            worker_profile=subtask.worker_profile,
            thread_id=thread_id
        )
        
        # 2. 执行子任务
        result = await executor.execute(subtask.description)
        
        # 3. 更新子任务状态
        subtask.status = 'completed'
        subtask.result = result
        subtask.progress = 100
        
        # 4. 发送子任务完成事件
        await emit_subtask_completed(subtask.id, result)
        
        return result
    
    def _aggregate_results(self, results):
        """整合子任务结果"""
        # 汇总所有子任务的报告
        # 生成综合分析结论
        pass
```

### 2.4 进度收集机制

```python
# 子任务进度上报
class SubagentExecutor:
    async def execute(self, description):
        # 执行过程中定期上报进度
        for progress_update in self._stream_progress():
            # 更新子任务进度
            await self._update_progress(progress_update)
            
            # 触发父任务进度更新
            await self._notify_parent_progress(progress_update)
    
    async def _notify_parent_progress(self, progress):
        """通知父任务进度更新"""
        await emit_task_progress(
            project_id=self.project_id,
            task_id=self.parent_task_id,
            progress=self.calculate_overall_progress(),
            current_step=self.current_step
        )
```

---

## 3. 任务管理中心设计

### 3.1 任务中心 vs 聊天中的任务

| 维度 | 聊天中的任务 | 任务管理中心 |
|------|------------|------------|
| **入口** | 用户发送消息触发 | 独立页面 `/tasks` |
| **Lead Agent 角色** | 协调子任务执行 | 任务规划 + 进度监控 |
| **显示内容** | 当前会话的任务 | 所有任务（跨会话） |
| **操作** | 查看进度、发送消息 | 启动/暂停/删除/批量操作 |
| **实时更新** | SSE 推送 | SSE 推送 + 定时轮询 |
| **使用场景** | 对话中自然创建任务 | 主动管理任务 |

### 3.2 任务管理中心页面

**文件位置**: `deerpanel/src/pages/tasks.html`

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>任务中心 - DeerPanel</title>
  <link rel="stylesheet" href="../style/main.css">
</head>
<body>
  <div class="app-container">
    <!-- 左侧边栏 -->
    <aside class="sidebar" id="sidebar">
      <!-- ... 导航菜单 ... -->
    </aside>

    <!-- 主内容区 -->
    <main class="main-content">
      <!-- 顶部工具栏 -->
      <header class="top-bar">
        <h1>任务中心</h1>
        <div class="toolbar-actions">
          <button class="btn-primary" id="btn-new-task">新建任务</button>
          <button class="btn-icon" id="btn-batch-ops" disabled>批量操作</button>
          <button class="btn-icon" id="btn-refresh">刷新</button>
        </div>
      </header>

      <!-- 批量操作工具栏 -->
      <div class="batch-toolbar" id="batch-toolbar" style="display: none;">
        <span class="selected-count">已选择 <span id="selected-count">0</span> 项</span>
        <button class="btn-action" id="btn-batch-start">批量启动</button>
        <button class="btn-action" id="btn-batch-pause">批量暂停</button>
        <button class="btn-action" id="btn-batch-delete">批量删除</button>
        <button class="btn-secondary" id="btn-cancel-selection">取消选择</button>
      </div>

      <!-- 任务列表 -->
      <div class="tasks-container">
        <!-- 搜索和筛选 -->
        <div class="tasks-filters">
          <input type="text" class="search-input" placeholder="搜索任务..." id="task-search">
          <select class="filter-select" id="status-filter">
            <option value="all">全部状态</option>
            <option value="executing">执行中</option>
            <option value="completed">已完成</option>
            <option value="failed">失败</option>
          </select>
        </div>

        <!-- 任务卡片列表 -->
        <div class="tasks-list" id="tasks-list">
          <!-- 任务卡片由 JavaScript 动态生成 -->
        </div>
      </div>
    </main>
  </div>

  <script type="module" src="../js/tasks.js"></script>
</body>
</html>
```

### 3.3 任务中心 JavaScript

**文件位置**: `deerpanel/src/pages/tasks.js`

```javascript
/**
 * 任务中心页面
 */
import { tasksAPI } from '../lib/api-client.js'
import { EventStreamManager } from '../lib/event-stream.js'

class TasksPage {
  constructor() {
    this.tasks = []
    this.selectedTasks = new Set()
    this.eventStreams = new Map()
    
    this.init()
  }

  /**
   * 初始化
   */
  async init() {
    this.setupEventListeners()
    await this.loadTasks()
    this.connectEventStreams()
    this.startAutoRefresh()
  }

  /**
   * 加载任务列表
   */
  async loadTasks() {
    try {
      this.tasks = await tasksAPI.listTasks()
      this.renderTasks()
    } catch (error) {
      console.error('Failed to load tasks:', error)
    }
  }

  /**
   * 连接所有项目的事件流
   */
  connectEventStreams() {
    // 按项目分组连接事件流
    const projectIds = new Set(this.tasks.map(t => t.parent_project_id))
    
    projectIds.forEach(projectId => {
      const eventStream = EventStreamManager.getInstance().getStream(projectId)
      
      // 监听任务创建
      eventStream.on('task:created', (data) => {
        this.tasks.unshift(data.task)
        this.renderTasks()
      })
      
      // 监听任务进度
      eventStream.on('task:progress', (data) => {
        this.updateTaskProgress(data.task_id, data.progress, data.current_step)
      })
      
      // 监听任务完成
      eventStream.on('task:completed', (data) => {
        this.updateTaskStatus(data.task_id, 'completed', data.result)
      })
      
      eventStream.connect()
      this.eventStreams.set(projectId, eventStream)
    })
  }

  /**
   * 渲染任务列表
   */
  renderTasks() {
    const container = document.getElementById('tasks-list')
    
    if (this.tasks.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>暂无任务</p>
          <button class="btn-primary" onclick="tasksPage.createNewTask()">新建任务</button>
        </div>
      `
      return
    }

    container.innerHTML = this.tasks.map(task => `
      <div class="task-card ${task.status}" data-task-id="${task.id}">
        <div class="task-card-header">
          <div class="task-checkbox">
            <input type="checkbox" 
                   ${this.selectedTasks.has(task.id) ? 'checked' : ''}
                   onchange="tasksPage.toggleTaskSelection('${task.id}')">
          </div>
          <div class="task-info">
            <h3 class="task-name">${this.escapeHtml(task.name)}</h3>
            <p class="task-description">${this.escapeHtml(task.description)}</p>
            <div class="task-meta">
              <span class="task-project">项目：${task.project_name}</span>
              <span class="task-created">创建：${new Date(task.created_at).toLocaleString()}</span>
            </div>
          </div>
          <div class="task-status-badge ${task.status}">
            ${this.getStatusText(task.status)}
          </div>
        </div>
        
        <div class="task-card-body">
          <!-- 进度条 -->
          <div class="task-progress">
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${task.progress}%"></div>
            </div>
            <span class="progress-text">${task.progress}%</span>
          </div>
          
          <!-- 子任务列表 -->
          ${task.subtasks && task.subtasks.length > 0 ? `
            <div class="subtasks-list">
              <div class="subtasks-header">
                <span>子任务 (${task.subtasks.length})</span>
                <span class="subtasks-stats">
                  ${task.subtasks.filter(s => s.status === 'completed').length} 完成
                </span>
              </div>
              <div class="subtasks-items">
                ${task.subtasks.map(subtask => `
                  <div class="subtask-item ${subtask.status}">
                    <span class="subtask-name">${this.escapeHtml(subtask.name)}</span>
                    <span class="subtask-progress">${subtask.progress}%</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
        
        <div class="task-card-actions">
          ${task.status === 'pending' || task.status === 'paused' ? `
            <button class="btn-action" onclick="tasksPage.startTask('${task.id}')">启动</button>
          ` : ''}
          ${task.status === 'executing' ? `
            <button class="btn-action" onclick="tasksPage.pauseTask('${task.id}')">暂停</button>
          ` : ''}
          <button class="btn-secondary" onclick="tasksPage.viewTaskDetails('${task.id}')">详情</button>
          <button class="btn-danger" onclick="tasksPage.deleteTask('${task.id}')">删除</button>
        </div>
      </div>
    `).join('')
  }

  /**
   * 更新任务进度
   */
  updateTaskProgress(taskId, progress, currentStep) {
    const task = this.tasks.find(t => t.id === taskId)
    if (task) {
      task.progress = progress
      task.current_step = currentStep
      this.renderTasks()
    }
  }

  /**
   * 更新任务状态
   */
  updateTaskStatus(taskId, status, result) {
    const task = this.tasks.find(t => t.id === taskId)
    if (task) {
      task.status = status
      if (result) task.result = result
      this.renderTasks()
    }
  }

  /**
   * 启动任务
   */
  async startTask(taskId) {
    try {
      await tasksAPI.startTask(taskId)
      await this.loadTasks()
    } catch (error) {
      console.error('Failed to start task:', error)
      alert('启动任务失败：' + error.message)
    }
  }

  /**
   * 暂停任务
   */
  async pauseTask(taskId) {
    try {
      await tasksAPI.stopTask(taskId)
      await this.loadTasks()
    } catch (error) {
      console.error('Failed to pause task:', error)
      alert('暂停任务失败：' + error.message)
    }
  }

  /**
   * 删除任务
   */
  async deleteTask(taskId) {
    if (!confirm('确定要删除这个任务吗？')) return
    
    try {
      await tasksAPI.deleteTask(taskId)
      await this.loadTasks()
    } catch (error) {
      console.error('Failed to delete task:', error)
      alert('删除任务失败：' + error.message)
    }
  }

  /**
   * 批量操作
   */
  batchStart() {
    this.selectedTasks.forEach(taskId => {
      tasksAPI.startTask(taskId)
    })
  }

  batchPause() {
    this.selectedTasks.forEach(taskId => {
      tasksAPI.stopTask(taskId)
    })
  }

  batchDelete() {
    if (!confirm(`确定要删除选中的 ${this.selectedTasks.size} 个任务吗？`)) return
    
    this.selectedTasks.forEach(taskId => {
      tasksAPI.deleteTask(taskId)
    })
  }

  /**
   * 自动刷新
   */
  startAutoRefresh() {
    // 每 10 秒刷新一次任务列表
    setInterval(() => {
      this.loadTasks()
    }, 10000)
  }

  escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  getStatusText(status) {
    const statusMap = {
      pending: '待开始',
      planning: '规划中',
      executing: '执行中',
      paused: '已暂停',
      completed: '已完成',
      failed: '失败'
    }
    return statusMap[status] || status
  }
}

// 初始化页面
const tasksPage = new TasksPage()
```

---

## 4. 完整的状态同步流程

### 4.1 端到端数据流

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户操作                                  │
│  - 聊天中创建任务 或  - 任务中心启动任务                          │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Lead Agent 协调                               │
│  1. 接收任务请求                                                 │
│  2. 创建子任务计划                                               │
│  3. 分配 Worker Profile                                          │
│  4. 启动子任务执行                                               │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│                   子任务执行                                     │
│  - SubagentExecutor 执行具体任务                                 │
│  - 定期上报进度 (progress, current_step)                         │
│  - 完成后返回结果                                                │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│                 进度收集和汇总                                   │
│  1. Lead Agent 收集子任务进度                                     │
│  2. 计算总体进度 = 已完成子任务 / 总子任务数                       │
│  3. 更新主任务状态和进度                                         │
│  4. 保存到 Task Storage                                          │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│                  SSE 事件推送                                     │
│  Event Broadcaster 广播事件：                                    │
│  - task:progress {task_id, progress, current_step}              │
│  - task:completed {task_id, result}                             │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│                前端接收事件                                       │
│  - Chat Page (EmbeddedDashboard + FloatingTaskPanel)            │
│  - Tasks Page (任务卡片列表)                                     │
│  - 状态持久化到 localStorage                                    │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│                   UI 实时更新                                    │
│  - 进度条更新                                                    │
│  - 状态徽章变化                                                  │
│  - 子任务列表刷新                                                │
│  - 统计数据重新计算                                              │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 关键数据一致性保证

| 场景 | 保证机制 | 恢复时间 |
|------|---------|---------|
| **页面刷新** | localStorage + API 拉取 | < 500ms |
| **网络中断** | SSE 自动重连（指数退避） | 1-30s |
| **多标签页** | 共享 EventStream，状态同步 | 即时 |
| **后端重启** | 任务状态持久化，重启后恢复 | 即时 |

### 4.3 Lead Agent 在不同场景下的行为

#### **场景 A：聊天中创建任务**

```
用户："分析特斯拉股票"
  ↓
Lead Agent (在当前聊天线程中)
  ├─ 创建主任务
  ├─ 规划子任务
  ├─ 分配子智能体
  └─ 执行并监控
  ↓
实时更新到当前聊天界面
```

#### **场景 B：任务中心启动任务**

```
用户点击"启动任务"按钮
  ↓
Lead Agent (独立于聊天线程)
  ├─ 加载任务配置
  ├─ 创建临时聊天线程（用于执行）
  ├─ 绑定 thread_id 到任务
  ├─ 执行任务规划
  └─ 监控进度
  ↓
更新到任务中心 + 可选的通知
```

---

## 5. 总结

### 核心优势

1. **三层状态恢复** - localStorage + API + SSE，确保刷新后状态完整
2. **Lead Agent 统一协调** - 无论在聊天还是任务中心，Lead Agent 都负责规划、分配、监控
3. **实时双向同步** - 前端 ↔ 后端通过 SSE 保持实时同步
4. **批量操作支持** - 任务中心支持批量启动/暂停/删除

### 技术亮点

- ✅ **状态持久化** - 每 5 秒自动保存，刷新不丢失
- ✅ **智能恢复** - 优先从缓存恢复，后台从 API 获取最新
- ✅ **Lead Agent 协调** - 统一的子任务管理和进度汇总
- ✅ **多入口支持** - 聊天和任务中心都能管理任务
- ✅ **批量操作** - 任务中心支持高效批量管理

通过这套补充设计，DeerFlow 将具备**完整的多场景任务管理能力**和**可靠的状态同步机制**！
