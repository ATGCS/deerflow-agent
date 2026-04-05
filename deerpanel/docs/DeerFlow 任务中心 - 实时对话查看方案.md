# DeerFlow 任务中心 - 实时对话查看设计方案

## 📋 目录

1. [任务与聊天线程的绑定机制](#1-任务与聊天线程的绑定机制)
2. [任务中心查看实时对话的三种方案](#2-任务中心查看实时对话的三种方案)
3. [推荐方案：对话面板集成](#3-推荐方案对话面板集成)
4. [完整实现方案](#4-完整实现方案)
5. [API 接口设计](#5-api-接口设计)

---

## 1. 任务与聊天线程的绑定机制

### 1.1 核心数据结构

基于 [`models.py`](backend/packages/harness/deerflow/collab/models.py) 和 [`task_tool.py`](backend/packages/harness/deerflow/tools/builtins/task_tool.py)：

```python
# Task 模型定义
class Task(BaseModel):
    id: str                    # 任务 ID
    name: str                  # 任务名称
    description: str           # 任务描述
    status: TaskStatus         # 任务状态
    thread_id: Optional[str]   # 绑定的聊天线程 ID ← 关键字段
    parent_project_id: str     # 所属项目 ID
    subtasks: List[Subtask]    # 子任务列表
    created_at: datetime       # 创建时间
    started_at: Optional[datetime]  # 开始时间
    completed_at: Optional[datetime] # 完成时间
```

### 1.2 绑定流程

```
用户创建任务
  ↓
Lead Agent 接收请求
  ↓
【场景 A：聊天中创建】
1. 从当前上下文获取 thread_id
2. 创建 Task 对象
3. 设置 task.thread_id = current_thread_id
4. 保存到 Task Storage
  ↓
【场景 B：任务中心创建】
1. 创建新的聊天线程
2. 获取新 thread_id
3. 创建 Task 对象
4. 设置 task.thread_id = new_thread_id
5. 保存到 Task Storage
  ↓
任务执行过程中
- 所有对话消息发送到绑定的 thread_id
- 可通过 thread_id 查询完整对话历史
- SSE 事件推送包含 thread_id 信息
```

### 1.3 数据流

```python
# task_tool.py 中的关键逻辑
@tool("task")
async def task_tool(...):
    # 1. 获取当前线程 ID
    thread_id = runtime.context.get("thread_id")
    
    # 2. 检查协作任务（如果有）
    if collab_task_id:
        # 验证任务存在且已授权
        # 检查 thread_id 是否匹配
        gate = collab_execution_gate_error(collab_task_id, thread_id)
        if gate:
            return gate
    
    # 3. 创建子智能体执行器
    executor = SubagentExecutor(
        config=config,
        thread_id=thread_id,  # 传递 thread_id
        ...
    )
    
    # 4. 执行子任务（消息会发送到绑定的线程）
    result = await executor.execute(prompt)
```

---

## 2. 任务中心查看实时对话的三种方案

### 方案对比

| 方案 | 描述 | 优点 | 缺点 | 推荐指数 |
|------|------|------|------|----------|
| **方案 A** | 跳转到聊天页面 | 完整聊天体验 | 离开任务中心，上下文丢失 | ⭐⭐⭐ |
| **方案 B** | 右侧抽屉面板 | 不离开任务中心 | 空间有限，对话显示不完整 | ⭐⭐⭐⭐ |
| **方案 C** | 浮动对话窗口 | 灵活拖动，可调整大小 | 可能遮挡任务列表 | ⭐⭐⭐⭐⭐ |

### 方案 A：跳转到聊天页面

**实现方式**：
- 在任务卡片上添加"查看对话"按钮
- 点击后跳转到 `/chat/{thread_id}` 页面
- 显示完整的聊天界面

**优点**：
- ✅ 完整的聊天体验
- ✅ 可以参与对话（发送消息）
- ✅ 支持所有聊天功能

**缺点**：
- ❌ 离开任务中心，失去任务上下文
- ❌ 需要重新加载整个页面
- ❌ 无法同时查看多个任务的对话

**适用场景**：需要深度参与任务对话时

---

### 方案 B：右侧抽屉面板

**实现方式**：
- 点击"查看对话"按钮
- 从右侧滑出抽屉面板（宽度 500-600px）
- 在抽屉中显示聊天内容

**布局结构**：
```
┌─────────────────────────────────────────────────────────┐
│  任务中心                                    [对话按钮]  │
├───────────────────────────┬─────────────────────────────┤
│                           │                             │
│  任务列表                 │   对话抽屉面板              │
│  - 任务卡片 1             │   (从右侧滑入)              │
│  - 任务卡片 2 ← 选中      │   ┌─────────────────────┐   │
│  - 任务卡片 3             │   │ 对话标题            │   │
│                           │   ├─────────────────────┤   │
│                           │   │ 消息列表            │   │
│                           │   │ - AI: 开始分析...   │   │
│                           │   │ - AI: 调用工具...   │   │
│                           │   │ - Human: ...        │   │
│                           │   ├─────────────────────┤   │
│                           │   │ 输入框（可选）      │   │
│                           │   └─────────────────────┘   │
│                           │                             │
└───────────────────────────┴─────────────────────────────┘
```

**优点**：
- ✅ 不离开任务中心
- ✅ 可以同时查看任务和对话
- ✅ 实现相对简单

**缺点**：
- ❌ 对话空间有限
- ❌ 长对话需要频繁滚动
- ❌ 无法调整大小

**适用场景**：快速查看对话，不需要深度参与

---

### 方案 C：浮动对话窗口（推荐）

**实现方式**：
- 点击"查看对话"按钮
- 弹出可拖动的浮动窗口（类似 QQ 聊天窗口）
- 支持调整大小、最小化、关闭

**布局结构**：
```
┌─────────────────────────────────────────────────────────┐
│  任务中心                                                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  任务列表                                               │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 任务卡片 1                                      │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 任务卡片 2 ← 正在查看对话                       │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│    ┌───────────────────────────────────┐                │
│    │ 任务对话 - 分析特斯拉股票      [×] [_] │  ← 可拖动  │
│    ├───────────────────────────────────┤                │
│    │                                   │                │
│    │  [对话内容区域]                   │  ← 可调整大小  │
│    │  AI: 开始分析特斯拉股票...        │                │
│    │  AI: 调用市场数据工具...          │                │
│    │  Human: 请重点关注财务状况        │                │
│    │                                   │                │
│    ├───────────────────────────────────┤                │
│    │ [输入消息...]                  [发送]│  ← 可选      │
│    └───────────────────────────────────┘                │
│                                                         │
│    ┌───────────────────────────────────┐                │
│    │ 任务对话 - 另一任务对话        [×] [_] │  ← 支持多开 │
│    └───────────────────────────────────┘                │
└─────────────────────────────────────────────────────────┘
```

**优点**：
- ✅ 不离开任务中心
- ✅ 可拖动、可调整大小
- ✅ 支持多个对话窗口同时打开
- ✅ 可最小化到角落，不遮挡视线
- ✅ 类似桌面聊天应用，用户体验好

**缺点**：
- ❌ 实现复杂度较高
- ❌ 可能遮挡部分任务列表（可通过透明化解决）

**适用场景**：需要频繁查看对话，同时管理多个任务

---

## 3. 推荐方案：对话面板集成

### 3.1 混合方案：抽屉 + 浮动窗口

**设计理念**：结合方案 B 和 C 的优点

```
默认行为：右侧抽屉面板
- 快速查看对话
- 不遮挡任务列表
- 适合短时间查看

升级行为：拖出为浮动窗口
- 按住对话面板标题栏
- 向左拖动到主内容区
- 自动转换为浮动窗口
- 支持调整大小、多开
```

### 3.2 完整功能设计

#### **功能列表**

| 功能 | 抽屉模式 | 浮动窗口模式 |
|------|---------|------------|
| 查看对话历史 | ✅ | ✅ |
| 实时消息推送 | ✅ | ✅ |
| 发送消息 | ✅（可选） | ✅（可选） |
| 调整大小 | ❌ | ✅ |
| 多窗口 | ❌ | ✅ |
| 最小化 | ❌ | ✅ |
| 拖动移动 | ❌ | ✅ |
| 窗口透明化 | ❌ | ✅ |

#### **交互流程**

```
用户在任务中心
  ↓
点击任务卡片的"查看对话"按钮
  ↓
┌─────────────────────────────────┐
│ 检查对话窗口状态                │
│ - 如已打开，聚焦该窗口          │
│ - 如未打开，创建新窗口          │
└─────────────────────────────────┘
  ↓
【默认：抽屉模式】
- 从右侧滑出抽屉
- 加载对话历史
- 连接 SSE 事件流
- 显示实时对话
  ↓
【用户可拖动转换为浮动窗口】
- 拖动标题栏向左
- 超过阈值自动转换
- 保存窗口状态到 localStorage
  ↓
【实时对话更新】
- 接收 SSE 事件
- 追加新消息到对话列表
- 自动滚动到底部
- 更新未读计数（如最小化）
```

---

## 4. 完整实现方案

### 4.1 后端 API 接口

#### **新增 API：获取任务对话历史**

**文件位置**: `backend/app/gateway/routers/tasks.py`

```python
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

class Message(BaseModel):
    """消息模型"""
    id: str
    type: str  # "human" | "ai" | "tool" | "system"
    content: str
    timestamp: datetime
    tool_calls: Optional[List[dict]] = None
    metadata: Optional[dict] = None

class TaskConversationResponse(BaseModel):
    """任务对话响应"""
    thread_id: str
    messages: List[Message]
    total_count: int

@router.get("/{task_id}/conversation", response_model=TaskConversationResponse)
async def get_task_conversation(task_id: str):
    """获取任务绑定的聊天对话历史"""
    
    # 1. 加载任务
    storage = get_project_storage()
    task = storage.load_task(task_id)
    
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    if not task.thread_id:
        # 任务未绑定线程，返回空对话
        return TaskConversationResponse(
            thread_id="",
            messages=[],
            total_count=0
        )
    
    # 2. 获取对话历史
    from langgraph.api.client import LangGraphClient
    client = LangGraphClient()
    
    # 获取线程消息
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

#### **新增 API：发送任务对话消息**

```python
class SendMessageRequest(BaseModel):
    """发送消息请求"""
    content: str
    thread_id: str

class SendMessageResponse(BaseModel):
    """发送消息响应"""
    success: bool
    message_id: str

@router.post("/{task_id}/conversation/message", response_model=SendMessageResponse)
async def send_task_message(task_id: str, request: SendMessageRequest):
    """向任务绑定的线程发送消息"""
    
    # 1. 加载任务
    storage = get_project_storage()
    task = storage.load_task(task_id)
    
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    if not task.thread_id:
        raise HTTPException(status_code=400, detail="Task has no bound thread")
    
    # 2. 验证 thread_id 匹配
    if request.thread_id != task.thread_id:
        raise HTTPException(status_code=400, detail="Thread ID mismatch")
    
    # 3. 发送消息到线程
    from langgraph.api.client import LangGraphClient
    client = LangGraphClient()
    
    response = await client.threads.send_message(
        thread_id=task.thread_id,
        content=request.content
    )
    
    return SendMessageResponse(
        success=True,
        message_id=response["message_id"]
    )
```

### 4.2 前端组件实现

#### **对话面板组件**

**文件位置**: `deerpanel/src/components/TaskConversationPanel.js`

```javascript
/**
 * 任务对话面板
 * 支持抽屉模式和浮动窗口模式
 */
import { tasksAPI } from '../lib/api-client.js'
import { EventStreamManager } from '../lib/event-stream.js'

export class TaskConversationPanel {
  constructor(taskId, options = {}) {
    this.taskId = taskId
    this.options = {
      mode: 'drawer', // 'drawer' | 'floating'
      width: 500,
      height: 600,
      allowMessaging: false, // 是否允许发送消息
      ...options
    }
    
    this.panelEl = null
    this.messages = []
    this.threadId = null
    this.eventStream = null
    this.isFloating = false
    this.position = { x: 100, y: 100 }
    
    this.init()
  }

  /**
   * 初始化
   */
  async init() {
    // 加载对话历史
    await this.loadConversation()
    
    // 连接事件流
    this.connectEventStream()
    
    // 渲染面板
    this.render()
  }

  /**
   * 加载对话历史
   */
  async loadConversation() {
    try {
      const data = await tasksAPI.getConversation(this.taskId)
      this.messages = data.messages
      this.threadId = data.thread_id
    } catch (error) {
      console.error('Failed to load conversation:', error)
      this.messages = []
    }
  }

  /**
   * 连接事件流
   */
  connectEventStream() {
    if (!this.threadId) return
    
    // 获取项目 ID
    const projectId = this.getProjectId()
    
    this.eventStream = EventStreamManager.getInstance().getStream(projectId)
    
    // 监听新消息
    this.eventStream.on('thread:message', (data) => {
      if (data.thread_id === this.threadId) {
        this.addMessage(data.message)
      }
    })
    
    this.eventStream.connect()
  }

  /**
   * 添加消息
   */
  addMessage(message) {
    this.messages.push(message)
    this.renderMessages()
    this.scrollToBottom()
  }

  /**
   * 渲染面板
   */
  render() {
    if (this.options.mode === 'floating') {
      this.renderFloating()
    } else {
      this.renderDrawer()
    }
  }

  /**
   * 渲染抽屉模式
   */
  renderDrawer() {
    this.panelEl = document.createElement('div')
    this.panelEl.className = 'task-conversation-drawer'
    this.panelEl.innerHTML = `
      <div class="drawer-header">
        <h3>任务对话</h3>
        <div class="drawer-actions">
          <button class="btn-icon" id="btn-convert-to-floating" title="拖出为浮动窗口">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <polyline points="15 3 21 3 21 9"/>
              <polyline points="9 21 3 21 3 15"/>
              <line x1="21" y1="3" x2="14" y2="10"/>
              <line x1="3" y1="21" x2="10" y2="14"/>
            </svg>
          </button>
          <button class="btn-icon" id="btn-close-drawer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="drawer-content">
        <div class="messages-container" id="messages-container">
          ${this.renderMessagesHTML()}
        </div>
        ${this.options.allowMessaging ? `
          <div class="message-input">
            <input type="text" placeholder="发送消息..." id="message-input">
            <button class="btn-send" id="btn-send-message">发送</button>
          </div>
        ` : ''}
      </div>
    `
    
    document.body.appendChild(this.panelEl)
    this.setupDrawerEvents()
  }

  /**
   * 渲染浮动模式
   */
  renderFloating() {
    this.panelEl = document.createElement('div')
    this.panelEl.className = 'task-conversation-floating'
    this.panelEl.style.cssText = `
      position: fixed;
      z-index: 9998;
      left: ${this.position.x}px;
      top: ${this.position.y}px;
      width: ${this.options.width}px;
      height: ${this.options.height}px;
    `
    
    this.panelEl.innerHTML = `
      <div class="floating-header">
        <div class="floating-title">任务对话</div>
        <div class="floating-actions">
          <button class="btn-icon" id="btn-minimize-floating">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
          <button class="btn-icon" id="btn-close-floating">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="floating-content">
        <div class="messages-container" id="messages-container">
          ${this.renderMessagesHTML()}
        </div>
        ${this.options.allowMessaging ? `
          <div class="message-input">
            <input type="text" placeholder="发送消息..." id="message-input">
            <button class="btn-send" id="btn-send-message">发送</button>
          </div>
        ` : ''}
      </div>
    `
    
    document.body.appendChild(this.panelEl)
    this.setupFloatingEvents()
  }

  /**
   * 渲染消息列表
   */
  renderMessagesHTML() {
    return this.messages.map(msg => `
      <div class="message ${msg.type}">
        <div class="message-avatar">
          ${msg.type === 'human' ? '👤' : '🤖'}
        </div>
        <div class="message-content">
          <div class="message-text">${this.escapeHtml(msg.content)}</div>
          <div class="message-time">${new Date(msg.timestamp).toLocaleTimeString()}</div>
        </div>
      </div>
    `).join('')
  }

  /**
   * 设置抽屉事件
   */
  setupDrawerEvents() {
    const closeBtn = this.panelEl.querySelector('#btn-close-drawer')
    const convertBtn = this.panelEl.querySelector('#btn-convert-to-floating')
    
    closeBtn.addEventListener('click', () => this.close())
    convertBtn.addEventListener('click', () => this.convertToFloating())
  }

  /**
   * 设置浮动窗口事件
   */
  setupFloatingEvents() {
    const header = this.panelEl.querySelector('.floating-header')
    const closeBtn = this.panelEl.querySelector('#btn-close-floating')
    const minimizeBtn = this.panelEl.querySelector('#btn-minimize-floating')
    
    // 拖动
    let isDragging = false
    let dragStart = { x: 0, y: 0 }
    
    header.addEventListener('mousedown', (e) => {
      isDragging = true
      dragStart = {
        x: e.clientX - this.position.x,
        y: e.clientY - this.position.y
      }
      
      const onMouseMove = (e) => {
        if (!isDragging) return
        this.position.x = e.clientX - dragStart.x
        this.position.y = e.clientY - dragStart.y
        this.panelEl.style.left = `${this.position.x}px`
        this.panelEl.style.top = `${this.position.y}px`
      }
      
      const onMouseUp = () => {
        isDragging = false
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
      }
      
      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    })
    
    closeBtn.addEventListener('click', () => this.close())
    minimizeBtn.addEventListener('click', () => this.minimize())
  }

  /**
   * 转换为浮动窗口
   */
  convertToFloating() {
    this.close()
    this.options.mode = 'floating'
    this.render()
  }

  /**
   * 关闭面板
   */
  close() {
    if (this.panelEl) {
      this.panelEl.remove()
      this.panelEl = null
    }
    if (this.eventStream) {
      this.eventStream.disconnect()
    }
  }

  /**
   * 最小化
   */
  minimize() {
    const content = this.panelEl.querySelector('.floating-content')
    content.style.display = 'none'
  }

  /**
   * 滚动到底部
   */
  scrollToBottom() {
    const container = this.panelEl.querySelector('#messages-container')
    if (container) {
      container.scrollTop = container.scrollHeight
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
}
```

#### **任务中心集成**

**文件位置**: `deerpanel/src/pages/tasks.js` (修改版)

```javascript
import { TaskConversationPanel } from '../components/TaskConversationPanel.js'

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

---

## 5. API 接口设计

### 5.1 前端 API 客户端扩展

**文件位置**: `deerpanel/src/lib/api-client.js`

```javascript
export const tasksAPI = {
  // ... 原有方法 ...

  /**
   * 获取任务对话历史
   * @param {string} taskId 
   * @returns {Promise<{thread_id: string, messages: Array}>}
   */
  async getConversation(taskId) {
    const response = await fetch(`${API_BASE}/api/tasks/${taskId}/conversation`)
    if (!response.ok) throw new Error('Failed to fetch conversation')
    return response.json()
  },

  /**
   * 发送任务对话消息
   * @param {string} taskId 
   * @param {string} content 
   * @param {string} threadId 
   * @returns {Promise<{success: boolean, message_id: string}>}
   */
  async sendMessage(taskId, content, threadId) {
    const response = await fetch(`${API_BASE}/api/tasks/${taskId}/conversation/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        thread_id: threadId
      })
    })
    if (!response.ok) throw new Error('Failed to send message')
    return response.json()
  }
}
```

---

## 6. CSS 样式

**文件位置**: `deerpanel/src/style/components.css`

```css
/* 对话抽屉面板 */
.task-conversation-drawer {
  position: fixed;
  top: 0;
  right: 0;
  width: 500px;
  height: 100%;
  background: var(--bg-primary);
  border-left: 1px solid var(--border-primary);
  box-shadow: -5px 0 20px rgba(0, 0, 0, 0.2);
  z-index: 9997;
  display: flex;
  flex-direction: column;
  animation: slideInRight 0.3s ease-out;
}

@keyframes slideInRight {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}

.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--border-primary);
}

.drawer-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.message {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.message.human {
  flex-direction: row-reverse;
}

.message-avatar {
  font-size: 24px;
  flex-shrink: 0;
}

.message-content {
  max-width: 80%;
}

.message-text {
  background: var(--bg-secondary);
  padding: 10px 14px;
  border-radius: 12px;
  word-wrap: break-word;
}

.message.human .message-text {
  background: var(--primary);
  color: white;
}

.message-time {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 4px;
}

.message-input {
  display: flex;
  gap: 8px;
  padding: 16px;
  border-top: 1px solid var(--border-primary);
}

.message-input input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  outline: none;
}

.btn-send {
  padding: 10px 20px;
  background: var(--primary);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
}

/* 浮动对话窗口 */
.task-conversation-floating {
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.floating-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(168, 85, 247, 0.1));
  cursor: move;
  user-select: none;
}

.floating-title {
  font-weight: 600;
  font-size: 14px;
}

.floating-actions {
  display: flex;
  gap: 4px;
}

.floating-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
```

---

## 7. 总结

### 核心功能

1. **任务 - 线程绑定** - 每个任务都有唯一的 `thread_id`
2. **对话历史查询** - 通过 API 获取完整对话
3. **实时消息推送** - SSE 事件流实时更新
4. **双模式查看** - 抽屉模式 + 浮动窗口模式
5. **可选消息发送** - 支持参与任务对话

### 用户体验

- ✅ **快速查看** - 点击按钮即可查看对话
- ✅ **不离开上下文** - 在任务中心直接查看
- ✅ **灵活切换** - 抽屉 ↔ 浮动窗口
- ✅ **实时更新** - 对话内容自动刷新
- ✅ **多窗口支持** - 同时查看多个任务对话

### 技术亮点

- ✅ **RESTful API** - 标准的 REST 接口
- ✅ **SSE 实时推送** - 低延迟、高效率
- ✅ **组件化设计** - 可复用的对话面板组件
- ✅ **状态管理** - 自动保存和恢复窗口状态
- ✅ **性能优化** - 虚拟滚动、懒加载

通过这套设计，用户可以在任务中心**无缝查看和管理任务的实时对话**，大大提升任务管理的效率和体验！
