/**
 * 主题管理（日间/夜间模式 + 跟随系统）
 */
const THEME_KEY = 'clawpanel-theme'

function emitThemePreferenceChanged() {
  window.dispatchEvent(new CustomEvent('deerpanel-theme-pref-changed'))
}

function effectiveFromMedia() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** @returns {'light' | 'dark' | 'system'} */
export function getThemePreference() {
  const v = localStorage.getItem(THEME_KEY)
  if (v === 'light' || v === 'dark') return v
  return 'system'
}

/** @param {'light' | 'dark' | 'system'} pref */
export function setThemePreference(pref) {
  if (pref === 'system') {
    localStorage.setItem(THEME_KEY, 'system')
    document.documentElement.dataset.theme = effectiveFromMedia()
    emitThemePreferenceChanged()
    return
  }
  if (pref === 'light' || pref === 'dark') {
    localStorage.setItem(THEME_KEY, pref)
    document.documentElement.dataset.theme = pref
    emitThemePreferenceChanged()
  }
}

export function initTheme() {
  const pref = localStorage.getItem(THEME_KEY)
  if (pref === 'light' || pref === 'dark') {
    document.documentElement.dataset.theme = pref
    return
  }
  document.documentElement.dataset.theme = effectiveFromMedia()
}

/** 在「跟随系统」或未写入偏好时，随 OS 明暗切换更新界面 */
export function attachSystemThemeListener() {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const pref = localStorage.getItem(THEME_KEY)
    if (pref === 'light' || pref === 'dark') return
    document.documentElement.dataset.theme = effectiveFromMedia()
  })
}

export function toggleTheme() {
  const current = document.documentElement.dataset.theme || 'light'
  const next = current === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = next
  localStorage.setItem(THEME_KEY, next)
  emitThemePreferenceChanged()
  return next
}

export function getTheme() {
  return document.documentElement.dataset.theme || 'light'
}
