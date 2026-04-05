# DeerFlow 任务进度可视化系统 - 详细设计方案

## 📋 目录

1. [系统架构概览](#1-系统架构概览)
2. [后端 API 接口详解](#2-后端 api-接口详解)
3. [WebSocket 事件协议](#3-websocket-事件协议)
4. [前端组件设计](#4-前端组件设计)
5. [页面布局与交互流程](#5-页面布局与交互流程)
6. [数据流与状态管理](#6-数据流与状态管理)
7. [实施路线图](#7-实施路线图)

---

## 1. 系统架构概览

### 1.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                     DeerFlow Desktop App                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Frontend (JavaScript + Tauri)                            │  │
│  │  ├─ Chat Page (聊天页面)                                  │  │
│  │  │  ├─ EmbeddedTaskDashboard (嵌入式仪表板)               │  │
│  │  │  └─ FloatingTaskPanel (浮动任务面板)                   │  │
│  │  ├─ Tasks Page (任务中心)                                 │  │
│  │  └─ State Management (状态管理)                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              ↑↓ HTTP + WebSocket                │
└──────────────────────────────┼──────────────────────────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────┐
│                      Backend (FastAPI)                          │
│  ┌─────────────────────────┐ │ ┌────────────────────────────┐   │
│  │  Tasks Router           │ │ │  Events Router (SSE)       │   │
│  │  - GET /api/tasks       │ │ │  - GET /events/stream      │   │
│  │  - POST /api/tasks      │ │ │  - Task Events             │   │
│  │  - PUT /api/tasks/{id}  │ │ │  - Heartbeat               │   │
│  │  - GET /api/tasks/{id}  │ │ │                            │   │
│  └─────────────────────────┘ │ └────────────────────────────┘   │
│                              ↑↓                                   │
│  ┌─────────────────────────┐ │ ┌────────────────────────────┐   │
│  │  Task Storage           │ │ │  Event Broadcaster         │   │
│  │  - projects.json        │ │ │  - SSE Stream              │   │
│  │  - tasks[]              │ │ │  - Observers               │   │
│  │  - subtasks[]           │ │ │                            │   │
│  └─────────────────────────┘ │ └────────────────────────────┘   │
│                              ↑↓                                   │
│  ┌─────────────────────────┐ │ ┌────────────────────────────┐   │
│  │  LangGraph SDK          │ │ │  DeerFlow Harness          │   │
│  │  - Thread Execution     │ │ │  - Task Tool               │   │
│  │  - Subagent Executor    │ │ │  - Worker Profile          │   │
│  └─────────────────────────┘ └ └────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 核心数据模型

基于后端 [`models.py`](backend/packages/harness/deerflow/collab/models.py)：

```typescript
// 前端类型定义（与后端 Pydantic 模型对应）

interface Task {
  id: string;                    // 唯一标识
  name: string;                  // 任务名称
  description: string;           // 任务描述
  status: TaskStatus;            // pending | planning | executing | paused | completed | failed
  parent_id?: string;            // 父任务 ID（子任务）
  dependencies: string[];        // 依赖的子任务 ID 列表
  assigned_to?: string;          // 分配的 Agent ID
  result?: any;                  // 执行结果
  error?: string;                // 错误信息
  progress: number;              // 进度 0-100
  execution_authorized: boolean; // 是否授权执行
  thread_id?: string;            // 绑定的聊天线程 ID
  created_at: string;            // 创建时间 (ISO8601)
  started_at?: string;           // 开始时间
  completed_at?: string;         // 完成时间
}

interface Subtask {
  id: string;
  name: string;
  description: string;
  status: TaskStatus;
  worker_profile?: WorkerProfile;  // 工作者配置
  progress: number;
  assigned_to?: string;
  result?: any;
  dependencies: string[];
}

interface WorkerProfile {
  base_subagent: string;         // 子智能体类型
  model?: string;                // 使用的模型
  instruction?: string;          // 额外指令
  tools?: string[];              // 工具列表
  skills?: string[];             // 技能列表
  depends_on?: string[];         // 依赖关系
}

enum TaskStatus {
  PENDING = "pending",
  PLANNING = "planning",
  PLANNED = "planned",
  EXECUTING = "executing",
  PAUSED = "paused",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled"
}
```

---

## 2. 后端 API 接口详解

### 2.1 RESTful API 接口

基于 [`tasks.py`](backend/app/gateway/routers/tasks.py)：

#### **1. 获取所有任务**

```http
GET /api/tasks
```

**响应格式**：
```json
[
  {
    "id": "abc123",
    "name": "分析特斯拉股票",
    "description": "全面分析特斯拉的投资价值",
    "status": "executing",
    "progress": 65,
    "parent_project_id": "proj_001",
    "project_name": "投资分析项目",
    "thread_id": "thread_456",
    "subtasks": [
      {
        "id": "sub_001",
        "name": "市场分析",
        "status": "completed",
        "progress": 100,
        "worker_profile": {
          "base_subagent": "market_analyst"
        }
      },
      {
        "id": "sub_002",
        "name": "基本面分析",
        "status": "executing",
        "progress": 45,
        "worker_profile": {
          "base_subagent": "fundamentals_analyst"
        }
      }
    ],
    "created_at": "2025-01-15T10:30:00Z",
    "started_at": "2025-01-15T10:31:00Z"
  }
]
```

#### **2. 获取单个任务**

```http
GET /api/tasks/{task_id}
```

**响应格式**：
```json
{
  "id": "abc123",
  "name": "分析特斯拉股票",
  "description": "全面分析特斯拉的投资价值",
  "status": "executing",
  "progress": 65,
  "subtasks": [...],
  "parent_project_id": "proj_001",
  "project_name": "投资分析项目"
}
```

#### **3. 创建任务**

```http
POST /api/tasks
Content-Type: application/json

{
  "name": "分析特斯拉股票",
  "description": "全面分析特斯拉的投资价值",
  "thread_id": "thread_456"  // 可选，绑定聊天线程
}
```

**响应格式**：
```json
{
  "id": "abc123",
  "name": "分析特斯拉股票",
  "status": "pending",
  "progress": 0,
  "created_at": "2025-01-15T10:30:00Z"
}
```

#### **4. 启动任务**

```http
POST /api/tasks/{task_id}/start
```

**响应格式**：
```json
{
  "success": true,
  "message": "Task started planning",
  "task_id": "abc123"
}
```

#### **5. 停止任务**

```http
POST /api/tasks/{task_id}/stop
```

**响应格式**：
```json
{
  "success": true,
  "message": "Task stopped",
  "task_id": "abc123"
}
```

#### **6. 更新任务**

```http
PUT /api/tasks/{task_id}
Content-Type: application/json

{
  "status": "completed",
  "progress": 100,
  "result": "建议买入"
}
```

#### **7. 获取子任务列表**

```http
GET /api/tasks/{task_id}/subtasks
```

**响应格式**：
```json
[
  {
    "id": "sub_001",
    "name": "市场分析",
    "status": "completed",
    "progress": 100,
    "worker_profile": {
      "base_subagent": "market_analyst"
    }
  }
]
```

### 2.2 前端 API 客户端封装

**文件位置**: `deerpanel/src/lib/api-client.js`

```javascript
/**
 * 任务管理 API 客户端
 */
import { invoke } from '@tauri-apps/api/core'

const API_BASE = 'http://localhost:8000'

export const tasksAPI = {
  /**
   * 获取所有任务
   * @returns {Promise<Task[]>}
   */
  async listTasks() {
    const response = await fetch(`${API_BASE}/api/tasks`)
    if (!response.ok) throw new Error('Failed to fetch tasks')
    return response.json()
  },

  /**
   * 获取单个任务
   * @param {string} taskId 
   * @returns {Promise<Task>}
   */
  async getTask(taskId) {
    const response = await fetch(`${API_BASE}/api/tasks/${taskId}`)
    if (!response.ok) throw new Error('Task not found')
    return response.json()
  },

  /**
   * 创建任务
   * @param {Object} taskData 
   * @returns {Promise<Task>}
   */
  async createTask(taskData) {
    const response = await fetch(`${API_BASE}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskData)
    })
    if (!response.ok) throw new Error('Failed to create task')
    return response.json()
  },

  /**
   * 启动任务
   * @param {string} taskId 
   * @returns {Promise<Object>}
   */
  async startTask(taskId) {
    const response = await fetch(`${API_BASE}/api/tasks/${taskId}/start`, {
      method: 'POST'
    })
    if (!response.ok) throw new Error('Failed to start task')
    return response.json()
  },

  /**
   * 停止任务
   * @param {string} taskId 
   * @returns {Promise<Object>}
   */
  async stopTask(taskId) {
    const response = await fetch(`${API_BASE}/api/tasks/${taskId}/stop`, {
      method: 'POST'
    })
    if (!response.ok) throw new Error('Failed to stop task')
    return response.json()
  },

  /**
   * 更新任务
   * @param {string} taskId 
   * @param {Object} updates 
   * @returns {Promise<Task>}
   */
  async updateTask(taskId, updates) {
    const response = await fetch(`${API_BASE}/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    })
    if (!response.ok) throw new Error('Failed to update task')
    return response.json()
  },

  /**
   * 获取子任务列表
   * @param {string} taskId 
   * @returns {Promise<Subtask[]>}
   */
  async listSubtasks(taskId) {
    const response = await fetch(`${API_BASE}/api/tasks/${taskId}/subtasks`)
    if (!response.ok) throw new Error('Failed to fetch subtasks')
    return response.json()
  },

  /**
   * 删除任务
   * @param {string} taskId 
   * @returns {Promise<Object>}
   */
  async deleteTask(taskId) {
    const response = await fetch(`${API_BASE}/api/tasks/${taskId}`, {
      method: 'DELETE'
    })
    if (!response.ok) throw new Error('Failed to delete task')
    return response.json()
  }
}
```

---

## 3. WebSocket 事件协议

### 3.1 SSE 事件流

基于 [`events.py`](backend/app/gateway/routers/events.py)：

**连接方式**：
```http
GET /api/events/projects/{project_id}/stream
Accept: text/event-stream
```

**SSE 事件类型**：

#### **1. 任务创建**

```typescript
{
  type: "task:created",
  project_id: "proj_001",
  data: {
    task: {
      id: "abc123",
      name: "分析特斯拉股票",
      status: "pending",
      progress: 0
    }
  },
  timestamp: "2025-01-15T10:30:00Z"
}
```

#### **2. 任务开始**

```typescript
{
  type: "task:started",
  project_id: "proj_001",
  data: {
    task_id: "abc123",
    agent_id: "agent_001"
  },
  timestamp: "2025-01-15T10:31:00Z"
}
```

#### **3. 任务进度更新**

```typescript
{
  type: "task:progress",
  project_id: "proj_001",
  data: {
    task_id: "abc123",
    progress: 65,
    current_step: "正在进行基本面分析"
  },
  timestamp: "2025-01-15T10:35:00Z"
}
```

#### **4. 任务完成**

```typescript
{
  type: "task:completed",
  project_id: "proj_001",
  data: {
    task_id: "abc123",
    result: "建议买入，目标价$300"
  },
  timestamp: "2025-01-15T10:40:00Z"
}
```

#### **5. 任务失败**

```typescript
{
  type: "task:failed",
  project_id: "proj_001",
  data: {
    task_id: "abc123",
    error: "API 调用超时"
  },
  timestamp: "2025-01-15T10:41:00Z"
}
```

#### **6. 任务心跳**

```typescript
{
  type: "task:heartbeat",
  project_id: "proj_001",
  data: {
    task_id: "abc123",
    agent_id: "agent_001",
    status: "executing",
    progress: 65,
    current_step: "分析财务报表"
  },
  timestamp: "2025-01-15T10:35:00Z"
}
```

### 3.2 前端 SSE 客户端封装

**文件位置**: `deerpanel/src/lib/event-stream.js`

```javascript
/**
 * SSE 事件流客户端
 */
export class TaskEventStream {
  constructor(projectId) {
    this.projectId = projectId
    this.eventSource = null
    this.listeners = new Map()
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 5
    this.reconnectDelay = 1000
  }

  /**
   * 连接事件流
   */
  connect() {
    const url = `http://localhost:8000/api/events/projects/${this.projectId}/stream`
    this.eventSource = new EventSource(url)

    this.eventSource.onopen = () => {
      console.log('Event stream connected')
      this.reconnectAttempts = 0
      this.emit('connected', {})
    }

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        this.handleEvent(data.type, data.data)
      } catch (e) {
        console.error('Failed to parse event:', e)
      }
    }

    this.eventSource.onerror = (error) => {
      console.error('Event stream error:', error)
      this.eventSource.close()
      this.attemptReconnect()
    }

    // 监听特定事件类型
    this.eventSource.addEventListener('task:created', (e) => {
      const data = JSON.parse(e.data)
      this.handleEvent('task:created', data)
    })

    this.eventSource.addEventListener('task:progress', (e) => {
      const data = JSON.parse(e.data)
      this.handleEvent('task:progress', data)
    })

    this.eventSource.addEventListener('task:completed', (e) => {
      const data = JSON.parse(e.data)
      this.handleEvent('task:completed', data)
    })
  }

  /**
   * 处理事件
   */
  handleEvent(eventType, data) {
    if (this.listeners.has(eventType)) {
      this.listeners.get(eventType).forEach(callback => {
        try {
          callback(data)
        } catch (e) {
          console.error(`Error in ${eventType} listener:`, e)
        }
      })
    }
  }

  /**
   * 添加事件监听器
   */
  on(eventType, callback) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, [])
    }
    this.listeners.get(eventType).push(callback)
  }

  /**
   * 移除事件监听器
   */
  off(eventType, callback) {
    if (!this.listeners.has(eventType)) return
    const callbacks = this.listeners.get(eventType)
    const index = callbacks.indexOf(callback)
    if (index > -1) {
      callbacks.splice(index, 1)
    }
  }

  /**
   * 尝试重连
   */
  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached')
      this.emit('disconnected', { reason: 'max_attempts' })
      return
    }

    this.reconnectAttempts++
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)
    
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)
    
    setTimeout(() => {
      this.connect()
    }, delay)
  }

  /**
   * 发射事件
   */
  emit(eventType, data) {
    if (this.listeners.has(eventType)) {
      this.listeners.get(eventType).forEach(callback => callback(data))
    }
  }

  /**
   * 断开连接
   */
  disconnect() {
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
    this.listeners.clear()
  }
}

/**
 * 全局事件流管理器
 */
export class EventStreamManager {
  static instance = null
  streams = new Map()

  static getInstance() {
    if (!EventStreamManager.instance) {
      EventStreamManager.instance = new EventStreamManager()
    }
    return EventStreamManager.instance
  }

  /**
   * 获取或创建项目事件流
   */
  getStream(projectId) {
    if (!this.streams.has(projectId)) {
      const stream = new TaskEventStream(projectId)
      this.streams.set(projectId, stream)
    }
    return this.streams.get(projectId)
  }

  /**
   * 断开所有连接
   */
  disconnectAll() {
    this.streams.forEach(stream => stream.disconnect())
    this.streams.clear()
  }
}
```

---

## 4. 前端组件设计

### 4.1 嵌入式任务仪表板

**文件位置**: `deerpanel/src/components/EmbeddedTaskDashboard.js`

```javascript
/**
 * 嵌入式任务仪表板
 * 显示时机：当有 2 个及以上并行任务时自动显示
 */
import { tasksAPI } from '../lib/api-client.js'
import { EventStreamManager } from '../lib/event-stream.js'

export class EmbeddedTaskDashboard {
  constructor(container, options = {}) {
    this.container = container
    this.options = {
      autoRefresh: true,
      refreshInterval: 5000,
      ...options
    }
    
    this.tasks = []
    this.eventStream = null
    this.refreshTimer = null
    
    this.render()
  }

  /**
   * 加载任务数据
   */
  async loadTasks() {
    try {
      const allTasks = await tasksAPI.listTasks()
      // 筛选执行中的任务
      this.tasks = allTasks.filter(t => 
        t.status === 'executing' || t.status === 'planning'
      )
      this.render()
    } catch (error) {
      console.error('Failed to load tasks:', error)
    }
  }

  /**
   * 连接事件流
   */
  connectEventStream(projectId) {
    if (this.eventStream) {
      this.eventStream.disconnect()
    }

    this.eventStream = EventStreamManager.getInstance().getStream(projectId)
    
    // 监听任务进度更新
    this.eventStream.on('task:progress', (data) => {
      this.updateTaskProgress(data.task_id, data.progress, data.current_step)
    })

    // 监听任务完成
    this.eventStream.on('task:completed', (data) => {
      this.updateTaskStatus(data.task_id, 'completed', data.result)
    })

    // 监听任务失败
    this.eventStream.on('task:failed', (data) => {
      this.updateTaskStatus(data.task_id, 'failed', data.error)
    })

    this.eventStream.connect()
  }

  /**
   * 更新任务进度
   */
  updateTaskProgress(taskId, progress, currentStep) {
    const task = this.tasks.find(t => t.id === taskId)
    if (task) {
      task.progress = progress
      task.current_step = currentStep
      this.render()
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
      this.render()
    }
  }

  /**
   * 渲染组件
   */
  render() {
    if (this.tasks.length < 2) {
      this.container.style.display = 'none'
      return
    }

    this.container.style.display = 'block'
    
    const completedCount = this.tasks.filter(t => t.status === 'completed').length
    const runningCount = this.tasks.filter(t => t.status === 'executing').length
    const totalCount = this.tasks.length
    const overallProgress = totalCount > 0 
      ? Math.round((completedCount / totalCount) * 100) 
      : 0

    this.container.innerHTML = `
      <div class="embedded-task-dashboard">
        <div class="task-dashboard-card">
          <div class="task-dashboard-header">
            <div class="task-dashboard-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <rect x="3" y="3" width="7" height="7" rx="1"/>
                <rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="14" y="14" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/>
              </svg>
              <span>并行任务</span>
              <span class="task-dashboard-badge">${totalCount} 个任务</span>
            </div>
            <div class="task-dashboard-stats">
              <span class="task-stat completed">${completedCount} 完成</span>
              <span class="task-stat running">${runningCount} 进行中</span>
            </div>
          </div>
          
          <div class="task-dashboard-progress">
            <div class="task-progress-bar">
              <div class="task-progress-fill" style="width: ${overallProgress}%"></div>
            </div>
            <span class="task-progress-text">${overallProgress}%</span>
          </div>
          
          <div class="task-dashboard-overview">
            ${this.tasks.map(task => `
              <div class="task-overview-item ${task.status}">
                ${this.getStatusIcon(task.status)}
                <span class="task-overview-label">${this.escapeHtml(task.name)}</span>
                <span class="task-overview-progress">${task.progress}%</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `
  }

  /**
   * 获取状态图标
   */
  getStatusIcon(status) {
    switch(status) {
      case 'completed':
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg>'
      case 'executing':
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" class="animate-spin"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>'
      default:
        return ''
    }
  }

  /**
   * HTML 转义
   */
  escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  /**
   * 销毁组件
   */
  destroy() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
    }
    if (this.eventStream) {
      this.eventStream.disconnect()
    }
  }
}
```

### 4.2 浮动任务面板

**文件位置**: `deerpanel/src/components/FloatingTaskPanel.js`

```javascript
/**
 * 浮动任务面板
 * 特性：可拖动、可调整大小、可最小化、快捷键支持
 */
import { tasksAPI } from '../lib/api-client.js'
import { EventStreamManager } from '../lib/event-stream.js'

export class FloatingTaskPanel {
  constructor() {
    this.panelEl = null
    this.isOpen = false
    this.isMinimized = false
    this.position = { x: 100, y: 100 }
    this.size = { width: 450, height: 550 }
    this.isDragging = false
    this.isResizing = false
    this.dragStart = { x: 0, y: 0 }
    this.tasks = []
    this.eventStream = null
    
    this.init()
  }

  /**
   * 初始化
   */
  init() {
    // 注册快捷键 Ctrl+T
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        e.preventDefault()
        this.toggle()
      }
    })
  }

  /**
   * 打开面板
   */
  async open() {
    if (this.panelEl) {
      this.panelEl.style.display = 'flex'
      this.isOpen = true
      await this.update()
      return
    }

    this.panelEl = document.createElement('div')
    this.panelEl.className = 'floating-task-panel'
    this.panelEl.style.cssText = `
      position: fixed;
      z-index: 9999;
      left: ${this.position.x}px;
      top: ${this.position.y}px;
      width: ${this.size.width}px;
      height: ${this.size.height}px;
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    `

    this.panelEl.innerHTML = this.renderHTML()
    document.body.appendChild(this.panelEl)

    this.setupEvents()
    this.isOpen = true
    await this.update()
  }

  /**
   * 渲染 HTML
   */
  renderHTML() {
    return `
      <div class="task-panel-header">
        <div class="task-panel-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <path d="M9 11l3 3L22 4"/>
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
          </svg>
          <span>任务进度</span>
          <span class="task-panel-badge" id="task-panel-badge">0 个任务</span>
        </div>
        <div class="task-panel-actions">
          <button class="task-panel-btn" id="btn-panel-minimize" title="最小化 (Ctrl+T)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
          <button class="task-panel-btn" id="btn-panel-close" title="关闭 (Ctrl+T)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      
      <div class="task-panel-content">
        <div class="task-overall-progress">
          <div class="task-progress-header">
            <span>总进度</span>
            <span id="task-overall-percent">0%</span>
          </div>
          <div class="task-progress-bar">
            <div class="task-progress-fill" id="task-overall-fill" style="width: 0%"></div>
          </div>
        </div>
        
        <div class="task-stats-grid">
          <div class="task-stat-card completed">
            <div class="task-stat-value" id="task-stat-completed">0</div>
            <div class="task-stat-label">已完成</div>
          </div>
          <div class="task-stat-card running">
            <div class="task-stat-value" id="task-stat-running">0</div>
            <div class="task-stat-label">进行中</div>
          </div>
          <div class="task-stat-card total">
            <div class="task-stat-value" id="task-stat-total">0</div>
            <div class="task-stat-label">总计</div>
          </div>
        </div>
        
        <div class="task-list" id="task-list">
          <div class="task-list-empty">暂无任务</div>
        </div>
      </div>
      
      <div class="task-panel-resize" id="task-panel-resize"></div>
    `
  }

  /**
   * 设置事件监听
   */
  setupEvents() {
    const header = this.panelEl.querySelector('.task-panel-header')
    const closeBtn = this.panelEl.querySelector('#btn-panel-close')
    const minimizeBtn = this.panelEl.querySelector('#btn-panel-minimize')
    const resizeHandle = this.panelEl.querySelector('#task-panel-resize')

    // 拖动
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.task-panel-actions')) return
      this.isDragging = true
      this.dragStart = {
        x: e.clientX - this.position.x,
        y: e.clientY - this.position.y
      }

      const onMouseMove = (e) => {
        if (!this.isDragging) return
        this.position.x = e.clientX - this.dragStart.x
        this.position.y = e.clientY - this.dragStart.y
        this.panelEl.style.left = `${this.position.x}px`
        this.panelEl.style.top = `${this.position.y}px`
      }

      const onMouseUp = () => {
        this.isDragging = false
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
      }

      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    })

    // 关闭
    closeBtn.addEventListener('click', () => this.close())

    // 最小化
    minimizeBtn.addEventListener('click', () => {
      this.isMinimized = !this.isMinimized
      const content = this.panelEl.querySelector('.task-panel-content')
      content.style.display = this.isMinimized ? 'none' : 'block'
      minimizeBtn.innerHTML = this.isMinimized ?
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="8 4 12 8 8 12"/></svg>' :
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="5" y1="12" x2="19" y2="12"/></svg>'
    })

    // 调整大小
    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault()
      this.isResizing = true
      this.dragStart = {
        x: e.clientX,
        y: e.clientY,
        width: this.size.width,
        height: this.size.height
      }

      const onMouseMove = (e) => {
        if (!this.isResizing) return
        const deltaX = e.clientX - this.dragStart.x
        const deltaY = e.clientY - this.dragStart.y
        this.size.width = Math.max(350, this.dragStart.width + deltaX)
        this.size.height = Math.max(400, this.dragStart.height + deltaY)
        this.panelEl.style.width = `${this.size.width}px`
        this.panelEl.style.height = `${this.size.height}px`
      }

      const onMouseUp = () => {
        this.isResizing = false
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
      }

      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    })
  }

  /**
   * 更新面板数据
   */
  async update() {
    if (!this.isOpen) return

    try {
      const allTasks = await tasksAPI.listTasks()
      this.tasks = allTasks.filter(t => 
        t.status === 'executing' || 
        t.status === 'planning' || 
        t.status === 'completed'
      )

      const completedCount = this.tasks.filter(t => t.status === 'completed').length
      const runningCount = this.tasks.filter(t => t.status === 'executing').length
      const totalCount = this.tasks.length
      const overallProgress = totalCount > 0 
        ? Math.round((completedCount / totalCount) * 100) 
        : 0

      // 更新统计
      document.getElementById('task-stat-completed').textContent = completedCount
      document.getElementById('task-stat-running').textContent = runningCount
      document.getElementById('task-stat-total').textContent = totalCount
      document.getElementById('task-overall-percent').textContent = `${overallProgress}%`
      document.getElementById('task-overall-fill').style.width = `${overallProgress}%`
      document.getElementById('task-panel-badge').textContent = `${totalCount} 个任务`

      // 更新任务列表
      const taskListEl = document.getElementById('task-list')
      if (totalCount === 0) {
        taskListEl.innerHTML = '<div class="task-list-empty">暂无任务</div>'
      } else {
        taskListEl.innerHTML = this.tasks.map(task => `
          <div class="task-panel-item ${task.status}">
            <div class="task-item-header">
              ${this.getStatusIcon(task.status)}
              <span class="task-item-title">${this.escapeHtml(task.name)}</span>
            </div>
            <div class="task-item-progress">
              <div class="task-progress-bar">
                <div class="task-progress-fill" style="width: ${task.progress}%"></div>
              </div>
              <span class="task-progress-text">${task.progress}%</span>
            </div>
            ${task.current_step ? `
              <div class="task-item-step">${this.escapeHtml(task.current_step)}</div>
            ` : ''}
          </div>
        `).join('')
      }
    } catch (error) {
      console.error('Failed to update task panel:', error)
    }
  }

  /**
   * 获取状态图标
   */
  getStatusIcon(status) {
    switch(status) {
      case 'completed':
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" class="text-green-500"><polyline points="20 6 9 17 4 12"/></svg>'
      case 'executing':
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" class="animate-spin text-blue-500"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>'
      default:
        return ''
    }
  }

  /**
   * HTML 转义
   */
  escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  /**
   * 关闭面板
   */
  close() {
    if (this.panelEl) {
      this.panelEl.style.display = 'none'
    }
    this.isOpen = false
  }

  /**
   * 切换面板状态
   */
  async toggle() {
    if (this.isOpen) {
      this.close()
    } else {
      await this.open()
    }
  }

  /**
   * 销毁面板
   */
  destroy() {
    if (this.panelEl) {
      this.panelEl.remove()
    }
  }
}
```

---

## 5. 页面布局与交互流程

### 5.1 聊天页面布局

**文件位置**: `deerpanel/src/pages/chat.html`

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>实时聊天 - DeerPanel</title>
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
        <div class="thread-title">
          <h2>会话标题</h2>
        </div>
        <div class="toolbar-actions">
          <button class="btn-icon" id="btn-task-panel" title="任务面板 (Ctrl+T)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
              <path d="M9 11l3 3L22 4"/>
              <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
            </svg>
            <span class="task-badge" id="task-badge" style="display: none;">0</span>
          </button>
        </div>
      </header>

      <!-- 聊天工作区 -->
      <div class="chat-workspace">
        <!-- 消息列表 -->
        <div class="message-list" id="message-list">
          <!-- Human/AI 消息 -->
          <!-- 嵌入式任务仪表板（动态插入） -->
          <!-- 子任务卡片 -->
        </div>

        <!-- 输入区 -->
        <div class="chat-composer">
          <textarea placeholder="输入消息..." id="message-input"></textarea>
          <button class="btn-send">发送</button>
        </div>
      </div>
    </main>
  </div>

  <!-- 浮动任务面板（动态创建） -->

  <script type="module" src="../js/chat.js"></script>
</body>
</html>
```

### 5.2 聊天页面 JavaScript

**文件位置**: `deerpanel/src/pages/chat.js`

```javascript
/**
 * 聊天页面主逻辑
 */
import { tasksAPI } from '../lib/api-client.js'
import { EventStreamManager } from '../lib/event-stream.js'
import { EmbeddedTaskDashboard } from '../components/EmbeddedTaskDashboard.js'
import { FloatingTaskPanel } from '../components/FloatingTaskPanel.js'

class ChatPage {
  constructor() {
    this.threadId = this.getThreadIdFromURL()
    this.messageList = document.getElementById('message-list')
    this.taskPanelBtn = document.getElementById('btn-task-panel')
    this.taskBadge = document.getElementById('task-badge')
    
    this.embeddedDashboard = null
    this.floatingPanel = null
    this.eventStream = null
    this.runningTasks = new Map()
    
    this.init()
  }

  /**
   * 初始化
   */
  async init() {
    // 初始化浮动面板
    this.floatingPanel = new FloatingTaskPanel()
    
    // 绑定任务面板按钮事件
    this.taskPanelBtn.addEventListener('click', () => {
      this.floatingPanel.toggle()
    })
    
    // 加载消息历史
    await this.loadMessages()
    
    // 连接事件流
    this.connectEventStream()
    
    // 启动定时检查
    this.startPeriodicCheck()
  }

  /**
   * 加载消息历史
   */
  async loadMessages() {
    // ... 加载消息逻辑 ...
  }

  /**
   * 连接事件流
   */
  connectEventStream() {
    // 获取当前会话绑定的项目 ID
    const projectId = this.getProjectId()
    
    this.eventStream = EventStreamManager.getInstance().getStream(projectId)
    
    // 监听任务创建
    this.eventStream.on('task:created', (data) => {
      this.handleTaskCreated(data.task)
    })
    
    // 监听任务进度
    this.eventStream.on('task:progress', (data) => {
      this.handleTaskProgress(data.task_id, data.progress, data.current_step)
    })
    
    // 监听任务完成
    this.eventStream.on('task:completed', (data) => {
      this.handleTaskCompleted(data.task_id, data.result)
    })
    
    this.eventStream.connect()
  }

  /**
   * 处理任务创建
   */
  async handleTaskCreated(task) {
    console.log('Task created:', task)
    this.runningTasks.set(task.id, task)
    this.updateTaskBadge()
    
    // 检查是否需要显示嵌入式仪表板
    if (this.runningTasks.size >= 2 && !this.embeddedDashboard) {
      this.showEmbeddedDashboard()
    }
    
    // 如果浮动面板打开，自动刷新
    if (this.floatingPanel.isOpen) {
      await this.floatingPanel.update()
    }
  }

  /**
   * 处理任务进度更新
   */
  async handleTaskProgress(taskId, progress, currentStep) {
    const task = this.runningTasks.get(taskId)
    if (task) {
      task.progress = progress
      task.current_step = currentStep
      
      // 更新嵌入式仪表板
      if (this.embeddedDashboard) {
        this.embeddedDashboard.updateTaskProgress(taskId, progress, currentStep)
      }
      
      // 更新浮动面板
      if (this.floatingPanel.isOpen) {
        await this.floatingPanel.update()
      }
    }
  }

  /**
   * 处理任务完成
   */
  async handleTaskCompleted(taskId, result) {
    const task = this.runningTasks.get(taskId)
    if (task) {
      task.status = 'completed'
      task.result = result
      this.runningTasks.delete(taskId)
      this.updateTaskBadge()
      
      // 更新嵌入式仪表板
      if (this.embeddedDashboard) {
        this.embeddedDashboard.updateTaskStatus(taskId, 'completed', result)
      }
      
      // 更新浮动面板
      if (this.floatingPanel.isOpen) {
        await this.floatingPanel.update()
      }
    }
  }

  /**
   * 显示嵌入式仪表板
   */
  showEmbeddedDashboard() {
    const container = document.createElement('div')
    container.id = 'embedded-dashboard-container'
    
    // 插入到消息列表顶部
    this.messageList.insertBefore(container, this.messageList.firstChild)
    
    this.embeddedDashboard = new EmbeddedTaskDashboard(container, {
      autoRefresh: true,
      refreshInterval: 5000
    })
    
    // 连接事件流
    this.embeddedDashboard.connectEventStream(this.getProjectId())
  }

  /**
   * 更新任务徽章
   */
  updateTaskBadge() {
    const count = this.runningTasks.size
    if (count > 0) {
      this.taskBadge.textContent = count
      this.taskBadge.style.display = 'flex'
    } else {
      this.taskBadge.style.display = 'none'
    }
  }

  /**
   * 启动定时检查
   */
  startPeriodicCheck() {
    setInterval(async () => {
      // 每 5 秒检查一次任务状态
      if (this.floatingPanel.isOpen) {
        await this.floatingPanel.update()
      }
    }, 5000)
  }

  /**
   * 获取项目 ID
   */
  getProjectId() {
    // 从 localStorage 或 API 获取
    return localStorage.getItem(`thread_${this.threadId}_project_id`)
  }

  /**
   * 从 URL 获取线程 ID
   */
  getThreadIdFromURL() {
    const match = window.location.pathname.match(/\/chat\/([^\/]+)/)
    return match ? match[1] : null
  }

  /**
   * 销毁页面
   */
  destroy() {
    if (this.embeddedDashboard) {
      this.embeddedDashboard.destroy()
    }
    if (this.floatingPanel) {
      this.floatingPanel.destroy()
    }
    if (this.eventStream) {
      this.eventStream.disconnect()
    }
  }
}

// 初始化页面
const chatPage = new ChatPage()

// 页面卸载时清理
window.addEventListener('beforeunload', () => {
  chatPage.destroy()
})
```

---

## 6. 数据流与状态管理

### 6.1 数据流图

```
用户操作
  ↓
[Chat Page]
  ↓ 发送消息
[Backend - LangGraph]
  ↓ 创建任务
[Task Storage]
  ↓ 触发事件
[Event Broadcaster]
  ↓ SSE 推送
[EventStream Client]
  ↓ 更新状态
[RunningTasks Map]
  ↓ 触发渲染
[EmbeddedDashboard] + [FloatingTaskPanel]
  ↓ 显示进度
用户可见
```

### 6.2 状态管理

```javascript
/**
 * 全局状态管理
 */
export const appState = {
  // 当前运行中的任务
  runningTasks: new Map(),  // taskId -> Task
  
  // 任务统计
  taskStats: {
    total: 0,
    completed: 0,
    running: 0,
    failed: 0
  },
  
  // 事件流连接状态
  eventStreamConnected: false,
  
  // 浮动面板状态
  floatingPanelOpen: false,
  
  // 嵌入式仪表板状态
  embeddedDashboardVisible: false,
  
  // 更新监听器
  listeners: new Set(),
  
  /**
   * 更新状态
   */
  update(updates) {
    Object.assign(this, updates)
    this.notifyListeners()
  },
  
  /**
   * 添加监听器
   */
  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  },
  
  /**
   * 通知监听器
   */
  notifyListeners() {
    this.listeners.forEach(listener => listener(this))
  }
}
```

---

## 7. 实施路线图

### 阶段一：基础设施（3-4 天）

**Day 1-2: API 客户端**
- [ ] 创建 `api-client.js`
- [ ] 实现所有 REST API 方法
- [ ] 错误处理和重试机制

**Day 3-4: 事件流客户端**
- [ ] 创建 `event-stream.js`
- [ ] 实现 SSE 连接和重连
- [ ] 事件监听器管理

### 阶段二：组件开发（4-5 天）

**Day 5-7: 嵌入式仪表板**
- [ ] 创建 `EmbeddedTaskDashboard.js`
- [ ] 实现数据加载和渲染
- [ ] 连接事件流
- [ ] 集成到聊天页面

**Day 8-9: 浮动任务面板**
- [ ] 创建 `FloatingTaskPanel.js`
- [ ] 实现拖动和调整大小
- [ ] 快捷键支持
- [ ] 数据更新逻辑

### 阶段三：页面集成（2-3 天）

**Day 10: 聊天页面集成**
- [ ] 修改 `chat.html`
- [ ] 修改 `chat.js`
- [ ] 添加任务面板按钮
- [ ] 连接事件流

**Day 11-12: 测试和优化**
- [ ] 功能测试
- [ ] 性能优化
- [ ] 响应式适配
- [ ] 内存泄漏检测

### 阶段四：高级功能（可选，2-3 天）

- [ ] 任务时间线可视化
- [ ] 进度预测算法
- [ ] 历史任务对比
- [ ] 导出任务报告

---

## 8. CSS 样式

**文件位置**: `deerpanel/src/style/components.css`

```css
/* 嵌入式任务仪表板 */
.embedded-task-dashboard {
  margin: 16px 0;
  animation: slideIn 0.3s ease-out;
}

.task-dashboard-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.task-dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.task-dashboard-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
}

.task-dashboard-badge {
  background: var(--bg-tertiary);
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}

.task-dashboard-stats {
  display: flex;
  gap: 12px;
  font-size: 13px;
}

.task-stat.completed { 
  color: var(--success); 
  font-weight: 600;
}

.task-stat.running { 
  color: var(--info); 
  font-weight: 600;
}

.task-dashboard-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.task-progress-bar {
  flex: 1;
  height: 8px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  overflow: hidden;
}

.task-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--info), var(--success));
  transition: width 0.3s ease;
}

.task-progress-text {
  font-size: 13px;
  font-weight: 600;
  min-width: 40px;
  text-align: right;
}

.task-dashboard-overview {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.task-overview-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--bg-tertiary);
  border-radius: 6px;
  font-size: 12px;
  border-left: 3px solid transparent;
}

.task-overview-item.completed { 
  border-left-color: var(--success);
  background: rgba(34, 197, 94, 0.1);
}

.task-overview-item.executing { 
  border-left-color: var(--info);
  background: rgba(59, 130, 246, 0.1);
}

/* 浮动任务面板 */
.floating-task-panel {
  animation: fadeIn 0.2s ease-out;
}

.task-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(168, 85, 247, 0.1));
  border-bottom: 1px solid var(--border-primary);
  cursor: move;
  user-select: none;
}

.task-panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
}

.task-panel-badge {
  background: var(--bg-tertiary);
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}

.task-panel-actions {
  display: flex;
  gap: 4px;
}

.task-panel-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.2s;
}

.task-panel-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.task-panel-content {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
}

.task-overall-progress {
  margin-bottom: 16px;
}

.task-progress-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 500;
}

.task-stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.task-stat-card {
  text-align: center;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 8px;
  border: 1px solid var(--border-primary);
}

.task-stat-value {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 4px;
}

.task-stat-card.completed .task-stat-value { 
  color: var(--success); 
}

.task-stat-card.running .task-stat-value { 
  color: var(--info); 
}

.task-stat-card.total .task-stat-value {
  color: var(--text-primary);
}

.task-stat-label {
  font-size: 12px;
  color: var(--text-tertiary);
}

.task-list {
  max-height: 300px;
  overflow-y: auto;
}

.task-panel-item {
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 6px;
  margin-bottom: 8px;
  border: 1px solid var(--border-primary);
  transition: all 0.2s;
}

.task-panel-item:hover {
  border-color: var(--info);
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.2);
}

.task-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.task-item-title {
  font-size: 13px;
  font-weight: 500;
  flex: 1;
}

.task-item-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.task-item-step {
  font-size: 12px;
  color: var(--text-secondary);
  padding-left: 22px;
}

.task-list-empty {
  text-align: center;
  color: var(--text-tertiary);
  padding: 40px 20px;
  font-size: 14px;
}

.task-panel-resize {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 16px;
  height: 16px;
  cursor: se-resize;
  background: linear-gradient(135deg, transparent 50%, var(--border-primary) 50%);
}

/* 动画 */
@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.animate-spin {
  animation: spin 1s linear infinite;
}

/* 响应式适配 */
@media (max-width: 768px) {
  .floating-task-panel {
    width: 90% !important;
    height: 80% !important;
    left: 5% !important;
    top: 10% !important;
  }
  
  .task-stats-grid {
    grid-template-columns: 1fr;
  }
}
```

---

## 9. 总结

### 核心优势

1. **前后端解耦** - REST API + SSE 事件流，清晰的数据流
2. **实时更新** - 基于 SSE 的推送机制，无需轮询
3. **渐进增强** - 嵌入式 + 浮动面板，灵活组合
4. **性能优化** - 事件驱动更新，避免无效渲染
5. **用户体验** - 快捷键支持、拖动调整、动画流畅

### 技术亮点

- ✅ **完整的 API 封装** - 所有后端接口都有对应的前端方法
- ✅ **SSE 事件流管理** - 自动重连、事件分发、资源清理
- ✅ **组件化设计** - 可复用的仪表板和面板组件
- ✅ **状态同步** - 多组件状态自动同步
- ✅ **响应式设计** - 适配桌面和移动端

通过这套详细的设计方案，DeerFlow 桌面版将具备**企业级**的任务进度可视化和实时监控能力！
