/**
 * 官方价格自动获取：定价页解析 / 异常兜底 / 货币折算 / 缓存命中计价 /
 * 缓存文件离线可用 / 抓取失败沿用旧价。
 * 页面结构夹具按 2026-10 时点的真实 HTML 精简（rowspan 省略标签单元格、脚注 sup、br 换行）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  OfficialPricingSource,
  fetchOfficialPricing,
  officialToPriceTable,
  parseOfficialPricing,
} from '../dist/pricing/official.js'
import { computeCost, isOffPeak, isPricedProvider } from '../dist/state-machine/cost.js'
import { TaskTracker } from '../dist/state-machine/task-tracker.js'

const FIXTURE = `<html><body>
<table>
<tr><th>MODEL</th><th>deepseek-flash<sup>(1)</sup></th><th>deepseek-v4-pro</th></tr>
<tr><td>BASE URL (OpenAI Format)</td><td colspan="2">https://api.deepseek.com</td></tr>
<tr><td>MODEL VERSION</td><td>DeepSeek-V4.1-Flash-1017</td><td>DeepSeek-V4-Pro-0813</td></tr>
<tr><td>CONTEXT LENGTH</td><td colspan="2">1M</td></tr>
<tr><td>MAX OUTPUT</td><td colspan="2">MAXIMUM: 384K</td></tr>
<tr><td>PRICING<span>(2)</span></td><td>1M INPUT TOKENS <br>(CACHE HIT)</td><td>OFF-PEAK</td><td>$0.003</td><td>$0.022</td></tr>
<tr><td>PEAK</td><td>$0.006</td><td>$0.044</td></tr>
<tr><td>1M INPUT TOKENS <br>(CACHE MISS)</td><td>OFF-PEAK</td><td>$0.15</td><td>$0.66</td></tr>
<tr><td>PEAK</td><td>$0.3</td><td>$1.32</td></tr>
<tr><td>1M OUTPUT TOKENS</td><td>OFF-PEAK</td><td>$0.6</td><td>$1.98</td></tr>
<tr><td>PEAK</td><td>$1.2</td><td>$3.96</td></tr>
<tr><td>Concurrency Limit<span>(3)</span></td><td>2500</td><td>500</td></tr>
</table>
<table>
<tr><th>API</th><th>Unit</th><th>Price</th></tr>
<tr><td>Search</td><td>Per 1,000 successful requests</td><td>$0.75</td></tr>
</table>
</body></html>`

const okFetch = async () => ({ ok: true, status: 200, text: async () => FIXTURE })

test('解析官方定价页：模型名动态解析，PEAK/OFF-PEAK 与缓存价齐全', () => {
  const file = parseOfficialPricing(FIXTURE, 1_700_000_000_000)
  assert.ok(file)
  assert.equal(file.ok, true)
  assert.deepEqual(Object.keys(file.models), ['deepseek-flash', 'deepseek-v4-pro'])
  const flash = file.models['deepseek-flash']
  assert.equal(flash.inputPeakUsd, 0.3)
  assert.equal(flash.inputOffPeakUsd, 0.15)
  assert.equal(flash.cacheHitInputPeakUsd, 0.006)
  assert.equal(flash.cacheHitInputOffPeakUsd, 0.003)
  assert.equal(flash.outputPeakUsd, 1.2)
  assert.equal(flash.outputOffPeakUsd, 0.6)
  assert.equal(flash.version, 'DeepSeek-V4.1-Flash-1017', '应保留 MODEL VERSION 行（渠道别名派生用）')
  const pro = file.models['deepseek-v4-pro']
  assert.equal(pro.inputPeakUsd, 1.32)
  assert.equal(pro.cacheHitInputPeakUsd, 0.044)
  assert.equal(pro.outputPeakUsd, 3.96)
  assert.equal(pro.version, 'DeepSeek-V4-Pro-0813')
})

test('解析异常一律返回 null（整次作废，退内置兜底价）', () => {
  assert.equal(parseOfficialPricing('<p>no table</p>', 1), null)
  assert.equal(
    parseOfficialPricing('<table><tr><td>x</td></tr></table>', 1),
    null,
    '无 MODEL 表头 → null',
  )
  assert.equal(
    parseOfficialPricing(
      '<table><tr><th>MODEL</th><th>m1</th></tr><tr><td>1M INPUT TOKENS (CACHE MISS)</td><td>PEAK</td><td>$0.3</td></tr></table>',
      1,
    ),
    null,
    '缺输出价 → 校验不过 → null',
  )
})

test('官方价折算：CNY×汇率（round4），USD 原样', () => {
  const file = parseOfficialPricing(FIXTURE, 1)
  const cny = officialToPriceTable(file, 'CNY', 7.2)
  assert.equal(cny['deepseek-flash'].inputPerMillion, 2.16)
  assert.equal(cny['deepseek-flash'].cacheInputPerMillion, 0.0432)
  assert.equal(cny['deepseek-flash'].outputPerMillion, 8.64)
  assert.equal(cny['deepseek-v4-pro'].inputPerMillion, 9.504)
  assert.equal(cny['deepseek-v4-pro'].outputPerMillion, 28.512)
  const usd = officialToPriceTable(file, 'USD', 7.2)
  assert.equal(usd['deepseek-flash'].inputPerMillion, 0.3)
  assert.equal(usd['deepseek-flash'].outputPerMillion, 1.2)
  // 价格表只含官方 ID；渠道别名不再登记（自定义渠道按 provider 门控，不计费）。
  assert.equal(cny['deepseek-v4.1-flash'], undefined)
})

test('computeCost：缓存命中按 cache 单价，缺省退回 input 价（旧口径）', () => {
  const split = {
    'deepseek-flash': {
      inputPerMillion: 2.16,
      cacheInputPerMillion: 0.0432,
      outputPerMillion: 8.64,
    },
  }
  // 输入 1M（其中缓存命中 900K）+ 输出 100K：
  // 0.1M×2.16 + 0.9M×0.0432 + 0.1M×8.64 = 0.216 + 0.03888 + 0.864
  assert.equal(computeCost(1_000_000, 100_000, 900_000, 'deepseek-flash', split), 1.1189)
  const noCache = {
    'deepseek-flash': { inputPerMillion: 2.16, outputPerMillion: 8.64 },
  }
  // 旧口径：全部输入按 input 价 → 2.16 + 0.864
  assert.equal(computeCost(1_000_000, 100_000, 900_000, 'deepseek-flash', noCache), 3.024)
})

test('computeCost：闲时（OFF-PEAK）按任务时刻取半价，跨档不拆价', () => {
  assert.equal(isOffPeak(Date.UTC(2026, 9, 20, 17, 0)), true, 'UTC 17:00 属闲时')
  assert.equal(isOffPeak(Date.UTC(2026, 9, 20, 0, 0)), true, 'UTC 00:00 仍属闲时（跨零点）')
  assert.equal(isOffPeak(Date.UTC(2026, 9, 20, 12, 0)), false, 'UTC 12:00 为高峰')
  assert.equal(isOffPeak(Date.UTC(2026, 9, 20, 16, 29)), false, '16:29 还没到闲时')
  const prices = {
    'deepseek-flash': {
      inputPerMillion: 2.16,
      cacheInputPerMillion: 0.0432,
      outputPerMillion: 8.64,
      inputOffPeakPerMillion: 1.08,
      cacheInputOffPeakPerMillion: 0.0216,
      outputOffPeakPerMillion: 4.32,
    },
  }
  const peak = computeCost(1_000_000, 100_000, 0, 'deepseek-flash', prices, Date.UTC(2026, 9, 20, 12, 0))
  const off = computeCost(1_000_000, 100_000, 0, 'deepseek-flash', prices, Date.UTC(2026, 9, 20, 18, 0))
  assert.equal(peak, 3.024)
  assert.equal(off, 1.512, '闲时正好半价')
  // 缺闲时价时回退高峰价（自制/旧缓存价格表不会算出 0）
  const peakOnly = { 'deepseek-flash': { inputPerMillion: 2.16, outputPerMillion: 8.64 } }
  assert.equal(
    computeCost(1_000_000, 0, 0, 'deepseek-flash', peakOnly, Date.UTC(2026, 9, 20, 18, 0)),
    2.16,
    '无闲时价回退高峰价',
  )
})

test('计费门控：只有 DeepSeek 账号（官方 API）任务计费，自定义渠道同名模型也为 0', async () => {
  assert.equal(isPricedProvider('deepseek-account'), true)
  assert.equal(isPricedProvider('deepseek-official'), true)
  assert.equal(isPricedProvider('aliyun-bailian'), false)
  assert.equal(isPricedProvider(''), false)

  const prices = {
    'deepseek-flash': { inputPerMillion: 2.16, cacheInputPerMillion: 0.0432, outputPerMillion: 8.64 },
  }
  const finished = []
  const tracker = new TaskTracker({
    modelPrices: prices,
    onFinish: (task) => {
      finished.push(task)
    },
  })
  const usage = { inputTokens: 100_000, outputTokens: 10_000, cachedTokens: 0, reasoningTokens: 0, totalTokens: 110_000 }
  const runTask = (sessionId, provider) => {
    const task = { sessionId, turn: 1, project: 'p', workspace: 'w', subagent: false }
    tracker.handle({ kind: 'task-start', task, time: 1 })
    tracker.handle({ kind: 'model-route', task, provider, model: 'deepseek-flash', time: 2 })
    tracker.handle({ kind: 'model-end', task, step: 1, usage, time: 3 })
    tracker.handle({ kind: 'task-end', task, status: 'success', reason: '', time: 4 })
  }
  runTask('s-account', 'deepseek-account')
  runTask('s-bailian', 'aliyun-bailian')
  await new Promise((resolve) => setTimeout(resolve, 30))

  assert.equal(finished.length, 2)
  const account = finished.find((t) => t.sessionId === 's-account')
  const bailian = finished.find((t) => t.sessionId === 's-bailian')
  assert.ok(account.cost > 0, '账号任务应按官方价计费')
  assert.equal(bailian.cost, 0, '自定义渠道任务同名模型也不计费')
  assert.ok(bailian.totalTokens > 0, '自定义渠道 Token 照常统计')
})

test('官方价格源：抓取成功 → 落盘缓存 → 离线实例直接沿用', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-companion-pricing-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  let changed = 0
  const source = new OfficialPricingSource({
    dataDir: dir,
    currency: () => 'CNY',
    usdCnyRate: () => 7.2,
    fetchImpl: okFetch,
    onChanged: () => {
      changed += 1
    },
  })
  await source.init()
  assert.equal(source.status().ok, false, '未抓取前无官方价')
  const result = await source.refresh()
  assert.equal(result.ok, true)
  assert.equal(changed, 1, '成功抓取应触发 onChanged')
  assert.equal(source.table()['deepseek-flash'].inputPerMillion, 2.16)
  assert.equal(source.table()['deepseek-v4.1-flash'], undefined, '不再登记渠道别名键')
  const st = source.status()
  assert.equal(st.versions['deepseek-flash'], 'DeepSeek-V4.1-Flash-1017', '状态应带官网版本号（面板展示）')
  const raw = JSON.parse(await readFile(join(dir, 'pricing-official.json'), 'utf8'))
  assert.equal(raw.ok, true)
  assert.ok(raw.models['deepseek-flash'], '缓存文件应含模型价格')
  // 离线：新实例只靠缓存文件（fetchImpl 被调用即失败）。
  const offline = new OfficialPricingSource({
    dataDir: dir,
    currency: () => 'USD',
    usdCnyRate: () => 7.2,
    fetchImpl: async () => {
      throw new Error('离线时不应发起抓取')
    },
  })
  await offline.init()
  assert.equal(offline.status().ok, true)
  assert.equal(offline.table()['deepseek-flash'].inputPerMillion, 0.3)
})

test('官方价格源：抓取失败保留旧缓存并记录原因；超时走中止', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-companion-pricing-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const good = new OfficialPricingSource({
    dataDir: dir,
    currency: () => 'CNY',
    usdCnyRate: () => 7.2,
    fetchImpl: okFetch,
  })
  await good.refresh()
  const bad = new OfficialPricingSource({
    dataDir: dir,
    currency: () => 'CNY',
    usdCnyRate: () => 7.2,
    fetchImpl: async () => {
      throw new Error('网络不可达')
    },
  })
  await bad.init()
  const result = await bad.refresh()
  assert.equal(result.ok, true, '旧缓存仍可用')
  assert.match(result.error ?? '', /网络不可达/)
  assert.equal(bad.table()['deepseek-flash'].outputPerMillion, 8.64)
  // 挂死的 fetch：超时应中止并给出失败原因，绝不抛异常。
  const hang = (url, init) =>
    new Promise((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })
  const timedOut = await fetchOfficialPricing(hang, 50)
  assert.equal(timedOut.ok, false)
  assert.match(timedOut.error ?? '', /aborted/i)
})
