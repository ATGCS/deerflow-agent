import { describe, it, expect } from 'vitest'
import {
  normalizeHistoryRole,
  messagesToDisplayRows,
  dedupeHistory,
  extractContent,
  accumulateStreamAssistantText,
  parseUsageToStats,
  stripThinkingTags,
  stripAgentMetaLines,
  upsertTool,
  CHAT_MAIN_SESSION_KEY,
} from '../src/lib/chat-normalize.js'

describe('normalizeHistoryRole', () => {
  it('maps human to user', () => {
    expect(normalizeHistoryRole({ type: 'human' })).toBe('user')
  })
  it('maps ai to assistant', () => {
    expect(normalizeHistoryRole({ type: 'ai' })).toBe('assistant')
  })
  it('respects explicit role', () => {
    expect(normalizeHistoryRole({ role: 'user' })).toBe('user')
  })
})

describe('extractContent + dedupeHistory', () => {
  it('treats type:tool as tool result (checkpoint / LangGraph)', () => {
    const c = extractContent({
      type: 'tool',
      name: 'write_file',
      tool_call_id: 'call_ab',
      content: 'OK',
    })
    expect(c.tools).toHaveLength(1)
    expect(c.tools[0].id).toBe('call_ab')
    expect(c.tools[0].output).toBe('OK')
  })
  it('interleaves text and tools in segments when merging assistant history', () => {
    const raw = [
      { role: 'assistant', content: [{ type: 'text', text: '先说明' }] },
      {
        role: 'assistant',
        content: [],
        tool_calls: [{ id: 't1', name: 'write_file', args: { path: '/a' } }],
      },
      { role: 'tool', tool_call_id: 't1', name: 'write_file', content: 'OK' },
      { role: 'assistant', content: [{ type: 'text', text: '再总结' }] },
    ]
    const d = dedupeHistory(raw)
    expect(d.length).toBe(1)
    expect(d[0].segments?.map((s) => s.kind)).toEqual(['text', 'tools', 'text'])
    expect(d[0].segments[0].kind).toBe('text')
    expect(d[0].segments[0].text).toContain('先说明')
    expect(d[0].segments[2].text).toContain('再总结')
  })
  it('extracts text from string content', () => {
    const c = extractContent({ role: 'user', content: 'hello' })
    expect(c.text).toContain('hello')
  })
  it('merges consecutive assistant with different text', () => {
    const raw = [
      { role: 'assistant', content: [{ type: 'text', text: 'a' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'b' }] },
    ]
    const d = dedupeHistory(raw)
    expect(d.length).toBe(1)
    expect(d[0].role).toBe('assistant')
    expect(d[0].text).toContain('a')
    expect(d[0].text).toContain('b')
  })
})

describe('messagesToDisplayRows', () => {
  it('maps system-type messages to assistant role (parity with chat.js)', () => {
    const rows = messagesToDisplayRows([
      { type: 'system', content: [{ type: 'text', text: 'sys' }] },
    ])
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].role).toBe('assistant')
    expect(rows[0].text).toContain('sys')
  })
})

describe('accumulateStreamAssistantText', () => {
  it('prefers longer prefix', () => {
    expect(accumulateStreamAssistantText('hel', 'hello')).toBe('hello')
  })
  it('concatenates when not prefix', () => {
    expect(accumulateStreamAssistantText('a', 'b')).toBe('ab')
  })
  it('ignores stale shorter snapshot (no duplicate concat)', () => {
    expect(accumulateStreamAssistantText('hello world', 'hello')).toBe('hello world')
  })
})

describe('upsertTool', () => {
  it('replaces empty object input with later full args', () => {
    const tools = []
    upsertTool(tools, { id: 'tc1', name: 'write_file', input: {}, status: 'running' })
    upsertTool(tools, {
      id: 'tc1',
      name: 'write_file',
      input: { path: '/mnt/x.txt', content: 'hi' },
      status: 'running',
    })
    expect(tools).toHaveLength(1)
    expect(tools[0].input).toEqual({ path: '/mnt/x.txt', content: 'hi' })
  })
  it('merges partial object inputs', () => {
    const tools = []
    upsertTool(tools, { id: 'tc1', name: 't', input: { path: '/a' }, status: 'running' })
    upsertTool(tools, { id: 'tc1', name: 't', input: { content: 'b' }, status: 'running' })
    expect(tools[0].input).toEqual({ path: '/a', content: 'b' })
  })
  it('merges string "{}" then object args', () => {
    const tools = []
    upsertTool(tools, { id: 'x', name: 'write_file', input: '{}', status: 'running' })
    upsertTool(tools, { id: 'x', name: 'write_file', input: { path: '/p', content: 'c' }, status: 'running' })
    expect(tools[0].input).toEqual({ path: '/p', content: 'c' })
  })
  it('merges by name when output exists but input still empty', () => {
    const tools = []
    upsertTool(tools, {
      id: 'call-1',
      name: 'write_file',
      input: {},
      output: 'OK',
      status: 'ok',
    })
    upsertTool(tools, { name: 'write_file', input: { path: '/mnt/a.txt', content: 'hi' }, status: 'ok' })
    expect(tools).toHaveLength(1)
    expect(tools[0].input).toEqual({ path: '/mnt/a.txt', content: 'hi' })
  })
  it('does not merge same-name tools when each has distinct id (multi write_file)', () => {
    const tools = []
    upsertTool(tools, { id: 'call_a', name: 'write_file', input: { path: '/a' }, status: 'running' })
    upsertTool(tools, { id: 'call_b', name: 'write_file', input: { path: '/b' }, status: 'running' })
    expect(tools).toHaveLength(2)
    expect(tools[0].id).toBe('call_a')
    expect(tools[1].id).toBe('call_b')
  })
})

describe('parseUsageToStats', () => {
  it('parses total_tokens', () => {
    expect(parseUsageToStats({ total_tokens: 10 })).toEqual({ input: 0, output: 0, total: 10 })
  })
})

describe('stripThinkingTags', () => {
  it('removes collab_phase_context blocks', () => {
    const raw =
      '你好<collab_phase_context> **Collaboration phase:** `req_confirm`</collab_phase_context>结尾'
    expect(stripThinkingTags(raw)).toBe('你好结尾')
  })
  it('removes agent meta preamble lines (identity / collab phase)', () => {
    expect(stripThinkingTags('身份：Deer\n\n用户可见')).toBe('用户可见')
    expect(stripThinkingTags('协作阶段：req_confirm\n正文')).toBe('正文')
  })
})

describe('stripAgentMetaLines', () => {
  it('drops lines starting with known prefixes', () => {
    const raw = '核心任务：wait\n技能：17\n\n已完成'
    expect(stripAgentMetaLines(raw)).toBe('已完成')
  })
})

describe('CHAT_MAIN_SESSION_KEY', () => {
  it('matches ws-client main key', () => {
    expect(CHAT_MAIN_SESSION_KEY).toBe('agent:main:main')
  })
})
