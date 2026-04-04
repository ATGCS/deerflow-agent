/**
 * Tauri API 封装层
 * Tauri 环境用 invoke，Web 模式走 dev-api 后端
 */

const isTauri = !!window.__TAURI_INTERNALS__

// 兼容旧接口：返回 Gateway 直连地址
export function getBackendBaseURL() {
  const origin = window.location.origin
  if (origin.includes(':1420') || origin.includes(':1421')) {
    return origin.replace(/:\d+$/, ':8012')
  }
  if (origin === 'http://localhost' || /^http:\/\/localhost:\d+$/.test(origin)) {
    return origin.replace(/(:\d+)?$/, ':8012')
  }
  return origin || 'http://localhost:8012';
}

// 通过 Rust 后端代理访问 Gateway API（避免 CORS）
// - Tauri 桌面应用：走 Rust invoke
// - 浏览器开发模式：走 Vite 代理 fetch
async function gatewayProxy(method, path, body = null, query = null) {
  if (window.__TAURI__) {
    let result
    result = await window.__TAURI__.core.invoke('gateway_proxy', {
      request: { method, path: '/api' + path, body, query }
    })
    if (!result.ok) {
      throw new Error(result.error || `Gateway API ${method} ${path} failed: ${result.status}`)
    }
    return result.body
  }

  // 浏览器开发模式：通过 Vite 代理
  let url = `/api${path}`
  if (query && Object.keys(query).length > 0) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) params.append(k, v)
    url += '?' + params.toString()
  }
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let result
  try { result = JSON.parse(text) } catch { result = text }
  if (!res.ok) throw new Error(result?.detail || result?.error || `Gateway API failed: ${res.status}`)
  return result
}

// 预加载 Tauri invoke，避免每次 API 调用都做动态 import
const _invokeReady = isTauri
  ? import('@tauri-apps/api/core').then(m => m.invoke)
  : null

// 简单缓存：避免页面切换时重复请求后端
const _cache = new Map()
const _inflight = new Map() // in-flight 请求去重，防止缓存过期后同一命令并发 spawn 多个进程
const CACHE_TTL = 15000 // 15秒

// 网络请求日志（用于调试）
const _requestLogs = []
const MAX_LOGS = 100

function logRequest(cmd, args, duration, cached = false) {
  const log = {
    timestamp: Date.now(),
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false, fractionalSecondDigits: 3 }),
    cmd,
    args: JSON.stringify(args),
    duration: duration ? `${duration}ms` : '-',
    cached
  }
  _requestLogs.push(log)
  if (_requestLogs.length > MAX_LOGS) {
    _requestLogs.shift()
  }
}

// 导出日志供调试页面使用
export function getRequestLogs() {
  return _requestLogs.slice()
}

export function clearRequestLogs() {
  _requestLogs.length = 0
}

function cachedInvoke(cmd, args = {}, ttl = CACHE_TTL) {
  const key = cmd + JSON.stringify(args)
  const cached = _cache.get(key)
  if (cached && Date.now() - cached.ts < ttl) {
    logRequest(cmd, args, 0, true)
    return Promise.resolve(cached.val)
  }
  // in-flight 去重：同一个 key 的请求正在执行中，复用同一个 Promise
  // 避免缓存过期瞬间多个调用者同时 spawn 进程（ARM 设备上的 CPU 爆满根因）
  if (_inflight.has(key)) {
    return _inflight.get(key)
  }
  const p = invoke(cmd, args).then(val => {
    _cache.set(key, { val, ts: Date.now() })
    _inflight.delete(key)
    return val
  }).catch(err => {
    _inflight.delete(key)
    throw err
  })
  _inflight.set(key, p)
  return p
}

// 清除指定命令的缓存（写操作后调用）
function invalidate(...cmds) {
  for (const [k] of _cache) {
    if (cmds.some(c => k.startsWith(c))) _cache.delete(k)
  }
}

// 导出 invalidate 供外部使用
export { invalidate }

// 函数声明：确保在 gatewayProxy 调用之前已定义（函数声明会被 hoisting）
async function invoke(cmd, args = {}) {
  const start = Date.now()
  if (_invokeReady && !WEB_ONLY_CMDS.has(cmd)) {
    const tauriInvoke = await _invokeReady
    const result = await tauriInvoke(cmd, args)
    const duration = Date.now() - start
    logRequest(cmd, args, duration, false)
    return result
  }
  // Web 模式：调用 dev-api 后端（真实数据）
  const result = await webInvoke(cmd, args)
  const duration = Date.now() - start
  logRequest(cmd, args, duration, false)
  return result
}

// Web 模式：通过 Vite 开发服务器的 API 端点调用真实后端
async function webInvoke(cmd, args) {
  const resp = await fetch(`/__api/${cmd}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (resp.status === 401) {
    // Tauri 模式下不触发登录浮层（Tauri 有自己的认证流程）
    if (!isTauri && window.__clawpanel_show_login) window.__clawpanel_show_login()
    throw new Error('需要登录')
  }
  // 检测后端是否可用：如果返回的是 HTML（非 JSON），说明后端未运行
  const ct = (resp.headers.get('content-type') || '').toLowerCase()
  if (ct.includes('text/html') || ct.includes('text/plain')) {
    throw new Error('后端服务未运行，该功能需要 Web 部署模式')
  }
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }))
    throw new Error(data.error || `HTTP ${resp.status}`)
  }
  return resp.json()
}

function normalizeAgentToWebShape(agent) {
  const name = String(agent?.name || '').trim()
  const model = (typeof agent?.model === 'string')
    ? agent.model
    : (agent?.model?.primary || agent?.model?.id || null)
  const description = String(agent?.description || '').trim()
  return {
    name,
    description,
    model: model || null,
    tool_groups: Array.isArray(agent?.tool_groups) ? agent.tool_groups : null,
    soul: typeof agent?.soul === 'string' ? agent.soul : null,
    isDefault: !!agent?.isDefault || name === 'main',
  }
}

// 后端连接状态
let _backendOnline = null // null=未检测, true=在线, false=离线
const _backendListeners = []

export function onBackendStatusChange(fn) {
  _backendListeners.push(fn)
  return () => { const i = _backendListeners.indexOf(fn); if (i >= 0) _backendListeners.splice(i, 1) }
}

export function isBackendOnline() { return _backendOnline }

function _setBackendOnline(v) {
  if (_backendOnline !== v) {
    _backendOnline = v
    _backendListeners.forEach(fn => { try { fn(v) } catch {} })
  }
}

// 后端健康检查
export async function checkBackendHealth() {
  if (isTauri) { _setBackendOnline(true); return true }
  try {
    const resp = await fetch('/__api/health', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const ok = resp.ok
    _setBackendOnline(ok)
    return ok
  } catch {
    _setBackendOnline(false)
    return false
  }
}

// 配置保存后防抖重载 Gateway（3 秒内多次写入只触发一次重载）
let _reloadTimer = null
function _debouncedReloadGateway() {
  clearTimeout(_reloadTimer)
  _reloadTimer = setTimeout(() => { invoke('reload_gateway').catch(() => {}) }, 3000)
}

// 导出 API
export const api = {
  // 服务管理（状态用短缓存，操作不缓存）
  getServicesStatus: () => cachedInvoke('get_services_status', {}, 10000),
  startService: (label) => { invalidate('get_services_status'); return invoke('start_service', { label }) },
  stopService: (label) => { invalidate('get_services_status'); return invoke('stop_service', { label }) },
  restartService: (label) => { invalidate('get_services_status'); return invoke('restart_service', { label }) },
  guardianStatus: () => invoke('guardian_status'),

  // 配置（读缓存，写清缓存）
  // 状态检查（统一语义）
  systemVersion: () => cachedInvoke('get_version_info', {}, 30000),
  systemStatusSummary: () => cachedInvoke('get_status_summary', {}, 60000),
  systemInstallation: () => cachedInvoke('check_installation', {}, 60000),
  readOpenclawConfig: () => (isTauri ? cachedInvoke('read_openclaw_config') : Promise.resolve({})),
  writeOpenclawConfig: (config) => { invalidate('read_openclaw_config'); return invoke('write_openclaw_config', { config }).then(r => { _debouncedReloadGateway(); return r }) },
  readMcpConfig: () => cachedInvoke('read_mcp_config'),
  writeMcpConfig: (config) => { invalidate('read_mcp_config'); return invoke('write_mcp_config', { config }) },
  reloadGateway: () => invoke('reload_gateway'),
  restartGateway: () => invoke('restart_gateway'),
  listOpenclawVersions: (source = 'chinese') => invoke('list_openclaw_versions', { source }),
  upgradeOpenclaw: (source = 'chinese', version = null, method = 'auto') => invoke('upgrade_openclaw', { source, version, method }),
  uninstallOpenclaw: (cleanConfig = false) => invoke('uninstall_openclaw', { cleanConfig }),
  installGateway: () => invoke('install_gateway'),
  uninstallGateway: () => invoke('uninstall_gateway'),
  getNpmRegistry: () => cachedInvoke('get_npm_registry', {}, 30000),
  setNpmRegistry: (registry) => { invalidate('get_npm_registry'); return invoke('set_npm_registry', { registry }) },
  testModel: (baseUrl, apiKey, modelId, apiType = null) => invoke('test_model', { baseUrl, apiKey, modelId, apiType }),
  listRemoteModels: (baseUrl, apiKey, apiType = null) => invoke('list_remote_models', { baseUrl, apiKey, apiType }),

  // Agent 扩展能力（非 Gateway 标准协议）
  backupAgent: (id) => invoke('backup_agent', { id }),
  // Agent 管理（Web 版语义）
  listAgents: async () => {
    const data = await gatewayProxy('GET', '/agents');
    return data.agents || [];
  },
  getAgent: async (name) => {
    return gatewayProxy('GET', `/agents/${name}`);
  },
  createAgent: async (request) => {
    return gatewayProxy('POST', '/agents', request);
  },
  updateAgent: async (name, request) => {
    return gatewayProxy('PUT', `/agents/${name}`, request);
  },
  deleteAgent: async (name) => {
    return gatewayProxy('DELETE', `/agents/${name}`);
  },
  checkAgentName: async (name) => {
    return gatewayProxy('GET', '/agents/check', null, { name });
  },
  // 传统 Agent 接口（保持兼容）
  agentsList: async () => {
    const data = await invoke('agents_list')
    const agents = Array.isArray(data?.agents) ? data.agents : (Array.isArray(data) ? data : [])
    return { agents: agents.map(normalizeAgentToWebShape) }
  },
  agentsGet: async (name) => {
    const data = await api.agentsList()
    const found = (data.agents || []).find(a => a.name === name)
    if (!found) throw new Error(`Agent '${name}' not found`)
    return found
  },
  agentsCreate: async ({ name, description = '', model = null, tool_groups = null, soul = '' }) => {
    const res = await invoke('agents_create', { name, description, model, tool_groups, soul })
    invalidate('agents_list')
    return normalizeAgentToWebShape(res)
  },
  agentsUpdate: async (name, { description = null, model = null, tool_groups = null, soul = null }) => {
    const res = await invoke('agents_update', { name, description, model, tool_groups, soul })
    invalidate('agents_list')
    return normalizeAgentToWebShape(res)
  },
  agentsDelete: async (name) => {
    await invoke('agents_delete', { name })
    invalidate('agents_list')
    return { success: true }
  },

  // 聊天会话（统一接口入口，底层走 DeerFlow HTTP/SSE 客户端）
  chatSessionsList: async (limit = 50) => {
    const { wsClient } = await import('./ws-client.js')
    return wsClient.sessionsList(limit)
  },
  chatSessionsDelete: async (sessionKey) => {
    const { wsClient } = await import('./ws-client.js')
    return wsClient.sessionsDelete(sessionKey)
  },
  chatSessionsReset: async (sessionKey) => {
    const { wsClient } = await import('./ws-client.js')
    return wsClient.sessionsReset(sessionKey)
  },
  chatHistory: async (sessionKey, limit = 200) => {
    const { wsClient } = await import('./ws-client.js')
    return wsClient.chatHistory(sessionKey, limit)
  },
  chatSend: async (sessionKey, message, attachments = undefined) => {
    const { wsClient } = await import('./ws-client.js')
    return wsClient.chatSend(sessionKey, message, attachments)
  },
  chatGetRunStatus: async (sessionKey) => {
    const { wsClient } = await import('./ws-client.js')
    return wsClient.getSessionRunStatus(sessionKey)
  },
  chatCancelActiveRuns: async (sessionKey) => {
    const { wsClient } = await import('./ws-client.js')
    return wsClient.cancelSessionActiveRuns(sessionKey)
  },
  /** 取消 LangGraph 进程内所有 pending/running（释放全局 worker 池，避免新会话被旧任务堵死） */
  chatCancelAllGlobalRuns: async () => {
    const { wsClient } = await import('./ws-client.js')
    return wsClient.cancelAllGlobalRunsBestEffort()
  },
  chatAbort: async (sessionKey, runId = undefined) => {
    const { wsClient } = await import('./ws-client.js')
    return wsClient.chatAbort(sessionKey, runId)
  },
  chatUpdateContext: async (sessionKey, context) => {
    const { wsClient } = await import('./ws-client.js')
    wsClient.updateSessionContext(sessionKey, context)
    return { ok: true }
  },
  chatGetContext: async (sessionKey) => {
    const { wsClient } = await import('./ws-client.js')
    return { context: wsClient.getSessionContext(sessionKey) }
  },
  chatSuggestions: async (sessionKey, n = 3, modelName = undefined, recentMessages = undefined) => {
    const { wsClient } = await import('./ws-client.js')
    return wsClient.chatSuggestions(sessionKey, n, modelName, recentMessages)
  },

  // 日志（短缓存）
  readLogTail: (logName, lines = 100) => cachedInvoke('read_log_tail', { logName, lines }, 5000),
  searchLog: (logName, query, maxResults = 50) => invoke('search_log', { logName, query, maxResults }),

  // 记忆 API（global：不传 agentId；per-agent：`agents/{id}/memory.json`）
  getMemoryAgents: async () => gatewayProxy('GET', '/memory/agents'),
  getMemory: async (agentId) => {
    const q = agentId != null && String(agentId).trim() !== '' ? { agent: String(agentId).trim() } : null;
    return gatewayProxy('GET', '/memory', null, q);
  },
  reloadMemory: async (agentId) => {
    const q = agentId != null && String(agentId).trim() !== '' ? { agent: String(agentId).trim() } : null;
    return gatewayProxy('POST', '/memory/reload', null, q);
  },
  clearMemory: async (agentId) => {
    const q = agentId != null && String(agentId).trim() !== '' ? { agent: String(agentId).trim() } : null;
    return gatewayProxy('DELETE', '/memory', null, q);
  },
  deleteMemoryFact: async (factId, agentId) => {
    const q = agentId != null && String(agentId).trim() !== '' ? { agent: String(agentId).trim() } : null;
    return gatewayProxy('DELETE', `/memory/facts/${encodeURIComponent(factId)}`, null, q);
  },
  getMemoryConfig: async () => gatewayProxy('GET', '/memory/config'),
  getMemoryStatus: async (agentId) => {
    const q = agentId != null && String(agentId).trim() !== '' ? { agent: String(agentId).trim() } : null;
    return gatewayProxy('GET', '/memory/status', null, q);
  },

  // 记忆文件
  listMemoryFiles: (category, agentId) => cachedInvoke('list_memory_files', { category, agentId: agentId || null }),
  readMemoryFile: (path, agentId) => cachedInvoke('read_memory_file', { path, agentId: agentId || null }, 5000),
  writeMemoryFile: (path, content, category, agentId) => { invalidate('list_memory_files', 'read_memory_file'); return invoke('write_memory_file', { path, content, category: category || 'memory', agentId: agentId || null }) },
  deleteMemoryFile: (path, agentId) => { invalidate('list_memory_files'); return invoke('delete_memory_file', { path, agentId: agentId || null }) },
  exportMemoryZip: (category, agentId) => invoke('export_memory_zip', { category, agentId: agentId || null }),

  // 消息渠道管理
  readPlatformConfig: (platform) => invoke('read_platform_config', { platform }),
  saveMessagingPlatform: (platform, form, accountId) => { invalidate('list_configured_platforms', 'read_platform_config'); return invoke('save_messaging_platform', { platform, form, accountId: accountId || null }) },
  removeMessagingPlatform: (platform) => { invalidate('list_configured_platforms', 'read_platform_config'); return invoke('remove_messaging_platform', { platform }) },
  toggleMessagingPlatform: (platform, enabled) => { invalidate('list_configured_platforms', 'read_openclaw_config', 'read_platform_config'); return invoke('toggle_messaging_platform', { platform, enabled }) },
  verifyBotToken: (platform, form) => invoke('verify_bot_token', { platform, form }),
  listConfiguredPlatforms: () => cachedInvoke('list_configured_platforms', {}, 5000),
  getChannelPluginStatus: (pluginId) => invoke('get_channel_plugin_status', { pluginId }),
  installQqbotPlugin: () => invoke('install_qqbot_plugin'),
  installChannelPlugin: (packageName, pluginId) => invoke('install_channel_plugin', { packageName, pluginId }),

  // 面板配置 (clawpanel.json)
  readPanelConfig: () => (isTauri ? invoke('read_panel_config') : Promise.resolve({})),
  writePanelConfig: (config) => invoke('write_panel_config', { config }),
  testProxy: (url) => invoke('test_proxy', { url: url || null }),

  // 安装/部署
  initOpenclawConfig: () => { invalidate('check_installation'); return invoke('init_openclaw_config') },
  checkNode: () => cachedInvoke('check_node', {}, 60000),
  checkNodeAtPath: (nodeDir) => invoke('check_node_at_path', { nodeDir }),
  scanNodePaths: () => invoke('scan_node_paths'),
  saveCustomNodePath: (nodeDir) => invoke('save_custom_node_path', { nodeDir }).then(r => { invalidate('check_node', 'get_services_status'); invoke('invalidate_path_cache').catch(() => {}); return r }),
  invalidatePathCache: () => invoke('invalidate_path_cache'),
  checkGit: () => cachedInvoke('check_git', {}, 60000),
  autoInstallGit: () => invoke('auto_install_git'),
  configureGitHttps: () => invoke('configure_git_https'),
  getDeployConfig: () => cachedInvoke('get_deploy_config'),
  patchModelVision: () => invoke('patch_model_vision'),
  checkPanelUpdate: () => invoke('check_panel_update'),
  writeEnvFile: (path, config) => invoke('write_env_file', { path, config }),

  // 备份管理
  listBackups: () => cachedInvoke('list_backups'),
  createBackup: () => { invalidate('list_backups'); return invoke('create_backup') },
  restoreBackup: (name) => invoke('restore_backup', { name }),
  deleteBackup: (name) => { invalidate('list_backups'); return invoke('delete_backup', { name }) },

  // 设备密钥 + Gateway 握手
  createConnectFrame: (nonce, gatewayToken) => {
    if (!isTauri) {
      return Promise.resolve({
        type: 'req',
        id: `connect-${Date.now()}`,
        method: 'connect',
        params: { nonce: nonce || '', token: gatewayToken || '' },
      })
    }
    return invoke('create_connect_frame', { nonce, gatewayToken })
  },

  // 设备配对
  autoPairDevice: () => invoke('auto_pair_device'),
  checkPairingStatus: () => invoke('check_pairing_status'),
  pairingListChannel: (channel) => invoke('pairing_list_channel', { channel }),
  pairingApproveChannel: (channel, code, notify = false) => invoke('pairing_approve_channel', { channel, code, notify }),

  // AI 助手工具
  assistantExec: (command, cwd) => invoke('assistant_exec', { command, cwd: cwd || null }),
  assistantReadFile: (path) => invoke('assistant_read_file', { path }),
  assistantWriteFile: (path, content) => invoke('assistant_write_file', { path, content }),
  assistantListDir: (path) => invoke('assistant_list_dir', { path }),
  assistantSystemInfo: () => invoke('assistant_system_info'),
  assistantListProcesses: (filter) => invoke('assistant_list_processes', { filter: filter || null }),
  assistantCheckPort: (port) => invoke('assistant_check_port', { port }),
  assistantWebSearch: (query, maxResults) => invoke('assistant_web_search', { query, max_results: maxResults || 5 }),
  assistantFetchUrl: (url) => invoke('assistant_fetch_url', { url }),

  // 技能接口（Web 版语义）
  loadSkills: async () => {
    const data = await gatewayProxy('GET', '/skills');
    return data.skills || [];
  },
  enableSkill: async (skillName, enabled) => gatewayProxy('PUT', `/skills/${skillName}`, { enabled }),
  installSkill: async (request) => gatewayProxy('POST', '/skills/install', request),

  // MCP 工具 API
  getMCPConfig: async () => gatewayProxy('GET', '/mcp/config'),
  updateMCPConfig: async (mcpServers) => gatewayProxy('PUT', '/mcp/config', { mcp_servers: mcpServers }),

  // DeerFlaw 多渠道 API
  getChannelsStatus: async () => gatewayProxy('GET', '/channels'),
  restartChannel: async (name) => gatewayProxy('POST', `/channels/${name}/restart`),
  enableChannel: async (name, enabled) => gatewayProxy('POST', `/channels/${name}/enable`, { enabled }),
  getChannelConfig: async (name) => gatewayProxy('GET', `/channels/${name}/config`),
  updateChannelConfig: async (name, config) => gatewayProxy('PUT', `/channels/${name}/config`, config),

  // 传统技能接口（保持兼容）
  skillsCatalog: () => invoke('skills_list'),
  skillsDetail: (name) => invoke('skills_info', { name }),
  skillsHealth: () => invoke('skills_check'),
  skillsInstallDep: (kind, spec) => invoke('skills_install_dep', { kind, spec }),
  skillsSkillHubCheck: () => invoke('skills_skillhub_check'),
  skillsSkillHubSetup: (cliOnly = true) => invoke('skills_skillhub_setup', { cliOnly }),
  skillsSkillHubSearch: (query) => invoke('skills_skillhub_search', { query }),
  skillsSkillHubInstall: (slug) => invoke('skills_skillhub_install', { slug }),
  skillsClawHubSearch: (query) => invoke('skills_clawhub_search', { query }),
  skillsClawHubInstall: (slug) => invoke('skills_clawhub_install', { slug }),
  skillsUninstall: (name) => invoke('skills_uninstall', { name }),

  // 实例管理
  instanceList: () => (isTauri
    ? cachedInvoke('instance_list', {}, 10000)
    : Promise.resolve({ activeId: 'local', instances: [{ id: 'local', name: '本机', type: 'local' }] })),
  instanceAdd: (instance) => { if (!isTauri) return Promise.reject(new Error('Web 模式不支持实例管理')); invalidate('instance_list'); return invoke('instance_add', instance) },
  instanceRemove: (id) => { if (!isTauri) return Promise.reject(new Error('Web 模式不支持实例管理')); invalidate('instance_list'); return invoke('instance_remove', { id }) },
  instanceSetActive: (id) => { if (!isTauri) return Promise.resolve({ success: true, id: id || 'local' }); invalidate('instance_list'); _cache.clear(); return invoke('instance_set_active', { id }) },
  instanceHealthCheck: (id) => (isTauri ? invoke('instance_health_check', { id }) : Promise.resolve({ id, online: true })),
  instanceHealthAll: () => (isTauri ? invoke('instance_health_all') : Promise.resolve([{ id: 'local', online: true }])),


  // 前端热更新
  checkFrontendUpdate: () => (isTauri ? invoke('check_frontend_update') : Promise.resolve({ hasUpdate: false })),
  downloadFrontendUpdate: (url, expectedHash) => invoke('download_frontend_update', { url, expectedHash: expectedHash || '' }),
  rollbackFrontendUpdate: () => invoke('rollback_frontend_update'),
  getUpdateStatus: () => invoke('get_update_status'),

  // 数据目录 & 图片存储
  ensureDataDir: () => invoke('assistant_ensure_data_dir'),
  saveImage: (id, data) => invoke('assistant_save_image', { id, data }),
  loadImage: (id) => invoke('assistant_load_image', { id }),
  deleteImage: (id) => invoke('assistant_delete_image', { id }),

  // ========== 多智能体协作任务 ==========
  // 任务管理（任务为中心）
  listAllTasks: async () => gatewayProxy('GET', '/tasks'),
  getTask: async (taskId) => gatewayProxy('GET', `/tasks/${taskId}`),
  createTask: async (name, description = '') => gatewayProxy('POST', '/tasks', { name, description }),
  updateTask: async (taskId, data) => gatewayProxy('PUT', `/tasks/${taskId}`, data),
  deleteTask: async (taskId) => gatewayProxy('DELETE', `/tasks/${taskId}`),

  // 任务执行控制
  startTaskPlanning: async (taskId) => gatewayProxy('POST', `/tasks/${taskId}/start`),
  stopTaskExecution: async (taskId) => gatewayProxy('POST', `/tasks/${taskId}/stop`),

  // 子任务管理
  addSubtask: async (taskId, name, description = '', dependencies = []) =>
    gatewayProxy('POST', `/tasks/${taskId}/subtasks`, { name, description, dependencies }),
  listSubtasks: async (taskId) => gatewayProxy('GET', `/tasks/${taskId}/subtasks`),
  getSubtask: async (taskId, subtaskId) => gatewayProxy('GET', `/tasks/${taskId}/subtasks/${subtaskId}`),
  updateSubtask: async (taskId, subtaskId, data) => gatewayProxy('PUT', `/tasks/${taskId}/subtasks/${subtaskId}`, data),
  deleteSubtask: async (taskId, subtaskId) => gatewayProxy('DELETE', `/tasks/${taskId}/subtasks/${subtaskId}`),
  assignSubtask: async (taskId, subtaskId, agentId) => gatewayProxy('POST', `/tasks/${taskId}/subtasks/${subtaskId}/assign`, { agent_id: agentId }),

  // 任务记忆
  getTaskFacts: async (taskId) => gatewayProxy('GET', `/task-memory/tasks/${taskId}`),
  getTaskMemory: async (taskId) => gatewayProxy('GET', `/task-memory/tasks/${taskId}`),
  getSubtaskMemory: async (taskId, subtaskId) => gatewayProxy('GET', `/task-memory/subtasks/${subtaskId}`),
  searchTaskFacts: async (taskId, keyword) => gatewayProxy('GET', `/task-memory/tasks/${taskId}/search`, null, { keyword }),
  getTaskRuntime: async (taskId) => gatewayProxy('GET', `/task-memory/tasks/${taskId}/runtime`),
}
