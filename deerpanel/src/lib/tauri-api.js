/**
 * Tauri API 封装层
 * Tauri 环境用 invoke，Web 模式走 dev-api 后端
 */

const isTauri = !!window.__TAURI_INTERNALS__

// 获取后端基础 URL
export function getBackendBaseURL() {
  const origin = window.location.origin
  // Tauri 桌面应用可能运行在端口 1420 或 1421，或者没有端口（如 http://localhost）
  if (origin.includes(':1420') || origin.includes(':1421')) {
    return origin.replace(/:\d+$/, ':2026')
  }
  // 如果 origin 是 http://localhost 或 http://localhost:xxx 但不是 2026，添加端口 2026
  if (origin === 'http://localhost' || /^http:\/\/localhost:\d+$/.test(origin)) {
    return origin.replace(/(:\d+)?$/, ':2026')
  }
  return origin || 'http://localhost:2026';
}

// 仅在 Node.js 后端实现的命令（Tauri Rust 不处理），强制走 webInvoke
const WEB_ONLY_CMDS = new Set([
  'agents_list', 'agents_get', 'agents_create', 'agents_update', 'agents_delete',
])

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
    const response = await fetch(`${getBackendBaseURL()}/api/agents`);
    if (!response.ok) throw new Error(`Failed to load agents: ${response.statusText}`);
    const data = await response.json();
    return data.agents || [];
  },
  getAgent: async (name) => {
    const response = await fetch(`${getBackendBaseURL()}/api/agents/${name}`);
    if (!response.ok) throw new Error(`Agent '${name}' not found`);
    return response.json();
  },
  createAgent: async (request) => {
    const response = await fetch(`${getBackendBaseURL()}/api/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail ?? `Failed to create agent: ${response.statusText}`);
    }
    return response.json();
  },
  updateAgent: async (name, request) => {
    const response = await fetch(`${getBackendBaseURL()}/api/agents/${name}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail ?? `Failed to update agent: ${response.statusText}`);
    }
    return response.json();
  },
  deleteAgent: async (name) => {
    const response = await fetch(`${getBackendBaseURL()}/api/agents/${name}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error(`Failed to delete agent: ${response.statusText}`);
  },
  checkAgentName: async (name) => {
    const response = await fetch(
      `${getBackendBaseURL()}/api/agents/check?name=${encodeURIComponent(name)}`
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(
        err.detail ?? `Failed to check agent name: ${response.statusText}`
      );
    }
    return response.json();
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

  // 记忆 API
  getMemory: async () => {
    const response = await fetch(`${getBackendBaseURL()}/api/memory`);
    if (!response.ok) throw new Error(`Failed to load memory: ${response.statusText}`);
    return response.json();
  },
  reloadMemory: async () => {
    const response = await fetch(`${getBackendBaseURL()}/api/memory/reload`, { method: 'POST' });
    if (!response.ok) throw new Error(`Failed to reload memory: ${response.statusText}`);
    return response.json();
  },
  clearMemory: async () => {
    const response = await fetch(`${getBackendBaseURL()}/api/memory`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Failed to clear memory: ${response.statusText}`);
    return response.json();
  },
  deleteMemoryFact: async (factId) => {
    const response = await fetch(`${getBackendBaseURL()}/api/memory/facts/${factId}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Failed to delete memory fact: ${response.statusText}`);
    return response.json();
  },
  getMemoryConfig: async () => {
    const response = await fetch(`${getBackendBaseURL()}/api/memory/config`);
    if (!response.ok) throw new Error(`Failed to load memory config: ${response.statusText}`);
    return response.json();
  },
  getMemoryStatus: async () => {
    const response = await fetch(`${getBackendBaseURL()}/api/memory/status`);
    if (!response.ok) throw new Error(`Failed to load memory status: ${response.statusText}`);
    return response.json();
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
    const response = await fetch(`${getBackendBaseURL()}/api/skills`);
    const json = await response.json();
    return json.skills || [];
  },
  enableSkill: async (skillName, enabled) => {
    const response = await fetch(
      `${getBackendBaseURL()}/api/skills/${skillName}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enabled,
        }),
      },
    );
    return response.json();
  },
  installSkill: async (request) => {
    const response = await fetch(`${getBackendBaseURL()}/api/skills/install`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.detail ?? `HTTP ${response.status}: ${response.statusText}`;
      return {
        success: false,
        skill_name: "",
        message: errorMessage,
      };
    }

    return response.json();
  },

  // MCP 工具 API
  getMCPConfig: async () => {
    const response = await fetch(`${getBackendBaseURL()}/api/mcp/config`);
    if (!response.ok) throw new Error(`Failed to load MCP config: ${response.statusText}`);
    return response.json();
  },
  updateMCPConfig: async (mcpServers) => {
    const response = await fetch(`${getBackendBaseURL()}/api/mcp/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mcp_servers: mcpServers }),
    });
    if (!response.ok) throw new Error(`Failed to update MCP config: ${response.statusText}`);
    return response.json();
  },

  // DeerFlaw 多渠道 API
  getChannelsStatus: async () => {
    const response = await fetch(`${getBackendBaseURL()}/api/channels`);
    if (!response.ok) throw new Error(`Failed to get channels status: ${response.statusText}`);
    return response.json();
  },
  restartChannel: async (name) => {
    const response = await fetch(`${getBackendBaseURL()}/api/channels/${name}/restart`, { method: 'POST' });
    if (!response.ok) throw new Error(`Failed to restart channel: ${response.statusText}`);
    return response.json();
  },
  enableChannel: async (name, enabled) => {
    const response = await fetch(`${getBackendBaseURL()}/api/channels/${name}/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (!response.ok) throw new Error(`Failed to enable/disable channel: ${response.statusText}`);
    return response.json();
  },
  getChannelConfig: async (name) => {
    const response = await fetch(`${getBackendBaseURL()}/api/channels/${name}/config`);
    if (!response.ok) throw new Error(`Failed to get channel config: ${response.statusText}`);
    return response.json();
  },
  updateChannelConfig: async (name, config) => {
    const response = await fetch(`${getBackendBaseURL()}/api/channels/${name}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!response.ok) throw new Error(`Failed to update channel config: ${response.statusText}`);
    return response.json();
  },

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
  listAllTasks: async () => {
    const response = await fetch(`${getBackendBaseURL()}/api/tasks`);
    if (!response.ok) throw new Error(`Failed to list tasks: ${response.statusText}`);
    return response.json();
  },
  getTask: async (taskId) => {
    const response = await fetch(`${getBackendBaseURL()}/api/tasks/${taskId}`);
    if (!response.ok) throw new Error(`Failed to get task: ${response.statusText}`);
    return response.json();
  },
  createTask: async (name, description = '') => {
    const response = await fetch(`${getBackendBaseURL()}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
    });
    if (!response.ok) throw new Error(`Failed to create task: ${response.statusText}`);
    return response.json();
  },
  updateTask: async (taskId, data) => {
    const response = await fetch(`${getBackendBaseURL()}/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(`Failed to update task: ${response.statusText}`);
    return response.json();
  },
  deleteTask: async (taskId) => {
    const response = await fetch(`${getBackendBaseURL()}/api/tasks/${taskId}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Failed to delete task: ${response.statusText}`);
    return response.json();
  },

  // 任务执行控制
  startTaskPlanning: async (taskId) => {
    const response = await fetch(`${getBackendBaseURL()}/api/tasks/${taskId}/start`, { method: 'POST' });
    if (!response.ok) throw new Error(`Failed to start task: ${response.statusText}`);
    return response.json();
  },
  stopTaskExecution: async (taskId) => {
    const response = await fetch(`${getBackendBaseURL()}/api/tasks/${taskId}/stop`, { method: 'POST' });
    if (!response.ok) throw new Error(`Failed to stop task: ${response.statusText}`);
    return response.json();
  },

  // 子任务管理
  addSubtask: async (taskId, name, description = '', dependencies = []) => {
    const response = await fetch(`${getBackendBaseURL()}/api/tasks/${taskId}/subtasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, dependencies }),
    });
    if (!response.ok) throw new Error(`Failed to add subtask: ${response.statusText}`);
    return response.json();
  },
  listSubtasks: async (taskId) => {
    const response = await fetch(`${getBackendBaseURL()}/api/tasks/${taskId}/subtasks`);
    if (!response.ok) throw new Error(`Failed to list subtasks: ${response.statusText}`);
    return response.json();
  },
  getSubtask: async (taskId, subtaskId) => {
    const response = await fetch(`${getBackendBaseURL()}/api/tasks/${taskId}/subtasks/${subtaskId}`);
    if (!response.ok) throw new Error(`Failed to get subtask: ${response.statusText}`);
    return response.json();
  },
  updateSubtask: async (taskId, subtaskId, data) => {
    const response = await fetch(`${getBackendBaseURL()}/api/tasks/${taskId}/subtasks/${subtaskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(`Failed to update subtask: ${response.statusText}`);
    return response.json();
  },
  deleteSubtask: async (taskId, subtaskId) => {
    const response = await fetch(`${getBackendBaseURL()}/api/tasks/${taskId}/subtasks/${subtaskId}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Failed to delete subtask: ${response.statusText}`);
    return response.json();
  },
  assignSubtask: async (taskId, subtaskId, agentId) => {
    const response = await fetch(`${getBackendBaseURL()}/api/tasks/${taskId}/subtasks/${subtaskId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId }),
    });
    if (!response.ok) throw new Error(`Failed to assign subtask: ${response.statusText}`);
    return response.json();
  },

  // 任务记忆
  getTaskFacts: async (taskId) => {
    // Backend doesn't implement GET `/api/task-memory/tasks/{taskId}/facts`.
    // Use the canonical endpoint and read `facts` from TaskMemoryResponse.
    const response = await fetch(`${getBackendBaseURL()}/api/task-memory/tasks/${taskId}`);
    if (!response.ok) throw new Error(`Failed to get task memory: ${response.statusText}`);
    return response.json();
  },
  getTaskMemory: async (taskId) => {
    const response = await fetch(`${getBackendBaseURL()}/api/task-memory/tasks/${taskId}`);
    if (!response.ok) throw new Error(`Failed to get task memory: ${response.statusText}`);
    return response.json();
  },
  getSubtaskMemory: async (taskId, subtaskId) => {
    const response = await fetch(`${getBackendBaseURL()}/api/task-memory/subtasks/${subtaskId}`);
    if (!response.ok) throw new Error(`Failed to get subtask memory: ${response.statusText}`);
    return response.json();
  },
  searchTaskFacts: async (taskId, keyword) => {
    const response = await fetch(`${getBackendBaseURL()}/api/task-memory/tasks/${taskId}/search?keyword=${encodeURIComponent(keyword)}`);
    if (!response.ok) throw new Error(`Failed to search task facts: ${response.statusText}`);
    return response.json();
  },
  getTaskRuntime: async (taskId) => {
    const response = await fetch(`${getBackendBaseURL()}/api/task-memory/tasks/${taskId}/runtime`);
    if (!response.ok) throw new Error(`Failed to get task runtime: ${response.statusText}`);
    return response.json();
  },
}
