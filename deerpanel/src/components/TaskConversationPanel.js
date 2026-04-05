/**
 * 任务对话面板
 * 文件：deerpanel/src/components/TaskConversationPanel.js
 * 
 * 支持抽屉模式和浮动窗口模式
 * 用于在任务中心查看任务绑定的实时对话
 * 参考文档：DeerFlow 前端实现进度.md - Task 3.1
 */

import { tasksAPI } from '../lib/api-client.js'
import { EventStreamManager, EventTypes } from '../lib/event-stream.js'

/**
 * 任务对话面板类
 */
export class TaskConversationPanel {
  /**
   * @param {string} taskId - 任务 ID
   * @param {Object} options - 配置选项
   * @param {string} [options.mode='drawer'] - 模式：'drawer' | 'floating'
   * @param {number} [options.width=500] - 宽度
   * @param {number} [options.height=600] - 高度
   * @param {boolean} [options.allowMessaging=false] - 是否允许发送消息
   */
  constructor(taskId, options = {}) {
    this.taskId = taskId
    this.options = {
      mode: 'drawer',
      width: 500,
      height: 600,
      allowMessaging: false,
      ...options
    }
    
    this.panelEl = null
    this.messages = []
    this.threadId = null
    this.eventStream = null
    this.isFloating = false
    this.position = { x: 100, y: 100 }
    this.onClose = null
    
    this.init()
  }

  /**
   * 初始化
   * @private
   * @async
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
   * @private
   * @async
   */
  async loadConversation() {
    try {
      const data = await tasksAPI.getConversation(this.taskId)
      this.messages = data.messages || []
      this.threadId = data.thread_id
      
      console.log('[TaskConversationPanel] Loaded conversation:', this.messages.length, 'messages')
    } catch (error) {
      console.error('[TaskConversationPanel] Failed to load conversation:', error)
      this.messages = []
      
      // 如果任务没有绑定线程，显示提示
      if (error.message.includes('not found')) {
        this.showError('该任务暂无对话记录')
      }
    }
  }

  /**
   * 连接事件流
   * @private
   */
  connectEventStream() {
    if (!this.threadId) {
      console.log('[TaskConversationPanel] No thread ID, skipping event stream connection')
      return
    }
    
    // 获取项目 ID（从 taskId 推断或从任务信息获取）
    const projectId = this.getProjectId()
    
    this.eventStream = EventStreamManager.getInstance().getStream(projectId)
    
    // 监听新消息
    this.eventStream.on(EventTypes.THREAD_MESSAGE, (data) => {
      if (data.thread_id === this.threadId) {
        console.log('[TaskConversationPanel] New message received:', data)
        this.addMessage(data.message)
      }
    })
    
    this.eventStream.connect()
  }

  /**
   * 获取项目 ID
   * @private
   * @returns {string} 项目 ID
   */
  getProjectId() {
    // 尝试从任务信息中获取
    // 这里简化处理，实际项目中可能需要调用 API 获取任务详情
    return 'default'
  }

  /**
   * 添加消息
   * @public
   * @param {Object} message - 消息对象
   */
  addMessage(message) {
    this.messages.push(message)
    this.renderMessages()
    this.scrollToBottom()
  }

  /**
   * 渲染面板
   * @private
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
   * @private
   */
  renderDrawer() {
    // 检查是否已存在
    if (this.panelEl) {
      return
    }

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
          <button class="btn-icon" id="btn-close-drawer" title="关闭">
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
    
    // 滚动到底部
    setTimeout(() => this.scrollToBottom(), 100)
  }

  /**
   * 渲染浮动模式
   * @private
   */
  renderFloating() {
    if (this.panelEl) {
      return
    }

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
          <button class="btn-icon" id="btn-minimize-floating" title="最小化">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
          <button class="btn-icon" id="btn-close-floating" title="关闭">
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
    
    // 滚动到底部
    setTimeout(() => this.scrollToBottom(), 100)
  }

  /**
   * 渲染消息列表 HTML
   * @private
   * @returns {string} HTML 字符串
   */
  renderMessagesHTML() {
    if (this.messages.length === 0) {
      return '<div class="messages-empty">暂无对话</div>'
    }
    
    return this.messages.map(msg => {
      const typeClass = msg.type || 'ai'
      const avatar = typeClass === 'human' ? '👤' : '🤖'
      const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ''
      
      return `
        <div class="message ${typeClass}">
          <div class="message-avatar">
            ${avatar}
          </div>
          <div class="message-content">
            <div class="message-text">${this.escapeHtml(msg.content || '')}</div>
            ${time ? `<div class="message-time">${time}</div>` : ''}
          </div>
        </div>
      `
    }).join('')
  }

  /**
   * 渲染消息列表
   * @private
   */
  renderMessages() {
    const container = this.panelEl?.querySelector('#messages-container')
    if (container) {
      container.innerHTML = this.renderMessagesHTML()
    }
  }

  /**
   * 设置抽屉事件
   * @private
   */
  setupDrawerEvents() {
    const closeBtn = this.panelEl.querySelector('#btn-close-drawer')
    const convertBtn = this.panelEl.querySelector('#btn-convert-to-floating')
    
    closeBtn.addEventListener('click', () => this.close())
    convertBtn.addEventListener('click', () => this.convertToFloating())
    
    // 发送消息
    if (this.options.allowMessaging) {
      const sendBtn = this.panelEl.querySelector('#btn-send-message')
      const input = this.panelEl.querySelector('#message-input')
      
      sendBtn.addEventListener('click', () => this.sendMessage(input.value))
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.sendMessage(input.value)
        }
      })
    }
  }

  /**
   * 设置浮动窗口事件
   * @private
   */
  setupFloatingEvents() {
    const header = this.panelEl.querySelector('.floating-header')
    const closeBtn = this.panelEl.querySelector('#btn-close-floating')
    const minimizeBtn = this.panelEl.querySelector('#btn-minimize-floating')
    
    // 拖动功能
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
    
    // 发送消息
    if (this.options.allowMessaging) {
      const sendBtn = this.panelEl.querySelector('#btn-send-message')
      const input = this.panelEl.querySelector('#message-input')
      
      sendBtn.addEventListener('click', () => this.sendMessage(input.value))
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.sendMessage(input.value)
        }
      })
    }
  }

  /**
   * 发送消息
   * @private
   * @async
   * @param {string} content - 消息内容
   */
  async sendMessage(content) {
    if (!content.trim() || !this.threadId) return
    
    try {
      await tasksAPI.sendMessage(this.taskId, content.trim(), this.threadId)
      
      // 清空输入框
      const input = this.panelEl.querySelector('#message-input')
      if (input) input.value = ''
      
      // 消息会自动通过 SSE 推送过来
    } catch (error) {
      console.error('[TaskConversationPanel] Failed to send message:', error)
      alert('发送消息失败：' + error.message)
    }
  }

  /**
   * 转换为浮动窗口
   * @public
   */
  convertToFloating() {
    this.close()
    this.options.mode = 'floating'
    this.render()
  }

  /**
   * 最小化
   * @public
   */
  minimize() {
    const content = this.panelEl.querySelector('.floating-content')
    if (content) {
      content.style.display = content.style.display === 'none' ? 'block' : 'none'
    }
  }

  /**
   * 滚动到底部
   * @private
   */
  scrollToBottom() {
    const container = this.panelEl?.querySelector('#messages-container')
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }

  /**
   * 显示错误信息
   * @private
   * @param {string} message - 错误消息
   */
  showError(message) {
    if (this.panelEl) {
      const container = this.panelEl.querySelector('#messages-container')
      if (container) {
        container.innerHTML = `<div class="messages-error">${this.escapeHtml(message)}</div>`
      }
    }
  }

  /**
   * HTML 转义
   * @private
   * @param {string} text - 原始文本
   * @returns {string} 转义后的 HTML
   */
  escapeHtml(text) {
    if (!text) return ''
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  /**
   * 关闭面板
   * @public
   */
  close() {
    if (this.panelEl) {
      this.panelEl.remove()
      this.panelEl = null
    }
    if (this.eventStream) {
      this.eventStream.disconnect()
      this.eventStream = null
    }
    if (this.onClose) {
      this.onClose()
    }
  }

  /**
   * 聚焦面板
   * @public
   */
  focus() {
    if (this.panelEl) {
      this.panelEl.style.zIndex = '9999'
      // 如果是浮动窗口，带到最前面
      if (this.options.mode === 'floating') {
        this.panelEl.style.boxShadow = '0 10px 40px rgba(0,0,0,0.4)'
        setTimeout(() => {
          this.panelEl.style.boxShadow = '0 10px 30px rgba(0,0,0,0.3)'
        }, 200)
      }
    }
  }

  /**
   * 销毁面板
   * @public
   */
  destroy() {
    this.close()
  }
}

export default TaskConversationPanel
