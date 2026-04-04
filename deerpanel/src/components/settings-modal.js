/**
 * 设置弹窗：大窗口内左分类 + 右嵌入各功能（非全页路由）
 */
import { navigate } from '../router.js'

/** @type {{ overlay: HTMLElement, onKeydown: (e: KeyboardEvent) => void, restoreHash: string, onThemePref?: () => void } | null} */
let _instance = null

const THEME_PREF_EVENT = 'deerpanel-theme-pref-changed'

function parseRestoreHash(opts) {
  if (opts.routeEntry) return '/chat'
  const raw = window.location.hash.slice(1) || '/chat'
  const path = raw.split('?')[0]
  if (path === '/settings') return '/chat'
  return raw || '/chat'
}

/**
 * @param {{ skipNavigate?: boolean }} [opts]
 */
export function closeSettingsModal(opts = {}) {
  if (!_instance) return
  if (_instance.onThemePref) {
    window.removeEventListener(THEME_PREF_EVENT, _instance.onThemePref)
  }
  document.removeEventListener('keydown', _instance.onKeydown)
  _instance.overlay.remove()
  import('../pages/settings.js')
    .then((m) => {
      if (typeof m.cleanup === 'function') m.cleanup()
    })
    .catch(() => {})
  const restore = _instance.restoreHash
  _instance = null
  if (opts.skipNavigate) return
  const h = restore.startsWith('/') ? restore : `/${restore}`
  navigate(h)
}

/**
 * @param {{ initialTab?: string, routeEntry?: boolean }} [opts]
 */
export async function openSettingsModal(opts = {}) {
  closeSettingsModal({ skipNavigate: true })

  const restoreHash = parseRestoreHash(opts)
  const { mountSettingsRoot } = await import('../pages/settings.js')

  const overlay = document.createElement('div')
  overlay.className = 'react-chat-modal-overlay'
  overlay.id = 'deerpanel-settings-modal-overlay'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-labelledby', 'deerpanel-settings-modal-title')

  overlay.innerHTML = `
    <div class="react-chat-modal-card react-chat-modal-card--settings">
      <div class="react-chat-modal-header">
        <strong class="react-chat-modal-title" id="deerpanel-settings-modal-title">设置</strong>
        <button type="button" class="react-chat-modal-close" data-settings-modal-close aria-label="关闭">×</button>
      </div>
      <div class="react-chat-modal-body react-chat-modal-body--settings">
        <div class="settings-modal-root" id="settings-modal-root"></div>
      </div>
      <div class="react-chat-modal-actions">
        <button type="button" class="react-chat-modal-btn react-chat-modal-btn--ghost" data-settings-modal-cancel>取消</button>
        <button type="button" class="react-chat-modal-btn react-chat-modal-btn--primary" data-settings-modal-done>完成</button>
      </div>
    </div>
  `

  const onKeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeSettingsModal()
    }
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeSettingsModal()
  })

  overlay.querySelector('[data-settings-modal-close]')?.addEventListener('click', () => closeSettingsModal())
  overlay.querySelector('[data-settings-modal-cancel]')?.addEventListener('click', () => closeSettingsModal())
  overlay.querySelector('[data-settings-modal-done]')?.addEventListener('click', () => closeSettingsModal())

  const onThemePref = () => {
    const r = overlay.querySelector('#settings-modal-root')
    if (!r) return
    import('../pages/general.js').then(({ renderAppearanceBar }) => {
      const wrap = r.querySelector('.settings-embed-wrap')
      if (wrap && typeof renderAppearanceBar === 'function') renderAppearanceBar(wrap)
    })
  }
  window.addEventListener(THEME_PREF_EVENT, onThemePref)

  document.body.appendChild(overlay)
  document.addEventListener('keydown', onKeydown)
  _instance = { overlay, onKeydown, restoreHash, onThemePref }

  try {
    const root = overlay.querySelector('#settings-modal-root')
    await mountSettingsRoot(root, {
      syncHash: true,
      initialTab: opts.initialTab,
    })
  } catch (e) {
    console.error('[settings-modal]', e)
    closeSettingsModal()
    throw e
  }
}
