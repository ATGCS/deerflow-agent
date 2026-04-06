/**
 * 应用全局左侧壳：聊天式主导航 + 任务记录
 * 会话列表由 ChatApp 同步；离开聊天页后仍从 sessionStorage / API 恢复展示
 */
import { navigate, getCurrentRoute } from '../router.js'

const LS_SHELL_COLLAPSED = 'deerpanel_shell_aside_collapsed'
/** 与 ChatApp.tsx 中 SHELL_SIDEBAR_SYNC_STORAGE_KEY 一致 */
const SS_SHELL_SYNC = 'deerpanel_shell_sidebar_sync'
const CHAT_MAIN_SESSION_KEY = 'agent:main:main'
/** 从 MCP/技能等页点任务记录进入 /chat 时要选中的会话（ChatApp 挂载后读取） */
const SS_PENDING_SHELL_SESSION = 'deerpanel_pending_shell_session'

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

let _shellEl = null
/** 最后一次来自聊天页的会话列表快照（离开聊天页后仍展示） */
let _lastChatSidebarSync = null

function _isChatRoute() {
  const p = (getCurrentRoute() || '/chat').split('?')[0]
  return p === '/chat' || p === '/chat-react'
}

function _applyCollapsed(collapsed) {
  if (!_shellEl) return
  try {
    localStorage.setItem(LS_SHELL_COLLAPSED, collapsed ? '1' : '0')
  } catch {
    /* ignore */
  }
  _shellEl.classList.toggle('collapsed', !!collapsed)
  const btn = _shellEl.querySelector('#shell-aside-collapse')
  if (btn) btn.textContent = collapsed ? '»' : '«'
}

function _parseSessionLabel(key) {
  const parts = String(key || '').split(':')
  if (parts.length < 3) return key || '未知'
  const agent = parts[1] || 'main'
  const channel = parts.slice(2).join(':')
  if (agent === 'main' && channel === 'main') return 'leader-agnet'
  if (agent === 'main') return channel
  return `${agent} / ${channel}`
}

function _sessionDisplayTitle(key) {
  try {
    const names = JSON.parse(localStorage.getItem('clawpanel-chat-session-names') || '{}')
    if (names[key]) return names[key]
  } catch {
    /* ignore */
  }
  return _parseSessionLabel(key)
}

function _formatSessionTime(ts) {
  const t = typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return ''
  const now = Date.now()
  const diffMs = now - d.getTime()
  if (diffMs < 60000) return '刚刚'
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)} 分钟前`
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)} 小时前`
  if (diffMs < 604800000) return `${Math.floor(diffMs / 86400000)} 天前`
  return `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`
}

function _formatSessionMeta(s) {
  const n = typeof s.messageCount === 'number' ? s.messageCount : typeof s.messages === 'number' ? s.messages : 0
  const ts = s.updatedAt ?? s.lastActivity ?? s.createdAt ?? 0
  const timeStr = ts ? _formatSessionTime(ts) : ''
  let status = '已完成'
  if (!n) status = '草稿'
  return timeStr ? `${timeStr} · ${status}` : status
}

async function _bootstrapShellSessionsIfEmpty() {
  if (_lastChatSidebarSync?.rows?.length) return
  try {
    const raw = sessionStorage.getItem(SS_SHELL_SYNC)
    if (raw) {
      const d = JSON.parse(raw)
      if (d && Array.isArray(d.rows) && d.rows.length) {
        _lastChatSidebarSync = d
        _renderSessionList(d)
        return
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const { api } = await import('../lib/tauri-api.js')
    const data = await api.chatSessionsList(50)
    const sessions = data?.sessions || []
    if (!sessions.length) return
    const rows = sessions.map((s) => {
      const key = String(s.sessionKey || '')
      return {
        sessionKey: key,
        title: _sessionDisplayTitle(key),
        meta: _formatSessionMeta(s),
        active: false,
        modePill: null,
        canDelete: key !== CHAT_MAIN_SESSION_KEY,
      }
    })
    const d = {
      listLoading: false,
      sessionFilter: '',
      moreMenuKey: null,
      newTaskActive: false,
      rows,
    }
    _lastChatSidebarSync = d
    _renderSessionList(d)
  } catch (e) {
    console.warn('[shell-aside] bootstrap sessions', e)
  }
}

function _syncNavActive() {
  if (!_shellEl) return
  const routePath = (getCurrentRoute() || '/chat').split('?')[0]
  _shellEl.querySelectorAll('[data-shell-nav]').forEach((btn) => {
    const target = btn.dataset.shellNav || ''
    let active = routePath === target
    if (target === '/chat' && (routePath === '/chat' || routePath === '/chat-react')) active = true
    btn.classList.toggle('active', active)
  })
  const newBtn = _shellEl.querySelector('#shell-btn-new-task')
  if (newBtn) {
    if (!_isChatRoute()) {
      newBtn.classList.remove('active')
    } else {
      const na =
        _lastChatSidebarSync && typeof _lastChatSidebarSync.newTaskActive === 'boolean'
          ? _lastChatSidebarSync.newTaskActive
          : false
      newBtn.classList.toggle('active', na)
    }
  }
}

function _renderSessionList(detail) {
  if (!_shellEl) return
  const ul = _shellEl.querySelector('#shell-session-list')
  if (!ul) return
  if (!detail) {
    ul.innerHTML = ''
    return
  }
  if (!detail.rows || !detail.rows.length) {
    ul.innerHTML =
      detail?.listLoading
        ? '<li class="react-chat-muted" style="padding:12px 14px">加载中…</li>'
        : '<li class="react-chat-muted" style="padding:12px 14px">暂无会话</li>'
    return
  }
  const moreKey = detail.moreMenuKey || ''
  const onChatRoute = _isChatRoute()
  ul.innerHTML = detail.rows
    .map((row) => {
      const key = escHtml(row.sessionKey)
      const title = escHtml(row.title)
      const meta = escHtml(row.meta)
      const pill = row.modePill ? `<span class="react-chat-history-pill">${escHtml(row.modePill)}</span>` : ''
      const active = onChatRoute && row.active ? ' active' : ''
      const moreOpen = moreKey === row.sessionKey
      const menu = moreOpen
        ? `<div class="react-chat-session-more-menu" role="menu">
            ${row.canDelete ? `<button type="button" class="react-chat-session-more-item react-chat-session-more-item--danger" data-shell-more="delete" data-key="${key}">删除会话</button>` : ''}
            <button type="button" class="react-chat-session-more-item" data-shell-more="refresh" data-key="${key}">刷新</button>
          </div>`
        : ''
      return `<li>
        <div class="react-chat-history-item${active}" role="button" tabindex="0" data-shell-session="${key}">
          <div class="react-chat-history-item-top">
            <span class="react-chat-history-item-title" title="${title}">${title}</span>
            <div class="react-chat-session-more-wrap" data-session-more-root>
              <button type="button" class="react-chat-session-more-btn" data-shell-more-btn="${key}" aria-expanded="${moreOpen ? 'true' : 'false'}">···</button>
              ${menu}
            </div>
          </div>
          <div class="react-chat-history-item-meta">${meta}${pill ? ` ${pill}` : ''}</div>
        </div>
      </li>`
    })
    .join('')
}

function _onChatSync(ev) {
  const d = ev.detail
  if (!_shellEl) return
  const newBtn = _shellEl.querySelector('#shell-btn-new-task')
  if (newBtn && d) {
    const na = typeof d.newTaskActive === 'boolean' ? d.newTaskActive : false
    // 仅在实际位于聊天路由时高亮；避免 ChatApp 卸载时用 sessionStorage 再派发一次把选中态粘住
    newBtn.classList.toggle('active', na && _isChatRoute())
  }

  if (!d) {
    newBtn?.classList.remove('active')
    let snapshot = _lastChatSidebarSync
    if (!snapshot?.rows?.length) {
      try {
        const raw = sessionStorage.getItem(SS_SHELL_SYNC)
        if (raw) snapshot = JSON.parse(raw)
      } catch {
        snapshot = null
      }
    }
    if (snapshot && Array.isArray(snapshot.rows)) {
      _lastChatSidebarSync = snapshot
      _renderSessionList(snapshot)
    }
    void _bootstrapShellSessionsIfEmpty()
    return
  }

  _lastChatSidebarSync = d

  const filterEl = _shellEl.querySelector('#shell-session-filter')
  if (filterEl && typeof d.sessionFilter === 'string' && document.activeElement !== filterEl) {
    filterEl.value = d.sessionFilter
  }
  _renderSessionList(d)
}

function _bindShell(el) {
  el.addEventListener('click', (e) => {
    const navBtn = e.target.closest('[data-shell-nav]')
    if (navBtn) {
      const path = navBtn.dataset.shellNav
      if (path) navigate(path)
      _closeMobileShell()
      return
    }
    if (e.target.closest('#shell-aside-collapse')) {
      _applyCollapsed(!_shellEl.classList.contains('collapsed'))
      return
    }
    if (e.target.closest('#shell-btn-new-task')) {
      navigate('/chat')
      window.dispatchEvent(new CustomEvent('deerpanel:shell-new-session'))
      _closeMobileShell()
      return
    }
    if (e.target.closest('#shell-footer-settings')) {
      import('./settings-modal.js').then(({ openSettingsModal }) => openSettingsModal())
      _closeMobileShell()
      return
    }
    const row = e.target.closest('[data-shell-session]')
    if (row && !e.target.closest('[data-shell-more-btn], .react-chat-session-more-menu')) {
      const key = row.dataset.shellSession
      if (key) {
        if (!_isChatRoute()) {
          try {
            sessionStorage.setItem(SS_PENDING_SHELL_SESSION, key)
          } catch {
            /* ignore */
          }
          navigate('/chat')
        } else {
          window.dispatchEvent(new CustomEvent('deerpanel:shell-select-session', { detail: { sessionKey: key } }))
        }
      }
      _closeMobileShell()
      return
    }
    const moreBtn = e.target.closest('[data-shell-more-btn]')
    if (moreBtn) {
      const key = moreBtn.dataset.shellMoreBtn
      if (key) window.dispatchEvent(new CustomEvent('deerpanel:shell-more-toggle', { detail: { sessionKey: key } }))
      return
    }
    const mi = e.target.closest('[data-shell-more]')
    if (mi) {
      const action = mi.dataset.shellMore
      const key = mi.dataset.key
      if (action === 'delete') window.dispatchEvent(new CustomEvent('deerpanel:shell-delete-session', { detail: { sessionKey: key } }))
      if (action === 'refresh') window.dispatchEvent(new CustomEvent('deerpanel:shell-refresh-session', { detail: { sessionKey: key } }))
      return
    }
  })

  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const row = e.target.closest('[data-shell-session]')
    if (!row) return
    e.preventDefault()
    const key = row.dataset.shellSession
    if (!key) return
    if (!_isChatRoute()) {
      try {
        sessionStorage.setItem(SS_PENDING_SHELL_SESSION, key)
      } catch {
        /* ignore */
      }
      navigate('/chat')
    } else {
      window.dispatchEvent(new CustomEvent('deerpanel:shell-select-session', { detail: { sessionKey: key } }))
    }
    _closeMobileShell()
  })

  const filterEl = el.querySelector('#shell-session-filter')
  if (filterEl) {
    filterEl.addEventListener('input', () => {
      window.dispatchEvent(
        new CustomEvent('deerpanel:shell-session-filter', { detail: { value: filterEl.value } }),
      )
    })
  }
}

function _closeMobileShell() {
  const el = document.getElementById('app-shell-aside')
  const overlay = document.getElementById('shell-aside-overlay')
  if (el) el.classList.remove('shell-aside-open')
  if (overlay) overlay.classList.remove('visible')
}

export function toggleShellAsideCollapsed() {
  if (!_shellEl) return
  _applyCollapsed(!_shellEl.classList.contains('collapsed'))
}

export function openMobileShellAside() {
  const el = document.getElementById('app-shell-aside')
  if (!el) return
  el.classList.add('shell-aside-open')
  let overlay = document.getElementById('shell-aside-overlay')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = 'shell-aside-overlay'
    overlay.className = 'shell-aside-overlay'
    overlay.addEventListener('click', _closeMobileShell)
    document.getElementById('app')?.appendChild(overlay)
  }
  requestAnimationFrame(() => overlay.classList.add('visible'))
}

export function initShellAside(el) {
  if (!el) return
  _shellEl = el
  el.id = 'app-shell-aside'
  el.className = 'react-chat-session-aside shell-aside-host'
  el.setAttribute('aria-label', '主导航')

  el.innerHTML = `
    <div class="react-chat-aside-toolbar">
      <span class="react-chat-aside-toolbar-title">DeerPanel</span>
      <button type="button" class="react-chat-aside-icon-btn" id="shell-aside-collapse" title="折叠/展开侧栏">«</button>
    </div>
    <nav class="react-chat-aside-primary" aria-label="快捷入口">
      <button type="button" class="react-chat-aside-nav-item" id="shell-btn-new-task">
        <span class="react-chat-aside-nav-ic" aria-hidden>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </span>
        <span>新建任务</span>
      </button>
      <button type="button" class="react-chat-aside-nav-item" data-shell-nav="/tasks">
        <span class="react-chat-aside-nav-ic" aria-hidden>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 11l3 3L22 4"/>
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
          </svg>
        </span>
        <span>任务中心</span>
      </button>
      <button type="button" class="react-chat-aside-nav-item" data-shell-nav="/cron">
        <span class="react-chat-aside-nav-ic" aria-hidden>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </span>
        <span>定时任务</span>
      </button>
      <button type="button" class="react-chat-aside-nav-item" data-shell-nav="/skills">
        <span class="react-chat-aside-nav-ic" aria-hidden>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
          </svg>
        </span>
        <span>技能</span>
      </button>
      <button type="button" class="react-chat-aside-nav-item" data-shell-nav="/tools">
        <span class="react-chat-aside-nav-ic" aria-hidden>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 22v-5"/><path d="M9 8V3h6v5"/><path d="M7 8h10v6a5 5 0 01-10 0V8z"/>
          </svg>
        </span>
        <span>MCP</span>
      </button>
      <button type="button" class="react-chat-aside-nav-item" data-shell-nav="/agents">
        <span class="react-chat-aside-nav-ic" aria-hidden>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
          </svg>
        </span>
        <span>预设角色</span>
      </button>
    </nav>
    <div id="shell-chat-panel">
      <div class="react-chat-aside-history-head">
        <span class="react-chat-aside-history-label">任务记录</span>
        <input type="search" class="react-chat-aside-history-search" id="shell-session-filter" placeholder="筛选…" aria-label="筛选任务记录" />
      </div>
      <ul class="react-chat-session-list" id="shell-session-list"></ul>
    </div>
    <div class="react-chat-aside-footer">
      <button type="button" class="react-chat-aside-footer-btn" id="shell-footer-settings">
        <span class="react-chat-aside-nav-ic" aria-hidden>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>
            <line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>
          </svg>
        </span>
        <span>设置</span>
      </button>
    </div>
  `

  try {
    if (localStorage.getItem(LS_SHELL_COLLAPSED) === '1') _applyCollapsed(true)
    else _applyCollapsed(false)
  } catch {
    _applyCollapsed(false)
  }

  _bindShell(el)
  window.addEventListener('hashchange', () => {
    _syncNavActive()
    if (_lastChatSidebarSync) {
      _renderSessionList(_lastChatSidebarSync)
    }
  })
  window.addEventListener('deerpanel:chat-sidebar-sync', _onChatSync)

  _syncNavActive()
  void _bootstrapShellSessionsIfEmpty()
}
