/**
 * 面板设置页面
 * 统一管理 DeerPanel 的网络代理、npm 源、模型代理等配置
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'

const isTauri = !!window.__TAURI_INTERNALS__

function escapeHtml(str) {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const REGISTRIES = [
  { label: '淘宝镜像 (推荐)', value: 'https://registry.npmmirror.com' },
  { label: 'npm 官方源', value: 'https://registry.npmjs.org' },
  { label: '华为云镜像', value: 'https://repo.huaweicloud.com/repository/npm/' },
]

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">面板设置</h1>
      <p class="page-desc">管理 DeerPanel 的网络、代理和下载源配置</p>
    </div>

    <div class="config-section" id="proxy-section">
      <div class="config-section-title">网络代理</div>
      <div id="proxy-bar"><div class="stat-card loading-placeholder" style="height:48px"></div></div>
    </div>

    <div class="config-section" id="model-proxy-section">
      <div class="config-section-title">模型请求代理</div>
      <div id="model-proxy-bar"><div class="stat-card loading-placeholder" style="height:48px"></div></div>
    </div>

    <div class="config-section" id="registry-section">
      <div class="config-section-title">npm 源设置</div>
      <div id="registry-bar"><div class="stat-card loading-placeholder" style="height:48px"></div></div>
    </div>
  `

  bindEvents(page)
  loadAll(page)
  return page
}

async function loadAll(page) {
  const tasks = [loadProxyConfig(page), loadModelProxyConfig(page)]
  tasks.push(loadRegistry(page))
  await Promise.all(tasks)
}

// ===== 网络代理 =====

async function loadProxyConfig(page) {
  const bar = page.querySelector('#proxy-bar')
  if (!bar) return
  try {
    const cfg = await api.readPanelConfig()
    const proxyUrl = cfg?.networkProxy?.url || ''
    bar.innerHTML = `
      <div style="display:flex;align-items:center;gap:var(--space-sm);flex-wrap:wrap">
        <input class="form-input" data-name="proxy-url" placeholder="http://127.0.0.1:7897" value="${escapeHtml(proxyUrl)}" style="max-width:360px">
        <button class="btn btn-primary btn-sm" data-action="save-proxy">保存</button>
        <button class="btn btn-secondary btn-sm" data-action="test-proxy" ${proxyUrl ? '' : 'disabled'}>测试连通</button>
        <button class="btn btn-secondary btn-sm" data-action="clear-proxy" ${proxyUrl ? '' : 'disabled'}>关闭代理</button>
      </div>
      <div id="proxy-test-result" style="margin-top:var(--space-xs);font-size:var(--font-size-xs);min-height:20px"></div>
      <div class="form-hint" style="margin-top:var(--space-xs)">
        设置后，npm 安装/升级、版本检测、GitHub/Gitee 更新检查、ClawHub Skills 等下载类操作会走此代理。自动绕过 localhost 和内网地址。保存后新请求立即生效；如 Gateway 正在运行，建议重启一次服务。
      </div>
    `
  } catch (e) {
    bar.innerHTML = `<div style="color:var(--error)">加载失败: ${escapeHtml(String(e))}</div>`
  }
}

// ===== 模型请求代理 =====

async function loadModelProxyConfig(page) {
  const bar = page.querySelector('#model-proxy-bar')
  if (!bar) return
  try {
    const cfg = await api.readPanelConfig()
    const proxyUrl = cfg?.networkProxy?.url || ''
    const modelProxy = !!cfg?.networkProxy?.proxyModelRequests
    const hasProxy = !!proxyUrl

    bar.innerHTML = `
      <div style="display:flex;align-items:center;gap:var(--space-sm);flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:6px;font-size:var(--font-size-sm);cursor:pointer">
          <input type="checkbox" data-name="model-proxy-toggle" ${modelProxy ? 'checked' : ''} ${hasProxy ? '' : 'disabled'}>
          模型测试和模型列表请求也走代理
        </label>
        <button class="btn btn-primary btn-sm" data-action="save-model-proxy">保存</button>
      </div>
      <div class="form-hint" style="margin-top:var(--space-xs)">
        ${hasProxy
          ? '默认关闭。部分用户的模型 API 地址本身就是国内中转或内网地址，走代理反而会连接失败。只有当你的模型服务商需要翻墙访问时才建议开启。'
          : '请先在上方设置网络代理地址后，才能启用此选项。'
        }
      </div>
    `
  } catch (e) {
    bar.innerHTML = `<div style="color:var(--error)">加载失败: ${escapeHtml(String(e))}</div>`
  }
}

// ===== npm 源设置 =====

async function loadRegistry(page) {
  const bar = page.querySelector('#registry-bar')
  try {
    const current = await api.getNpmRegistry()
    const isPreset = REGISTRIES.some(r => r.value === current)
    bar.innerHTML = `
      <div style="display:flex;align-items:center;gap:var(--space-sm);flex-wrap:wrap">
        <select class="form-input" data-name="registry" style="max-width:320px">
          ${REGISTRIES.map(r => `<option value="${r.value}" ${r.value === current ? 'selected' : ''}>${r.label}</option>`).join('')}
          <option value="custom" ${!isPreset ? 'selected' : ''}>自定义</option>
        </select>
        <input class="form-input" data-name="custom-registry" placeholder="https://..." value="${isPreset ? '' : escapeHtml(current)}" style="max-width:320px;${isPreset ? 'display:none' : ''}">
        <button class="btn btn-primary btn-sm" data-action="save-registry">保存</button>
      </div>
      <div class="form-hint" style="margin-top:var(--space-xs)">升级和版本检测使用此源下载 npm 包，国内用户推荐淘宝镜像</div>
    `
    const select = bar.querySelector('[data-name="registry"]')
    const customInput = bar.querySelector('[data-name="custom-registry"]')
    select.onchange = () => {
      customInput.style.display = select.value === 'custom' ? '' : 'none'
    }
  } catch (e) {
    bar.innerHTML = `<div style="color:var(--error)">加载失败: ${escapeHtml(String(e))}</div>`
  }
}

// ===== 事件绑定 =====

function bindEvents(page) {
  page.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const action = btn.dataset.action
    btn.disabled = true
    try {
      switch (action) {
        case 'save-proxy':
          await handleSaveProxy(page)
          break
        case 'test-proxy':
          await handleTestProxy(page)
          break
        case 'clear-proxy':
          await handleClearProxy(page)
          break
        case 'save-model-proxy':
          await handleSaveModelProxy(page)
          break
        case 'save-registry':
          await handleSaveRegistry(page)
          break
      }
    } catch (e) {
      toast(e.toString(), 'error')
    } finally {
      btn.disabled = false
    }
  })
}

function normalizeProxyUrl(value) {
  const url = String(value || '').trim()
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('代理地址必须以 http:// 或 https:// 开头')
  }
  return url
}

async function handleTestProxy(page) {
  const resultEl = page.querySelector('#proxy-test-result')
  if (resultEl) resultEl.innerHTML = '<span style="color:var(--text-tertiary)">正在测试代理连通性...</span>'
  try {
    const r = await api.testProxy()
    if (resultEl) {
      resultEl.innerHTML = r.ok
        ? `<span style="color:var(--success)">✓ 代理连通（HTTP ${r.status}，耗时 ${r.elapsed_ms}ms）→ ${escapeHtml(r.target)}</span>`
        : `<span style="color:var(--warning)">⚠ 代理可达但返回异常（HTTP ${r.status}，${r.elapsed_ms}ms）</span>`
    }
  } catch (e) {
    if (resultEl) resultEl.innerHTML = `<span style="color:var(--error)">✗ ${escapeHtml(String(e))}</span>`
  }
}

async function handleSaveProxy(page) {
  const input = page.querySelector('[data-name="proxy-url"]')
  const proxyUrl = normalizeProxyUrl(input?.value || '')
  if (!proxyUrl) {
    toast('请输入代理地址，或点击"关闭代理"', 'error')
    return
  }
  const cfg = await api.readPanelConfig()
  if (!cfg.networkProxy || typeof cfg.networkProxy !== 'object') {
    cfg.networkProxy = {}
  }
  cfg.networkProxy.url = proxyUrl
  await api.writePanelConfig(cfg)
  toast('网络代理已保存；如 Gateway 正在运行，建议重启服务', 'success')
  await loadProxyConfig(page)
  await loadModelProxyConfig(page)
}

async function handleClearProxy(page) {
  const cfg = await api.readPanelConfig()
  delete cfg.networkProxy
  await api.writePanelConfig(cfg)
  toast('网络代理已关闭', 'success')
  await loadProxyConfig(page)
  await loadModelProxyConfig(page)
}

async function handleSaveModelProxy(page) {
  const toggle = page.querySelector('[data-name="model-proxy-toggle"]')
  const checked = toggle?.checked || false
  const cfg = await api.readPanelConfig()
  if (!cfg.networkProxy || typeof cfg.networkProxy !== 'object') {
    cfg.networkProxy = {}
  }
  cfg.networkProxy.proxyModelRequests = checked
  await api.writePanelConfig(cfg)
  toast(checked ? '模型请求将走代理' : '模型请求已关闭代理', 'success')
}

async function handleSaveRegistry(page) {
  const select = page.querySelector('[data-name="registry"]')
  const customInput = page.querySelector('[data-name="custom-registry"]')
  const registry = select.value === 'custom' ? customInput.value.trim() : select.value
  if (!registry) { toast('请输入源地址', 'error'); return }
  await api.setNpmRegistry(registry)
  toast('npm 源已保存', 'success')
}
