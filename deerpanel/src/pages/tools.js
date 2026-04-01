/**
 * 工具管理页面 - 管理 MCP 服务器
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'

function esc(str) {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot')
}

let _loadSeq = 0

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">工具管理</h1>
        <p class="page-desc">管理 MCP 服务器和工具配置</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-sm btn-secondary" id="btn-reload">刷新</button>
      </div>
    </div>
    <div class="page-content">
      <div id="tools-loading" style="padding:40px;text-align:center;color:var(--text-tertiary)">加载中...</div>
      <div id="tools-content" style="display:none"></div>
      <div id="tools-empty" style="display:none;padding:40px;text-align:center;color:var(--text-tertiary)">暂无 MCP 服务器配置</div>
      <div id="tools-error" style="display:none;padding:40px;text-align:center;color:var(--error)"></div>
    </div>
  `

  bindEvents(page)
  loadTools(page)
  return page
}

async function loadTools(page) {
  const loadingEl = page.querySelector('#tools-loading')
  const contentEl = page.querySelector('#tools-content')
  const emptyEl = page.querySelector('#tools-empty')
  const errorEl = page.querySelector('#tools-error')

  loadingEl.style.display = 'block'
  contentEl.style.display = 'none'
  emptyEl.style.display = 'none'
  errorEl.style.display = 'none'

  const seq = ++_loadSeq

  try {
    const data = await api.getMCPConfig()
    if (seq !== _loadSeq) return

    const servers = data?.mcp_servers || {}
    const serverList = Object.entries(servers)

    loadingEl.style.display = 'none'

    if (serverList.length === 0) {
      emptyEl.style.display = 'block'
      return
    }

    contentEl.style.display = 'block'
    renderTools(page, data)
  } catch (e) {
    if (seq !== _loadSeq) return
    loadingEl.style.display = 'none'
    errorEl.textContent = '加载失败: ' + e
    errorEl.style.display = 'block'
    toast('加载工具配置失败: ' + e, 'error')
  }
}

function renderTools(page, data) {
  const contentEl = page.querySelector('#tools-content')
  const servers = data?.mcp_servers || {}
  const serverList = Object.entries(servers)

  const enabledCount = serverList.filter(([, s]) => s.enabled).length
  const disabledCount = serverList.filter(([, s]) => !s.enabled).length

  let html = `
    <div style="margin-bottom:var(--space-lg);color:var(--text-secondary);font-size:var(--font-size-sm)">
      共 ${serverList.length} 个 MCP 服务器: ${enabledCount} 启用 / ${disabledCount} 禁用
    </div>
    <div style="display:flex;flex-direction:column;gap:var(--space-md)">
  `

  for (const [name, config] of serverList) {
    const desc = esc(config.description || '无描述')
    const type = esc(config.type || 'stdio')
    const command = esc(config.command || '')
    const url = esc(config.url || '')

    html += `
      <div style="background:var(--bg-tertiary);border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-md)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-md);margin-bottom:var(--space-sm)">
          <div style="flex:1;min-width:0">
            <div style="font-weight:500;margin-bottom:4px">${esc(name)}</div>
            <div style="font-size:var(--font-size-sm);color:var(--text-secondary);line-height:1.4">${desc}</div>
          </div>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;flex-shrink:0">
            <input type="checkbox" class="mcp-toggle" data-name="${esc(name)}" ${config.enabled ? 'checked' : ''}>
            <span style="font-size:var(--font-size-sm);color:${config.enabled ? 'var(--success)' : 'var(--text-tertiary)'}">${config.enabled ? '启用' : '禁用'}</span>
          </label>
        </div>
        <div style="font-size:var(--font-size-xs);color:var(--text-tertiary);display:flex;flex-wrap:wrap;gap:8px">
          <span>类型: <span style="color:var(--text-secondary)">${type}</span></span>
          ${command ? `<span>命令: <span style="color:var(--text-secondary);font-family:var(--font-mono)">${command}</span></span>` : ''}
          ${url ? `<span>URL: <span style="color:var(--text-secondary)">${url}</span></span>` : ''}
        </div>
      </div>
    `
  }

  html += '</div>'
  contentEl.innerHTML = html

  // 绑定启用/禁用事件
  contentEl.querySelectorAll('.mcp-toggle').forEach(checkbox => {
    checkbox.onchange = async () => {
      const name = checkbox.dataset.name
      const enabled = checkbox.checked
      const label = checkbox.nextElementSibling

      try {
        // 更新配置
        const currentData = await api.getMCPConfig()
        const servers = currentData?.mcp_servers || {}
        servers[name] = { ...servers[name], enabled }
        await api.updateMCPConfig(servers)

        toast(`MCP 服务器 ${name} 已${enabled ? '启用' : '禁用'}`, 'success')

        // 更新 UI
        label.textContent = enabled ? '启用' : '禁用'
        label.style.color = enabled ? 'var(--success)' : 'var(--text-tertiary)'

        // 更新统计
        renderTools(page, await api.getMCPConfig())
      } catch (e) {
        // 恢复原状态
        checkbox.checked = !enabled
        toast('操作失败: ' + e, 'error')
      }
    }
  })
}

function bindEvents(page) {
  page.querySelector('#btn-reload').onclick = () => loadTools(page)
}
