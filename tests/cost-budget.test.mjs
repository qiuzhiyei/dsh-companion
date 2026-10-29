/**
 * 费用估算与预算告警测试。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { computeCost, priceFor, formatCost } from '../dist/state-machine/cost.js'
import { BudgetGuard } from '../dist/state-machine/budget.js'
import { periodRange } from '../dist/storage/stats.js'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

const PRICES = {
  'deepseek-chat': { inputPerMillion: 2, outputPerMillion: 8 },
  'deepseek-reasoner': { inputPerMillion: 4, outputPerMillion: 16 },
}

test('computeCost: 输入+输出按单价计算', () => {
  // 1M 输入 @2 + 0.5M 输出 @8 = 2 + 4 = 6
  assert.equal(computeCost(1_000_000, 500_000, 0, 'deepseek-chat', PRICES), 6)
})

test('computeCost: 缓存命中计费口径包含缓存 token', () => {
  // prompt = uncached 0.5M + cached 0.5M → (0.5+0.5)/1M*2 = 2；output 0.25M*8 = 2
  assert.equal(computeCost(1_000_000, 250_000, 500_000, 'deepseek-chat', PRICES), 4)
})

test('priceFor: provider/model 前缀宽松匹配', () => {
  assert.equal(priceFor('deepseek/deepseek-chat', PRICES), PRICES['deepseek-chat'])
})

test('priceFor: 未知模型 → 0 费用（不产生 NaN）', () => {
  assert.equal(computeCost(123, 456, 0, 'unknown-model', PRICES), 0)
  assert.ok(Number.isFinite(computeCost(1, 1, 0, 'unknown-model', PRICES)))
})

test('formatCost: 货币符号', () => {
  assert.equal(formatCost(1.5, 'CNY'), '1.50 ¥')
  assert.equal(formatCost(0.001, 'USD'), '0.0010 $')
})

test('BudgetGuard: 单任务 Token 超限告警一次', () => {
  const guard = new BudgetGuard(
    () => ({ taskMaxTokens: 100_000, taskMaxCost: null, dailyMaxTokens: null, dailyMaxCost: null }),
    () => PRICES,
  )
  const first = guard.checkTask('t1', 60_000, 50_000, 0, 'deepseek-chat')
  assert.ok(first && first.kind === 'task-tokens')
  const second = guard.checkTask('t1', 200_000, 300_000, 0, 'deepseek-chat')
  assert.equal(second, null)
})

test('BudgetGuard: 单任务费用超限', () => {
  const guard = new BudgetGuard(
    () => ({ taskMaxTokens: null, taskMaxCost: 1, dailyMaxTokens: null, dailyMaxCost: null }),
    () => PRICES,
  )
  // 2M in @2 + 0.5M out @8 = 8 > 1（DeepSeek 官方 API provider 才走费用线）
  const alert = guard.checkTask('t2', 2_000_000, 500_000, 0, 'deepseek-chat', 'deepseek-account')
  assert.ok(alert && alert.kind === 'task-cost')
  // 同模型但自定义渠道 → 不计费，费用告警不触发
  assert.equal(guard.checkTask('t3', 2_000_000, 500_000, 0, 'deepseek-chat', 'aliyun-bailian'), null)
})

test('BudgetGuard: 并行任务互不干扰（task-start 不得冲掉其它任务的去重标记）', () => {
  const guard = new BudgetGuard(
    () => ({ taskMaxTokens: 100_000, taskMaxCost: null, dailyMaxTokens: null, dailyMaxCost: null }),
    () => PRICES,
  )
  // 任务 A 超限 → 报一次
  const a1 = guard.checkTask('sessA:1', 60_000, 60_000, 0, 'deepseek-chat')
  assert.ok(a1 && a1.kind === 'task-tokens', 'A 首次超限应告警')
  // 任务 B 启动（真实竞态场景：旧实现 task-start 会全局清空 armedTask）
  // 新口径下没有全局清空——A 再次超限必须仍被去重，不重复弹。
  const a2 = guard.checkTask('sessA:1', 80_000, 80_000, 0, 'deepseek-chat')
  assert.equal(a2, null, 'A 的标记不得被 B 启动冲掉（并行任务告警竞态回归）')
  // B 自己超限仍正常告警（各自的 key 各自去重）
  const b1 = guard.checkTask('sessB:1', 200_000, 0, 0, 'deepseek-chat')
  assert.ok(b1 && b1.kind === 'task-tokens', 'B 首次超限应独立告警')
  assert.equal(guard.checkTask('sessB:1', 200_000, 0, 0, 'deepseek-chat'), null, 'B 二次超限去重')
})

test('BudgetGuard: clearTask 只清指定任务、不误伤并行任务', () => {
  const guard = new BudgetGuard(
    () => ({ taskMaxTokens: 100_000, taskMaxCost: null, dailyMaxTokens: null, dailyMaxCost: null }),
    () => PRICES,
  )
  guard.checkTask('sessA:1', 200_000, 0, 0, 'deepseek-chat')
  guard.checkTask('sessB:2', 200_000, 0, 0, 'deepseek-chat')
  guard.checkTask('sessC:3', 0, 2_000_000, 0, 'deepseek-chat', 'deepseek-account')
  // A 结束 → 只清 A；A 再次超限应重新告警（新任务同 key 也不复用标记）
  guard.clearTask('sessA:1')
  assert.ok(guard.checkTask('sessA:1', 200_000, 0, 0, 'deepseek-chat'), 'A 清理后应能重新告警')
  // B/C 未受影响，仍去重
  assert.equal(guard.checkTask('sessB:2', 200_000, 0, 0, 'deepseek-chat'), null, 'B 不应被误清')
  assert.equal(guard.checkTask('sessC:3', 0, 2_000_000, 0, 'deepseek-chat', 'deepseek-account'), null,
    'C 的费用线标记不应被误清')
})

test('源码契约: index.ts 接线 — task-end 精准清理，task-start 不得全局清空', () => {
  const src = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8')
  // task-end 必须按 key 清理（回收内存 + 不误伤并行任务）；key 口径 = sessionId:turn
  assert.ok(src.includes("event.kind === 'task-end'"), '缺 task-end 接线')
  assert.ok(
    src.includes('guard.clearTask(`${event.task.sessionId}:${event.task.turn}`)'),
    'task-end 应按 taskKey 口径（sessionId:turn）调用 clearTask',
  )
  // task-start 块内不得出现全局清空（并行任务下会冲掉其它任务的标记 → 重复告警）。
  // 用正则限定在 task-start 后 300 字符内查，不依赖 task-end 的位置。
  assert.ok(
    !/event\.kind === 'task-start'[\s\S]{0,300}?resetTaskArming/.test(src),
    'task-start 不得全局清空去重标记（并行告警竞态回归）',
  )
  // togglePause 恢复统计时的全局重新武装是正确语义，必须保留
  assert.ok(src.includes('resetTaskArming()'), 'togglePause 应保留全局重新武装')
})

test('BudgetGuard: 每日 Token 告警去重 + 新任务重新武装', () => {
  const guard = new BudgetGuard(
    () => ({ taskMaxTokens: null, taskMaxCost: null, dailyMaxTokens: 500_000, dailyMaxCost: null }),
    () => PRICES,
  )
  const alert = guard.checkDaily({ totalTokens: 600_000, cost: 0 })
  assert.ok(alert && alert.kind === 'daily-tokens')
  assert.equal(guard.checkDaily({ totalTokens: 700_000, cost: 0 }), null)
})

test('periodRange: 周从周一开始', () => {
  // 2026-10-15 是周四；本周一应为 2026-10-12 00:00 本地。
  const thursday = new Date(2026, 9, 15, 15, 30)
  const { from, to } = periodRange('week', thursday)
  const monday = new Date(from)
  assert.equal(monday.getDay(), 1)
  assert.equal(monday.getDate(), 12)
  assert.equal(to - from, 7 * 24 * 3600 * 1000)
})

test('periodRange: 月边界', () => {
  const mid = new Date(2026, 9, 15)
  const { from, to } = periodRange('month', mid)
  assert.equal(new Date(from).getDate(), 1)
  assert.equal(new Date(from).getMonth(), 9)
  assert.equal(new Date(to).getMonth(), 10)
})
