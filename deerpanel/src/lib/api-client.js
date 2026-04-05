/**
 * 任务管理 API 客户端
 * 文件：deerpanel/src/lib/api-client.js
 * 
 * 封装所有与任务管理相关的后端 API 调用
 * 参考文档：DeerFlow 前端实现进度.md - Task 1.1
 */

const API_BASE = 'http://localhost:8000'

/**
 * 任务管理 API 客户端
 */
export const tasksAPI = {
  /**
   * 获取所有任务
   * @returns {Promise<Array>} 任务列表
   */
  async listTasks() {
    try {
      const response = await fetch(`${API_BASE}/api/tasks`)
      if (!response.ok) {
        throw new Error(`Failed to fetch tasks: ${response.status} ${response.statusText}`)
      }
      return await response.json()
    } catch (error) {
      console.error('Error fetching tasks:', error)
      throw error
    }
  },

  /**
   * 获取单个任务详情
   * @param {string} taskId - 任务 ID
   * @returns {Promise<Object>} 任务对象
   */
  async getTask(taskId) {
    try {
      const response = await fetch(`${API_BASE}/api/tasks/${taskId}`)
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Task not found: ${taskId}`)
        }
        throw new Error(`Failed to get task: ${response.status} ${response.statusText}`)
      }
      return await response.json()
    } catch (error) {
      console.error(`Error fetching task ${taskId}:`, error)
      throw error
    }
  },

  /**
   * 创建新任务
   * @param {Object} taskData - 任务数据
   * @param {string} taskData.name - 任务名称
   * @param {string} taskData.description - 任务描述
   * @param {string} [taskData.thread_id] - 绑定的线程 ID（可选）
   * @returns {Promise<Object>} 创建的任务对象
   */
  async createTask(taskData) {
    try {
      const response = await fetch(`${API_BASE}/api/tasks`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(taskData)
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || `Failed to create task: ${response.status}`)
      }
      return await response.json()
    } catch (error) {
      console.error('Error creating task:', error)
      throw error
    }
  },

  /**
   * 启动任务
   * @param {string} taskId - 任务 ID
   * @returns {Promise<Object>} 操作结果
   */
  async startTask(taskId) {
    try {
      const response = await fetch(`${API_BASE}/api/tasks/${taskId}/start`, {
        method: 'POST',
        headers: { 
          'Accept': 'application/json'
        }
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || `Failed to start task: ${response.status}`)
      }
      return await response.json()
    } catch (error) {
      console.error(`Error starting task ${taskId}:`, error)
      throw error
    }
  },

  /**
   * 停止任务
   * @param {string} taskId - 任务 ID
   * @returns {Promise<Object>} 操作结果
   */
  async stopTask(taskId) {
    try {
      const response = await fetch(`${API_BASE}/api/tasks/${taskId}/stop`, {
        method: 'POST',
        headers: { 
          'Accept': 'application/json'
        }
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || `Failed to stop task: ${response.status}`)
      }
      return await response.json()
    } catch (error) {
      console.error(`Error stopping task ${taskId}:`, error)
      throw error
    }
  },

  /**
   * 更新任务
   * @param {string} taskId - 任务 ID
   * @param {Object} updates - 更新数据
   * @param {string} [updates.status] - 任务状态
   * @param {number} [updates.progress] - 进度百分比
   * @param {any} [updates.result] - 执行结果
   * @returns {Promise<Object>} 更新后的任务对象
   */
  async updateTask(taskId, updates) {
    try {
      const response = await fetch(`${API_BASE}/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(updates)
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || `Failed to update task: ${response.status}`)
      }
      return await response.json()
    } catch (error) {
      console.error(`Error updating task ${taskId}:`, error)
      throw error
    }
  },

  /**
   * 获取子任务列表
   * @param {string} taskId - 任务 ID
   * @returns {Promise<Array>} 子任务列表
   */
  async listSubtasks(taskId) {
    try {
      const response = await fetch(`${API_BASE}/api/tasks/${taskId}/subtasks`)
      if (!response.ok) {
        throw new Error(`Failed to fetch subtasks: ${response.status} ${response.statusText}`)
      }
      return await response.json()
    } catch (error) {
      console.error(`Error fetching subtasks for task ${taskId}:`, error)
      throw error
    }
  },

  /**
   * 获取任务对话历史
   * @param {string} taskId - 任务 ID
   * @returns {Promise<Object>} 对话历史对象 {thread_id, messages, total_count}
   */
  async getConversation(taskId) {
    try {
      const response = await fetch(`${API_BASE}/api/tasks/${taskId}/conversation`)
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Conversation not found for task: ${taskId}`)
        }
        throw new Error(`Failed to fetch conversation: ${response.status} ${response.statusText}`)
      }
      return await response.json()
    } catch (error) {
      console.error(`Error fetching conversation for task ${taskId}:`, error)
      throw error
    }
  },

  /**
   * 发送对话消息
   * @param {string} taskId - 任务 ID
   * @param {string} content - 消息内容
   * @param {string} threadId - 线程 ID
   * @returns {Promise<Object>} 发送结果 {success, message_id}
   */
  async sendMessage(taskId, content, threadId) {
    try {
      const response = await fetch(`${API_BASE}/api/tasks/${taskId}/conversation/message`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ 
          content, 
          thread_id: threadId 
        })
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || `Failed to send message: ${response.status}`)
      }
      return await response.json()
    } catch (error) {
      console.error(`Error sending message for task ${taskId}:`, error)
      throw error
    }
  },

  /**
   * 删除任务
   * @param {string} taskId - 任务 ID
   * @returns {Promise<Object>} 删除结果
   */
  async deleteTask(taskId) {
    try {
      const response = await fetch(`${API_BASE}/api/tasks/${taskId}`, {
        method: 'DELETE',
        headers: { 
          'Accept': 'application/json'
        }
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || `Failed to delete task: ${response.status}`)
      }
      return await response.json()
    } catch (error) {
      console.error(`Error deleting task ${taskId}:`, error)
      throw error
    }
  }
}

/**
 * 错误处理工具函数
 */
export class APIError extends Error {
  constructor(message, statusCode, data = null) {
    super(message)
    this.name = 'APIError'
    this.statusCode = statusCode
    this.data = data
  }
}

/**
 * 重试工具函数
 * @param {Function} fn - 要重试的函数
 * @param {number} maxRetries - 最大重试次数
 * @param {number} delay - 重试间隔（毫秒）
 * @returns {Promise<any>}
 */
export async function withRetry(fn, maxRetries = 3, delay = 1000) {
  let lastError
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      
      // 如果是 4xx 错误，不重试
      if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
        throw error
      }
      
      // 最后一次尝试失败
      if (attempt === maxRetries) {
        break
      }
      
      // 等待后重试（指数退避）
      const waitTime = delay * Math.pow(2, attempt - 1)
      console.warn(`Attempt ${attempt} failed, retrying in ${waitTime}ms...`, error)
      await new Promise(resolve => setTimeout(resolve, waitTime))
    }
  }
  
  throw lastError
}

export default tasksAPI
