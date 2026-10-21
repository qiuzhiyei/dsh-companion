/**
 * 状态机转移表测试（消费 dist 产物，保证构建物可用）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { PetStateMachine } from '../dist/state-machine/pet-state-machine.js'

function task(sessionId = 's1', turn = 1) {
  return { sessionId, turn, project: 'p', workspace: 'w', subagent: false }
}

function machineWithLog() {
  const trace = []
  const machine = new PetStateMachine({
    settleMs: 60,
    onStateChange: (from, to) => trace.push(`${from}->${to}`),
  })
  return { machine, trace }
}

test('task start → casting', () => {
  const { machine } = machineWithLog()
  machine.handle({ kind: 'task-start', task: task(), time: 1 })
  assert.equal(machine.current, 'casting')
})

test('model start → waiting, stream → hooked', () => {
  const { machine } = machineWithLog()
  machine.handle({ kind: 'task-start', task: task(), time: 1 })
  machine.handle({ kind: 'model-start', task: task(), step: 1, time: 2 })
  assert.equal(machine.current, 'waiting')
  machine.handle({ kind: 'stream-activity', task: task(), time: 3 })
  assert.equal(machine.current, 'hooked')
})

test('tool run keeps hooked; last tool end back to waiting', () => {
  const { machine } = machineWithLog()
  machine.handle({ kind: 'task-start', task: task(), time: 1 })
  machine.handle({ kind: 'tool-start', task: task(), callId: 'c1', name: 'read', time: 2 })
  machine.handle({ kind: 'tool-start', task: task(), callId: 'c2', name: 'grep', time: 3 })
  machine.handle({ kind: 'tool-end', task: task(), callId: 'c1', name: 'read', ok: true, time: 4 })
  assert.equal(machine.current, 'hooked')
  machine.handle({ kind: 'tool-end', task: task(), callId: 'c2', name: 'grep', ok: true, time: 5 })
  assert.equal(machine.current, 'waiting')
})

test('model end without tools → reeling', () => {
  const { machine } = machineWithLog()
  machine.handle({ kind: 'task-start', task: task(), time: 1 })
  machine.handle({ kind: 'model-start', task: task(), step: 1, time: 2 })
  machine.handle({ kind: 'model-end', task: task(), step: 1, usage: null, time: 3 })
  assert.equal(machine.current, 'reeling')
})

test('task end outcomes map to terminal states', () => {
  for (const [status, expected] of [
    ['success', 'done'],
    ['failed', 'error'],
    ['interrupted', 'interrupted'],
  ]) {
    const { machine } = machineWithLog()
    machine.handle({ kind: 'task-start', task: task(), time: 1 })
    machine.handle({ kind: 'task-end', task: task(), status, reason: 'r', time: 2 })
    assert.equal(machine.current, expected, status)
  }
})

test('terminal state settles back to idle', async () => {
  const { machine } = machineWithLog()
  machine.handle({ kind: 'task-start', task: task(), time: 1 })
  machine.handle({ kind: 'task-end', task: task(), status: 'success', reason: 'completed', time: 2 })
  assert.equal(machine.current, 'done')
  await new Promise((resolve) => setTimeout(resolve, 90))
  assert.equal(machine.current, 'idle')
})

test('new task interrupts settle window', () => {
  const { machine } = machineWithLog()
  machine.handle({ kind: 'task-start', task: task(), time: 1 })
  machine.handle({ kind: 'task-end', task: task(), status: 'failed', reason: 'error', time: 2 })
  machine.handle({ kind: 'task-start', task: task('s1', 2), time: 3 })
  assert.equal(machine.current, 'casting')
  machine.dispose()
  assert.equal(machine.current, 'casting')
})

test('dispose clears settle timer', async () => {
  const { machine } = machineWithLog()
  machine.handle({ kind: 'task-start', task: task(), time: 1 })
  machine.handle({ kind: 'task-end', task: task(), status: 'success', reason: 'completed', time: 2 })
  machine.dispose()
  await new Promise((resolve) => setTimeout(resolve, 90))
  assert.equal(machine.current, 'done')
})
