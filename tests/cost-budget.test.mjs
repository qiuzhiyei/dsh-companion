/**
 * 费用估算与预算告警测试。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { computeCost, priceFor, formatCost } from '../dist/state-machine/cost.js'
import { BudgetGuard } from '../dist/state-machine/budget.js'
import { periodRange } from '../dist/storage/stats.js'

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
