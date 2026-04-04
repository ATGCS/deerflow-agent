/**
 * 通用设置：外观 / 主题（本版本不暴露未接入面板的代理、npm 源等项）
 */
import { toast } from '../components/toast.js'
import { getThemePreference, setThemePreference } from '../lib/theme.js'

const THEME_PREF_EVENT = 'deerpanel-theme-pref-changed'

let _themeListener = null

export function cleanup() {
  if (_themeListener) {
    window.removeEventListener(THEME_PREF_EVENT, _themeListener)
    _themeListener = null
  }
}

const GENERAL_INNER_HTML = `
  <div class="config-section">
    <div class="config-section-title">外观</div>
    <div id="general-appearance-bar"><div class="stat-card loading-placeholder" style="height:44px"></div></div>
  </div>
`

/** 嵌入设置中心等容器（不含外层 .page） */
export async function mountGeneralInto(container) {
  cleanup()
  container.innerHTML = GENERAL_INNER_HTML
  const root = container
  _themeListener = () => renderAppearanceBar(root)
  window.addEventListener(THEME_PREF_EVENT, _themeListener)
  renderAppearanceBar(root)
  root.addEventListener('click', (e) => {
    const themeBtn = e.target.closest('[data-action="set-theme-pref"]')
    if (!themeBtn) return
    const pref = themeBtn.dataset.themePref
    if (pref === 'light' || pref === 'dark' || pref === 'system') {
      setThemePreference(pref)
      renderAppearanceBar(root)
      toast('外观已保存', 'success')
    }
  })
}

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">通用设置</h1>
        <p class="page-desc">浅色 / 深色 / 跟随系统。</p>
      </div>
    </div>
    <div class="page-content" style="max-width:720px" id="general-standalone-root"></div>
  `

  await mountGeneralInto(page.querySelector('#general-standalone-root'))
  return page
}

export function renderAppearanceBar(page) {
  const bar = page.querySelector('#general-appearance-bar')
  if (!bar) return
  const p = getThemePreference()
  const labels = { light: '浅色', dark: '深色', system: '跟随系统' }
  const keys = ['light', 'dark', 'system']
  bar.innerHTML = `
    <div class="settings-theme-row" role="group" aria-label="外观">
      ${keys
        .map(
          (key) => `
        <button type="button" class="settings-theme-btn${p === key ? ' settings-theme-btn--active' : ''}"
          data-action="set-theme-pref" data-theme-pref="${key}">${labels[key]}</button>`
        )
        .join('')}
    </div>
    <p class="form-hint" style="margin-top:var(--space-xs)">顶栏可切换浅色 / 深色（会保存为你的偏好）。</p>
  `
}
