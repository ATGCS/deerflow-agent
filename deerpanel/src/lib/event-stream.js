/**
 * @fileoverview 任务事件流管理
 * 实现 Server-Sent Events (SSE) 连接和管理
 * 用于实时接收任务进度更新、状态变更等事件
 * 参考文档：DeerFlow 前端实现进度.md - Task 1.2
 */

// API 基础地址 - 使用 Gateway 端口 8012
const API_BASE = 'http://localhost:8012'

/**
 * 任务事件流类
 * 负责连接 SSE 端点并处理各类事件
 */
export class TaskEventStream {
  /**
   * @param {string} projectId - 项目 ID
   */
  constructor(projectId) {
    this.projectId = projectId
    this.eventSource = null
    this.listeners = new Map()
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 5
    this.reconnectDelay = 1000 // 1 秒
    this.isConnected = false
    this.lastEventTime = null
  }

  /**
   * 连接事件流
   * @public
   */
  connect() {
    if (this.eventSource) {
      console.warn('Event stream already connected, disconnecting first...')
      this.disconnect()
    }

    const url = `${API_BASE}/api/events/projects/${this.projectId}/stream`
    console.log('[EventStream] Connecting to:', url)

    try {
      this.eventSource = new EventSource(url)
      this.setupEventHandlers()
    } catch (error) {
      console.error('[EventStream] Failed to create EventSource:', error)
      this.attemptReconnect()
    }
  }

  /**
   * 设置事件处理器
   * @private
   */
  setupEventHandlers() {
    // 连接成功
    this.eventSource.onopen = () => {
      console.log('[EventStream] Connected successfully')
      this.isConnected = true
      this.reconnectAttempts = 0
      this.emit('connected', {
        timestamp: new Date().toISOString()
      })
    }

    // 接收消息
    this.eventSource.onmessage = (event) => {
      this.lastEventTime = Date.now()
      try {
        const data = JSON.parse(event.data)
        console.log('[EventStream] Received message:', data)
        this.handleEvent(data.type, data.data)
      } catch (error) {
        console.error('[EventStream] Failed to parse event data:', error, event.data)
      }
    }

    // 发生错误
    this.eventSource.onerror = (error) => {
      console.error('[EventStream] Error occurred:', error)
      this.isConnected = false
      
      // 关闭连接
      this.eventSource.close()
      
      // 尝试重连
      this.attemptReconnect()
    }

    // 监听特定事件类型 - 任务创建
    this.eventSource.addEventListener('task:created', (e) => {
      const data = JSON.parse(e.data)
      console.log('[EventStream] Task created:', data)
      this.handleEvent('task:created', data)
    })

    // 监听特定事件类型 - 任务开始
    this.eventSource.addEventListener('task:started', (e) => {
      const data = JSON.parse(e.data)
      console.log('[EventStream] Task started:', data)
      this.handleEvent('task:started', data)
    })

    // 监听特定事件类型 - 任务进度
    this.eventSource.addEventListener('task:progress', (e) => {
      const data = JSON.parse(e.data)
      console.log('[EventStream] Task progress:', data)
      this.handleEvent('task:progress', data)
    })

    // 监听特定事件类型 - 任务完成
    this.eventSource.addEventListener('task:completed', (e) => {
      const data = JSON.parse(e.data)
      console.log('[EventStream] Task completed:', data)
      this.handleEvent('task:completed', data)
    })

    // 监听特定事件类型 - 任务失败
    this.eventSource.addEventListener('task:failed', (e) => {
      const data = JSON.parse(e.data)
      console.log('[EventStream] Task failed:', data)
      this.handleEvent('task:failed', data)
    })

    // 监听特定事件类型 - 任务心跳
    this.eventSource.addEventListener('task:heartbeat', (e) => {
      const data = JSON.parse(e.data)
      this.handleEvent('task:heartbeat', data)
    })

    // 监听特定事件类型 - 线程消息
    this.eventSource.addEventListener('thread:message', (e) => {
      const data = JSON.parse(e.data)
      console.log('[EventStream] Thread message:', data)
      this.handleEvent('thread:message', data)
    })
  }

  /**
   * 处理事件
   * @private
   * @param {string} eventType - 事件类型
   * @param {any} data - 事件数据
   */
  handleEvent(eventType, data) {
    if (this.listeners.has(eventType)) {
      const callbacks = this.listeners.get(eventType)
      callbacks.forEach((callback, index) => {
        try {
          callback(data)
        } catch (error) {
          console.error(`[EventStream] Error in ${eventType} listener #${index}:`, error)
        }
      })
    }
  }

  /**
   * 添加事件监听器
   * @public
   * @param {string} eventType - 事件类型
   * @param {Function} callback - 回调函数
   * @returns {Function} 取消监听函数
   */
  on(eventType, callback) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, [])
    }
    this.listeners.get(eventType).push(callback)

    // 返回取消监听的函数
    return () => this.off(eventType, callback)
  }

  /**
   * 移除事件监听器
   * @public
   * @param {string} eventType - 事件类型
   * @param {Function} callback - 回调函数
   */
  off(eventType, callback) {
    if (!this.listeners.has(eventType)) return
    
    const callbacks = this.listeners.get(eventType)
    const index = callbacks.indexOf(callback)
    if (index > -1) {
      callbacks.splice(index, 1)
    }
    
    // 如果没有监听器了，清理该事件类型
    if (callbacks.length === 0) {
      this.listeners.delete(eventType)
    }
  }

  /**
   * 尝试重连
   * @private
   */
  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[EventStream] Max reconnection attempts reached')
      this.emit('disconnected', { 
        reason: 'max_attempts',
        attempts: this.reconnectAttempts
      })
      return
    }

    this.reconnectAttempts++
    // 指数退避：1s, 2s, 4s, 8s, 16s
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)
    
    console.log(
      `[EventStream] Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    )
    
    setTimeout(() => {
      console.log('[EventStream] Reconnecting...')
      this.connect()
    }, delay)
  }

  /**
   * 发射事件
   * @private
   * @param {string} eventType - 事件类型
   * @param {any} data - 事件数据
   */
  emit(eventType, data) {
    if (this.listeners.has(eventType)) {
      this.listeners.get(eventType).forEach(callback => {
        try {
          callback(data)
        } catch (error) {
          console.error(`[EventStream] Error emitting ${eventType}:`, error)
        }
      })
    }
  }

  /**
   * 断开连接
   * @public
   */
  disconnect() {
    if (this.eventSource) {
      console.log('[EventStream] Disconnecting...')
      this.eventSource.close()
      this.eventSource = null
      this.isConnected = false
    }
    this.listeners.clear()
    this.reconnectAttempts = 0
    console.log('[EventStream] Disconnected')
  }

  /**
   * 获取连接状态
   * @public
   * @returns {boolean} 是否已连接
   */
  // isConnected 已在构造函数中定义，无需 getter
  
  /**
   * 获取最后事件时间
   * @public
   * @returns {number|null} 最后事件时间戳
   */
  getLastEventTime() {
    return this.lastEventTime
  }
}

/**
 * 全局事件流管理器
 * 单例模式，管理所有项目的事件流连接
 */
export class EventStreamManager {
  static instance = null

  constructor() {
    this.streams = new Map()
  }

  /**
   * 获取单例实例
   * @public
   * @static
   * @returns {EventStreamManager} 单例实例
   */
  static getInstance() {
    if (!EventStreamManager.instance) {
      EventStreamManager.instance = new EventStreamManager()
    }
    return EventStreamManager.instance
  }

  /**
   * 获取或创建项目事件流
   * @public
   * @param {string} projectId - 项目 ID
   * @returns {TaskEventStream} 事件流实例
   */
  getStream(projectId) {
    if (!this.streams.has(projectId)) {
      const stream = new TaskEventStream(projectId)
      this.streams.set(projectId, stream)
      console.log('[EventStreamManager] Created new stream for project:', projectId)
    }
    return this.streams.get(projectId)
  }

  /**
   * 断开指定项目的事件流
   * @public
   * @param {string} projectId - 项目 ID
   */
  disconnectStream(projectId) {
    if (this.streams.has(projectId)) {
      const stream = this.streams.get(projectId)
      stream.disconnect()
      this.streams.delete(projectId)
      console.log('[EventStreamManager] Disconnected stream for project:', projectId)
    }
  }

  /**
   * 断开所有连接
   * @public
   */
  disconnectAll() {
    console.log('[EventStreamManager] Disconnecting all streams...')
    this.streams.forEach((stream, projectId) => {
      stream.disconnect()
    })
    this.streams.clear()
    console.log('[EventStreamManager] All streams disconnected')
  }

  /**
   * 获取活跃连接数
   * @public
   * @returns {number} 活跃连接数
   */
  getActiveConnectionsCount() {
    let count = 0
    this.streams.forEach(stream => {
      if (stream.isConnected) {
        count++
      }
    })
    return count
  }

  /**
   * 获取所有项目 ID
   * @public
   * @returns {Array<string>} 项目 ID 列表
   */
  getConnectedProjects() {
    const projects = []
    this.streams.forEach((stream, projectId) => {
      if (stream.isConnected) {
        projects.push(projectId)
      }
    })
    return projects
  }
}

/**
 * 事件类型常量
 */
export const EventTypes = {
  // 连接相关
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  
  // 任务相关
  TASK_CREATED: 'task:created',
  TASK_STARTED: 'task:started',
  TASK_PROGRESS: 'task:progress',
  TASK_COMPLETED: 'task:completed',
  TASK_FAILED: 'task:failed',
  TASK_HEARTBEAT: 'task:heartbeat',
  
  // 线程相关
  THREAD_MESSAGE: 'thread:message'
}

export default {
  TaskEventStream,
  EventStreamManager,
  EventTypes
}
