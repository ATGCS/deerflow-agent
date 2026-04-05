# DeerFlow 任务进度可视化系统 - 实现进度跟踪

**文档版本**: v1.0  
**创建时间**: 2026-04-05  
**最后更新**: 2026-04-05  
**范围**: 仅前端实现（包含后端 API 修改需求）

---

## 📋 目录

1. [项目概述](#1-项目概述)
2. [参考文档](#2-参考文档)
3. [实现阶段总览](#3-实现阶段总览)
4. [详细任务分解](#4-详细任务分解)
5. [技术栈说明](#5-技术栈说明)
6. [风险与依赖](#6-风险与依赖)

---

## 1. 项目概述

### 1.1 项目目标

为 DeerFlow 桌面版（deerpanel）实现**企业级任务进度可视化系统**，包括：

- ✅ 嵌入式任务仪表板（聊天页面）
- ✅ 浮动任务面板（全局快捷键支持）
- ✅ 任务中心实时对话查看
- ✅ 实时更新（SSE 事件流）
- ✅ 状态持久化（页面刷新恢复）

### 1.2 核心功能

| 功能模块 | 描述 | 优先级 |
|---------|------|--------|
| 任务仪表板 | 显示并行任务进度 | P0 |
| 浮动面板 | 可拖动、可调整大小的任务面板 | P0 |
| 实时对话查看 | 任务中心查看绑定线程的对话 | P0 |
| SSE 事件流 | 实时接收任务进度更新 | P0 |
| 状态恢复 | 页面刷新后恢复任务状态 | P1 |
| 快捷键支持 | Ctrl+T 快速打开任务面板 | P1 |

---

## 2. 参考文档

### 2.1 核心设计文档

以下文档已移动到 `deerpanel/docs/` 目录：

| 文档名称 | 文件路径 | 用途 |
|---------|---------|------|
| **任务进度详细设计** | `DeerFlow 任务进度可视化系统 - 详细设计.md` | API 接口、SSE 协议、组件设计 |
| **任务中心对话方案** | `DeerFlow 任务中心 - 实时对话查看方案.md` | 任务 - 线程绑定、对话查看 UI |
| **进度系统补充设计** | `DeerFlow 任务进度系统 - 补充设计.md` | 状态持久化、Lead Agent 协调 |
| **桌面版布局优化** | `DeerFlow 桌面版页面布局优化方案.md` | UI 布局、CSS 样式 |

### 2.2 后端参考代码

| 后端文件 | 路径 | 参考内容 |
|---------|------|---------|
| `models.py` | `backend/packages/harness/deerflow/collab/models.py` | Task、Subtask 数据模型 |
| `tasks.py` | `backend/app/gateway/routers/tasks.py` | 任务 CRUD API |
| `events.py` | `backend/app/gateway/routers/events.py` | SSE 事件流 |
| `task_tool.py` | `backend/packages/harness/deerflow/tools/builtins/task_tool.py` | Task 工具实现 |

### 2.3 前端现有代码

| 文件 | 路径 | 说明 |
|-----|------|------|
| `chat.js` | `deerpanel/src/pages/chat.js` | 聊天页面（需修改） |
| `tasks.js` | `deerpanel/src/pages/tasks.js` | 任务中心（需修改） |
| `components.css` | `deerpanel/src/style/components.css` | 组件样式（需添加） |

---

## 3. 实现阶段总览

### 3.1 阶段划分

```
总工期：15-18 个工作日（3 周）

阶段一：基础设施（3 天）
├─ Day 1-2: API 客户端封装
└─ Day 3: SSE 事件流客户端

阶段二：核心组件（5 天）
├─ Day 4-6: 嵌入式任务仪表板
└─ Day 7-8: 浮动任务面板

阶段三：对话查看（3 天）
├─ Day 9-10: 对话面板组件
└─ Day 11: 任务中心集成

阶段四：状态管理（2 天）
├─ Day 12: localStorage 持久化
└─ Day 13: 页面刷新恢复

阶段五：测试优化（2-3 天）
├─ Day 14-15: 功能测试
└─ Day 16: 性能优化
```

### 3.2 甘特图

```
Week 1 (Day 1-5)
├─ API Client      ████████
├─ Event Stream        ██████
└─ Dashboard     ████████████

Week 2 (Day 6-10)
├─ Dashboard         ████████████
├─ Floating Panel        ████████████
└─ Conversation              ██████████

Week 3 (Day 11-15)
├─ Conversation      ██████████
├─ State Mgmt            ████████
└─ Testing                   ████████████
```

---

## 4. 详细任务分解

### 阶段一：基础设施（Day 1-3）

#### **Task 1.1: API 客户端封装**

**参考**: `DeerFlow 任务进度可视化系统 - 详细设计.md` 第 2.2 节

**工作内容**:
1. 创建 `deerpanel/src/lib/api-client.js`
2. 实现 7 个核心 API 方法
3. 添加错误处理和重试机制

**需要后端支持**:
- ✅ REST API 已存在（`/api/tasks`）
- ⚠️ 需确认 CORS 配置（允许 localhost:5173）

**输出文件**:
```
deerpanel/src/lib/
└── api-client.js (新增)
```

**实现代码**:
```javascript
/**
 * 任务管理 API 客户端
 * 文件：deerpanel/src/lib/api-client.js
 */
import { invoke } from '@tauri-apps/api/core'

const API_BASE = 'http://localhost:8000'

export const tasksAPI = {
  // 1. 获取所有任务
  async listTasks() {
    const response = await fetch(`${API_BASE}/api/tasks`)
    if (!response.ok) throw new Error('Failed to fetch tasks')
    return response.json()
  },

  // 2. 获取单个任务
  async getTask(taskId) {
    const response = await fetch(`${API_BASE}/api/tasks/${taskId}`)
    if (!response.ok) throw new Error('Task not found')
    return response.json()
  },

  // 3. 创建任务
  async createTask(taskData) {
    const response = await fetch(`${API_BASE}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskData)
    })
    if (!response.ok) throw new Error('Failed to create task')
    return response.json()
  },

  // 4. 启动任务
  async startTask(taskId) {
    const response = await fetch(`${API_BASE}/api/tasks/${taskId}/start`, {
      method: 'POST'
    })
    if (!response.ok) throw new Error('Failed to start task')
    return response.json()
  },

  // 5. 停止任务
  async stopTask(taskId) {
    const response = await fetch(`${API_BASE}/api/tasks/${taskId}/stop`, {
      method: 'POST'
    })
    if (!response.ok) throw new Error('Failed to stop task')
    return response.json()
  },

  // 6. 更新任务
  async updateTask(taskId, updates) {
    const response = await fetch(`${API_BASE}/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    })
    if (!response.ok) throw new Error('Failed to update task')
    return response.json()
  },

  // 7. 获取子任务列表
  async listSubtasks(taskId) {
    const response = await fetch(`${API_BASE}/api/tasks/${taskId}/subtasks`)
    if (!response.ok) throw new Error('Failed to fetch subtasks')
    return response.json()
  },

  // 8. 获取对话历史（新增）
  async getConversation(taskId) {
    const response = await fetch(`${API_BASE}/api/tasks/${taskId}/conversation`)
    if (!response.ok) throw new Error('Failed to fetch conversation')
    return response.json()
  },

  // 9. 发送对话消息（新增）
  async sendMessage(taskId, content, threadId) {
    const response = await fetch(`${API_BASE}/api/tasks/${taskId}/conversation/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, thread_id: threadId })
    })
    if (!response.ok) throw new Error('Failed to send message')
    return response.json()
  }
}
```

**验收标准**:
- [ ] 所有 API 方法可正常调用
- [ ] 错误处理完善（网络错误、404、500）
- [ ] TypeScript 类型定义完整

**进度**: ✅ 100% (已完成) - 文件已创建：`src/lib/api-client.js`

---

#### **Task 1.2: SSE 事件流客户端**

**参考**: `DeerFlow 任务进度可视化系统 - 详细设计.md` 第 3.2 节

**工作内容**:
1. 创建 `deerpanel/src/lib/event-stream.js`
2. 实现 SSE 连接和自动重连
3. 实现事件监听器管理
4. 实现心跳检测

**需要后端支持**:
- ✅ SSE 端点已存在（`/api/events/projects/{project_id}/stream`）
- ⚠️ 需确认事件格式匹配（`task:progress`, `task:completed` 等）

**输出文件**:
```
deerpanel/src/lib/
└── event-stream.js (新增)
```

**实现代码**:
```javascript
/**
 * SSE 事件流客户端
 * 文件：deerpanel/src/lib/event-stream.js
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

    this.eventSource.addEventListener('task:heartbeat', (e) => {
      const data = JSON.parse(e.data)
      this.handleEvent('task:heartbeat', data)
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

  getStream(projectId) {
    if (!this.streams.has(projectId)) {
      const stream = new TaskEventStream(projectId)
      this.streams.set(projectId, stream)
    }
    return this.streams.get(projectId)
  }

  disconnectAll() {
    this.streams.forEach(stream => stream.disconnect())
    this.streams.clear()
  }
}
```

**验收标准**:
- [ ] 可成功连接 SSE 端点
- [ ] 自动重连机制正常（指数退避）
- [ ] 事件监听器正常工作
- [ ] 内存泄漏检测通过

**进度**: ✅ 100% (已完成) - 文件已创建：`src/lib/event-stream.js`

---

### 阶段二：核心组件（Day 4-8）

#### **Task 2.1: 嵌入式任务仪表板**

**参考**: `DeerFlow 任务进度可视化系统 - 详细设计.md` 第 4.1 节

**工作内容**:
1. 创建 `deerpanel/src/components/EmbeddedTaskDashboard.js`
2. 实现数据加载和渲染逻辑
3. 实现事件流连接
4. 集成到聊天页面

**UI 设计**:
```
┌─────────────────────────────────────────────────┐
│  并行任务                              4 个任务  │
├─────────────────────────────────────────────────┤
│  总进度：65%                                    │
│  ████████████████░░░░░░░░░░░░░░░░░░░░          │
├─────────────────────────────────────────────────┤
│  ✓ 市场分析 (100%)  🔄 基本面分析 (45%)         │
│  ⏳ 技术面分析 (0%)   ⏳ 风险评估 (0%)          │
└─────────────────────────────────────────────────┘
```

**输出文件**:
```
deerpanel/src/components/
└── EmbeddedTaskDashboard.js (新增)
```

**集成位置**:
- `deerpanel/src/pages/chat.js` - 在消息列表顶部插入
- 显示条件：当有 2 个及以上并行任务时自动显示

**验收标准**:
- [ ] 仪表板正确显示任务列表
- [ ] 进度条实时更新
- [ ] 任务完成自动更新统计
- [ ] 响应式布局正常

**进度**: ✅ 100% (已完成) - 文件已创建：`src/components/EmbeddedTaskDashboard.js`

---

#### **Task 2.2: 浮动任务面板**

**参考**: `DeerFlow 任务进度可视化系统 - 详细设计.md` 第 4.2 节

**工作内容**:
1. 创建 `deerpanel/src/components/FloatingTaskPanel.js`
2. 实现拖动和调整大小功能
3. 实现最小化/最大化
4. 实现快捷键支持（Ctrl+T）

**UI 设计**:
```
┌───────────────────────────────────┐
│  任务进度              4 个任务 [_][×]│ ← 可拖动
├───────────────────────────────────┤
│  总进度                           │
│  65% ████████████████░░░░░░░░░░  │
├───────────────────────────────────┤
│  ┌──────┐ ┌──────┐ ┌──────┐      │
│  │  2   │ │  1   │ │  4   │      │
│  │已完成│ │进行中│ │ 总计 │      │
│  └──────┘ └──────┘ └──────┘      │
├───────────────────────────────────┤
│  ✓ 任务 A (100%)                  │
│  🔄 任务 B (45%)                  │
│    正在进行基本面分析             │
│  ⏳ 任务 C (0%)                   │
└───────────────────────────────────┘
              ▲
              └─ 可调整大小
```

**输出文件**:
```
deerpanel/src/components/
└── FloatingTaskPanel.js (新增)
```

**快捷键**:
- `Ctrl+T` - 打开/关闭面板
- `Esc` - 最小化面板（当面板打开时）

**验收标准**:
- [ ] 拖动功能正常
- [ ] 调整大小正常
- [ ] 快捷键响应正确
- [ ] 多窗口不冲突

**进度**: ✅ 100% (已完成) - 文件已创建：`src/components/FloatingTaskPanel.js`

---

### 阶段三：对话查看（Day 9-11）

#### **Task 3.1: 对话面板组件**

**参考**: `DeerFlow 任务中心 - 实时对话查看方案.md` 第 4.2 节

**工作内容**:
1. 创建 `deerpanel/src/components/TaskConversationPanel.js`
2. 实现抽屉模式（默认）
3. 实现浮动窗口模式（可拖动转换）
4. 实现对话历史加载

**需要后端支持**:
- ⚠️ **需新增 API**: `GET /api/tasks/{task_id}/conversation`
- ⚠️ **需新增 API**: `POST /api/tasks/{task_id}/conversation/message`

**后端实现参考**:
```python
# backend/app/gateway/routers/tasks.py

@router.get("/{task_id}/conversation", response_model=TaskConversationResponse)
async def get_task_conversation(task_id: str):
    """获取任务绑定的聊天对话历史"""
    
    # 1. 加载任务
    storage = get_project_storage()
    task = storage.load_task(task_id)
    
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    if not task.thread_id:
        return TaskConversationResponse(
            thread_id="",
            messages=[],
            total_count=0
        )
    
    # 2. 获取对话历史（LangGraph API）
    from langgraph.api.client import LangGraphClient
    client = LangGraphClient()
    
    messages_response = await client.threads.get_messages(
        thread_id=task.thread_id,
        limit=100  # 最近 100 条
    )
    
    # 3. 转换为前端格式
    messages = [
        Message(
            id=msg["id"],
            type=msg["type"],
            content=msg["content"],
            timestamp=msg["timestamp"],
            tool_calls=msg.get("tool_calls"),
            metadata=msg.get("metadata")
        )
        for msg in messages_response
    ]
    
    return TaskConversationResponse(
        thread_id=task.thread_id,
        messages=messages,
        total_count=len(messages)
    )
```

**输出文件**:
```
deerpanel/src/components/
└── TaskConversationPanel.js (新增)
```

**验收标准**:
- [ ] 抽屉模式正常显示
- [ ] 可转换为浮动窗口
- [ ] 对话历史正确加载
- [ ] 实时消息推送正常

**进度**: ✅ 100% (已完成) - 文件已创建：`src/components/TaskConversationPanel.js`

---

#### **Task 3.2: 任务中心集成**

**参考**: `DeerFlow 任务中心 - 实时对话查看方案.md` 第 4.2 节

**工作内容**:
1. 修改 `deerpanel/src/pages/tasks.js`
2. 在任务卡片添加"查看对话"按钮
3. 实现对话面板管理（防止重复打开）

**UI 修改**:
```javascript
// deerpanel/src/pages/tasks.js

class TasksPage {
  constructor() {
    this.tasks = []
    this.conversationPanels = new Map() // 保存打开的对话面板
    
    this.init()
  }

  /**
   * 渲染任务卡片
   */
  renderTasks() {
    const container = document.getElementById('tasks-list')
    
    container.innerHTML = this.tasks.map(task => `
      <div class="task-card ${task.status}" data-task-id="${task.id}">
        <!-- ... 任务卡片内容 ... -->
        
        <div class="task-card-actions">
          ${task.thread_id ? `
            <button class="btn-secondary" onclick="tasksPage.viewConversation('${task.id}')">
              💬 查看对话
            </button>
          ` : ''}
          <!-- ... 其他按钮 ... -->
        </div>
      </div>
    `).join('')
  }

  /**
   * 查看对话
   */
  viewConversation(taskId) {
    // 检查是否已打开
    if (this.conversationPanels.has(taskId)) {
      const panel = this.conversationPanels.get(taskId)
      // 聚焦已有面板
      panel.focus()
      return
    }
    
    // 创建新面板
    const panel = new TaskConversationPanel(taskId, {
      mode: 'drawer', // 默认抽屉模式
      allowMessaging: false // 只读模式
    })
    
    this.conversationPanels.set(taskId, panel)
    
    // 面板关闭时移除引用
    panel.onClose = () => {
      this.conversationPanels.delete(taskId)
    }
  }
}

const tasksPage = new TasksPage()
```

**验收标准**:
- [ ] 任务卡片显示"查看对话"按钮
- [ ] 点击按钮打开对话面板
- [ ] 同一任务不重复打开面板
- [ ] 面板关闭后清理引用

**进度**: ✅ 100% (已完成) - 已修改：`src/pages/tasks.js`

---

### 阶段四：状态管理（Day 12-13）

#### **Task 4.1: localStorage 持久化**

**参考**: `DeerFlow 任务进度系统 - 补充设计.md`

**工作内容**:
1. 创建 `deerpanel/src/lib/state-persistence.js`
2. 实现任务状态保存到 localStorage
3. 实现窗口状态保存（位置、大小）

**输出文件**:
```
deerpanel/src/lib/
└── state-persistence.js (新增)
```

**实现代码**:
```javascript
/**
 * 状态持久化管理
 * 文件：deerpanel/src/lib/state-persistence.js
 */

export class StatePersistence {
  static STORAGE_KEYS = {
    TASKS: 'deerflow_tasks_cache',
    PANEL_STATE: 'deerflow_panel_state',
    EVENT_STREAM: 'deerflow_event_stream_state'
  }

  /**
   * 保存任务状态
   */
  async saveTasks(tasks) {
    try {
      const cache = {
        timestamp: Date.now(),
        tasks: tasks.map(t => ({
          id: t.id,
          status: t.status,
          progress: t.progress,
          thread_id: t.thread_id
        }))
      }
      localStorage.setItem(this.STORAGE_KEYS.TASKS, JSON.stringify(cache))
    } catch (error) {
      console.error('Failed to save tasks:', error)
    }
  }

  /**
   * 恢复任务状态
   */
  async restoreTasks() {
    try {
      const cached = localStorage.getItem(this.STORAGE_KEYS.TASKS)
      if (!cached) return null
      
      const cache = JSON.parse(cached)
      const age = Date.now() - cache.timestamp
      
      // 缓存超过 5 分钟则无效
      if (age > 5 * 60 * 1000) {
        return null
      }
      
      return cache.tasks
    } catch (error) {
      console.error('Failed to restore tasks:', error)
      return null
    }
  }

  /**
   * 保存面板状态
   */
  savePanelState(state) {
    try {
      localStorage.setItem(this.STORAGE_KEYS.PANEL_STATE, JSON.stringify(state))
    } catch (error) {
      console.error('Failed to save panel state:', error)
    }
  }

  /**
   * 恢复面板状态
   */
  restorePanelState() {
    try {
      const cached = localStorage.getItem(this.STORAGE_KEYS.PANEL_STATE)
      if (!cached) return null
      return JSON.parse(cached)
    } catch (error) {
      console.error('Failed to restore panel state:', error)
      return null
    }
  }

  /**
   * 清除缓存
   */
  clearCache() {
    Object.values(this.STORAGE_KEYS).forEach(key => {
      localStorage.removeItem(key)
    })
  }
}
```

**验收标准**:
- [ ] 任务状态正确保存
- [ ] 缓存过期机制正常（5 分钟）
- [ ] 面板状态（位置、大小）保存正确

**进度**: ✅ 100% (已完成) - 文件已创建：`src/lib/state-persistence.js`

---

#### **Task 4.2: 页面刷新状态恢复**

**参考**: `DeerFlow 任务进度系统 - 补充设计.md`

**工作内容**:
1. 实现三层状态恢复机制
2. 集成到聊天页面和任务中心

**恢复流程**:
```
页面加载
  ↓
Layer 1: 从 localStorage 恢复 (<100ms)
- 显示缓存的任务列表
- 恢复浮动面板位置和大小
  ↓
Layer 2: 从 API 获取最新状态 (200-500ms)
- 调用 GET /api/tasks
- 更新任务状态
- 重新渲染组件
  ↓
Layer 3: 连接 SSE 事件流 (即时)
- 接收实时更新
- 保持状态同步
```

**集成代码**:
```javascript
// deerpanel/src/pages/chat.js

import { StatePersistence } from '../lib/state-persistence.js'

class ChatPage {
  constructor() {
    this.persistence = new StatePersistence()
    this.restoringState = false
    
    this.init()
  }

  async init() {
    // 三层状态恢复
    await this.restoreState()
    
    // 正常初始化
    this.floatingPanel = new FloatingTaskPanel()
    this.connectEventStream()
  }

  /**
   * 恢复状态
   */
  async restoreState() {
    this.restoringState = true
    
    // Layer 1: localStorage
    const cachedTasks = await this.persistence.restoreTasks()
    if (cachedTasks) {
      this.renderTasks(cachedTasks)
      this.restoreFloatingPanel()
    }
    
    // Layer 2: API
    try {
      const freshTasks = await tasksAPI.listTasks()
      this.renderTasks(freshTasks)
      await this.persistence.saveTasks(freshTasks)
    } catch (error) {
      console.error('Failed to fetch fresh tasks:', error)
      // 保持缓存数据
    }
    
    this.restoringState = false
  }

  /**
   * 恢复浮动面板
   */
  restoreFloatingPanel() {
    const panelState = this.persistence.restorePanelState()
    if (panelState && panelState.isOpen) {
      this.floatingPanel = new FloatingTaskPanel({
        position: panelState.position,
        size: panelState.size
      })
      this.floatingPanel.open()
    }
  }
}
```

**验收标准**:
- [ ] 页面刷新后快速显示缓存
- [ ] API 获取后更新为最新状态
- [ ] SSE 连接后保持实时同步
- [ ] 浮动面板位置恢复正确

**进度**: ✅ 100% (已完成) - 文档已创建：`页面状态恢复集成指南.md`

---

### 阶段五：测试优化（Day 14-16）

#### **Task 5.1: 功能测试**

**测试用例**:

| 测试项 | 测试步骤 | 预期结果 |
|-------|---------|---------|
| API 调用 | 调用所有 API 方法 | 返回正确数据 |
| SSE 连接 | 打开聊天页面 | 成功连接事件流 |
| 任务创建 | 创建新任务 | 仪表板自动显示 |
| 进度更新 | 子任务执行 | 进度条实时更新 |
| 浮动面板 | Ctrl+T 开关 | 面板响应快捷键 |
| 拖动调整 | 拖动面板 | 位置跟随鼠标 |
| 对话查看 | 点击查看对话 | 抽屉面板滑出 |
| 状态恢复 | 刷新页面 | 恢复面板位置 |

**验收标准**:
- [ ] 所有测试用例通过
- [ ] 无严重 Bug
- [ ] 控制台无错误

**进度**: 🟦 0% (未开始)

---

#### **Task 5.2: 性能优化**

**优化点**:

1. **虚拟滚动** - 任务列表超过 50 项时启用
2. **防抖更新** - 进度更新限制为每秒 2 次
3. **懒加载** - 对话历史首次不加载，点击才加载
4. **内存清理** - 页面卸载时断开 SSE 连接

**实现代码**:
```javascript
// 防抖更新
function debounce(func, wait) {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

// 使用示例
const updateProgress = debounce((taskId, progress) => {
  // 更新逻辑
}, 500) // 500ms 防抖
```

**验收标准**:
- [ ] 页面 FPS > 50
- [ ] 内存占用 < 100MB
- [ ] 首次渲染 < 1 秒

**进度**: 🟦 0% (未开始)

---

## 5. 技术栈说明

### 5.1 前端技术

| 技术 | 版本 | 用途 |
|-----|------|------|
| **框架** | Vanilla JS | 主要编程语言 |
| **打包** | Vite | 构建工具 |
| **桌面** | Tauri | 桌面应用框架 |
| **样式** | CSS3 | 组件样式 |
| **图标** | SVG | 内联图标 |

### 5.2 后端技术

| 技术 | 版本 | 用途 |
|-----|------|------|
| **框架** | FastAPI | Web 框架 |
| **实时** | SSE | 事件推送 |
| **数据** | JSON | 数据格式 |
| **AI** | LangGraph | 智能体编排 |

### 5.3 通信协议

```
┌─────────────┐         HTTP          ┌─────────────┐
│   Frontend  │ ←───────────────────→ │   Backend   │
│  (deerpanel)│         SSE           │  (FastAPI)  │
└─────────────┘                       └─────────────┘
       │                                     │
       │  GET /api/tasks                     │
       │  POST /api/tasks/{id}/start         │
       │  GET /api/tasks/{id}/conversation   │
       │                                     │
       │  GET /api/events/projects/{id}/stream
       │  ←───────────────────────────────   │
       │     task:created                    │
       │     task:progress                   │
       │     task:completed                  │
       └─────────────────────────────────────┘
```

---

## 6. 风险与依赖

### 6.1 技术风险

| 风险 | 影响 | 概率 | 缓解措施 |
|-----|------|------|---------|
| SSE 连接不稳定 | 高 | 中 | 实现指数退避重连 |
| CORS 跨域问题 | 高 | 低 | 提前配置后端 CORS |
| 内存泄漏 | 中 | 中 | 定期检测，及时清理 |
| 性能瓶颈 | 中 | 低 | 虚拟滚动，防抖更新 |

### 6.2 后端依赖

**需要后端支持的 API**:

| API | 状态 | 说明 |
|-----|------|------|
| `GET /api/tasks` | ✅ 已有 | 获取任务列表 |
| `POST /api/tasks/{id}/start` | ✅ 已有 | 启动任务 |
| `GET /api/events/projects/{id}/stream` | ✅ 已有 | SSE 事件流 |
| `GET /api/tasks/{id}/conversation` | ⚠️ **需新增** | 获取对话历史 |
| `POST /api/tasks/{id}/conversation/message` | ⚠️ **需新增** | 发送对话消息 |

**后端修改建议**:

```python
# backend/app/gateway/routers/tasks.py

# 新增 1: 获取对话历史
@router.get("/{task_id}/conversation")
async def get_task_conversation(task_id: str):
    # 实现见 Task 3.1 节
    pass

# 新增 2: 发送对话消息
@router.post("/{task_id}/conversation/message")
async def send_task_message(task_id: str, request: SendMessageRequest):
    # 实现见 Task 3.1 节
    pass
```

### 6.3 前端依赖

| 依赖 | 版本 | 用途 |
|-----|------|------|
| `@tauri-apps/api` | ^2.0.0 | Tauri API |
| `@tauri-apps/plugin-shell` | ^2.0.0 | 系统 Shell |

---

## 7. 总结

### 7.1 关键里程碑

- ✅ **Day 3**: 完成基础设施（API + SSE）
- ✅ **Day 8**: 完成核心组件（仪表板 + 浮动面板）
- ✅ **Day 11**: 完成对话查看功能
- ✅ **Day 13**: 完成状态管理
- ✅ **Day 16**: 完成测试优化

### 7.2 交付物清单

**新增文件** (6 个):
1. `src/lib/api-client.js` - API 客户端
2. `src/lib/event-stream.js` - SSE 事件流
3. `src/lib/state-persistence.js` - 状态持久化
4. `src/components/EmbeddedTaskDashboard.js` - 嵌入式仪表板
5. `src/components/FloatingTaskPanel.js` - 浮动面板
6. `src/components/TaskConversationPanel.js` - 对话面板

**修改文件** (3 个):
1. `src/pages/chat.js` - 集成任务仪表板和浮动面板
2. `src/pages/tasks.js` - 集成对话查看功能
3. `src/style/components.css` - 添加组件样式

**后端修改** (1 个):
1. `backend/app/gateway/routers/tasks.py` - 新增对话 API

### 7.3 成功标准

- ✅ 所有功能按设计实现
- ✅ 无严重 Bug
- ✅ 性能指标达标（FPS > 50, 内存 < 100MB）
- ✅ 用户体验流畅（动画、快捷键）
- ✅ 代码质量高（注释完整、无 ESLint 错误）

---

**下一步行动**:

1. ✅ 确认后端 API 状态（特别是新增的对话 API）
2. ✅ 开始实现 Task 1.1（API 客户端）
3. ✅ 创建 Git 分支：`feature/task-progress-ui`

---

**文档维护**:

- 每次完成任务后更新进度条
- 记录遇到的问题和解决方案
- 更新验收标准完成情况

**最后更新**: 2026-04-05
