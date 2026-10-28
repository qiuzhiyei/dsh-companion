/**
 * 插件级冒烟（集成）：真实 cordis Context + dist/index.js apply()。
 * 验证独立运行能力：HTTP/SSE、状态快照、皮肤、统计、导出、可逆卸载。
 *
 * 该文件不随包发布（package.json files 不含 tests/）；
 * @deepseek-ai/cordis 为 devDependency，仅开发期解析。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { apply, Config } from '../dist/index.js'

const PORT = 17_601

async function waitFor(predicate, { timeoutMs = 12_000, stepMs = 150 } = {}) {
  const deadline = Date.now() + timeoutMs
  let lastError = new Error('condition never met')
  while (Date.now() < deadline) {
    try {
      const value = await predicate()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, stepMs))
  }
  throw lastError
}

test('插件完整生命周期：加载 → 服务 → 模拟任务 → 统计 → 卸载', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-companion-smoke-'))
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  const ctx = new Context()
  const rawConfig = Config({
    adapter: 'mock',
    dataDir,
    storage: 'auto',
    server: { enabled: true, host: '127.0.0.1', port: PORT, shell: 'off', toast: false },
    mock: { auto: false, intervalMs: 1_000, speed: 80 },
    settleMs: 4_000,
  })
  const config = {
    adapter: 'mock',
    dataDir,
    storage: 'auto',
    currency: 'CNY',
    settleMs: 4_000,
    logEvents: false,
    server: { enabled: true, host: '127.0.0.1', port: PORT, shell: 'off', toast: false },
    mock: { auto: false, intervalMs: 1_000, speed: 80 },
  }
  assert.equal(rawConfig.adapter, 'mock', 'Config schema 应归一化出默认值')
  assert.equal(typeof rawConfig.server.port, 'number')

  // 无论断言成败都卸载（否则插件 HTTP Server 会挂住事件循环）。
  let disposed = false
  const dispose = async () => {
    if (!disposed) {
      disposed = true
      await ctx.fiber.dispose()
    }
  }
  t.after(dispose)

  apply(ctx, config)

  // 等服务就绪。
  const baseUrl = await waitFor(async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/state`)
    if (res.ok) return `http://127.0.0.1:${PORT}`
    return null
  })
  assert.ok(baseUrl)

  // CORS：GUI 页面（不同源）的左下角角标依赖跨域读 API。
  {
    const res = await fetch(`${baseUrl}/api/state`)
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
    const preflight = await fetch(`${baseUrl}/api/state`, { method: 'OPTIONS' })
    assert.equal(preflight.status, 204)
  }

  // 触发一次模拟任务。
  const startRes = await fetch(`${baseUrl}/api/mock/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario: 'success' }),
  })
  assert.ok((await startRes.json()).ok)

  // 状态机应先到 casting/hooked（任一非 idle）。
  const sawWorking = await waitFor(async () => {
    const state = (await (await fetch(`${baseUrl}/api/state`)).json()).state
    return ['casting', 'waiting', 'hooked', 'reeling'].includes(state)
  })
  assert.ok(sawWorking)

  // 任务结束后：done + 统计落库。
  const finished = await waitFor(async () => {
    const snapshot = await (await fetch(`${baseUrl}/api/state`)).json()
    return snapshot.state === 'done' ? snapshot : null
  })
  assert.ok(finished.lastResult, '应有最近任务快照')
  assert.equal(finished.lastResult.status, 'success')
  assert.ok(finished.lastResult.tokens.totalTokens > 0)
  assert.ok(finished.lastResult.cost > 0)
  assert.equal(finished.adapter, 'mock')
  assert.equal(finished.currency, 'CNY')
  assert.equal(finished.settings.skin, 'whale', '新默认皮肤是 whale（Q版鲸鱼娘）')
  assert.equal(finished.label, '任务完成', '默认文案应是中性监测文案')

  // 历史与统计。
  const history = await (await fetch(`${baseUrl}/api/history?limit=10`)).json()
  assert.equal(history.tasks.length, 1)
  assert.equal(history.total, 1)
  assert.equal(history.tasks[0].model, 'deepseek-flash')

  // 历史筛选（服务端过滤 + 命中总数）：模型 / 状态 / 项目关键词 / 空结果
  const byModel = await (await fetch(`${baseUrl}/api/history?limit=10&model=deepseek-flash`)).json()
  assert.equal(byModel.total, 1)
  const byWrongModel = await (await fetch(`${baseUrl}/api/history?limit=10&model=deepseek-chat`)).json()
  assert.equal(byWrongModel.total, 0)
  assert.equal(byWrongModel.tasks.length, 0)
  const byStatus = await (await fetch(`${baseUrl}/api/history?limit=10&status=failed`)).json()
  assert.equal(byStatus.total, 0)
  const byQ = await (await fetch(`${baseUrl}/api/history?limit=10&q=DEMO`)).json()
  assert.equal(byQ.total, 1, '项目关键词不区分大小写')
  const byBadQ = await (await fetch(`${baseUrl}/api/history?limit=10&q=nope`)).json()
  assert.equal(byBadQ.total, 0)

  const stats = await (await fetch(`${baseUrl}/api/stats?period=today`)).json()
  assert.equal(stats.tasks, 1)
  assert.equal(stats.success, 1)
  assert.equal(stats.successRate, 100)
  assert.ok(stats.toolCalls >= 1)

  // 柱状图序列：今日=24 小时桶，mock 任务的 token 应落进某个桶。
  const series = await (await fetch(`${baseUrl}/api/stats/series?period=today`)).json()
  assert.equal(series.period, 'today')
  assert.equal(series.buckets.length, 24)
  assert.ok(series.buckets.some((b) => b.tokens > 0), '今日桶里应统计到 mock 任务')

  // 模型清单：mock 任务用过的模型应出现（价格设置“添加模型”的候选）。
  const modelsRes = await fetch(`${baseUrl}/api/models`)
  const models = await modelsRes.json()
  assert.ok(Array.isArray(models.models), 'models 应为数组')
  assert.ok(models.models.includes('deepseek-flash'), 'mock 模型 deepseek-flash 应在候选清单')

  // 皮肤：whale（Q版鲸鱼娘）是默认且排第一；fisherman 与 monitor 均已移除。
  const skins = await (await fetch(`${baseUrl}/api/skins`)).json()
  assert.equal(skins[0].name, 'whale', '默认皮肤鲸鱼娘应排第一')
  const whale = skins.find((s) => s.name === 'whale')
  assert.ok(whale, '默认皮肤 whale 应存在')
  assert.ok(!skins.some((s) => s.name === 'fisherman'), 'fisherman 应已随皮肤移除')
  assert.ok(!skins.some((s) => s.name === 'monitor'), 'monitor 应已随皮肤移除')
  assert.ok(whale.states.includes('idle'))
  assert.ok(whale.states.includes('hooked'))
  // 鲸鱼娘 5 套服装（WorkBuddy AI 帧包接入）：默认 JK + 4 套换装。
  for (const name of ['whale', 'whale-ol', 'whale-police', 'whale-hanfu', 'whale-qipao']) {
    assert.ok(skins.some((s) => s.name === name), `鲸鱼娘套装 ${name} 应在列`)
  }
  // 反应帧（拟人化互动）：鲸鱼娘 5 套全配 pat/angry/dizzy/drag。
  for (const name of ['whale', 'whale-ol', 'whale-police', 'whale-hanfu', 'whale-qipao']) {
    const s = skins.find((x) => x.name === name)
    for (const r of ['pat', 'angry', 'dizzy', 'drag']) {
      assert.ok(s.reactions.includes(r), `${name} 应有反应帧 ${r}`)
    }
  }
  const patRes = await fetch(`${baseUrl}/skins/whale/pat.png`)
  assert.ok(patRes.ok, '反应帧应可经 /skins 路由访问（先查状态再查反应）')
  const skinRes = await fetch(`${baseUrl}/skins/whale/hooked.png`)
  assert.ok(skinRes.ok)
  assert.ok((skinRes.headers.get('content-type') || '').includes('image/png'), '状态资源应为 PNG')
  const pngBytes = new Uint8Array(await skinRes.arrayBuffer())
  assert.equal(pngBytes[0], 0x89, 'PNG 魔数 \\x89')
  assert.equal(pngBytes[1], 0x50)

  // 皮肤帧协商缓存：帧是静态资源，带 If-None-Match 必须回 304（不重传帧体）。
  // 没有它，每次重新验证都要重传整帧（鲸鱼娘单帧可达 150KB）。
  const etag = skinRes.headers.get('etag')
  assert.ok(etag, '皮肤资源应带 ETag')
  assert.ok(etag.startsWith('W/"'), 'ETag 应为弱校验（内容哈希）')
  const revalidated = await fetch(`${baseUrl}/skins/whale/hooked.png`, {
    headers: { 'if-none-match': etag },
  })
  assert.equal(revalidated.status, 304, '带匹配的 If-None-Match 应回 304')
  const wrongTag = await fetch(`${baseUrl}/skins/whale/hooked.png`, {
    headers: { 'if-none-match': 'W/"stale-etag-value-000000"' },
  })
  assert.equal(wrongTag.status, 200, 'ETag 不匹配（文件改过）必须回 200 重传')

  // 页面。
  const petPage = await fetch(`${baseUrl}/`)
  assert.ok(petPage.ok)
  assert.ok((await petPage.text()).includes('EventSource'))
  const panelPage = await fetch(`${baseUrl}/panel`)
  assert.ok(panelPage.ok)

  // 导出（CSV 携带 BOM 字节 EF BB BF —— Response.text() 解码会剥 BOM，须读字节）。
  const csv = await fetch(`${baseUrl}/api/export/sessions?format=csv`)
  assert.ok(csv.ok)
  const csvBytes = new Uint8Array(await csv.arrayBuffer())
  assert.equal(csvBytes[0], 0xef, 'CSV 应以 UTF-8 BOM 开头（Excel 兼容）')
  assert.equal(csvBytes[1], 0xbb)
  assert.equal(csvBytes[2], 0xbf)
  assert.ok(new TextDecoder().decode(csvBytes).includes('id,sessionId,turn,'))
  const jsonExport = await fetch(`${baseUrl}/api/export/sessions?format=json`)
  assert.ok(jsonExport.ok)

  // 设置更新（皮肤切换 + 预算）。
  const settingsRes = await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      privacyMode: true,
      budget: { taskMaxTokens: 1000, taskMaxCost: null, dailyMaxTokens: null, dailyMaxCost: null },
    }),
  })
  assert.ok(settingsRes.ok)
  const updated = await settingsRes.json()
  assert.equal(updated.privacyMode, true)
  assert.equal(updated.budget.taskMaxTokens, 1000)

  // 久坐提醒：默认 60 分钟；PUT 回读 + 越界夹到 5..480。
  const rrDef = (await (await fetch(`${baseUrl}/api/state`)).json()).settings.restReminder
  assert.equal(rrDef.intervalMinutes, 60, '久坐提醒默认 60 分钟')
  assert.equal(rrDef.enabled, true, '久坐提醒默认开启')
  const rrRes = await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ restReminder: { enabled: false, intervalMinutes: 25 } }),
  })
  assert.ok(rrRes.ok)
  const rrUpdated = await rrRes.json()
  assert.equal(rrUpdated.restReminder.enabled, false)
  assert.equal(rrUpdated.restReminder.intervalMinutes, 25)
  const rrClamp = await (await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ restReminder: { enabled: true, intervalMinutes: 9999 } }),
  })).json()
  assert.equal(rrClamp.restReminder.intervalMinutes, 480, '间隔超上限应夹到 480')

  // 自由活动开关走后端 settings（跨窗口共用真相；旧 localStorage 方案因面板与
  // 悬浮窗存储分区隔离而失效——「面板关了桌宠还跑」）。
  const roamDef = (await (await fetch(`${baseUrl}/api/state`)).json()).settings.roam
  assert.equal(roamDef, true, '自由活动默认开启')
  const roamOff = await (await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roam: false }),
  })).json()
  assert.equal(roamOff.roam, false, 'PUT roam=false 应生效')
  const roamState = (await (await fetch(`${baseUrl}/api/state`)).json()).settings.roam
  assert.equal(roamState, false, '/api/state 应下发 roam=false（悬浮页据此停逛）')
  const roamOn = await (await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roam: true }),
  })).json()
  assert.equal(roamOn.roam, true, 'PUT roam=true 应恢复')

  // 余额台账设置：lowBalance 阈值回读（正数保留 / 0 与非法值归 null = 关）。
  const balDef = (await (await fetch(`${baseUrl}/api/state`)).json()).settings.balance
  assert.equal(balDef.lowBalance, null, '余额低告警默认关')
  const balRes = await (await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ balance: { enabled: false, intervalMinutes: 30, lowBalance: 5 } }),
  })).json()
  assert.equal(balRes.balance.lowBalance, 5)
  const balOff = await (await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ balance: { enabled: false, intervalMinutes: 30, lowBalance: 0 } }),
  })).json()
  assert.equal(balOff.balance.lowBalance, null, '0 = 关闭告警')
  const balNeg = await (await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ balance: { enabled: false, intervalMinutes: 30, lowBalance: -3 } }),
  })).json()
  assert.equal(balNeg.balance.lowBalance, null, '负数 = 关闭告警')

  // 数据保留：默认永久保留（老库/新库都不许默认删数据），设置后预览与清理生效。
  const retDef = await (await fetch(`${baseUrl}/api/retention`)).json()
  assert.equal(retDef.months, null, '默认必须永久保留')
  assert.equal(retDef.cutoff, null, '永久保留时没有截止时间')
  assert.equal(retDef.candidates, 0, '永久保留时不得有任何可清理条数')
  assert.equal(typeof retDef.total, 'number', '应报告库内总数')
  // 永久保留下「立即清理」必须是 no-op（不能误删）。
  const noop = await (await fetch(`${baseUrl}/api/retention/prune`, { method: 'POST' })).json()
  assert.equal(noop.removed, 0, '永久保留时清理必须是 no-op')
  // 设成 1 个月：mock 任务都是刚刚跑的，不该被清掉。
  const retSet = await (await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ retention: { months: 1 } }),
  })).json()
  assert.equal(retSet.retention.months, 1)
  const ret1 = await (await fetch(`${baseUrl}/api/retention`)).json()
  assert.equal(ret1.months, 1)
  assert.ok(ret1.cutoff > 0, '设了保留期就该有截止时间')
  assert.equal(ret1.candidates, 0, '刚跑的任务不该算过期')
  const prune1 = await (await fetch(`${baseUrl}/api/retention/prune`, { method: 'POST' })).json()
  assert.equal(prune1.removed, 0, '没有过期数据时应删 0 条')
  assert.equal(prune1.months, 1)
  assert.equal(prune1.total, ret1.total, '清理 0 条后总数不变')
  // 非法值一律回落永久保留（0 不能变成「删光所有数据」）。
  const ret0 = await (await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ retention: { months: 0 } }),
  })).json()
  assert.equal(ret0.retention.months, null, 'months=0 必须视为永久保留，不能删光数据')

  // 外观设置写入回读（透明度 / 缩放 / 皮肤即时生效链路）。
  const lookRes = await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ opacity: 0.6, scale: 1.5, skin: 'whale-ol' }),
  })
  assert.ok(lookRes.ok)
  const look = await lookRes.json()
  assert.equal(look.opacity, 0.6)
  assert.equal(look.scale, 1.5)
  assert.equal(look.skin, 'whale-ol')
  const altState = await (await fetch(`${baseUrl}/api/state`)).json()
  assert.equal(altState.settings.skin, 'whale-ol')
  // setLabels 已生效：label 应是鲸鱼娘皮肤文案之一（与状态机当时状态无关）。
  const altLabels = new Set([
    '待机中', '任务启动', '模型思考中…', '输出 / 工具执行中',
    '收尾中…', '任务完成', '任务出错', '任务中断',
  ])
  assert.ok(altLabels.has(altState.label), `鲸鱼娘皮肤文案，实际: ${altState.label}`)
  // 切回 whale（默认）：5 套服装 labels 同为中性文案，后续断言不受影响。
  const backRes = await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skin: 'whale', opacity: 1, scale: 1 }),
  })
  assert.ok(backRes.ok)
  assert.equal((await backRes.json()).skin, 'whale')

  // SSE（连接后应立刻收到一份快照）。
  const sseFirst = await waitFor(async () => {
    const controller = new AbortController()
    const res = await fetch(`${baseUrl}/api/events`, { signal: controller.signal })
    const reader = res.body.getReader()
    const { value } = await reader.read()
    controller.abort()
    const text = new TextDecoder().decode(value)
    const match = /data: (.+)/.exec(text)
    return match ? JSON.parse(match[1]) : null
  })
  assert.equal(sseFirst.plugin, 'dsh-companion')

  // 卸载（可逆清理）：服务应随后不可达。
  await dispose()
  await waitFor(async () => {
    try {
      await fetch(`${baseUrl}/api/state`)
      return null
    } catch {
      return true
    }
  })
})

test('暂停统计：模拟任务不落库', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-companion-smoke-'))
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })
  const ctx = new Context()
  let disposed = false
  t.after(async () => {
    if (!disposed) {
      disposed = true
      await ctx.fiber.dispose()
    }
  })
  apply(ctx, {
    adapter: 'mock',
    dataDir,
    storage: 'auto',
    currency: 'CNY',
    settleMs: 2_000,
    logEvents: false,
    server: { enabled: true, host: '127.0.0.1', port: PORT + 20, shell: 'off', toast: false },
    mock: { auto: false, intervalMs: 1_000, speed: 100 },
  })

  const baseUrl = await waitFor(async () => {
    const res = await fetch(`http://127.0.0.1:${PORT + 20}/api/state`)
    return res.ok ? `http://127.0.0.1:${PORT + 20}` : null
  })

  // 暂停 → 触发模拟任务 → 等待完成 → 无记录。
  const pauseRes = await fetch(`${baseUrl}/api/pause`, { method: 'POST' })
  assert.ok((await pauseRes.json()).paused)
  await fetch(`${baseUrl}/api/mock/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario: 'success' }),
  })
  await waitFor(async () => {
    const snapshot = await (await fetch(`${baseUrl}/api/state`)).json()
    // 暂停时事件被忽略，状态保持 idle（或上次快照）。
    return snapshot.task === null && Date.now() > 0 ? true : null
  })
  await new Promise((resolve) => setTimeout(resolve, 300))
  const history = await (await fetch(`${baseUrl}/api/history?limit=10`)).json()
  assert.equal(history.total, 0, '暂停期间任务不应落库')

  disposed = true
  await ctx.fiber.dispose()
})
