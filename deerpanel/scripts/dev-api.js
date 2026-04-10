/**
 * YTPanel 开发模式 API 插件
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
const AUTOMATIONS_DIR = path.join(homedir(), '.deerflow', 'automations')
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

// 内置热门 MCP 服务器精选列表
const HOT_MCP_SERVERS = [
  { slug: 'filesystem', name: 'Filesystem', description: '读写本地文件系统，管理文件和目录操作', install_cmd: 'npx -y @modelcontextprotocol/server-filesystem', stars: 9800 },
  { slug: 'fetch', name: 'Web Fetch', description: '抓取网页内容，获取互联网上的任意 URL 数据', install_cmd: 'npx -y @modelcontextprotocol/server-fetch', stars: 8700 },
  { slug: 'brave-search', name: 'Brave Search', description: '使用 Brave Search 引擎进行实时网络搜索', install_cmd: 'npx -y @modelcontextprotocol/server-brave-search', stars: 7500 },
  { slug: 'github', name: 'GitHub MCP Server', description: 'GitHub 仓库、Issue、PR、Actions 等全功能集成', install_cmd: 'npx -y @modelcontextprotocol/server-github', stars: 7200 },
  { slug: 'puppeteer', name: 'Puppeteer Browser', description: '基于 Chromium 的浏览器自动化，支持截图、点击、表单填写', install_cmd: 'npx -y @anthropic/mcp-server-puppeteer', stars: 6500 },
  { slug: 'memory', name: 'Memory Knowledge Graph', description: '持久化记忆存储，基于知识图谱的上下文管理', install_cmd: 'npx -y @modelcontextprotocol/server-memory', stars: 6100 },
  { slug: 'postgres', name: 'PostgreSQL', description: 'PostgreSQL 数据库查询和管理，安全执行 SQL', install_cmd: 'npx -y @modelcontextprotocol/server-postgres', stars: 5800 },
  { slug: 'slack', name: 'Slack', description: 'Slack 工作区消息收发、频道管理和用户信息获取', install_cmd: 'npx -y @modelcontextprotocol/server-slack', stars: 5200 },
  { slug: 'sequential-thinking', name: 'Sequential Thinking', description: '逐步推理思维链，增强复杂问题解决能力', install_cmd: 'npx -y @modelcontextprotocol/server-sequentialthinking', stars: 4900 },
  { slug: 'docker', name: 'Docker', description: 'Docker 容器、镜像和网络管理，执行容器操作命令', install_cmd: 'npx -y @modelcontextprotocol/server-docker', stars: 4600 },
  { slug: 'notion', name: 'Notion', description: 'Notion 页面、数据库和块级内容读写管理', install_cmd: 'npx -y@mcp/notion-server', stars: 4300 },
  { slug: 'aws-kb-retrieval', name: 'AWS Knowledge Base Retrieval', description: '从 Amazon Knowledge Bases 检索 RAG 知识文档', install_cmd: 'npx -y @aws-sdk/mcp-server-kb-retrieval', stars: 4000 },
  { slug: 'gdrive', name: 'Google Drive', description: 'Google Drive 文件搜索、上传下载和权限管理', install_cmd: 'npx -y @anthropic/mcp-server-google-drive', stars: 3800 },
  { stripe_name: 'stripe', name: 'Stripe', description: 'Stripe 支付、账单、客户和产品数据查询', install_cmd: 'npx -y @anthropic/mcp-server-stripe', stars: 3500 },
  { slug: 'everything', name: 'Everything (Windows Search)', description: 'Windows 本地文件极速搜索，基于 Everything 引擎', install_cmd: 'npx -y mcp-server-everything', stars: 3200 },
  { slug: 'supabase', name: 'Supabase', description: 'Supabase 数据库、Auth 和 Storage 服务集成', install_cmd: 'npx -y @supabase/mcp-supabase', stars: 3000 },
  { slug: 'obsidian', name: 'Obsidian', description: 'Obsidian 笔记库搜索、读取和链接管理', install_cmd: 'npx -y @modelcontextprotocol/server-obsidian', stars: 2800 },
  { slug: 'spotify', name: 'Spotify', description: 'Spotify 音乐播放控制、播放列表和推荐发现', install_cmd: 'npx -y @anthropic/mcp-server-spotify', stars: 2500 },
  { slug: 'calendar', name: 'Google Calendar', description: 'Google Calendar 日程创建、查询和提醒管理', install_cmd: 'npx -y @anthropic/mcp-server-google-calendar', stars: 2300 },
  { slug: 'time', name: 'World Time & Date', description: '全球时区时间查询、日期计算和定时任务', install_cmd: 'npx -y @modelcontextprotocol/server-time', stars: 2000 },
]

// ========== ClawHub Convex API 工具函数（独立于 handlers 对象，避免 this 上下文丢失）==========

/** 调用 ClawHub Convex 后端 */
async function callClawHubConvex(funcPath, args = {}) {
  const resp = await fetch('https://wry-manatee-359.convex.cloud/api/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'convex-client': 'npm-1.34.1' },
    body: JSON.stringify({ path: funcPath, args }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`ClawHub HTTP ${resp.status}: ${t.substring(0, 200)}`)
  }
  const data = await resp.json()
  if (data.status === 'error') throw new Error(data.errorMessage || 'Convex server error')
  return data.value
}

/** 将 Convex skill 对象映射为前端格式 */
function mapClawHubSkill(s) {
  return {
    slug: s.slug || '',
    name: s.displayName || s.name || '',
    description: s.summary || s.description || '',
    stars: s.stats?.stars || 0,
    downloads: s.stats?.downloads || 0,
    versionId: s.latestVersionId || '',
    tags: s.tags ? Object.keys(s.tags) : [],
    source: 'clawhub',
  }
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

  // ========== Skills 管理（对齐 Tauri skills_* 命令）==========

  async skills_list() {
    // 扫描本地 skills 目录
    const skillsDir = path.join(OPENCLAW_DIR, 'skills')
    if (!fs.existsSync(skillsDir)) {
      return { skills: [], source: 'local-scan', cliAvailable: false }
    }
    const skills = []
    try {
      for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const name = entry.name
        const skillMd = path.join(skillsDir, name, 'SKILL.md')
        let description = ''
        if (fs.existsSync(skillMd)) {
          const content = fs.readFileSync(skillMd, 'utf8')
          const m = content.match(/^description:\s*["']?(.+?)["']?$/m)
          if (m) description = m[1].trim()
        }
        skills.push({ name, description, source: 'managed', eligible: true, bundled: false, filePath: skillMd })
      }
    } catch (_) { /* ignore */ }
    return { skills, source: 'local-scan', cliAvailable: false }
  },

  async skills_info(args) {
    const name = String(args?.name || '').trim()
    if (!name) throw new Error('name is required')
    const skillMd = path.join(OPENCLAW_DIR, 'skills', name, 'SKILL.md')
    if (!fs.existsSync(skillMd)) throw new Error(`Skill「${name}」不存在`)
    return fs.readFileSync(skillMd, 'utf8')
  },

  async skills_check() {
    return { status: 'ok', node: true, message: 'dev mode skip' }
  },

  async skills_install_dep(args) {
    const kind = args?.kind || ''
    const spec = args?.spec || {}
    let cmdStr = ''
    if (kind === 'node') cmdStr = `npm install -g ${spec.package}`
    else if (kind === 'brew') cmdStr = `brew install ${spec.formula}`
    else if (kind === 'go') cmdStr = `go install ${spec.module}`
    else if (kind === 'uv') cmdStr = `uv tool install ${spec.package}`
    else throw new Error(`不支持的安装类型: ${kind}`)
    const { stdout, stderr } = await exec(cmdStr, { shell: true, windowsHide: true, timeout: 60_000 })
    return { success: true, output: `${stdout || ''}${stderr || ''}`.trim() }
  },

  async skills_skillhub_check() {
    try {
      await exec('skillhub --cli-version', { shell: true, timeout: 5_000 })
      return { installed: true, version: 'dev' }
    } catch {
      return { installed: false }
    }
  },

  async skills_skillhub_setup() {
    return { success: true, output: 'dev-mode: skip setup' }
  },

  // ========== ClawHub 技能市场（Convex 后端）==========

  /** 搜索/浏览技能（使用 skills:listPublicPageV4 分页接口）
   * - 有 query 时：拉取一页后在客户端过滤 slug / displayName / summary
   * - 无 query 时：返回按下载量排序的热门技能列表
   */
  async skills_skillhub_search(args) {
    const query = String(args?.query || '').trim().toLowerCase()
    const page = Math.max(1, Number(args?.page || 1))
    const pageSize = Math.min(50, Math.max(1, Number(args?.pageSize || 50)))

    try {
      // Convex API 要求 args 是数组格式: [ { ... } ]
      const convexArgs = {
        dir: 'desc',
        highlightedOnly: false,
        nonSuspiciousOnly: true,
        numItems: pageSize,
        sort: 'downloads',
      }
      // 翻页时传入 cursor
      if (page > 1 && args?.cursor) {
        convexArgs.cursor = String(args.cursor)
      }

      const result = await callClawHubConvex('skills:listPublicPageV4', convexArgs)

      let rawItems = []
      if (Array.isArray(result?.page)) rawItems = result.page
      else if (Array.isArray(result)) rawItems = result

      // 数据嵌套在 item.skill 子对象中！提取 skill
      const skills = rawItems.map(item => item?.skill || item)

      // 客户端关键词过滤
      let list = skills
      if (query) {
        const q = query
        list = list.filter(s =>
          (s.slug || '').toLowerCase().includes(q) ||
          (s.displayName || '').toLowerCase().includes(q) ||
          (s.summary || '').toLowerCase().includes(q)
        )
      }

      return {
        skills: list.map(mapClawHubSkill),
        hasMore: !!result?.nextCursor,
        cursor: result?.nextCursor || null,
        total: list.length,
      }
    } catch (e) {
      console.error('[skillhub] search failed:', e.message)
      return { skills: [], hasMore: false, cursor: null, total: 0, error: e.message }
    }
  },

  // 浏览热门技能（别名，直接走分页接口）
  async skills_skillhub_browse(args) {
    return handlers.skills_skillhub_search(args)
  },

  // 安装技能：从 ClawHub 下载 ZIP 并解压到本地
  async skills_skillhub_install(args) {
    const slug = String(args?.slug || '').trim()
    if (!slug) throw new Error('slug is required')

    const skillsDir = path.join(OPENCLAW_DIR, 'skills')
    fs.mkdirSync(skillsDir, { recursive: true })

    // 下载 ZIP
    const dlUrl = `https://wry-manatee-359.convex.site/api/v1/download?slug=${encodeURIComponent(slug)}`
    console.log(`[skillhub] downloading ${slug} from ${dlUrl}`)
    const resp = await fetch(dlUrl, { signal: AbortSignal.timeout(60_000) })
    if (!resp.ok) throw new Error(`下载失败 HTTP ${resp.status}`)

    const buf = Buffer.from(await resp.arrayBuffer())
    const tmpZip = path.join(OPENCLAW_DIR, `_tmp_${slug.replace(/\//g, '_')}.zip`)
    fs.writeFileSync(tmpZip, buf)

    // 解压（Windows 用 PowerShell Expand-Archive）
    const targetDir = path.join(skillsDir, slug.split('/').pop() || slug)
    if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true })
    fs.mkdirSync(targetDir, { recursive: true })

    await exec(
      `powershell -Command "Expand-Archive -Path '${tmpZip}' -DestinationPath '${targetDir}' -Force"`,
      { shell: true, windowsHide: true, timeout: 30_000 }
    )

    // 清理临时文件
    try { fs.unlinkSync(tmpZip) } catch (_) { /* ignore */ }

    return { success: true, slug, output: `已安装到 ${targetDir}` }
  },

  async skills_clawhub_search(args) {
    return this.skills_skillhub_search.call(this, args)
  },

  async skills_clawhub_install(args) {
    return this.skills_skillhub_install.call(this, args)
  },

  async skills_uninstall(args) {
    const name = String(args?.name || '').trim()
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) throw new Error('无效的 Skill 名称')
    const targetDir = path.join(OPENCLAW_DIR, 'skills', name)
    if (!fs.existsSync(targetDir)) throw new Error(`Skill「${name}」不存在`)
    fs.rmSync(targetDir, { recursive: true, force: true })
    return { success: true, name }
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

  // MCP 市场（内置精选列表 + 关键词搜索）
  async mcp_market_search(args) {
    const query = String(args?.query || '').trim().toLowerCase()
    let results = HOT_MCP_SERVERS
    if (query) {
      const q = query
      results = results.filter(s =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.description || '').toLowerCase().includes(q) ||
        (s.slug || '').toLowerCase().includes(q)
      )
    }
    return results
  },

  // ========== 定时任务 / Automation（对接 core/scheduler）==========

  async automation_list() {
    return { automations: _listAllAutomations() }
  },

  async automation_get(args) {
    const id = String(args?.id || '').trim()
    if (!id) throw new Error('id is required')
    const task = _loadAutomation(id)
    if (!task) throw new Error(`Automation '${id}' not found`)
    // 附带执行历史
    const hp = _historyPath(id)
    let history = []
    try { history = fs.readFileSync(hp, 'utf8').split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch {}
    return { id, ...task, history }
  },

  async automation_create(args) {
    const name = String(args?.name || '').trim()
    const prompt = String(args?.prompt || '').trim()
    if (!name) throw new Error('name is required')
    if (!prompt) throw new Error('prompt is required')

    const scheduleType = args?.schedule_type || 'recurring'
    let rrule = ''
    let scheduledAt = ''
    let schedule = ''

    if (scheduleType === 'once' && args?.scheduled_at) {
      scheduledAt = args.scheduled_at
      schedule = scheduledAt
    } else if (args?.rrule) {
      rrule = args.rrule
      schedule = rrule
    } else if (args?.cron_expr) {
      const converted = cronToRrule(args.cron_expr)
      rrule = converted.rrule
      scheduledAt = converted.scheduledAt || ''
      schedule = rrule || scheduledAt
    } else {
      rrule = 'FREQ=DAILY;INTERVAL=1;BYHOUR=9'
      schedule = rrule
    }

    const id = _genId()
    _saveAutomation(id, {
      name,
      prompt,
      schedule: args?.schedule || schedule,
      rrule,
      scheduled_at: scheduledAt || null,
      status: 'active',
      schedule_type: scheduleType,
      workspace: args?.workspace || null,
      valid_from: args?.valid_from || null,
      valid_until: args?.valid_until || null,
      max_duration_minutes: args?.max_duration_minutes || 30,
    })
    return { success: true, id, name, schedule_type: scheduleType, schedule: rrule || scheduledAt }
  },

  async automation_update(args) {
    const id = String(args?.id || '').trim()
    if (!id) throw new Error('id is required')
    const task = _loadAutomation(id)
    if (!task) throw new Error(`Automation '${id}' not found`)

    // 如果前端传了 cron_expr，转换后更新 rrule
    if (args?.cron_expr) {
      const conv = cronToRrule(args.cron_expr)
      args.rrule = conv.rrule || undefined
      if (conv.scheduledAt) args.scheduled_at = conv.scheduledAt
    }

    const updated = { ...task }
    // 允许显式传 null 来清除字段（如 scheduled_at 从一次性改周期性时需要清空）
    for (const k of ['name', 'prompt', 'schedule', 'rrule', 'scheduled_at', 'status',
                     'workspace', 'valid_from', 'valid_until', 'max_duration_minutes']) {
      if (k in args) updated[k] = (args[k] === null ? '' : args[k])
    }
    _saveAutomation(id, updated)
    return { success: true, id }
  },

  async automation_delete(args) {
    const id = String(args?.id || '').trim()
    if (!id) throw new Error('id is required')
    const f = path.join(AUTOMATIONS_DIR, `${id}.toml`)
    if (!fs.existsSync(f)) throw new Error(`Automation '${id}' not found`)
    fs.unlinkSync(f)
    // 清理历史文件
    const hp = _historyPath(id)
    if (fs.existsSync(hp)) fs.unlinkSync(hp)
    return { success: true, id }
  },

  async automation_run(args) {
    const id = String(args?.id || '').trim()
    if (!id) throw new Error('id is required')
    const task = _loadAutomation(id)
    if (!task) throw new Error(`Automation '${id}' not found`)
    // 记录一次手动触发的历史记录
    const record = {
      run_id: crypto.randomUUID().slice(0, 12),
      started_at: new Date().toISOString(),
      trigger_type: 'manual',
      status: 'triggered',
      output: '',
      error: '',
      duration_seconds: 0,
    }
    const hp = _historyPath(id)
    try { fs.appendFileSync(hp, JSON.stringify(record) + '\n', 'utf8') } catch {}
    return { success: true, id, run_id: record.run_id, message: 'Task triggered. Note: Full execution requires scheduler engine.' }
  },

  async automation_history(args) {
    const id = String(args?.id || '').trim()
    if (!id) throw new Error('id is required')
    const hp = _historyPath(id)
    let records = []
    try { records = fs.readFileSync(hp, 'utf8').split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch {}
    // 倒序，最新在前
    records.reverse()
    const limit = Math.min(50, Math.max(1, Number(args?.limit || 50)))
    return { id, runs: records.slice(0, limit), total: records.length }
  },

  async automation_start() {
    // 开发模式下返回模拟状态；生产模式走 Gateway 的 start action
    const tasks = _listAllAutomations()
    const active = tasks.filter(t => t.status === 'active').length
    return { state: 'running', active_timers: active, total_tasks: tasks.length }
  },

  async automation_stop() {
    return { state: 'stopped' }
  },

  async automation_pause(args) {
    const id = String(args?.id || '').trim()
    if (!id) throw new Error('id is required')
    const task = _loadAutomation(id)
    if (!task) throw new Error(`Automation '${id}' not found`)
    task.status = 'paused'
    _saveAutomation(id, task)
    return { success: true, id, status: 'paused' }
  },

  async automation_resume(args) {
    const id = String(args?.id || '').trim()
    if (!id) throw new Error('id is required')
    const task = _loadAutomation(id)
    if (!task) throw new Error(`Automation '${id}' not found`)
    task.status = 'active'
    _saveAutomation(id, task)
    return { success: true, id, status: 'active' }
  },
}

// ========== Cron ↔ RRULE 转换器 ==========

/** 解析标准 cron 表达式为结构化对象 */
function parseCronExpression(expr) {
  const parts = String(expr || '').trim().split(/\s+/)
  if (parts.length < 5 && parts.length > 6) throw new Error(`无效 cron 表达式: ${expr}`)
  const [minute = '*', hour = '*', dom = '*', month = '*', dow = '*'] = parts
  return { minute, hour, dom, month, dow }
}

/** 将 cron 表达式转换为 RRULE 格式 */
function cronToRrule(cronExpr) {
  const c = parseCronExpression(cronExpr)

  // 检查是否是一次性任务（scheduled_at 类型）
  if (/^\d{4}-\d{2}-\d{2}/.test(cronExpr)) {
    return { rrule: '', scheduleType: 'once', scheduledAt: cronExpr }
  }

  // 特殊关键字
  const kw = cronExpr.toLowerCase().trim()
  if (kw === '@hourly' || kw === '每小时') return { rrule: 'FREQ=HOURLY;INTERVAL=1', scheduleType: 'recurring' }
  if (kw === '@daily' || kw === '每天' || kw === 'daily') return { rrule: 'FREQ=DAILY;INTERVAL=1', scheduleType: 'recurring' }
  if (kw === '@weekly' || kw === '每周') return { rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR', scheduleType: 'recurring' }

  // 判断频率类型
  const isHourly = c.hour !== '*' && c.dom === '*' && c.month === '*' && (c.dow === '*' || c.dow === '?')
    && c.minute.match(/^\*|^\d+$/)
  if (isHourly) {
    const h = parseInt(c.hour, 10)
    const m = c.minute === '*' ? 0 : parseInt(c.minute, 10)
    // 简化为 hourly（精确到小时）
    return { rrule: `FREQ=HOURLY;INTERVAL=1`, scheduleType: 'recurring', byHour: h, byMinute: m }
  }

  const isDaily = c.hour !== '*' && c.dom === '*' && c.month === '*' && (c.dow === '*' || c.dow === '?')
  if (isDaily) {
    const h = parseInt(c.hour, 10)
    const m = c.minute === '*' ? 0 : parseInt(c.minute, 10)
    let rule = `FREQ=DAILY;INTERVAL=1`
    if (h !== 0) rule += `;BYHOUR=${h}`
    if (m !== 0) rule += `;BYMINUTE=${m}`
    return { rrule: rule, scheduleType: 'recurring' }
  }

  const isWeekly = c.dow !== '*' && c.dow !== '?' || (
    c.dom !== '*' && !c.dom.includes('/') && !c.dom.includes('-') && !c.dom.includes(',')
  )
  if (isWeekly) {
    const DOW_MAP = { 0: 'SU', 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA' }
    const days = []
    if (c.dow !== '*' && c.dow !== '?') {
      for (const d of c.dow.split(',')) {
        const n = parseInt(d.trim(), 10)
        if (!isNaN(n)) days.push(DOW_MAP[n] ?? d)
      }
    }
    const h = parseInt(c.hour, 10) || 9
    let rule = `FREQ=WEEKLY;INTERVAL=1`
    if (days.length) rule += `;BYDAY=${days.join(',')}`
    rule += `;BYHOUR=${h}`
    return { rrule: rule, scheduleType: 'recurring' }
  }

  // 默认 daily
  const dh = c.hour !== '*' ? parseInt(c.hour, 10) : 9
  return { rrule: `FREQ=DAILY;INTERVAL=1;BYHOUR=${dh}`, scheduleType: 'recurring' }
}

/** 从 RRULE 反推可读的 cron 表达式 */
function rruleToCron(rruleStr, scheduledAt) {
  if (scheduledAt) return scheduledAt
  if (!rruleStr) return '0 * * * *'
  try {
    const parts = {}
    for (const seg of rruleStr.toUpperCase().split(';')) {
      const [k, v] = seg.split('=').map(s => s.trim())
      if (k && v) parts[k] = v
    }
    const freq = parts.FREQ || ''
    const interval = parseInt(parts.INTERVAL || '1', 10)
    const hour = parseInt(parts.BYHOUR || '9', 10)
    const min = parseInt(parts.BYMINUTE || '0', 10)
    const byday = parts.BYDAY || ''

    switch (freq) {
      case 'HOURLY':
        return `0 */${interval} * * *`
      case 'DAILY': {
        if (byday && byday.includes(',')) {
          // 实际上是按周几的 daily
          const DOW_NUM = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }
          const nums = byday.split(',').map(d => DOW_NUM[d.trim()] ?? '?').join(',')
          return `${min} ${hour} * * ${nums}`
        }
        return `${min} ${hour} * * *`
      }
      case 'WEEKLY':
        if (byday) {
          const DOW_NUM = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }
          const nums = byday.split(',').map(d => DOW_NUM[d.trim()] ?? '?').join(',')
          return `${min} ${hour} * * ${nums}`
        }
        return `${min} ${hour} * * 1`  // default Monday
      default:
        return `${min} ${hour} * * *`
    }
  } catch { return '0 9 * * *' }
}

/** RRULE → 可读中文描述 */
function rruleToHuman(rruleStr, scheduleType, scheduledAt) {
  if (scheduleType === 'once' || scheduledAt) return `一次性: ${scheduledAt || rruleStr}`
  if (!rruleStr) return '每分钟'
  try {
    const parts = {}
    for (const seg of rruleStr.toUpperCase().split(';')) {
      const [k, v] = seg.split('=').map(s => s.trim())
      if (k && v) parts[k] = v
    }
    const freq = parts.FREQ || ''
    const interval = parseInt(parts.INTERVAL || '1', 10)
    const hour = parts.BYHOUR ? parseInt(parts.BYHOUR, 10) : null

    switch (freq) {
      case 'HOURLY': return interval > 1 ? `每 ${interval} 小时` : `每小时`
      case 'DAILY': {
        const timeStr = hour != null ? ` ${String(hour).padStart(2, '0')}:00` : ''
        return interval > 1 ? `每 ${interval} 天${timeStr}` : `每天${timeStr}`
      }
      case 'WEEKLY': {
        const DAY_CN = { MO: '周一', TU: '周二', WE: '周三', TH: '周四', FR: '周五', SA: '周六', SU: '周日' }
        const days = (parts.BYDAY || '').split(',').map(d => DAY_CN[d.trim()] || d).filter(Boolean)
        const dayStr = days.length ? `(${days.join(',')})` : '(工作日)'
        return interval > 1 ? `每 ${interval} 周 ${dayStr}` : `每周 ${dayStr}`
      }
      default: return rruleStr
    }
  } catch { return rruleStr }
}

// ========== Automation TOML 读写 ==========

const _ensureAutomationsDir = () => {
  if (!fs.existsSync(AUTOMATIONS_DIR)) fs.mkdirSync(AUTOMATIONS_DIR, { recursive: true })
}

function _parseTomlSimple(content) {
  /** 极简 TOML parser — 只处理我们需要的扁平键值对和基础类型 */
  const result = {}
  const lines = content.split(/\r?\n/)
  let currentSection = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const sectionMatch = trimmed.match(/^\[(.+)\]$/)
    if (sectionMatch) { currentSection = sectionMatch[1]; continue }
    const kvMatch = trimmed.match(/^(\w[\w.-]*)\s*=\s*(.+)$/)
    if (kvMatch) {
      const key = kvMatch[1]
      let value = kvMatch[2].trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      } else if (value === 'true') value = true
      else if (value === 'false') value = false
      else if (/^-?\d+(\.\d+)?$/.test(value)) value = parseFloat(value)
      if (currentSection) {
        if (!result[currentSection]) result[currentSection] = {}
        result[currentSection][key] = value
      } else {
        result[key] = value
      }
    }
  }
  return result
}

function _loadAutomation(id) {
  const f = path.join(AUTOMATIONS_DIR, `${id}.toml`)
  if (!fs.existsSync(f)) return null
  return _parseTomlSimple(fs.readFileSync(f, 'utf8'))
}

function _listAllAutomations() {
  _ensureAutomationsDir()
  const items = []
  try {
    for (const entry of fs.readdirSync(AUTOMATIONS_DIR)) {
      if (!entry.endsWith('.toml') || entry.endsWith('_history.jsonl')) continue
      const id = entry.replace(/\.toml$/, '')
      const task = _loadAutomation(id)
      if (task) items.push({ id, ...task })
    }
  } catch (_) {}
  return items
}

function _saveAutomation(id, data) {
  _ensureAutomationsDir()
  const lines = ['name = "' + String(data.name || '').replace(/"/g, '\\"') + '"']
  if (data.prompt) lines.push('prompt = "' + String(data.prompt).replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"')
  if (data.schedule) lines.push('schedule = "' + String(data.schedule) + '"')
  if (data.rrule) lines.push('rrule = "' + String(data.rrule) + '"')
  if (data.scheduled_at) lines.push('scheduled_at = "' + String(data.scheduled_at) + '"')
  if (data.status) lines.push('status = "' + data.status + '"')
  if (data.schedule_type) lines.push('schedule_type = "' + data.schedule_type + '"')
  if (data.workspace) lines.push('workspace = "' + String(data.workspace) + '"')
  if (data.valid_from) lines.push('valid_from = "' + data.valid_from + '"')
  if (data.valid_until) lines.push('valid_until = "' + data.valid_until + '"')
  if (data.max_duration_minutes) lines.push('max_duration_minutes = ' + Number(data.max_duration_minutes))
  lines.push('created_at = "' + (data.created_at || new Date().toISOString()) + '"')
  fs.writeFileSync(path.join(AUTOMATIONS_DIR, `${id}.toml`), lines.join('\n') + '\n', 'utf8')
}

function _genId() {
  return crypto.randomUUID().slice(0, 8)
}

function _historyPath(id) {
  return path.join(AUTOMATIONS_DIR, `${id}_history.jsonl`)
}

// 不需要认证的命令
const PUBLIC_CMDS = new Set(['health', 'auth_check', 'auth_login', 'auth_logout', 'list_agents', 'agents_list', 'agents_get', 'agents_create', 'agents_update', 'agents_delete', 'read_deerpanel_config', 'get_services_status', 'check_installation', 'get_version_info', 'get_status_summary', 'read_log_tail', 'search_log', 'assistant_read_file', 'assistant_write_file', 'assistant_exec', 'mcp_market_search', 'skills_list', 'skills_info', 'skills_check', 'skills_install_dep', 'skills_skillhub_check', 'skills_skillhub_setup', 'skills_skillhub_search', 'skills_skillhub_browse', 'skills_skillhub_install', 'skills_clawhub_search', 'skills_clawhub_install', 'skills_uninstall', 'automation_list', 'automation_create', 'automation_get', 'automation_update', 'automation_delete', 'automation_run', 'automation_history', 'automation_start', 'automation_stop', 'automation_pause', 'automation_resume'])

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
