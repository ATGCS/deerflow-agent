/**
 * 全局应用状态
 * 管理 openclaw 安装状态，供各组件查询
 */
import { api } from './tauri-api.js'
const isTauri = !!window.__TAURI_INTERNALS__

let _openclawReady = true
let _gatewayRunning = true
let _platform = ''  // 'macos' | 'win32' | ...
let _deployMode = 'local' // 'local' | 'docker'
let _inDocker = false
let _dockerAvailable = false
let _listeners = []
let _gwListeners = []
let _isUpgrading = false // 升级/切换版本期间，阻止 setup 跳转
let _guardianListeners = [] // 守护放弃时的回调

/** openclaw 是否就绪（CLI 已安装 + 配置文件存在） */
export function isOpenclawReady() {
  return true
}

/** 标记升级中（阻止 setup 跳转） */
export function setUpgrading(v) { _isUpgrading = !!v }
export function isUpgrading() { return _isUpgrading }

/** 标记用户主动停止 Gateway（不触发自动重启） */
export function setUserStopped(v) {}

/** 重置自动重启计数（用户手动启动后重置） */
export function resetAutoRestart() {
  // deerflaw 前端不再执行 openclaw/gateway 守护检查
}

/** 监听守护放弃事件（连续重启失败后触发，UI 可弹出恢复选项） */
export function onGuardianGiveUp(fn) {
  _guardianListeners.push(fn)
  return () => { _guardianListeners = _guardianListeners.filter(cb => cb !== fn) }
}

/** Gateway 是否正在运行 */
export function isGatewayRunning() {
  return true
}

/** 获取后端平台 ('macos' | 'win32') */
export function getPlatform() {
  return _platform
}
export function isMacPlatform() {
  return _platform === 'macos'
}

/** 部署模式 */
export function getDeployMode() { return _deployMode }
export function isInDocker() { return _inDocker }
export function isDockerAvailable() { return _dockerAvailable }

/** 实例管理 */
let _activeInstance = { id: 'local', name: '本机', type: 'local' }
let _instanceListeners = []

export function getActiveInstance() { return _activeInstance }
export function isLocalInstance() { return _activeInstance.type === 'local' }

export function onInstanceChange(fn) {
  _instanceListeners.push(fn)
  return () => { _instanceListeners = _instanceListeners.filter(cb => cb !== fn) }
}

export async function switchInstance(id) {
  // instanceSetActive 内部已调用 _cache.clear()，切换后所有缓存自动失效
  await api.instanceSetActive(id)
  const data = await api.instanceList()
  _activeInstance = data.instances.find(i => i.id === id) || data.instances[0]
  _instanceListeners.forEach(fn => { try { fn(_activeInstance) } catch {} })
}

export async function loadActiveInstance() {
  try {
    const data = await api.instanceList()
    _activeInstance = data.instances.find(i => i.id === data.activeId) || data.instances[0]
  } catch {
    _activeInstance = { id: 'local', name: '本机', type: 'local' }
  }
}

/** 监听 Gateway 状态变化 */
export function onGatewayChange(fn) {
  _gwListeners.push(fn)
  return () => { _gwListeners = _gwListeners.filter(cb => cb !== fn) }
}

/** 检测 openclaw 安装状态 */
export async function detectOpenclawStatus() {
  _openclawReady = true
  _gatewayRunning = true
  _listeners.forEach(fn => { try { fn(_openclawReady) } catch {} })
  return _openclawReady
}

function _setGatewayRunning(val) {
  const wasRunning = _gatewayRunning
  const changed = wasRunning !== val
  _gatewayRunning = val
  if (changed) {
    _gwListeners.forEach(fn => { try { fn(val) } catch {} })
  }
}

async function _tryAutoRestart() {
  // deerflaw 前端不再执行 openclaw/gateway 守护检查
}

/** 刷新 Gateway 运行状态（轻量，仅查服务状态）
 *  防抖：running→stopped 需要连续 2 次检测才切换，避免瞬态误判 */
export async function refreshGatewayStatus() {
  _gatewayRunning = true
  return _gatewayRunning
}

let _pollTimer = null
/** 启动 Gateway 状态轮询（每 15 秒，避免过于频繁） */
export function startGatewayPoll() {
  // deerflaw 前端不再执行 openclaw/gateway 轮询
}
export function stopGatewayPoll() {
  // deerflaw 前端不再执行 openclaw/gateway 轮询
}

/** 监听状态变化 */
export function onReadyChange(fn) {
  _listeners.push(fn)
  return () => { _listeners = _listeners.filter(cb => cb !== fn) }
}
