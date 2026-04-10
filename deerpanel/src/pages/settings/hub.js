/**
 * 设置弹窗内布局：左侧分类 + 右侧多面板（各 Tab 独立 DOM，切换只改显隐，避免高度闪动）
 */
import { ALLOWED_TABS, NAV_ICONS, NAV_LABELS, TAB_META, parseTabFromLocation } from './meta.js'

const _panelMounted = new Set()
/** @type {Map<string, () => void>} */
const _tabCleanups = new Map()
/** @type {Map<string, Promise<void>>} */
const _mountInflight = new Map()

function settingsHubHtml() {
  const navButtons = ALLOWED_TABS.map((tab) => {
    const label = NAV_LABELS[tab] ?? TAB_META[tab]?.title ?? tab
    const active = tab === 'general' ? ' settings-nav-item--active' : ''
    const id = tab === 'general' ? ' id="settings-tab-general"' : ''
    return `
        <button type="button" class="settings-nav-item${active}" data-settings-tab="${tab}"${id} role="tab" aria-selected="${tab === 'general' ? 'true' : 'false'}">
          <span class="settings-nav-ic" aria-hidden="true">${NAV_ICONS[tab] ?? ''}</span>
          <span>${label}</span>
        </button>`
  }).join('')

  const panels = ALLOWED_TABS.map((tab) => {
    const active = tab === 'general'
    return `
      <div class="settings-subview settings-subview-panel" data-settings-panel="${tab}" role="tabpanel" id="settings-panel-wrap-${tab}" ${active ? '' : 'hidden'} aria-hidden="${active ? 'false' : 'true'}">
        <div class="settings-subview-panel-inner" id="settings-panel-inner-${tab}"></div>
      </div>`
  }).join('')

  return `
    <div class="settings-layout settings-layout--hub settings-layout--modal-hub">
      <nav class="settings-nav" aria-label="设置分类" role="tablist">
        <div class="settings-nav-title">分类</div>
        ${navButtons}
      </nav>
      <div class="settings-hub-main">
        <header class="settings-subview-head" id="settings-subview-head">
          <h2 class="settings-subview-title" id="settings-subview-title">${TAB_META.general.title}</h2>
          <p class="settings-subview-desc" id="settings-subview-desc">${TAB_META.general.desc}</p>
        </header>
        <div class="settings-subview-stack">
          ${panels}
        </div>
      </div>
    </div>
  `
}

function updateSubHead(rootEl, tab) {
  const meta = TAB_META[tab] || TAB_META.general
  const headEl = rootEl.querySelector('#settings-subview-head')
  // IM channels tab has its own split-layout header, hide this one
  if (headEl) {
    headEl.style.display = (tab === 'im') ? 'none' : ''
  }
  const tEl = rootEl.querySelector('#settings-subview-title')
  const dEl = rootEl.querySelector('#settings-subview-desc')
  if (tEl) tEl.textContent = meta.title
  if (dEl) dEl.textContent = meta.desc
}

function setNavActive(rootEl, tab) {
  rootEl.querySelectorAll('[data-settings-tab]').forEach((btn) => {
    const on = btn.dataset.settingsTab === tab
    btn.classList.toggle('settings-nav-item--active', on)
    btn.setAttribute('aria-selected', on ? 'true' : 'false')
  })
}

function setPanelVisible(rootEl, tab) {
  rootEl.querySelectorAll('[data-settings-panel]').forEach((panel) => {
    const on = panel.dataset.settingsPanel === tab
    panel.toggleAttribute('hidden', !on)
    panel.setAttribute('aria-hidden', on ? 'false' : 'true')
  })
}

function runTabCleanups() {
  for (const fn of _tabCleanups.values()) {
    try {
      fn()
    } catch {
      /* ignore */
    }
  }
  _tabCleanups.clear()
  _panelMounted.clear()
  _mountInflight.clear()
}

/**
 * @param {HTMLElement} rootEl
 * @param {string} tab
 */
async function ensurePanelMounted(rootEl, tab) {
  if (_panelMounted.has(tab)) return
  if (_mountInflight.has(tab)) {
    await _mountInflight.get(tab)
    return
  }

  const inner = rootEl.querySelector(`#settings-panel-inner-${tab}`)
  if (!inner) return

  const work = (async () => {
    inner.replaceChildren()

    try {
      switch (tab) {
        case 'general': {
          const g = await import('../general.js')
          if (!inner.isConnected) return
          const pane = document.createElement('div')
          pane.className = 'settings-modal-pane settings-modal-pane--general settings-embed-wrap'
          inner.appendChild(pane)
          await g.mountGeneralInto(pane)
          _tabCleanups.set('general', () => g.cleanup())
          break
        }
        case 'mail': {
          const m = await import('../mail.js')
          if (!inner.isConnected) return
          const pane = document.createElement('div')
          pane.className = 'settings-modal-pane settings-modal-pane--mail'
          inner.appendChild(pane)
          await m.mountMailInto(pane)
          break
        }
        case 'models': {
          const mod = await import('../models.js')
          if (!inner.isConnected) return
          await mod.mountModelsForSettingsModal(inner)
          _tabCleanups.set('models', () => mod.cleanup())
          break
        }
        case 'im': {
          const mod = await import('../channels.js')
          if (!inner.isConnected) return
          mod.mountChannelsForSettingsModal(inner)
          break
        }
        case 'memory': {
          const mod = await import('../memory.js')
          if (!inner.isConnected) return
          mod.mountMemoryForSettingsModal(inner)
          break
        }
        default:
          break
      }
      _panelMounted.add(tab)
    } catch (e) {
      if (!inner.isConnected) return
      inner.innerHTML = `<div class="settings-subview-error" style="color:var(--error)">加载失败：${String(e)}</div>`
    }
  })()

  _mountInflight.set(tab, work)
  try {
    await work
  } finally {
    _mountInflight.delete(tab)
  }
}

/**
 * @param {HTMLElement} rootEl
 * @param {string} tab
 * @param {{ initial?: boolean, syncHash?: boolean }} [opts]
 */
async function switchSettingsTab(rootEl, tab, opts = {}) {
  if (!ALLOWED_TABS.includes(tab)) tab = 'general'

  if (!rootEl.querySelector('.settings-subview-stack')) return

  const syncHash = opts.syncHash !== false

  setNavActive(rootEl, tab)
  updateSubHead(rootEl, tab)
  setPanelVisible(rootEl, tab)

  if (!opts.initial && syncHash) {
    window.history.replaceState(null, '', `#/settings?tab=${encodeURIComponent(tab)}`)
  }

  await ensurePanelMounted(rootEl, tab)
}

/**
 * @param {HTMLElement} rootEl
 * @param {{ syncHash?: boolean, initialTab?: string }} [options]
 */
export async function mountSettingsRoot(rootEl, options = {}) {
  const { syncHash = true, initialTab } = options
  rootEl.classList.add('settings-modal-hub-root')
  rootEl.innerHTML = settingsHubHtml()

  rootEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-settings-tab]')
    if (!btn) return
    e.preventDefault()
    const t = btn.dataset.settingsTab
    if (!t) return
    switchSettingsTab(rootEl, t, { syncHash, initial: false })
  })

  const tab =
    initialTab && ALLOWED_TABS.includes(initialTab) ? initialTab : parseTabFromLocation()
  await switchSettingsTab(rootEl, tab, { initial: true, syncHash })
}

export function cleanup() {
  runTabCleanups()
}

/** 路由占位：打开弹窗 */
export async function render() {
  const el = document.createElement('div')
  el.className = 'settings-route-placeholder'
  el.setAttribute('aria-hidden', 'true')

  const hash = window.location.hash.slice(1) || ''
  const q = hash.includes('?') ? hash.split('?')[1] : ''
  const tab = new URLSearchParams(q).get('tab')

  requestAnimationFrame(async () => {
    const { openSettingsModal } = await import('../../components/settings-modal.js')
    openSettingsModal({
      initialTab: tab && ALLOWED_TABS.includes(tab) ? tab : undefined,
      routeEntry: true,
    })
  })

  return el
}
