/**
 * dsh-adapter 模型路由契约。
 *
 * 背景（会话日志实证）：DSH 的 request/header 只在请求配置变化时才发，
 * 整轮 turn 可以一个 header 都没有（38 header vs 390 assistant/message），
 * 这些轮次的任务过去落库就缺模型名。修复 = 适配层按会话缓存最近已知路由
 * （header/context/model-selection 三个来源），turn/start 时主动补发。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { DshAdapter } from '../dist/adapter/dsh-adapter.js'

function makeCtx() {
  const handlers = new Map()
  return {
    handlers,
    on(name, fn) {
      handlers.set(name, fn)
      return () => handlers.delete(name)
    },
  }
}

const session = { id: 'session-9', header: { cwd: 'D:/work/demo', delegationDepth: 0 } }

test('dsh-adapter: 零 header 的轮次继承会话最近已知路由', async () => {
  const ctx = makeCtx()
  const adapter = new DshAdapter(ctx)
  const events = []
  adapter.onEvent((e) => events.push(e))
  const emit = (event) => ctx.handlers.get('session/event')(session, event)

  // turn 1 带 header，正常拿到路由
  emit({ type: 'turn/start', time: 1000, data: { turn: 1 } })
  emit({ type: 'request/header', time: 1001, data: { header: { config: { provider: 'aliyun-bailian', model: 'qwen3.8-max' } } } })
  emit({ type: 'turn/end', time: 1002, data: { turn: 1, reason: { kind: 'completed' } } })

  // turn 2 整轮零 header：task-start 后必须立刻补发缓存路由
  events.length = 0
  emit({ type: 'turn/start', time: 2000, data: { turn: 2 } })
  assert.deepEqual(events.slice(0, 2).map((e) => e.kind), ['task-start', 'model-route'])
  assert.equal(events[1].provider, 'aliyun-bailian')
  assert.equal(events[1].model, 'qwen3.8-max')
  assert.equal(events[1].task.turn, 2, '补发的路由必须归属新 turn')

  await adapter.dispose()
})

test('dsh-adapter: model/selection 更新缓存并同步运行中任务', async () => {
  const ctx = makeCtx()
  const adapter = new DshAdapter(ctx)
  const events = []
  adapter.onEvent((e) => events.push(e))
  const emit = (event) => ctx.handlers.get('session/event')(session, event)

  emit({ type: 'turn/start', time: 1000, data: { turn: 1 } })
  emit({ type: 'model/selection', time: 1001, data: { provider: 'deepseek-account', model: 'deepseek-flash' } })
  const route = events.filter((e) => e.kind === 'model-route').pop()
  assert.equal(route.provider, 'deepseek-account')
  assert.equal(route.model, 'deepseek-flash')
  assert.equal(route.task.turn, 1, '运行中 turn 直接同步')

  // 后续新轮次继承切换后的缓存
  events.length = 0
  emit({ type: 'turn/end', time: 1002, data: { turn: 1, reason: { kind: 'completed' } } })
  emit({ type: 'turn/start', time: 2000, data: { turn: 2 } })
  const inherited = events.filter((e) => e.kind === 'model-route').pop()
  assert.equal(inherited.model, 'deepseek-flash')

  await adapter.dispose()
})

test('dsh-adapter: 无打开 turn 的 header 只进缓存，不发 turn=0 幽灵路由', async () => {
  const ctx = makeCtx()
  const adapter = new DshAdapter(ctx)
  const events = []
  adapter.onEvent((e) => events.push(e))
  const emit = (event) => ctx.handlers.get('session/event')(session, event)

  // 会话冷启动就来 header（turn 未打开）：不得发事件（旧实现发 turn=0 噪音）。
  emit({ type: 'request/header', time: 900, data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } } } })
  assert.equal(events.filter((e) => e.kind === 'model-route').length, 0, '无 turn 时不应发幽灵 model-route')
  assert.ok(!events.some((e) => e.task && e.task.turn === 0), '任何事件都不该归属 turn=0')

  // 但缓存必须已记下：下一个 turn/start 照常补发。
  events.length = 0
  emit({ type: 'turn/start', time: 1000, data: { turn: 1 } })
  const routes = events.filter((e) => e.kind === 'model-route')
  assert.equal(routes.length, 1, 'header 缓存应在 turn/start 时补发')
  assert.equal(routes[0].model, 'deepseek-v4-pro')
  assert.equal(routes[0].task.turn, 1)

  await adapter.dispose()
})

test('dsh-adapter: 会话缓存有上限（长期运行不泄漏），淘汰后按需重建', async () => {
  const ctx = makeCtx()
  const adapter = new DshAdapter(ctx, { maxCachedSessions: 2 })
  const events = []
  adapter.onEvent((e) => events.push(e))
  const mkSession = (id) => ({ id, header: { cwd: 'D:/work/' + id, delegationDepth: 0 } })
  const emit = (s, event) => ctx.handlers.get('session/event')(s, event)

  const sA = mkSession('session-a')
  const sB = mkSession('session-b')
  const sC = mkSession('session-c')
  // 三个会话依次活跃，上限 2 → session-a 的路由缓存被淘汰。
  for (const [s, model] of [[sA, 'm-a'], [sB, 'm-b'], [sC, 'm-c']]) {
    emit(s, { type: 'turn/start', time: 1, data: { turn: 1 } })
    emit(s, { type: 'request/header', time: 2, data: { header: { config: { provider: 'p', model } } } })
    emit(s, { type: 'turn/end', time: 3, data: { turn: 1, reason: { kind: 'completed' } } })
  }

  // 最旧会话（A）再开轮：缓存已淘汰 → 不再补发路由。
  events.length = 0
  emit(sA, { type: 'turn/start', time: 10, data: { turn: 2 } })
  assert.equal(events.filter((e) => e.kind === 'model-route').length, 0, '被淘汰会话不再补发')
  // 任务元信息按需重建：project 应从 session.header 现算，不因淘汰而残缺。
  const startA = events.find((e) => e.kind === 'task-start')
  assert.equal(startA.task.project, 'session-a', '淘汰后元信息应无损重建')
  emit(sA, { type: 'turn/end', time: 11, data: { turn: 2, reason: { kind: 'completed' } } })

  // 仍活跃的会话（C）缓存健在：照常补发。
  events.length = 0
  emit(sC, { type: 'turn/start', time: 20, data: { turn: 2 } })
  const routes = events.filter((e) => e.kind === 'model-route')
  assert.equal(routes.length, 1, '未淘汰会话应照常补发')
  assert.equal(routes[0].model, 'm-c')

  await adapter.dispose()
})
