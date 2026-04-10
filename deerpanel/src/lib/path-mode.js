const PATH_MODE_KEY = 'deerpanel_use_virtual_paths'

export function getUseVirtualPaths() {
  const raw = localStorage.getItem(PATH_MODE_KEY)
  if (raw == null) return false
  return raw !== 'false'
}

export function setUseVirtualPaths(enabled) {
  localStorage.setItem(PATH_MODE_KEY, enabled ? 'true' : 'false')
}

