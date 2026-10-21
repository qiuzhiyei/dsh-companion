/**
 * 端到端（无宿主）：mock 事件模拟器 → 任务追踪器 → 持久化。
 * 这条链路证明插件可脱离 DSH 独立运行。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockDshAdapter } from '../dist/adapter/mock-adapter.js'
import { PetStateMachine } from '../dist/state-machine/pet-state-machine.js'
import { TaskTracker } from '../dist/state-machine/task-tracker.js'
import { openPetStore } from '../dist/storage/store.js'

test('mock 模拟器完整跑一次成功任务（提速 60 倍）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-companion-test-'))
  try {
    const opened = await openPetStore(dir, 'json')
    const store = opened.store
    const persisted = []
    const tracker = new TaskTracker({
      modelPrices: { 'deepseek-flash': { inputPerMillion: 2, outputPerMillion: 8 } },
      onFinish: async (task, tools) => {
        persisted.push({ task, tools })
        await store.saveTask(task)
        await store.saveToolCalls(tools)
      },
    })
    const machine = new PetStateMachine({ settleMs: 50 })
    const adapter = new MockDshAdapter({ speed: 60 })
    adapter.onEvent((event) => {
      machine.handle(event)
      tracker.handle(event)
    })
    assert.equal(adapter.start('success'), true)
    // 场景总时长 ~10.6s / 60 ≈ 180ms；等 600ms 覆盖全部事件。
    await new Promise((resolve) => setTimeout(resolve, 600))
    await adapter.dispose()

    assert.equal(persisted.length, 1, '应恰好完成一个任务')
    const { task, tools } = persisted[0]
    assert.equal(task.status, 'success')
    assert.equal(task.model, 'deepseek-flash')
    assert.ok(task.promptTokens > 0)
    assert.ok(task.completionTokens > 0)
    assert.equal(task.totalTokens, task.promptTokens + task.completionTokens)
    assert.ok(task.cost > 0)
    assert.equal(task.toolCalls, tools.length)
    // 三个步骤。
    assert.equal(task.steps, 3)

    const tasks = await store.listTasks(10)
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0].id, task.id)
    const toolCalls = await store.listToolCalls(100)
    assert.equal(toolCalls.length, tools.length)
    await store.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('mock 失败场景 → failed 终态', async () => {
  const adapter = new MockDshAdapter({ speed: 80 })
  const machine = new PetStateMachine({ settleMs: 50 })
  const statuses = []
  adapter.onEvent((event) => {
    machine.handle(event)
    if (event.kind === 'task-end') statuses.push(event.status)
  })
  adapter.start('error')
  await new Promise((resolve) => setTimeout(resolve, 400))
  await adapter.dispose()
  assert.deepEqual(statuses, ['failed'])
})

test('mock 中断场景 → interrupted 终态', async () => {
  const adapter = new MockDshAdapter({ speed: 80 })
  const statuses = []
  adapter.onEvent((event) => {
    if (event.kind === 'task-end') statuses.push(event.status)
  })
  adapter.start('interrupted')
  await new Promise((resolve) => setTimeout(resolve, 400))
  await adapter.dispose()
  assert.deepEqual(statuses, ['interrupted'])
})

test('同一时刻只允许一个模拟任务', () => {
  const adapter = new MockDshAdapter()
  assert.equal(adapter.start('success'), true)
  assert.equal(adapter.start('long'), false)
})
