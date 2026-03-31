/**
 * WebSocket 客户�?- 直连 DeerPanel Gateway
 *
 * 协议流程（直连模式）�? * 1. 连接 ws://host/ws?token=xxx
 * 2. Gateway �?connect.challenge（带 nonce�? * 3. 客户端调�?Tauri 后端生成 Ed25519 签名�?connect frame
 * 4. Gateway 返回 connect 响应（带 snapshot�? * 5. �?snapshot.sessionDefaults.mainSessionKey 获取 sessionKey
 * 6. 开始正常通信
 */
import { api } from './tauri-api.js'

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

const REQUEST_TIMEOUT = 30000
const MAX_RECONNECT_DELAY = 60000
const PING_INTERVAL = 30000
const CHALLENGE_TIMEOUT = 15000
const MAX_RECONNECT_ATTEMPTS = 20
const HEARTBEAT_TIMEOUT = 90000
const MESSAGE_CACHE_SIZE = 100
// Gateway 启动前的初始重连延迟（更长，�?Gateway 充足的重�?初始化时间）
const INITIAL_RECONNECT_DELAY = 10000

export class WsClient {
  constructor() {
    this._ws = null
    this._url = ''
    this._token = ''
    this._pending = new Map()
    this._eventListeners = []
    this._statusListeners = []
    this._readyCallbacks = []
    this._reconnectAttempts = 0
    this._reconnectTimer = null
    this._connected = false
    this._gatewayReady = false
    this._handshaking = false
    this._connecting = false
    this._intentionalClose = false
    this._snapshot = null
    this._hello = null
    this._sessionKey = null
    this._pingTimer = null
    this._challengeTimer = null
    this._wsId = 0
    this._autoPairAttempts = 0
    this._serverVersion = null

    // 增强状态追�?    this._lastConnectedAt = null
    this._lastMessageAt = null
    this._pendingReconnect = false
    this._missedHeartbeats = 0
    this._heartbeatTimer = null
    this._reconnectState = 'idle' // idle | attempting | scheduled

    // 消息缓存
    this._messageCache = new Map()
    this._cacheSize = MESSAGE_CACHE_SIZE
    this._seenMessageIds = new Set()
  }

  get connected() { return this._connected }
  get connecting() { return this._connecting }
  get gatewayReady() { return this._gatewayReady }
  get snapshot() { return this._snapshot }
  get hello() { return this._hello }
  get sessionKey() { return this._sessionKey }
  get serverVersion() { return this._serverVersion }
  get reconnectState() { return this._reconnectState }
  get reconnectAttempts() { return this._reconnectAttempts }
  get lastConnectedAt() { return this._lastConnectedAt }
  get lastMessageAt() { return this._lastMessageAt }

  /**
   * 获取连接详细信息，供前端使用
   */
  getConnectionInfo() {
    return {
      connected: this._connected,
      gatewayReady: this._gatewayReady,
      lastConnectedAt: this._lastConnectedAt,
      lastMessageAt: this._lastMessageAt,
      reconnectAttempts: this._reconnectAttempts,
      reconnectState: this._reconnectState,
      serverVersion: this._serverVersion,
      missedHeartbeats: this._missedHeartbeats,
      pendingReconnect: this._pendingReconnect,
    }
  }

  onStatusChange(fn) {
    this._statusListeners.push(fn)
    return () => { this._statusListeners = this._statusListeners.filter(cb => cb !== fn) }
  }

  onReady(fn) {
    this._readyCallbacks.push(fn)
    return () => { this._readyCallbacks = this._readyCallbacks.filter(cb => cb !== fn) }
  }

  connect(host, token, opts = {}) {
    this._intentionalClose = false
    this._autoPairAttempts = 0
    this._token = token || ''
    // 自动检测协议：如果页面通过 HTTPS 加载（反代场景），使�?wss://
    const proto = opts.secure ?? (typeof location !== 'undefined' && location.protocol === 'https:') ? 'wss' : 'ws'
    const nextUrl = `${proto}://${host}/ws?token=${encodeURIComponent(this._token)}`
    if (this._connecting || this._handshaking || this._gatewayReady) {
      if (this._url === nextUrl) return
    }
    if (this._ws && (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING)) return
    this._url = nextUrl
    this._lastConnectedAt = Date.now()
    this._doConnect()
  }

  disconnect() {
    this._intentionalClose = true
    this._stopPing()
    this._stopHeartbeat()
    this._clearReconnectTimer()
    this._clearChallengeTimer()
    this._flushPending()
    this._closeWs()
    this._setConnected(false)
    this._gatewayReady = false
    this._handshaking = false
    this._reconnectState = 'idle'
    this._pendingReconnect = false
  }

  reconnect() {
    if (!this._url) return
    this._intentionalClose = false
    this._reconnectAttempts = 0
    this._autoPairAttempts = 0
    this._missedHeartbeats = 0
    this._stopPing()
    this._stopHeartbeat()
    this._clearReconnectTimer()
    this._clearChallengeTimer()
    this._flushPending()
    this._closeWs()
    this._doConnect()
  }

  _doConnect() {
    this._connecting = true
    this._closeWs()
    this._gatewayReady = false
    this._handshaking = false
    this._reconnectState = 'attempting'
    this._setConnected(false, 'connecting')
    const wsId = ++this._wsId
    let ws
    try { ws = new WebSocket(this._url) } catch { this._scheduleReconnect(); return }
    this._ws = ws

    ws.onopen = () => {
      if (wsId !== this._wsId) return
      this._connecting = false
      this._reconnectAttempts = 0
      this._missedHeartbeats = 0
      this._lastConnectedAt = Date.now()
      this._lastMessageAt = Date.now()
      this._startHeartbeat()
      this._setConnected(true)
      this._startPing()
      // �?Gateway �?connect.challenge，超时则主动�?      this._challengeTimer = setTimeout(() => {
        if (!this._handshaking && !this._gatewayReady) {
          console.log('[ws] 未收�?challenge，主动发 connect')
          this._sendConnectFrame('')
        }
      }, CHALLENGE_TIMEOUT)
    }

    ws.onmessage = (evt) => {
      if (wsId !== this._wsId) return
      let msg
      try { msg = JSON.parse(evt.data) } catch { return }
      this._handleMessage(msg)
    }

    ws.onclose = (e) => {
      if (wsId !== this._wsId) return
      this._ws = null
      this._connecting = false
      this._clearChallengeTimer()
      if (e.code === 4001 || e.code === 4003 || e.code === 4004) {
        this._setConnected(false, 'auth_failed', e.reason || 'Token 认证失败')
        this._intentionalClose = true
        this._flushPending()
        return
      }
      if (e.code === 1008 && !this._intentionalClose) {
        if (this._autoPairAttempts < 1) {
          console.log('[ws] origin not allowed (1008)，尝试自动修�?..')
          this._setConnected(false, 'reconnecting', 'origin not allowed，修复中...')
          this._autoPairAndReconnect()
          return
        }
        console.warn('[ws] origin 1008 自动修复已尝试过，显示错�?)
        this._setConnected(false, 'error', e.reason || 'origin not allowed，请点击「修复并重连�?)
        return
      }
      this._setConnected(false)
      this._gatewayReady = false
      this._handshaking = false
      this._stopPing()
      this._flushPending()
      if (!this._intentionalClose) this._scheduleReconnect()
    }

    ws.onerror = (err) => {
      console.error('[ws] WebSocket 错误:', err)
    }
  }

  _handleMessage(msg) {
    // 更新最后消息时间（用于心跳检测）
    this._lastMessageAt = Date.now()
    this._missedHeartbeats = 0

    // 握手阶段：connect.challenge
    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      console.log('[ws] 收到 connect.challenge')
      this._clearChallengeTimer()
      const nonce = msg.payload?.nonce || ''
      this._sendConnectFrame(nonce)
      return
    }

    // 握手响应：connect �?res
    if (msg.type === 'res' && msg.id?.startsWith('connect-')) {
      this._clearChallengeTimer()
      this._handshaking = false
      if (!msg.ok || msg.error) {
        const errMsg = msg.error?.message || 'Gateway 握手失败'
        const errCode = msg.error?.code
        console.error('[ws] connect 失败:', errMsg, errCode)

        // 如果是配�?origin 错误，尝试自动配对（仅一次，防止无限循环�?        if (errCode === 'NOT_PAIRED' || errCode === 'PAIRING_REQUIRED' || /origin not allowed/i.test(errMsg)) {
          if (this._autoPairAttempts < 1) {
            console.log('[ws] 检测到配对/origin 错误，尝试自动修�?..', errCode || errMsg)
            this._autoPairAndReconnect()
            return
          }
          console.warn('[ws] 自动修复已尝试过，不再重�?)
        }

        this._setConnected(false, 'error', errMsg)
        this._readyCallbacks.forEach(fn => {
          try { fn(null, null, { error: true, message: errMsg }) } catch {}
        })
        return
      }
      // 握手成功，提�?snapshot
      this._handleConnectSuccess(msg.payload)
      return
    }

    // RPC 响应
    if (msg.type === 'res') {
      const cb = this._pending.get(msg.id)
      if (cb) {
        this._pending.delete(msg.id)
        clearTimeout(cb.timer)
        if (msg.ok) cb.resolve(msg.payload)
        else cb.reject(new Error(msg.error?.message || msg.error?.code || 'request failed'))
      }
      return
    }

    // 事件转发
    if (msg.type === 'event') {
      // 消息去重检�?      if (msg.id && this._seenMessageIds.has(msg.id)) {
        console.log('[ws] 跳过重复消息:', msg.id)
        return
      }
      if (msg.id) {
        this._seenMessageIds.add(msg.id)
        // 保持 Set 大小，防止内存泄�?        if (this._seenMessageIds.size > 1000) {
          const arr = Array.from(this._seenMessageIds)
          this._seenMessageIds = new Set(arr.slice(-500))
        }
      }

      // 缓存聊天消息
      if (msg.event === 'chat.message' && msg.payload?.sessionKey) {
        this._cacheMessage(msg.payload.sessionKey, msg.payload)
      }

      this._eventListeners.forEach(fn => {
        try { fn(msg) } catch (e) { console.error('[ws] handler error:', e) }
      })
    }
  }

  async _autoPairAndReconnect() {
    this._autoPairAttempts++
    try {
      console.log('[ws] 执行自动配对（第', this._autoPairAttempts, '次）...')
      const result = await api.autoPairDevice()
      console.log('[ws] 配对结果:', result)

      // 配对后需�?reload Gateway �?allowedOrigins 生效
      try {
        await api.reloadGateway()
        console.log('[ws] Gateway 已重�?)
      } catch (e) {
        console.warn('[ws] reloadGateway 失败（非致命�?', e)
      }

      // 修复 #160: 不调�?reconnect()（它会重�?_autoPairAttempts 导致无限循环），
      // 而是直接重连一次。如果仍然失败，_autoPairAttempts 不会被重置，不会再次触发自动修复�?      console.log('[ws] 配对成功�?秒后重新连接...')
      setTimeout(() => {
        if (!this._intentionalClose) {
          this._reconnectAttempts = 0
          this._closeWs()
          this._doConnect()
        }
      }, 3000)
    } catch (e) {
      console.error('[ws] 自动配对失败:', e)
      this._setConnected(false, 'error', `配对失败: ${e}`)
    }
  }

  async _sendConnectFrame(nonce) {
    this._handshaking = true
    try {
      const frame = await api.createConnectFrame(nonce, this._token)
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        console.log('[ws] 发�?connect frame')
        this._ws.send(JSON.stringify(frame))
      }
    } catch (e) {
      console.error('[ws] 生成 connect frame 失败:', e)
      this._handshaking = false
    }
  }

  _handleConnectSuccess(payload) {
    this._autoPairAttempts = 0
    this._hello = payload || null
    this._snapshot = payload?.snapshot || null
    this._serverVersion = payload?.serverVersion || null
    const defaults = this._snapshot?.sessionDefaults
    if (defaults?.mainSessionKey) {
      this._sessionKey = defaults.mainSessionKey
    } else {
      const agentId = defaults?.defaultAgentId || 'main'
      this._sessionKey = `agent:${agentId}:main`
    }
    this._gatewayReady = true
    this._reconnectState = 'idle'
    this._pendingReconnect = false
    console.log('[ws] Gateway 就绪, sessionKey:', this._sessionKey)
    this._setConnected(true, 'ready')
    this._readyCallbacks.forEach(fn => {
      try { fn(this._hello, this._sessionKey) } catch (e) {
        console.error('[ws] ready cb error:', e)
      }
    })
  }

  _setConnected(val, status, errorMsg) {
    this._connected = val
    const s = status || (val ? 'connected' : 'disconnected')
    this._statusListeners.forEach(fn => {
      try { fn(s, errorMsg) } catch (e) { console.error('[ws] status listener error:', e) }
    })
  }

  _closeWs() {
    if (this._ws) {
      const old = this._ws
      this._ws = null
      this._wsId++
      try { old.close() } catch {}
    }
  }

  _flushPending() {
    for (const [, cb] of this._pending) {
      clearTimeout(cb.timer)
      cb.reject(new Error('连接已断开'))
    }
    this._pending.clear()
  }

  _clearReconnectTimer() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }
  }

  _clearChallengeTimer() {
    if (this._challengeTimer) {
      clearTimeout(this._challengeTimer)
      this._challengeTimer = null
    }
  }

  _scheduleReconnect() {
    // 超过最大重连次数，停止重连
    if (this._reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn('[ws] 已达到最大重连次�?(', MAX_RECONNECT_ATTEMPTS, ')，停止自动重�?)
      this._reconnectState = 'idle'
      this._pendingReconnect = false
      this._setConnected(false, 'error', `连接失败，已停止重连。请手动刷新页面重试。`)
      return
    }

    this._clearReconnectTimer()
    // 指数退避：1s, 2s, 4s, 8s, 16s, 32s, 60s (最�?60s)
    const baseDelay = 2000
    const maxDelay = MAX_RECONNECT_DELAY
    const exponentialDelay = Math.min(baseDelay * Math.pow(2, this._reconnectAttempts), maxDelay)
    // 首次连接（Gateway 可能还未启动）：使用更长的初始延�?    const delay = this._reconnectAttempts === 0
      ? INITIAL_RECONNECT_DELAY
      : Math.round(exponentialDelay * (0.5 + Math.random())) // 50%~150% 抖动，防止同步风�?
    this._reconnectAttempts++
    this._reconnectState = 'scheduled'
    this._pendingReconnect = true
    this._setConnected(false, 'reconnecting', `重连�?(${this._reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})�?{Math.round(delay/1000)}秒后...`)
    console.log(`[ws] 计划重连 (${this._reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})，延�?${Math.round(delay/1000)}秒`)
    this._reconnectTimer = setTimeout(() => {
      if (!this._intentionalClose) {
        this._reconnectState = 'attempting'
        this._doConnect()
      }
    }, delay)
  }

  _startPing() {
    this._stopPing()
    this._pingTimer = setInterval(() => {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        try { this._ws.send('{"type":"ping"}') } catch {}
      }
    }, PING_INTERVAL)
  }

  _stopPing() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer)
      this._pingTimer = null
    }
  }

  /**
   * 心跳检测：如果超过 HEARTBEAT_TIMEOUT 没有收到任何消息，触发重�?   * 这用于检�?Gateway 端崩溃或网络中断
   */
  _startHeartbeat() {
    this._stopHeartbeat()
    this._missedHeartbeats = 0
    this._heartbeatTimer = setInterval(() => {
      if (!this._connected || !this._gatewayReady) return

      const now = Date.now()
      const timeSinceLastMessage = this._lastMessageAt ? now - this._lastMessageAt : 0

      if (timeSinceLastMessage > HEARTBEAT_TIMEOUT) {
        this._missedHeartbeats++
        console.warn(`[ws] 心跳超时 (${Math.round(timeSinceLastMessage/1000)}�?，missedHeartbeats: ${this._missedHeartbeats}`)
        // 增加容忍度：连续 3 次超时（检查间�?30s × 3 = �?90s）才强制重连
        if (this._missedHeartbeats >= 3) {
          console.error('[ws] 心跳检测失败超�?次，强制重连')
          this._stopHeartbeat()
          this.reconnect()
        } else if (this._missedHeartbeats >= 2) {
          // 2 次超时：先尝试发 ping 探测，不行再重连
          console.warn('[ws] 心跳超时 2 次，发送探�?ping...')
          if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            try { this._ws.send('{"type":"ping"}') } catch {}
          }
        }
      }
    }, HEARTBEAT_TIMEOUT / 3) // �?30 秒检查一�?  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer)
      this._heartbeatTimer = null
    }
  }

  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this._ws || this._ws.readyState !== WebSocket.OPEN || !this._gatewayReady) {
        if (!this._intentionalClose && (this._reconnectAttempts > 0 || !this._gatewayReady)) {
          const waitTimeout = setTimeout(() => { unsub(); reject(new Error('等待重连超时')) }, 15000)
          const unsub = this.onReady((hello, sessionKey, err) => {
            clearTimeout(waitTimeout); unsub()
            if (err?.error) { reject(new Error(err.message || 'Gateway 握手失败')); return }
            this.request(method, params).then(resolve, reject)
          })
          return
        }
        return reject(new Error('WebSocket 未连�?))
      }
      const id = uuid()
      const timer = setTimeout(() => { this._pending.delete(id); reject(new Error('请求超时')) }, REQUEST_TIMEOUT)
      this._pending.set(id, { resolve, reject, timer })
      this._ws.send(JSON.stringify({ type: 'req', id, method, params }))
    })
  }

  chatSend(sessionKey, message, attachments) {
    const params = { sessionKey, message, deliver: false, idempotencyKey: uuid() }
    if (attachments && attachments.length > 0) {
      params.attachments = attachments
      console.log('[ws] 发送附�?', attachments.length, '�?)
      console.log('[ws] 附件详情:', attachments.map(a => ({ type: a.type, mime: a.mimeType, name: a.fileName, size: a.content?.length })))
    }
    return this.request('chat.send', params)
  }

  chatHistory(sessionKey, limit = 200) {
    return this.request('chat.history', { sessionKey, limit })
  }

  chatAbort(sessionKey, runId) {
    const params = { sessionKey }
    if (runId) params.runId = runId
    return this.request('chat.abort', params)
  }

  sessionsList(limit = 50) {
    return this.request('sessions.list', { limit })
  }

  sessionsDelete(key) {
    return this.request('sessions.delete', { key })
  }

  sessionsReset(key) {
    return this.request('sessions.reset', { key })
  }

  onEvent(callback) {
    this._eventListeners.push(callback)
    return () => { this._eventListeners = this._eventListeners.filter(fn => fn !== callback) }
  }

  // ==================== 消息缓存管理 ====================

  /**
   * 缓存消息
   * @param {string} sessionKey - 会话 key
   * @param {object} message - 消息对象
   */
  _cacheMessage(sessionKey, message) {
    if (!this._messageCache.has(sessionKey)) {
      this._messageCache.set(sessionKey, [])
    }
    const messages = this._messageCache.get(sessionKey)

    // 去重检查（基于消息 ID 或内容哈希）
    const msgId = message.id || message.messageId
    if (msgId && messages.some(m => (m.id || m.messageId) === msgId)) {
      return
    }

    messages.push({
      ...message,
      _cachedAt: Date.now(),
    })

    // 限制缓存大小
    if (messages.length > this._cacheSize) {
      messages.splice(0, messages.length - this._cacheSize)
    }
  }

  /**
   * 获取缓存的消�?   * @param {string} sessionKey - 会话 key
   * @returns {array} 缓存的消息数�?   */
  _getCachedMessages(sessionKey) {
    return this._messageCache.get(sessionKey) || []
  }

  /**
   * 清除指定会话的缓�?   * @param {string} sessionKey - 会话 key
   */
  _clearCache(sessionKey) {
    if (sessionKey) {
      this._messageCache.delete(sessionKey)
    } else {
      this._messageCache.clear()
    }
    console.log('[ws] 消息缓存已清�?', sessionKey || '全部')
  }

  /**
   * 清除消息去重记录
   */
  _clearSeenMessageIds() {
    this._seenMessageIds.clear()
  }

  /**
   * 获取缓存状态信�?   */
  getCacheInfo() {
    const info = {}
    for (const [key, messages] of this._messageCache) {
      info[key] = {
        count: messages.length,
        oldest: messages[0]?._cachedAt,
        newest: messages[messages.length - 1]?._cachedAt,
      }
    }
    return info
  }

  /**
   * 连接成功后自动拉取历史消息（供前端调用）
   * @param {string} sessionKey - 会话 key
   * @param {number} limit - 消息数量限制
   */
  async fetchHistoryOnReconnect(sessionKey, limit = 200) {
    if (!sessionKey || !this._gatewayReady) {
      return { error: 'not ready' }
    }
    try {
      const history = await this.chatHistory(sessionKey, limit)
      // 将历史消息缓存起�?      if (history?.messages) {
        for (const msg of history.messages) {
          this._cacheMessage(sessionKey, msg)
        }
      }
      return { history }
    } catch (e) {
      console.error('[ws] 拉取历史消息失败:', e)
      return { error: e.message }
    }
  }
}

const _g = typeof window !== 'undefined' ? window : globalThis
if (!_g.__deerpanelWsClient) _g.__deerpanelWsClient = new WsClient()
export const wsClient = _g.__deerpanelWsClient
