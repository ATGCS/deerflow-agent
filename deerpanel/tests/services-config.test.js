import test from 'node:test'
import assert from 'node:assert/strict'

import { buildConfigCandidates, readConfigWithFallback } from '../src/lib/services-config.js'

test('候选路径优先使用项目根目录 config.yaml', () => {
  const candidates = buildConfigCandidates('D:\\github\\deerflaw', '')
  assert.equal(candidates[0], 'D:/github/deerflaw/config.yaml')
  assert.equal(candidates[1], 'D:/github/deerflaw/backend/config.yaml')
})

test('readConfigWithFallback 可从首个命中路径读取成功', async () => {
  const mockReadFile = async (p) => (p === 'D:/github/deerflaw/config.yaml' ? 'name: deerflow' : '')
  const result = await readConfigWithFallback({
    readFile: mockReadFile,
    preferredRoot: 'D:/github/deerflaw',
    savedPath: '',
    resolveByShell: async () => '',
  })
  assert.equal(result.path, 'D:/github/deerflaw/config.yaml')
  assert.equal(result.content, 'name: deerflow')
})

test('readConfigWithFallback 可通过 shell 回退路径读取成功', async () => {
  const mockReadFile = async (p) => (p === 'E:/work/deerflaw/config.yaml' ? 'api: true' : '')
  const result = await readConfigWithFallback({
    readFile: mockReadFile,
    preferredRoot: '',
    savedPath: '',
    resolveByShell: async () => 'E:/work/deerflaw/config.yaml',
  })
  assert.equal(result.path, 'E:/work/deerflaw/config.yaml')
  assert.equal(result.content, 'api: true')
})
