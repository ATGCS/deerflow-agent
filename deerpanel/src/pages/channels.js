/**
 * 消息渠道管理页面 - 管理 DeerFlaw 多渠道（飞书、Slack、Telegram 等）
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { showModal } from '../components/modal.js'

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
        <h1 class="page-title">消息渠道</h1>
        <p class="page-desc">管理 DeerFlaw 多渠道接入（飞书、Slack、Telegram）</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-sm btn-secondary" id="btn-reload">刷新</button>
      </div>
    </div>
    <div class="page-content">
      <div id="channels-loading" style="padding:40px;text-align:center;color:var(--text-tertiary)">加载中...</div>
      <div id="channels-content" style="display:none"></div>
      <div id="channels-error" style="display:none;padding:40px;text-align:center;color:var(--error)"></div>
    </div>
  `

  bindEvents(page)
  loadChannels(page)
  return page
}

async function loadChannels(page) {
  const loadingEl = page.querySelector('#channels-loading')
  const contentEl = page.querySelector('#channels-content')
  const errorEl = page.querySelector('#channels-error')

  loadingEl.style.display = 'block'
  contentEl.style.display = 'none'
  errorEl.style.display = 'none'

  const seq = ++_loadSeq

  try {
    const data = await api.getChannelsStatus()
    if (seq !== _loadSeq) return

    loadingEl.style.display = 'none'
    contentEl.style.display = 'block'
    renderChannels(page, data)
  } catch (e) {
    if (seq !== _loadSeq) return
    loadingEl.style.display = 'none'
    errorEl.textContent = '加载失败: ' + e
    errorEl.style.display = 'block'
    toast('加载渠道状态失败: ' + e, 'error')
  }
}

function renderChannels(page, data) {
  const contentEl = page.querySelector('#channels-content')
  const serviceRunning = data?.service_running || false
  const channels = data?.channels || {}

  const channelList = Object.entries(channels)
  const runningCount = channelList.filter(([, c]) => c.running).length
  const enabledCount = channelList.filter(([, c]) => c.enabled).length

  let html = `
    <div style="margin-bottom:var(--space-lg)">
      <div style="display:flex;align-items:center;gap:var(--space-sm);margin-bottom:var(--space-md)">
        <span style="font-weight:500">渠道服务:</span>
        <span style="color:${serviceRunning ? 'var(--success)' : 'var(--error)'}">${serviceRunning ? '● 运行中' : '○ 未运行'}</span>
      </div>
      <div style="color:var(--text-secondary);font-size:var(--font-size-sm)">
        共 ${channelList.length} 个渠道: ${enabledCount} 已启用 / ${runningCount} 运行中
      </div>
    </div>
  `

  if (!channelList.length) {
    html += `
      <div style="padding:40px;text-align:center;color:var(--text-tertiary)">
        暂无渠道配置。请在 config.yaml 中配置 channels。
      </div>
    `
    contentEl.innerHTML = html
    return
  }

  html += `
    <div style="display:flex;flex-direction:column;gap:var(--space-md)">
  `

  const channelIcons = {
    feishu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8M12 8v8"/></svg>',
    slack: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M14.5 10c-.83 0-1.5-.67-1.5-1.5v-5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5z"/><path d="M20.5 10H19V8.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/><path d="M9.5 14c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5S8 21.33 8 20.5v-5c0-.83.67-1.5 1.5-1.5z"/><path d="M3.5 14H5v1.5c0 .83-.67 1.5-1.5 1.5S2 16.33 2 15.5 2.67 14 3.5 14z"/><path d="M14 14.5c0-.83.67-1.5 1.5-1.5h5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-5c-.83 0-1.5-.67-1.5-1.5z"/><path d="M15.5 19H14v1.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5-.67-1.5-1.5-1.5z"/><path d="M10 9.5C10 8.67 9.33 8 8.5 8h-5C2.67 8 2 8.67 2 9.5S2.67 11 3.5 11h5c.83 0 1.5-.67 1.5-1.5z"/><path d="M8.5 5H10V3.5C10 2.67 9.33 2 8.5 2S7 2.67 7 3.5 7.67 5 8.5 5z"/></svg>',
    telegram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>',
  }

  const channelLabels = {
    feishu: '飞书',
    slack: 'Slack',
    telegram: 'Telegram',
  }

  for (const [name, status] of channelList) {
    const label = channelLabels[name] || name
    const icon = channelIcons[name] || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M12 2a10 10 0 100 20 10 10 0 000-20z"/><path d="M12 6v6l4 2"/></svg>'
    const enabled = status.enabled
    const running = status.running

    html += `
      <div style="background:var(--bg-tertiary);border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-md)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-md)">
          <div style="display:flex;align-items:center;gap:var(--space-sm)">
            <span style="color:var(--text-secondary)">${icon}</span>
            <div>
              <div style="font-weight:500">${esc(label)}</div>
              <div style="font-size:var(--font-size-xs);color:var(--text-tertiary)">${esc(name)}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:var(--space-sm)">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
              <input type="checkbox" class="channel-toggle" data-channel="${esc(name)}" ${enabled ? 'checked' : ''}>
              <span style="font-size:var(--font-size-sm);color:${enabled ? 'var(--success)' : 'var(--text-tertiary)'}">${enabled ? '启用' : '禁用'}</span>
            </label>
          </div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:var(--space-sm)">
          <span style="font-size:var(--font-size-xs)">
            状态: <span style="color:${running ? 'var(--success)' : 'var(--text-tertiary)'}">${running ? '● 运行中' : '○ 已停止'}</span>
          </span>
          <button class="btn btn-xs btn-secondary" data-action="restart" data-channel="${esc(name)}" ${!running ? '' : 'disabled'} style="padding:2px 8px;font-size:11px">重启</button>
          <button class="btn btn-xs btn-secondary" data-action="config" data-channel="${esc(name)}" style="padding:2px 8px;font-size:11px">配置</button>
        </div>
      </div>
    `
  }

  html += '</div>'
  contentEl.innerHTML = html

  // 绑定启用/禁用事件
  contentEl.querySelectorAll('.channel-toggle').forEach(checkbox => {
    checkbox.onchange = async () => {
      const name = checkbox.dataset.channel
      const enabled = checkbox.checked
      const label = checkbox.nextElementSibling

      try {
        const result = await api.enableChannel(name, enabled)
        if (result.success) {
          toast(`渠道 ${name} 已${enabled ? '启用' : '禁用'}`, 'success')
          // 更新 UI
          label.textContent = enabled ? '启用' : '禁用'
          label.style.color = enabled ? 'var(--success)' : 'var(--text-tertiary)'
          // 更新状态
          loadChannels(page)
        } else {
          toast(result.message || '操作失败', 'error')
          checkbox.checked = !enabled
        }
      } catch (e) {
        toast('操作失败: ' + e, 'error')
        checkbox.checked = !enabled
      }
    }
  })

  // 绑定重启事件
  contentEl.querySelectorAll('[data-action="restart"]').forEach(btn => {
    btn.onclick = async () => {
      const name = btn.dataset.channel
      btn.disabled = true
      btn.textContent = '重启中...'

      try {
        const result = await api.restartChannel(name)
        if (result.success) {
          toast(`渠道 ${name} 重启成功`, 'success')
        } else {
          toast(result.message || '重启失败', 'error')
        }
      } catch (e) {
        toast('重启失败: ' + e, 'error')
      } finally {
        btn.disabled = false
        btn.textContent = '重启'
      }
    }
  })

  // 绑定配置事件
  contentEl.querySelectorAll('[data-action="config"]').forEach(btn => {
    btn.onclick = async () => {
      const name = btn.dataset.channel
      try {
        const configData = await api.getChannelConfig(name)
        showChannelConfigDialog(page, name, configData)
      } catch (e) {
        toast('获取配置失败: ' + e, 'error')
      }
    }
  })
}

function showChannelConfigDialog(page, name, configData) {
  const config = configData.config || {}
  const label = { feishu: '飞书', slack: 'Slack', telegram: 'Telegram' }[name] || name

  showModal({
    title: `${label} 配置`,
    fields: [
      { name: 'app_id', label: 'App ID', value: config.app_id || '', placeholder: '请输入 App ID' },
      { name: 'app_secret', label: 'App Secret', value: config.app_secret || '', placeholder: '请输入 App Secret' },
      { name: 'bot_name', label: 'Bot 名称', value: config.bot_name || '', placeholder: '请输入 Bot 名称' },
    ],
    onConfirm: async (result) => {
      const newConfig = {}
      if (result.app_id) newConfig.app_id = result.app_id
      if (result.app_secret) newConfig.app_secret = result.app_secret
      if (result.bot_name) newConfig.bot_name = result.bot_name

      try {
        const updateResult = await api.updateChannelConfig(name, newConfig)
        if (updateResult.success) {
          toast(`渠道 ${name} 配置已更新`, 'success')
          loadChannels(page)
        } else {
          toast(updateResult.message || '更新失败', 'error')
        }
      } catch (e) {
        toast('更新失败: ' + e, 'error')
      }
    }
  })
}

function bindEvents(page) {
  page.querySelector('#btn-reload').onclick = () => loadChannels(page)
}
