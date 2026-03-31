import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DOCKER_TASK_TIMEOUT_MS,
  buildDockerDispatchTargets,
  buildDockerInstanceSwitchContext,
} from '../src/lib/docker-tasking.js'

test('Docker 异步任务默认超时提升�?10 分钟', () => {
  assert.equal(DOCKER_TASK_TIMEOUT_MS, 10 * 60 * 1000)
})

test('Docker 派发目标会保留容器和节点信息', () => {
  const targets = buildDockerDispatchTargets([
    { id: 'container-1234567890ab', name: 'deerpanel-coder', nodeId: 'node-a' },
    { id: 'container-bbbbbbbbbbbb', name: 'deerpanel-writer', nodeId: 'node-b' },
  ])

  assert.deepEqual(targets, [
    { containerId: 'container-1234567890ab', containerName: 'deerpanel-coder', nodeId: 'node-a' },
    { containerId: 'container-bbbbbbbbbbbb', containerName: 'deerpanel-writer', nodeId: 'node-b' },
  ])
})

test('Docker 实例切换上下文会要求整页重载并生成正确注册参�?, () => {
  const ctx = buildDockerInstanceSwitchContext({
    containerId: 'abcdef1234567890',
    name: 'deerpanel-coder',
    port: '21420',
    gatewayPort: '28789',
    nodeId: 'node-a',
  })

  assert.equal(ctx.instanceId, 'docker-abcdef123456')
  assert.equal(ctx.reloadRoute, true)
  assert.deepEqual(ctx.registration, {
    name: 'deerpanel-coder',
    type: 'docker',
    endpoint: 'http://127.0.0.1:21420',
    gatewayPort: 28789,
    containerId: 'abcdef1234567890',
    nodeId: 'node-a',
    note: 'Added from Docker page',
  })
})
