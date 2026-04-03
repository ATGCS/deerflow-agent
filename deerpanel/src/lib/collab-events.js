/**
 * SSE subscription for GET /api/events/projects/{project_id}/stream
 * Server sends named events only for connected/ping; payload events use default message + JSON body { type, data, ... }.
 */
import { getBackendBaseURL } from './tauri-api.js'

/**
 * @param {string} projectId
 * @param {(payload: { type?: string, data?: object, project_id?: string }) => void} onEvent
 * @param {{ onConnected?: () => void, onError?: (err?: unknown) => void }} [opts]
 * @returns {{ close: () => void }}
 */
export function subscribeProjectEventStream(projectId, onEvent, opts = {}) {
  const { onConnected, onError } = opts
  let es = null
  let closed = false
  let attempt = 0
  let timer = null

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const scheduleReconnect = () => {
    if (closed) return
    clearTimer()
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))
    attempt += 1
    timer = setTimeout(connect, delay)
  }

  function connect() {
    if (closed) return
    clearTimer()
    const url = `${getBackendBaseURL()}/api/events/projects/${encodeURIComponent(projectId)}/stream`
    try {
      es = new EventSource(url)
    } catch (e) {
      onError?.(e)
      scheduleReconnect()
      return
    }

    es.addEventListener('connected', () => {
      attempt = 0
      onConnected?.()
    })
    es.addEventListener('ping', () => {})

    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data)
        onEvent(payload)
      } catch {
        /* ignore */
      }
    }

    es.onerror = () => {
      if (closed) return
      try {
        es?.close()
      } catch {
        /* ignore */
      }
      es = null
      onError?.()
      scheduleReconnect()
    }
  }

  connect()

  return {
    close: () => {
      closed = true
      clearTimer()
      try {
        es?.close()
      } catch {
        /* ignore */
      }
      es = null
    },
  }
}
