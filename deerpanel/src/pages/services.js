/**
 * 服务管理页面（DeerFlow 版）
 * DeerFlow 服务启停 + DeerFlow 配置在线编辑
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { classifyHealthSource, getHealthProbeCandidates } from '../lib/services-health.js'
import { readConfigWithFallback } from '../lib/services-config.js'
import { navigate } from '../router.js'

const POLL_INTERVAL = 1200
const POLL_TIMEOUT = 25000
const STORAGE_CONFIG_PATH_KEY = 'deerpanel.deerflow.config.path'
const STORAGE_PROJECT_ROOT_KEY = 'deerpanel.deerflow.project.root'
let _configOriginal = ''
let _configPath = ''
let _primaryServiceLabel = ''

function escapeHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function serviceDisplayName(label) {
  if (label === 'ai.openclaw.gateway') return 'DeerFlow API'
  if (label === 'ai.openclaw.node') return 'DeerFlow Node Host'
  return label
}

function pickPrimaryService(services) {
  if (!services?.length) return ''
  const preferred = services.find((s) => /gateway|api|deerflow/i.test(String(s.label || '')))
  return (preferred || services[0]).label || ''
}

function getSavedConfigPath() {
  try { return localStorage.getItem(STORAGE_CONFIG_PATH_KEY) || '' } catch { return '' }
}

function setSavedConfigPath(path) {
  try { localStorage.setItem(STORAGE_CONFIG_PATH_KEY, path || '') } catch {}
}

function getSavedProjectRoot() {
  try { return localStorage.getItem(STORAGE_PROJECT_ROOT_KEY) || 'D:\\github\\deerflaw' } catch { return 'D:\\github\\deerflaw' }
}

function setSavedProjectRoot(path) {
  try { localStorage.setItem(STORAGE_PROJECT_ROOT_KEY, path || '') } catch {}
}

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'
  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">服务管理</h1>
      <p class="page-desc">在此启动/停止 DeerFlow 服务，并在线编辑 DeerFlow 配置</p>
    </div>
    <div id="gateway-health" class="service-card" style="margin-bottom:var(--space-sm)">
      <div class="service-info">
        <span class="status-dot stopped"></span>
        <div>
          <div class="service-name">服务健康检查</div>
          <div class="service-desc">检测中...</div>
        </div>
      </div>
      <div class="service-actions">
        <button class="btn btn-secondary btn-sm" data-action="refresh-health">刷新健康状态</button>
        <button class="btn btn-secondary btn-sm" data-action="restart-deerflow-dev">按脚本重启</button>
        <button class="btn btn-secondary btn-sm" data-action="open-logs">查看运行日志</button>
      </div>
    </div>
    <div id="services-list"><div class="stat-card loading-placeholder" style="height:72px"></div></div>
    <div class="config-section" id="config-editor-section">
      <div class="config-section-title">DeerFlow 配置（在线编辑）</div>
      <div class="form-hint" style="margin-bottom:var(--space-sm)">先配置 DeerFlow 项目地址，系统将自动定位 config.yaml。</div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:var(--space-sm)">
        <input id="project-root-input" class="form-input" placeholder="项目地址，例如 D:\\github\\deerflaw" style="min-width:360px;flex:1" />
        <button class="btn btn-secondary btn-sm" data-action="apply-project-root">使用此地址</button>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:var(--space-sm)">
        <button class="btn btn-primary btn-sm" data-action="save-config" disabled>保存并重启服务</button>
        <button class="btn btn-secondary btn-sm" data-action="save-config-only" disabled>仅保存配置</button>
        <button class="btn btn-secondary btn-sm" data-action="reload-config">重新加载</button>
      </div>
      <div id="config-editor-status" style="font-size:var(--font-size-xs);margin-bottom:6px;min-height:18px"></div>
      <textarea id="config-editor-area" class="form-input" style="font-family:var(--font-mono);font-size:12px;min-height:320px;resize:vertical;tab-size:2;white-space:pre;overflow-x:auto" spellcheck="false" disabled></textarea>
    </div>
  `
  bindEvents(page)
  await Promise.all([loadGatewayHealth(page), loadServices(page), loadConfigEditor(page)])
  return page
}

async function loadGatewayHealth(page) {
  const box = page.querySelector('#gateway-health')
  if (!box) return
  const dot = box.querySelector('.status-dot')
  const name = box.querySelector('.service-name')
  const desc = box.querySelector('.service-desc')
  const hit = await probeGatewayHealth()
  if (hit.ok) {
    const meta = classifyHealthSource(hit.url)
    dot.classList.remove('stopped')
    dot.classList.add('running')
    name.textContent = meta.title
    desc.textContent = `健康：${hit.url} · ${hit.summary || 'healthy'} · ${meta.tip}`
  } else {
    dot.classList.remove('running')
    dot.classList.add('stopped')
    name.textContent = '服务健康检查'
    desc.textContent = '未连通。已探测地址：http://localhost:2024/'
  }
}

async function loadServices(page) {
  const container = page.querySelector('#services-list')
  try {
    const services = await api.getServicesStatus()
    _primaryServiceLabel = pickPrimaryService(services)
    if (!services?.length) {
      container.innerHTML = ''
      return
    }
    container.innerHTML = services.map((svc) => {
      const running = !!svc.running
      const statusText = running ? '运行中' : '已停止'
      const pidText = svc.pid ? ` · PID ${svc.pid}` : ''
      const desc = `${statusText}${pidText}${svc.description ? ` · ${svc.description}` : ''}`
      return `
        <div class="service-card" data-label="${escapeHtml(svc.label)}">
          <div class="service-info">
            <span class="status-dot ${running ? 'running' : 'stopped'}"></span>
            <div>
              <div class="service-name">${escapeHtml(serviceDisplayName(svc.label))}</div>
              <div class="service-desc">${escapeHtml(desc)}</div>
            </div>
          </div>
          <div class="service-actions">
            ${running
              ? `<button class="btn btn-secondary btn-sm" data-action="restart-service" data-label="${escapeHtml(svc.label)}">重启</button>
                 <button class="btn btn-danger btn-sm" data-action="stop-service" data-label="${escapeHtml(svc.label)}">停止</button>`
              : `<button class="btn btn-primary btn-sm" data-action="start-service" data-label="${escapeHtml(svc.label)}">启动</button>`
            }
            <button class="btn btn-secondary btn-sm" data-action="refresh-services">刷新</button>
          </div>
        </div>
      `
    }).join('')
  } catch (e) {
    container.innerHTML = `<div class="service-card"><div class="service-info"><span class="status-dot stopped"></span><div><div class="service-name">DeerFlow Services</div><div class="service-desc">读取服务状态失败：${escapeHtml(String(e))}</div></div></div><div class="service-actions"><button class="btn btn-secondary btn-sm" data-action="refresh-services">重试</button></div></div>`
  }
}

async function loadConfigEditor(page) {
  const area = page.querySelector('#config-editor-area')
  const status = page.querySelector('#config-editor-status')
  const projectInput = page.querySelector('#project-root-input')
  const btnSave = page.querySelector('[data-action="save-config"]')
  const btnSaveOnly = page.querySelector('[data-action="save-config-only"]')
  try {
    const projectRoot = String(projectInput?.value || getSavedProjectRoot() || '').trim()
    if (projectInput) projectInput.value = projectRoot
    const { path, content } = await readDeerflowConfig(projectRoot)
    _configPath = path
    _configOriginal = content
    area.value = content
    area.disabled = false
    btnSave.disabled = true
    btnSaveOnly.disabled = true
    status.innerHTML = `<span style="color:var(--text-tertiary)">已加载 DeerFlow 配置（${escapeHtml(path)}） · ${(content.length / 1024).toFixed(1)} KB</span>`
    area.oninput = () => {
      const changed = area.value !== _configOriginal
      status.innerHTML = changed
        ? '<span style="color:var(--warning)">● 有未保存修改</span>'
        : '<span style="color:var(--text-tertiary)">无修改</span>'
      btnSave.disabled = !changed
      btnSaveOnly.disabled = !changed
    }
  } catch (e) {
    status.innerHTML = `<span style="color:var(--error)">加载配置失败: ${escapeHtml(String(e))}</span>`
    area.disabled = true
    btnSave.disabled = true
    btnSaveOnly.disabled = true
  }
}

function bindEvents(page) {
  page.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const action = btn.dataset.action
    try {
      if (action === 'refresh-services') {
        await loadServices(page)
        return
      }
      if (action === 'refresh-health') {
        await loadGatewayHealth(page)
        return
      }
      if (action === 'reload-config') {
        await loadConfigEditor(page)
        return
      }
      if (action === 'apply-project-root') {
        const projectInput = page.querySelector('#project-root-input')
        const nextPath = String(projectInput?.value || '').trim()
        if (!nextPath) {
          toast('请先输入 DeerFlow 项目地址', 'error')
          return
        }
        setSavedProjectRoot(nextPath)
        await loadConfigEditor(page)
        toast('已应用项目地址', 'success')
        return
      }
      if (action === 'open-logs') {
        navigate('/logs')
        return
      }
      if (action === 'save-config' || action === 'save-config-only') {
        await saveConfig(page, action === 'save-config')
        return
      }
      if (action === 'start-deerflow-dev') {
        await startDeerflowDev()
        toast('已按 README 脚本触发启动，请稍后刷新状态', 'success')
        await loadServices(page)
        return
      }
      if (action === 'stop-deerflow-dev') {
        await stopDeerflowDev()
        toast('已按脚本触发停止，请稍后刷新状态', 'success')
        await loadServices(page)
        return
      }
      if (action === 'restart-deerflow-dev') {
        await stopDeerflowDev()
        await new Promise(resolve => setTimeout(resolve, 800))
        await startDeerflowDev()
        toast('已按脚本触发重启，请稍后刷新状态', 'success')
        await loadGatewayHealth(page)
        await loadServices(page)
        return
      }
      if (action === 'start-service' || action === 'stop-service' || action === 'restart-service') {
        const label = btn.dataset.label
        if (!label) return
        await runServiceAction(page, action, label, btn)
      }
    } catch (err) {
      toast((err && err.message) ? err.message : String(err), 'error')
    }
  })
}

async function runServiceAction(page, action, label, btn) {
  const fn = action === 'start-service'
    ? api.startService
    : action === 'stop-service'
      ? api.stopService
      : api.restartService
  const oldText = btn.textContent
  btn.disabled = true
  btn.textContent = action === 'start-service' ? '启动中...' : action === 'stop-service' ? '停止中...' : '重启中...'
  try {
    await fn(label)
    await waitForTargetState(label, action !== 'stop-service')
    toast(`${serviceDisplayName(label)} 已${action === 'start-service' ? '启动' : action === 'stop-service' ? '停止' : '重启'}`, 'success')
  } finally {
    btn.disabled = false
    btn.textContent = oldText
    await loadServices(page)
  }
}

async function waitForTargetState(label, expectRunning) {
  const startAt = Date.now()
  while (Date.now() - startAt < POLL_TIMEOUT) {
    try {
      const services = await api.getServicesStatus()
      const svc = services?.find?.(s => s.label === label)
      if (svc && !!svc.running === expectRunning) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL))
  }
}

async function saveConfig(page, restartGateway) {
  const area = page.querySelector('#config-editor-area')
  const status = page.querySelector('#config-editor-status')
  if (!_configPath) {
    toast('未找到 DeerFlow 配置文件路径', 'error')
    return
  }
  status.innerHTML = '<span style="color:var(--text-tertiary)">保存中...</span>'
  await api.assistantWriteFile(_configPath, area.value)
  _configOriginal = area.value
  page.querySelector('[data-action="save-config"]').disabled = true
  page.querySelector('[data-action="save-config-only"]').disabled = true
  if (restartGateway) {
    if (_primaryServiceLabel) {
      await api.restartService(_primaryServiceLabel)
      status.innerHTML = `<span style="color:var(--success)">配置已保存并重启服务（${escapeHtml(_primaryServiceLabel)}）</span>`
      toast(`配置已保存并重启服务：${_primaryServiceLabel}`, 'success')
    } else {
      await startDeerflowDev()
      status.innerHTML = '<span style="color:var(--success)">配置已保存，并触发 DeerFlow 启动命令</span>'
      toast('配置已保存，并触发 DeerFlow 启动命令', 'success')
    }
    await loadServices(page)
  } else {
    status.innerHTML = '<span style="color:var(--success)">配置已保存</span>'
    toast('配置已保存', 'success')
  }
}

async function readDeerflowConfig(preferredPath = '') {
  const preferredRoot = String(preferredPath || '').trim().replace(/\\/g, '/').replace(/\/$/, '')
  const saved = getSavedConfigPath()
  const found = await readConfigWithFallback({
    readFile: (p) => api.assistantReadFile(p),
    preferredRoot,
    savedPath: saved,
    resolveByShell: resolveConfigPathByShell,
  })
  setSavedConfigPath(found.path)
  return found
}

async function detectDeerflowProcessHint() {
  try {
    const cmd = `powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process | Where-Object { ($_.CommandLine -like '*deer-flow*') -or ($_.CommandLine -like '*deerflow*') -or ($_.Name -like '*python*') -and ($_.CommandLine -like '*backend.app*') }; ($p | Measure-Object).Count"`
    const out = await api.assistantExec(cmd, '.')
    const lines = String(out || '').trim().split('\n').filter(Boolean)
    const count = Number(lines[lines.length - 1] || 0)
    if (!Number.isFinite(count) || count <= 0) return ''
    return `；检测到相关进程 ${count} 个`
  } catch {
    try {
      const out = await api.assistantListProcesses('deerflow')
      const lines = String(out || '').trim().split('\n').filter(Boolean)
      if (!lines.length) return ''
      return `；检测到相关进程 ${lines.length} 个`
    } catch {
      return ''
    }
  }
}

async function startDeerflowDev() {
  const projectRoot = getSavedProjectRoot() || 'D:\\github\\deerflaw'
  const wslRoot = toWslPath(projectRoot)
  const cmd = `powershell -NoProfile -Command "Start-Process -WindowStyle Hidden wsl -ArgumentList '-d','Ubuntu','--','bash','-lc','cd ${wslRoot} && bash scripts/serve.sh --dev'"`
  await api.assistantExec(cmd, '.')
}

async function stopDeerflowDev() {
  const cmd = `powershell -NoProfile -Command "wsl -d Ubuntu -- bash -lc 'pkill -f \"uvicorn app.gateway.app:app\" || true; pkill -f \"langgraph_cli dev\" || true; pkill -f \"vite\" || true'"`
  await api.assistantExec(cmd, '.')
}

function toWslPath(winPath) {
  const normalized = String(winPath || '').trim().replace(/\\/g, '/')
  const m = normalized.match(/^([A-Za-z]):\/(.*)$/)
  if (!m) return normalized || '/mnt/d/github/deerflaw'
  const drive = m[1].toLowerCase()
  const rest = m[2]
  return `/mnt/${drive}/${rest}`
}

async function probeGatewayHealth() {
  const candidates = getHealthProbeCandidates()
  for (const url of candidates) {
    try {
      const r = await fetch(url, { method: 'GET' })
      if (!r.ok) continue
      let summary = ''
      try {
        const data = await r.json()
        if (data?.ok === true) {
          summary = 'ok:true'
        } else {
          continue
        }
      } catch {}
      return { ok: true, url, summary }
    } catch {}
  }
  return { ok: false, url: '', summary: '' }
}

async function resolveConfigPathByShell(hintPath = '') {
  try {
    const escapedHint = String(hintPath || '').replace(/'/g, "''")
    const cmd = `powershell -NoProfile -Command "$hint='${escapedHint}'; $c=@(); if($hint){$c+=$hint}; $c+=@('config.yaml','backend/config.yaml','../config.yaml','../backend/config.yaml','../../config.yaml','D:/github/deerflaw/config.yaml','D:/github/deerflaw/backend/config.yaml','D:/openclaw-workspace/github/deerflaw/config.yaml','D:/openclaw-workspace/github/deerflaw/backend/config.yaml'); foreach($p in $c){ if(Test-Path $p){ (Resolve-Path $p).Path; exit 0 } }; $roots=@('D:/github','D:/openclaw-workspace/github','C:/github'); foreach($r in $roots){ if(Test-Path $r){ $hit=Get-ChildItem -Path $r -Filter 'config.yaml' -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -like '*deerflaw*' -or $_.FullName -like '*deer-flow*' } | Select-Object -First 1; if($hit){ $hit.FullName; exit 0 } } }"`
    const out = await api.assistantExec(cmd, '.')
    const first = String(out || '').split(/\r?\n/).map(s => s.trim()).find(Boolean) || ''
    return first
  } catch {
    return ''
  }
}
