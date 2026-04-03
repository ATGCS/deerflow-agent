import { useMemo, useRef, useState, type ReactNode } from 'react'
import type { ChatAttachment } from '../chat-types.js'

function readFileAsAttachment(file: File): Promise<ChatAttachment> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const base64 = String(r.result || '').split(',')[1] || ''
      if (!base64) {
        reject(new Error('empty file'))
        return
      }
      resolve({
        mimeType: file.type || 'image/png',
        content: base64,
      })
    }
    r.onerror = () => reject(r.error || new Error('read failed'))
    r.readAsDataURL(file)
  })
}

export function ChatComposer({
  sessionReady,
  sending,
  streaming,
  onSend,
  onAbort,
  placeholder = '输入消息…',
  renderBottomControls,
}: {
  sessionReady: boolean
  sending: boolean
  streaming: boolean
  onSend: (message: string, attachments?: ChatAttachment[]) => void | Promise<void>
  onAbort: () => void | Promise<void>
  placeholder?: string
  renderBottomControls?: (args: { pickFiles: () => void; insertText: (next: string) => void }) => ReactNode
}) {
  const [text, setText] = useState('')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const fileRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const pickFiles = useMemo(
    () => () => {
      fileRef.current?.click()
    },
    [],
  )

  function insertText(next: string) {
    setText(next)
    textareaRef.current?.focus()
  }

  async function handleSend() {
    const t = text.trim()
    if (!t && !pendingFiles.length) return
    let attachments: ChatAttachment[] = []
    try {
      for (const f of pendingFiles) {
        attachments.push(await readFileAsAttachment(f))
      }
    } catch (e) {
      console.warn('[ChatComposer] attachment', e)
      return
    }
    setText('')
    setPendingFiles([])
    await onSend(t, attachments.length ? attachments : undefined)
  }

  return (
    <footer className="react-chat-composer">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="react-chat-file-input"
        onChange={(e) => {
          const list = [...(e.target.files || [])]
          if (list.length) setPendingFiles((p) => [...p, ...list])
          e.target.value = ''
        }}
      />

      {pendingFiles.length > 0 && (
        <div className="react-chat-composer-files">
          {pendingFiles.map((f, i) => (
            <span key={`${f.name}-${i}`} className="react-chat-file-chip">
              {f.name}
              <button
                type="button"
                className="react-chat-file-chip-x"
                onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="react-chat-composer-top-row">
        <div className="react-chat-input-wrap">
          <textarea
            ref={textareaRef}
            className="react-chat-input"
            rows={2}
            value={text}
            placeholder={placeholder}
            disabled={!sessionReady}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void handleSend()
              }
            }}
          />
        </div>
        {streaming || sending ? (
          <button
            type="button"
            className="react-chat-icon-stop-btn"
            onClick={() => void onAbort()}
            title="停止"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            className="react-chat-icon-send-btn"
            disabled={!sessionReady || (!text.trim() && !pendingFiles.length)}
            onClick={() => void handleSend()}
            title="发送"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        )}
      </div>

      {renderBottomControls ? (
        <div className="react-chat-composer-bottom-row">
          {renderBottomControls({ pickFiles, insertText })}
        </div>
      ) : null}
    </footer>
  )
}
