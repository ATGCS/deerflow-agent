import { describe, it, expect } from 'vitest'
import {
  formatToolDisplayTitle,
  getToolIcon,
  supervisorActionZh,
  SUPERVISOR_ACTION_ZH,
} from '../src/lib/tool-display.js'

describe('supervisorActionZh', () => {
  it('maps known actions to Chinese', () => {
    expect(supervisorActionZh('create_task')).toBe(SUPERVISOR_ACTION_ZH.create_task)
    expect(supervisorActionZh('start_execution')).toBe('开始执行')
  })
  it('passes through unknown action', () => {
    expect(supervisorActionZh('custom_action')).toBe('custom_action')
  })
})

describe('getToolIcon', () => {
  it('returns icon by tool object', () => {
    expect(getToolIcon({ name: 'supervisor' })).toBe('🧭')
    expect(getToolIcon({ name: 'bash' })).toBe('⌨️')
  })
  it('returns default for unknown', () => {
    expect(getToolIcon({ name: 'some_mcp_tool_xyz' })).toBe('🔧')
  })
})

describe('formatToolDisplayTitle', () => {
  it('formats supervisor with Chinese action', () => {
    expect(
      formatToolDisplayTitle({
        name: 'supervisor',
        input: { action: 'create_task', task_name: 'x' },
      }),
    ).toContain('创建任务')
    expect(formatToolDisplayTitle({ name: 'supervisor', input: {} })).toContain('任务调度')
  })
  it('formats common builtins in Chinese', () => {
    expect(formatToolDisplayTitle({ name: 'read_file', input: { path: '/a' } })).toContain('读取文件')
    expect(formatToolDisplayTitle({ name: 'web_search', input: { query: 'q' } })).toContain('网络搜索')
  })
})
