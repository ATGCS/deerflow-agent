/**
 * DeerPanel 开发模式 API 插件
 * 在 Vite 开发服务器上提供真实 API 端点
 */
import fs from 'fs'
import path from 'path'
import { homedir } from 'os'
import crypto from 'crypto'
import { exec as _exec } from 'child_process'
import { promisify } from 'util'

const OPENCLAW_DIR = path.join(homedir(), '.deerpanel')
const CONFIG_PATH = path.join(OPENCLAW_DIR, 'deerpanel.json')
const PANEL_CONFIG_PATH = path.join(OPENCLAW_DIR, 'deerpanel.json')
const DEERFLOW_GATEWAY_URL = process.env.DEERFLOW_GATEWAY_URL || 'http://localhost:2026'
const PROJECT_ROOT = process.env.DEERFLOW_PROJECT_ROOT || path.resolve(process.cwd(), '..')
const exec = promisify(_exec)

// 会话管理
const _sessions = new Map()
const SESSION_TTL = 24 * 60 * 60 * 1000

function parseCookies(req) {
  const cookie = req.headers.cookie || ''
  return Object.fromEntries(cookie.split(';').filter(Boolean).map(c => {
    const [k, v] = c.trim().split('=')
    return [k, decodeURIComponent(v || '')]
  }))
}

function isAuthenticated(req) {
  const cookies = parseCookies(req)
  const session = _sessions.get(cookies.deerpanel_session)
  return session && session.expires > Date.now()
}

function readPanelConfig() {
  try {
    return JSON.parse(fs.readFileSync(PANEL_CONFIG_PATH, 'utf8'))
  } catch {
    return {}
  }
}

async function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', chunk => data += chunk)
    req.on('end', () => {
      try {
        resolve(JSON.parse(data))
      } catch {
        resolve({})
      }
    })
  })
}

async function callGateway(pathname, options = {}) {
  const resp = await fetch(`${DEERFLOW_GATEWAY_URL}${pathname}`, options)
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const detail = data?.detail || data?.error || `Gateway returned ${resp.status}`
    throw new Error(String(detail))
  }
  return data
}

function resolveLogPath(logName) {
  const filename = ({
    gateway: 'gateway.log',
    'gateway-err': 'gateway.err.log',
    guardian: 'guardian.log',
    'guardian-backup': 'guardian-backup.log',
    'config-audit': 'config-audit.jsonl',
  })[String(logName || 'gateway')] || 'gateway.log'

  const candidates = [
    path.join(PROJECT_ROOT, 'logs', filename),                    // DeerFlow 脚本日志
    path.join(homedir(), '.openclaw', 'logs', filename),          // Tauri Rust 日志路径
    path.join(OPENCLAW_DIR, 'logs', filename),                    // 旧 dev-api 目录
  ]
  return candidates.find((p) => fs.existsSync(p)) || candidates[0]
}

function readTail(content, lines) {
  const all = String(content || '').split(/\r?\n/)
  const n = Math.max(1, Number(lines || 200))
  return all.slice(-n).join('\n').trim()
}

function resolveLocalPath(inputPath = '') {
  const raw = String(inputPath || '').trim()
  if (!raw) throw new Error('path is required')
  if (path.isAbsolute(raw)) return raw
  return path.resolve(PROJECT_ROOT, raw)
}

// 处理器
const handlers = {
  // 健康检查
  async health() {
    return { ok: true, ts: Date.now() }
  },

  // 认证相关
  async auth_check() {
    const cfg = readPanelConfig()
    const pw = cfg.accessPassword || ''
    const isDefault = pw === '123456'
    return {
      required: !!pw,
      authenticated: !pw || isAuthenticated({ headers: {} }),
      mustChangePassword: isDefault,
      defaultPassword: isDefault ? '123456' : undefined
    }
  },

  async auth_login(args, req) {
    const cfg = readPanelConfig()
    const pw = cfg.accessPassword || ''
    if (!pw) return { success: true }
    if (args.password !== pw) throw new Error('密码错误')
    const token = crypto.randomUUID()
    _sessions.set(token, { expires: Date.now() + SESSION_TTL })
    return { success: true, mustChangePassword: !!cfg.mustChangePassword, token }
  },

  async auth_status() {
    const cfg = readPanelConfig()
    return { hasPassword: !!cfg.accessPassword }
  },

  async auth_logout() {
    return { success: true }
  },

  // 配置读取
  async read_deerpanel_config() {
    return readPanelConfig()
  },

  // Agent 管理（对齐 Web /api/agents）
  async agents_list() {
    return callGateway('/api/agents')
  },

  async agents_get(args) {
    const name = String(args?.name || '').trim()
    if (!name) throw new Error('name is required')
    return callGateway(`/api/agents/${encodeURIComponent(name)}`)
  },

  async agents_create(args) {
    const body = {
      name: args?.name,
      description: args?.description || '',
      model: args?.model ?? null,
      tool_groups: args?.tool_groups ?? null,
      soul: args?.soul || '',
    }
    return callGateway('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  },

  async agents_update(args) {
    const name = String(args?.name || '').trim()
    if (!name) throw new Error('name is required')
    const body = {
      description: args?.description ?? null,
      model: args?.model ?? null,
      tool_groups: args?.tool_groups ?? null,
      soul: args?.soul ?? null,
    }
    return callGateway(`/api/agents/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  },

  async agents_delete(args) {
    const name = String(args?.name || '').trim()
    if (!name) throw new Error('name is required')
    await callGateway(`/api/agents/${encodeURIComponent(name)}`, { method: 'DELETE' })
    return { success: true }
  },

  // Agent 管理 - 兼容旧命令（映射到 agents_list）
  async list_agents() {
    try {
      const data = await callGateway('/api/agents')
      return (data.agents || []).map(agent => ({
        id: agent.name,
        isDefault: agent.name === 'main',
        identityName: agent.description || agent.name,
        identityEmoji: '',
        model: agent.model,
        workspace: null,
        tool_groups: agent.tool_groups,
        soul: agent.soul
      }))
    } catch (e) {
      console.error('[list_agents] 从 Gateway 获取失败:', e.message)
      return []
    }
  },

  // 其他命令返回空值或默认值
  async get_services_status() {
    return { status: 'unknown' }
  },

  async check_installation() {
    return { installed: true }
  },

  async get_version_info() {
    return { version: '0.0.0' }
  },

  async get_status_summary() {
    return {}
  },

  // 助手文件/命令能力（供服务管理页面等复用）
  async assistant_read_file(args) {
    const p = resolveLocalPath(args?.path)
    return fs.readFileSync(p, 'utf8')
  },

  async assistant_write_file(args) {
    const p = resolveLocalPath(args?.path)
    const content = String(args?.content ?? '')
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content, 'utf8')
    return { success: true, path: p }
  },

  async assistant_exec(args) {
    const command = String(args?.command || '').trim()
    if (!command) throw new Error('command is required')
    const cwd = args?.cwd ? resolveLocalPath(args.cwd) : PROJECT_ROOT
    const { stdout, stderr } = await exec(command, {
      cwd,
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 1024 * 1024 * 8,
      shell: true,
    })
    return `${stdout || ''}${stderr || ''}`.trim()
  },

  // 日志读取（对齐 Tauri 命令）
  async read_log_tail(args) {
    const p = resolveLogPath(args?.logName || args?.log_name || 'gateway')
    if (!fs.existsSync(p)) return ''
    const raw = fs.readFileSync(p, 'utf8')
    return readTail(raw, args?.lines)
  },

  async search_log(args) {
    const p = resolveLogPath(args?.logName || args?.log_name || 'gateway')
    if (!fs.existsSync(p)) return []
    const query = String(args?.query || '').trim().toLowerCase()
    if (!query) return []
    const maxResults = Math.max(1, Number(args?.maxResults || args?.max_results || 50))
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/)
    const matched = lines.filter((l) => l.toLowerCase().includes(query))
    return matched.slice(-maxResults)
  },
}

// 不需要认证的命令
const PUBLIC_CMDS = new Set(['health', 'auth_check', 'auth_login', 'auth_logout', 'list_agents', 'agents_list', 'agents_get', 'agents_create', 'agents_update', 'agents_delete', 'read_deerpanel_config', 'get_services_status', 'check_installation', 'get_version_info', 'get_status_summary', 'read_log_tail', 'search_log', 'assistant_read_file', 'assistant_write_file', 'assistant_exec'])

// API 中间件
async function _apiMiddleware(req, res, next) {
  if (!req.url?.startsWith('/__api/')) return next()

  const cmd = req.url.slice(7).split('?')[0]
  const handler = handlers[cmd]

  res.setHeader('Content-Type', 'application/json')

  try {
    // 公开接口不需要认证
    const cfg = readPanelConfig()
    const pw = cfg.accessPassword || ''
    if (!PUBLIC_CMDS.has(cmd) && pw && !isAuthenticated(req)) {
      res.statusCode = 401
      res.end(JSON.stringify({ error: '未登录', code: 'AUTH_REQUIRED' }))
      return
    }

    if (!handler) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: `未实现的命令: ${cmd}` }))
      return
    }

    const args = await readBody(req)
    const result = await handler(args, req)
    res.end(JSON.stringify(result))
  } catch (e) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: e.message || String(e) }))
  }
}

// 导出插件
export function devApiPlugin() {
  return {
    name: 'deerpanel-dev-api',
    configureServer(server) {
      server.middlewares.use(_apiMiddleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(_apiMiddleware)
    },
  }
}

export { _apiMiddleware }
