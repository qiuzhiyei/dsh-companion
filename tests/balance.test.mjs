/**
 * 余额台账测试：平台响应解析、凭证通道、缓存/失败降级、日/月聚合口径。
 * 只测纯逻辑与注入的 fetch，不联网、不读真实凭证。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { AccountBalanceSource, parseBalancePayload } from '../dist/balance/source.js'
import { summarizeBalance, startOfDay, startOfMonth, collectBalanceSeries } from '../dist/balance/ledger.js'

const SAMPLE = {
  code: 0,
  msg: '',
  data: {
    biz_code: 0,
    biz_msg: '',
    biz_data: {
      normal_wallets: [{ currency: 'CNY', balance: '17.7723147200000000', token_estimation: '0' }],
      bonus_wallets: [{ currency: 'CNY', balance: '6.0000000000000000', token_estimation: '0' }],
      total_costs: [{ currency: 'CNY', amount: '42.2276852800000000' }],
    },
  },
}

function creds(record) {
  return { readRecord: async () => record }
}

test('parseBalancePayload: 真实样本 → 充值/赠金/累计消耗', () => {
  const view = parseBalancePayload(SAMPLE)
  assert.ok(view)
  assert.equal(view.currency, 'CNY')
  assert.equal(view.normal, 17.77231472)
  assert.equal(view.bonus, 6)
  assert.equal(view.totalCosts, 42.22768528)
})

test('parseBalancePayload: code 非 0 / 缺钱包 → null（不抛）', () => {
  assert.equal(parseBalancePayload({ code: 1 }), null)
  assert.equal(parseBalancePayload({ code: 0, data: {} }), null)
  assert.equal(parseBalancePayload(null), null)
})

const snap = (ts, normal, extra = {}) => ({
  ts,
  currency: 'CNY',
  normal,
  bonus: 0,
  totalCosts: null,
  source: 'timer',
  ...extra,
})

test('summarizeBalance: 有基线时只算区间内下降量', () => {
  const now = new Date(2026, 9, 23, 15, 0).getTime()
  const from = startOfDay(now)
  const points = [snap(from + 1000, 20), snap(from + 3600_000, 18), snap(from + 7200_000, 15)]
  const sum = summarizeBalance({ period: 'today', snapshots: points, baseline: snap(from - 60_000, 25), now })
  assert.equal(sum.spent, 10) // 25 → 15
  assert.equal(sum.topups, 0)
  assert.equal(sum.start, 25)
  assert.equal(sum.end, 15)
  assert.equal(sum.samples, 3)
  // 条带用的「更新于 / 赠金」= 期间最后一条快照
  assert.equal(sum.at, from + 7200_000)
  assert.equal(sum.bonus, 0)
})

test('summarizeBalance: 赠金先被扣也算消耗（只看 normal 会恒为 0）', () => {
  const now = new Date(2026, 9, 23, 17, 0).getTime()
  const from = startOfDay(now)
  const points = [
    snap(from + 1000, 17.77231472, { bonus: 6 }),
    snap(from + 3600_000, 17.77231472, { bonus: 5.65148312 }),
    snap(from + 7200_000, 17.77231472, { bonus: 5.51034064 }),
  ]
  const sum = summarizeBalance({ period: 'today', snapshots: points, baseline: null, now })
  // normal 一分没动，消耗全在赠金上：6.00 → 5.51034064
  assert.ok(Math.abs(sum.spent - 0.48965936) < 1e-9)
  assert.equal(sum.start, 17.77231472) // start/end 仍只报充值余额
  assert.equal(sum.end, 17.77231472)
  assert.ok(Math.abs(sum.bonus - 5.51034064) < 1e-9)
})

test('summarizeBalance: 赠金到账记充值，不吞掉同段消耗', () => {
  const now = new Date(2026, 9, 23, 17, 0).getTime()
  const from = startOfDay(now)
  const points = [
    snap(from + 1000, 10, { bonus: 0 }),
    snap(from + 3600_000, 10, { bonus: 5 }), // 赠金到账 5
    snap(from + 7200_000, 10, { bonus: 4.8 }), // 随后花掉 0.2
  ]
  const sum = summarizeBalance({ period: 'today', snapshots: points, baseline: snap(from - 60_000, 10), now })
  assert.equal(sum.topups, 5)
  assert.ok(Math.abs(sum.spent - 0.2) < 1e-9)
})

test('summarizeBalance: 余额上升记充值，不算负消耗', () => {
  const now = new Date(2026, 9, 23, 15, 0).getTime()
  const from = startOfDay(now)
  const points = [snap(from + 1000, 10), snap(from + 3600_000, 30), snap(from + 7200_000, 28)]
  const sum = summarizeBalance({ period: 'today', snapshots: points, baseline: snap(from - 60_000, 12), now })
  assert.equal(sum.spent, 4) // 基线 12→10 降 2；充值 10→30；30→28 降 2
  assert.equal(sum.topups, 20) // 10→30 充 20
})

test('summarizeBalance: 无快照 → 全零；无基线用首点当起点', () => {
  const now = Date.now()
  const empty = summarizeBalance({ period: 'today', snapshots: [], baseline: null, now })
  assert.equal(empty.spent, 0)
  assert.equal(empty.samples, 0)
  assert.equal(empty.start, null)
  assert.equal(empty.at, null)
  assert.equal(empty.bonus, null)

  const from = startOfDay(now)
  const sum = summarizeBalance({
    period: 'today',
    snapshots: [snap(from + 1000, 9), snap(from + 2000, 7)],
    baseline: null,
    now,
  })
  assert.equal(sum.start, 9)
  assert.equal(sum.spent, 2)
})

test('summarizeBalance: 币种变化记为不可归因，不产生假消耗', () => {
  const now = new Date(2026, 9, 23, 12, 0).getTime()
  const from = startOfDay(now)
  const sum = summarizeBalance({
    period: 'today',
    snapshots: [snap(from + 1000, 10, { currency: 'CNY' }), snap(from + 2000, 2, { currency: 'USD' })],
    baseline: null,
    now,
  })
  assert.equal(sum.spent, 0)
  assert.equal(sum.unknown, 1)
})

test('startOfMonth: 当月 1 日零点', () => {
  const ts = new Date(2026, 9, 23, 15, 30).getTime()
  const d = new Date(startOfMonth(ts))
  assert.equal(d.getDate(), 1)
  assert.equal(d.getHours(), 0)
})

test('AccountBalanceSource: 没有凭证服务 → credentials-unavailable，不抛', async () => {
  const source = new AccountBalanceSource({ getCredentials: () => undefined, cacheMs: 0 })
  const reading = await source.read(true)
  assert.equal(reading.ok, false)
  assert.equal(reading.signedIn, false)
  assert.equal(reading.error, 'credentials-unavailable')
})

test('AccountBalanceSource: 未登录（无 token）→ not-signed-in', async () => {
  const source = new AccountBalanceSource({
    getCredentials: () => creds({ kind: 'grant', payload: {} }),
    cacheMs: 0,
  })
  const reading = await source.read(true)
  assert.equal(reading.error, 'not-signed-in')
})

test('AccountBalanceSource: 正常读取并携带 x-dsh-auth-token（token 不出现在结果里）', async () => {
  let seen = null
  const fetchImpl = async (url, init) => {
    seen = { url, headers: init.headers }
    return { ok: true, status: 200, json: async () => SAMPLE }
  }
  const source = new AccountBalanceSource({
    getCredentials: () =>
      creds({ kind: 'grant', payload: { token: 'secret-token', issuer: 'https://platform.deepseek.com' } }),
    fetchImpl,
    cacheMs: 0,
  })
  const reading = await source.read(true)
  assert.equal(reading.ok, true)
  assert.equal(reading.normal, 17.77231472)
  assert.equal(reading.bonus, 6)
  assert.equal(seen.url, 'https://platform.deepseek.com/api/v0/users/get_user_summary')
  assert.equal(seen.headers['x-dsh-auth-token'], 'secret-token')
  assert.equal(JSON.stringify(reading).includes('secret-token'), false)
})

test('AccountBalanceSource: issuer 不匹配 → 不把凭证发给别的域', async () => {
  let called = false
  const source = new AccountBalanceSource({
    getCredentials: () =>
      creds({ kind: 'grant', payload: { token: 't', issuer: 'https://evil.example' } }),
    fetchImpl: async () => {
      called = true
      return { ok: true, status: 200, json: async () => SAMPLE }
    },
    cacheMs: 0,
  })
  const reading = await source.read(true)
  assert.equal(reading.error, 'issuer-mismatch')
  assert.equal(called, false)
})

test('AccountBalanceSource: HTTP 失败降级为 error，不抛', async () => {
  const source = new AccountBalanceSource({
    getCredentials: () => creds({ kind: 'grant', payload: { token: 't' } }),
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    cacheMs: 0,
  })
  const reading = await source.read(true)
  assert.equal(reading.ok, false)
  assert.equal(reading.error, 'http-401')
  assert.equal(reading.signedIn, true)
})

test('AccountBalanceSource: 60s 内重复读取走缓存，不再发请求', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return { ok: true, status: 200, json: async () => SAMPLE }
  }
  const source = new AccountBalanceSource({
    getCredentials: () => creds({ kind: 'grant', payload: { token: 't' } }),
    fetchImpl,
    cacheMs: 60_000,
  })
  await source.read(true)
  const second = await source.read(false)
  assert.equal(calls, 1)
  assert.equal(second.cached, true)
  await source.read(true)
  assert.equal(calls, 2)
})

// ---------------------------------------------------------------------------
// 30 天趋势（面板余额卡 sparkline）：按本地日取当天最后一个快照
// ---------------------------------------------------------------------------

test('collectBalanceSeries: 同一天多次采样只留最后一个（按本地日）', () => {
  const now = new Date(2026, 9, 30, 18, 0).getTime()
  const day = new Date(2026, 9, 29, 0, 0).getTime()
  const snapshots = [
    snap(day + 9 * 3600_000, 100),
    snap(day + 15 * 3600_000, 98.5),
    snap(day + 21 * 3600_000, 97.25, { bonus: 2.5 }),
    snap(new Date(2026, 9, 30, 10, 0).getTime(), 90),
  ]
  const series = collectBalanceSeries(snapshots, 30, 'CNY', now)
  assert.equal(series.days, 30)
  assert.equal(series.currency, 'CNY')
  assert.equal(series.points.length, 2, '两天各一个点')
  assert.equal(series.points[0].ts, day + 21 * 3600_000, '应取当天最后一个采样')
  assert.equal(series.points[0].normal, 97.25)
  assert.equal(series.points[0].bonus, 2.5)
  assert.equal(series.points[0].total, 99.75, 'total = normal + bonus（与低余额告警同口径）')
  assert.ok(series.points[0].ts < series.points[1].ts, '返回必须按时间升序')
})

test('collectBalanceSeries: 窗口外快照被丢弃，空输入返回空数组', () => {
  const now = new Date(2026, 9, 30, 12, 0).getTime()
  const old = snap(new Date(2026, 6, 1, 12, 0).getTime(), 500)
  const recent = snap(new Date(2026, 9, 29, 12, 0).getTime(), 100)
  const series = collectBalanceSeries([old, recent], 30, 'CNY', now)
  assert.equal(series.points.length, 1)
  assert.equal(series.points[0].normal, 100)
  assert.deepEqual(collectBalanceSeries([], 30, 'CNY', now), { days: 30, currency: 'CNY', points: [] })
})

test('collectBalanceSeries: days 夹进 1..365，金额保留两位', () => {
  const now = new Date(2026, 9, 30, 12, 0).getTime()
  const series = collectBalanceSeries([snap(now - 3600_000, 12.3456, { bonus: 0.005 })], 999, 'USD', now)
  assert.equal(series.days, 365)
  assert.equal(series.currency, 'USD')
  assert.equal(series.points[0].normal, 12.35)
  assert.equal(series.points[0].total, 12.35)
  assert.equal(collectBalanceSeries([], 0, 'CNY', now).days, 1, '0 天归 1')
})