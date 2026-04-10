import { useRef, useEffect, useCallback, useMemo, type MutableRefObject } from 'react'
import { MessageRow } from './MessageRow.js'
import type { DisplayRow, StreamState, SubagentStreamTask } from '../chat-types.js'

type VItem = { kind: 'row'; row: DisplayRow; i: number } | { kind: 'stream'; row: DisplayRow }

export function MessageVirtualList({
  rows,
  streamRef,
  streamTick = 0,
  historyLoading = false,
  layoutKey = 0,
  inlineSubagentTasks,
}: {
  rows: DisplayRow[]
  streamRef: MutableRefObject<StreamState>
  streamTick?: number
  /** 为 false 且有条目时滚到底部（刷新/切换会话加载完历史） */
  historyLoading?: boolean
  /**
   * 外部布局变化触发重新测量/滚动（例如托管面板展开导致容器高度变化）
   * 不参与数据渲染，仅用于修复虚拟列表在高度变化时的“白块/不渲染”问题。
   */
  layoutKey?: number | string
  /** final 后主会话气泡已落库，子任务事件仍写入此处时，合并进最后一条 assistant 的展示 */
  inlineSubagentTasks?: Record<string, SubagentStreamTask>
}) {
  const parentRef = useRef<HTMLDivElement | null>(null)

  const items = useMemo((): VItem[] => {
    const ink = inlineSubagentTasks || {}
    const rawLast = rows[rows.length - 1]
    let displayRows = rows
    if (rawLast?.role === 'assistant' && Object.keys(ink).length > 0) {
      displayRows = [...rows.slice(0, -1), { ...rawLast, subagentTasks: { ...ink } }]
    }

    const list: VItem[] = displayRows.map((row, i) => ({ kind: 'row', row, i }))
    // 只在最后一条消息是 user 消息时显示 stream（避免 AI 消息重复显示）
    const lastRow = rows[rows.length - 1]
    if (lastRow?.role === 'user') {
      const s = streamRef?.current
      const hasSubagents = s && Object.keys(s.subagentTasks || {}).length > 0
      const hasTextSegment = !!(s?.segments || []).some((seg) => seg?.kind === 'text' && String(seg?.text || '').trim())
      const hasRenderableStream =
        !!(
          s &&
          (s.text ||
            hasTextSegment ||
            (s.images && s.images.length) ||
            (s.videos && s.videos.length) ||
            (s.audios && s.audios.length) ||
            (s.files && s.files.length) ||
            hasSubagents)
        )
      if (
        hasRenderableStream
      ) {
        const st =
          s.subagentTasks && Object.keys(s.subagentTasks).length ? { ...s.subagentTasks } : undefined
        list.push({
          kind: 'stream',
          row: {
            role: '_stream',
            text: s.text,
            segments: s.segments || [],
            tools: s.tools || [],
            images: s.images || [],
            videos: s.videos || [],
            audios: s.audios || [],
            files: s.files || [],
            ...(st ? { subagentTasks: st } : {}),
          },
        })
      }
    }
    return list
  }, [rows, streamTick, inlineSubagentTasks])

  const scrollToBottom = useCallback(() => {
    const el = parentRef.current
    if (!el || !items.length) return
    el.scrollTop = el.scrollHeight
  }, [items.length])

  /* 历史加载完成 / 流式更新：虚拟列表测量滞后时多帧、延时再滚到底 */
  useEffect(() => {
    if (!items.length || historyLoading) return
    scrollToBottom()
    const raf = requestAnimationFrame(() => {
      scrollToBottom()
      requestAnimationFrame(scrollToBottom)
    })
    const t1 = window.setTimeout(scrollToBottom, 120)
    const t2 = window.setTimeout(scrollToBottom, 320)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [items.length, streamTick, rows.length, historyLoading, scrollToBottom])

  /* 外部布局变化（托管面板展开/收起）保持贴底行为稳定 */
  useEffect(() => {
    if (!items.length) return
    const el = parentRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight)
    const nearBottom = distanceFromBottom < 80

    const raf = requestAnimationFrame(() => {
      if (nearBottom) {
        scrollToBottom()
      }
    })

    return () => {
      cancelAnimationFrame(raf)
    }
  }, [layoutKey, items.length, scrollToBottom])

  if (!items.length) {
    return (
      <div className="react-vlist-scroller chat-messages-inner">
        <div className="react-chat-empty">还没有消息，开始聊天吧</div>
      </div>
    )
  }

  return (
    <div ref={parentRef} className="react-vlist-scroller chat-messages-inner">
      <div className="react-vlist-inner" style={{ width: '100%' }}>
        {items.map((item, i) => {
          const isUser = item.row.role === 'user'
          return (
            <div
              key={item.kind === 'row' ? `row-${item.i}` : 'react-chat-stream-bubble'}
              data-index={i}
              className={isUser ? 'react-vlist-item react-vlist-item--user' : 'react-vlist-item'}
              style={{ width: '100%' }}
            >
              <MessageRow row={item.row} isStreaming={item.kind === 'stream'} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
