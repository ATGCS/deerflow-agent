import { formatToolDisplayValue, isToolRunning, toolLabel } from '../../lib/chat-normalize.js'
import { getToolIcon } from '../../lib/tool-display.js'

function formatTime(date: Date | number) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (isToday) return `${h}:${m}`
  const mon = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `${mon}-${day} ${h}:${m}`
}

export function ToolCallList({
  tools,
  filterIds,
}: {
  tools?: unknown[]
  /** 若提供，仅按该顺序展示对应 id 的工具（用于交错 segments） */
  filterIds?: string[]
}) {
  const safeToolKind = (name: unknown) => {
    const s = String(name || '').trim()
    if (!s) return 'tool'
    return s.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()
  }

  let list = tools || []
  if (filterIds?.length) {
    const m = new Map<string, unknown>()
    for (const tool of list) {
      const t = tool as Record<string, unknown>
      const id = String(t.id || t.tool_call_id || '')
      if (id) m.set(id, tool)
    }
    list = filterIds.map((id) => m.get(id)).filter(Boolean) as unknown[]
  }
  if (!list.length) return null
  return (
    <div className="msg-tool react-msg-tool">
      {list.map((tool, i) => {
        const t = tool as Record<string, unknown>
        const running = isToolRunning(tool)
        const status = running ? '进行中' : t.status === 'error' ? '失败' : '完成'
        const statusCls = running ? 'running' : t.status === 'error' ? 'error' : 'ok'
        const timeValue = (t.time || t.messageTimestamp) as number | string | undefined
        const timeText = timeValue ? formatTime(new Date(timeValue)) : ''
        const rawName = t.name ?? t.tool_name ?? t.toolName
        const toolName = String(rawName != null && String(rawName).trim() ? rawName : 'tool')
        const toolKind = safeToolKind(toolName)
        const titleText = toolLabel(tool)
        const inputJson = formatToolDisplayValue(t.input)
        const outputJson = formatToolDisplayValue(t.output)

        const inputObj = t.input && typeof t.input === 'object' ? (t.input as Record<string, unknown>) : null
        const command = typeof inputObj?.command === 'string' ? inputObj.command : null
        const query = typeof inputObj?.query === 'string' ? inputObj.query : null
        const url = typeof inputObj?.url === 'string' ? inputObj.url : null
        const path = typeof inputObj?.path === 'string' ? inputObj.path : null

        const bashCommand = command || (typeof t.input === 'string' ? t.input : null)

        const key = (t.id || t.tool_call_id || `t-${i}`) as string
        return (
          <details
            key={key}
            className={`msg-tool-item${running ? ' msg-tool-item--running' : ''} msg-tool-item--${toolKind}`}
            open={running}
          >
            <summary title={titleText}>
              <span className="msg-tool-icon" aria-hidden="true">
                {getToolIcon(tool)}
              </span>
              <span className="msg-tool-name">{titleText}</span>
              <span className={`msg-tool-status msg-tool-status--${statusCls}`}>{status}</span>
              {timeText ? <span className="msg-tool-time">{timeText}</span> : null}
            </summary>
            <div className="msg-tool-body">
              {toolKind === 'bash' ? (
                <>
                  <div className="msg-tool-block msg-tool-block--terminal">
                    <div className="msg-tool-title">命令</div>
                    <pre>{bashCommand || inputJson || '无命令'}</pre>
                  </div>
                  <div className="msg-tool-block msg-tool-block--terminal">
                    <div className="msg-tool-title">输出</div>
                    <pre>{outputJson || '无输出'}</pre>
                  </div>
                </>
              ) : toolKind === 'read_file' ? (
                <>
                  <div className="msg-tool-block msg-tool-block--code">
                    <div className="msg-tool-title">文件路径</div>
                    <pre>{path || inputJson || '无路径'}</pre>
                  </div>
                  <div className="msg-tool-block msg-tool-block--code">
                    <div className="msg-tool-title">内容</div>
                    <pre>{outputJson || '无内容'}</pre>
                  </div>
                </>
              ) : toolKind === 'write_file' || toolKind === 'str_replace' ? (
                <>
                  <div className="msg-tool-block msg-tool-block--code">
                    <div className="msg-tool-title">目标文件</div>
                    <pre>{path || inputJson || '无文件'}</pre>
                  </div>
                  <div className="msg-tool-block msg-tool-block--code">
                    <div className="msg-tool-title">结果</div>
                    <pre>{outputJson || '无结果'}</pre>
                  </div>
                </>
              ) : toolKind === 'web_search' || toolKind === 'web_fetch' ? (
                <>
                  <div className="msg-tool-block msg-tool-block--code">
                    <div className="msg-tool-title">{toolKind === 'web_search' ? '查询' : 'URL'}</div>
                    <pre>{toolKind === 'web_search' ? query || inputJson || '无查询' : url || inputJson || '无 URL'}</pre>
                  </div>
                  <div className="msg-tool-block msg-tool-block--code">
                    <div className="msg-tool-title">结果</div>
                    <pre>{outputJson || '无结果'}</pre>
                  </div>
                </>
              ) : (
                <>
                  <div className="msg-tool-block">
                    <div className="msg-tool-title">参数</div>
                    <pre>{inputJson || '无参数'}</pre>
                  </div>
                  <div className="msg-tool-block">
                    <div className="msg-tool-title">结果</div>
                    <pre>{outputJson || '无结果'}</pre>
                  </div>
                </>
              )}
            </div>
          </details>
        )
      })}
    </div>
  )
}
