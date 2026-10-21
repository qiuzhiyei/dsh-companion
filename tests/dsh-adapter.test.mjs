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
