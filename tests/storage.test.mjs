/**
 * 存储层测试：SQLite / JSON 双后端一致性 + 历史查询 + 周期统计。
 * 使用临时目录，测完清理。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openPetStore, JsonPetStore, SqlitePetStore } from '../dist/storage/store.js'
import { computePeriodStats, computeRanking, periodRange } from '../dist/storage/stats.js'
import { exportSessions } from '../dist/storage/export.js'

function makeTask(overrides = {}) {
  return {
    id: 'session-1:1',
    sessionId: 'session-1',
    turn: 1,
    project: 'demo',
    workspace: 'D:/work/demo',
    provider: 'deepseek',
    model: 'deepseek-chat',
    startTime: Date.now() - 1000,
    endTime: Date.now(),
    status: 'success',
    promptTokens: 1200,
    completionTokens: 800,
    totalTokens: 2000,
    cachedTokens: 400,
    reasoningTokens: 0,
    cost: 0.0088,
    toolCalls: 3,
    toolSuccess: 2,
    toolFail: 1,
    steps: 2,
    tags: [],
    note: '',
    ...overrides,
  }
}

for (const Backend of [SqlitePetStore, JsonPetStore]) {
  const label = Backend === SqlitePetStore ? 'sqlite' : 'json'

  test(`[${label}] 任务与设置读写一致`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-companion-test-'))
    try {
      const store =
        Backend === SqlitePetStore
          ? new SqlitePetStore(join(dir, 'pet.sqlite'))
          : new JsonPetStore(join(dir, 'pet-data.json'))
      await store.init()
      const task = makeTask()
      await store.saveTask(task)
      await store.saveToolCalls([
        {
          id: 'session-1:1:c1',
          taskKey: 'session-1:1',
          callId: 'c1',
          name: 'read',
          startTime: 1,
          endTime: 2,
          status: 'ok',
        },
      ])
      const tasks = await store.listTasks(10)
      assert.equal(tasks.length, 1)
      assert.equal(tasks[0].id, 'session-1:1')
      assert.equal(tasks[0].promptTokens, 1200)
      assert.equal(tasks[0].status, 'success')
      const tools = await store.listToolCalls(10)
      assert.equal(tools.length, 1)
      assert.equal(tools[0].name, 'read')

      await store.saveSettings({
        skin: 'whale',
        position: { x: 10, y: 20 },
        opacity: 0.8,
        scale: 1.2,
        clickThrough: false,
        privacyMode: true,
        paused: false,
        autoStart: true,
        currency: 'CNY',
        modelPrices: { 'deepseek-chat': { inputPerMillion: 2, outputPerMillion: 8 } },
        budget: { taskMaxTokens: 1000, taskMaxCost: null, dailyMaxTokens: null, dailyMaxCost: null },
      })
      const settings = await store.loadSettings()
      assert.equal(settings.privacyMode, true)
      assert.deepEqual(settings.position, { x: 10, y: 20 })
      assert.equal(settings.budget.taskMaxTokens, 1000)
      await store.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test(`[${label}] 缺模型名回填 + 最近已知路由继承`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-companion-test-'))
    try {
      const store =
        Backend === SqlitePetStore
          ? new SqlitePetStore(join(dir, 'pet.sqlite'))
          : new JsonPetStore(join(dir, 'pet-data.json'))
      await store.init()
      const base = Date.now() - 100_000
      // 同会话：turn 2 有路由；turn 3（时间最近）与 turn 1 缺模型名
      await store.saveTask(makeTask({ id: 'session-1:2', turn: 2, provider: 'aliyun-bailian', model: 'qwen3.8-max', startTime: base + 40_000 }))
      await store.saveTask(makeTask({ id: 'session-1:3', turn: 3, provider: '', model: '', startTime: base + 60_000 }))
      await store.saveTask(makeTask({ id: 'session-1:1', turn: 1, provider: '', model: '', startTime: base }))
      // 另一个会话无已知路由：不得串味、不得硬填
      await store.saveTask(makeTask({ id: 'session-2:1', sessionId: 'session-2', turn: 1, provider: '', model: '', startTime: base + 10_000 }))

      const route = await store.lastKnownRoute('session-1')
      assert.deepEqual(route, { provider: 'aliyun-bailian', model: 'qwen3.8-max' })
      assert.equal(await store.lastKnownRoute('session-2'), null)

      const fixed = await store.backfillMissingModels()
      assert.equal(fixed, 2, '只回填 session-1 的两条')
      const tasks = await store.listTasks(10)
      const byId = Object.fromEntries(tasks.map((t) => [t.id, t]))
      assert.equal(byId['session-1:3'].model, 'qwen3.8-max')
      assert.equal(byId['session-1:3'].provider, 'aliyun-bailian')
      assert.equal(byId['session-1:1'].model, 'qwen3.8-max')
      assert.equal(byId['session-2:1'].model, '', '无已知路由的会话保持空')
      // 幂等：再跑一遍不再改动
      assert.equal(await store.backfillMissingModels(), 0)
      await store.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test(`[${label}] 历史筛选（模型/状态/时间/关键词）与命中总数`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-companion-test-'))
    try {
      const store =
        Backend === SqlitePetStore
          ? new SqlitePetStore(join(dir, 'pet.sqlite'))
          : new JsonPetStore(join(dir, 'pet-data.json'))
      await store.init()
      const base = Date.now() - 200_000
      await store.saveTask(makeTask({ id: 'a:1', project: 'Alpha-项目', model: 'deepseek-chat', status: 'success', startTime: base }))
      await store.saveTask(makeTask({ id: 'a:2', project: 'beta', model: 'deepseek-chat', status: 'failed', startTime: base + 60_000 }))
      await store.saveTask(makeTask({ id: 'a:3', project: 'alpha-web', model: 'deepseek-reasoner', status: 'success', startTime: base + 120_000 }))

      const all = await store.queryTasks({ limit: 10 })
      assert.equal(all.total, 3)
      assert.deepEqual(all.tasks.map((t) => t.id), ['a:3', 'a:2', 'a:1'], '按开始时间倒序')

      const chat = await store.queryTasks({ limit: 10, model: 'deepseek-chat' })
      assert.equal(chat.total, 2)
      const failed = await store.queryTasks({ limit: 10, status: 'failed' })
      assert.equal(failed.total, 1)
      assert.equal(failed.tasks[0].id, 'a:2')

      const window = await store.queryTasks({ limit: 10, fromMs: base + 60_000, toMs: base + 120_000 })
      assert.equal(window.total, 1)
      assert.equal(window.tasks[0].id, 'a:2')

      // 项目关键词不区分大小写；SQL 通配符必须按字面处理（不能变成“匹配一切”）
      const alpha = await store.queryTasks({ limit: 10, q: 'ALPHA' })
      assert.equal(alpha.total, 2)
      assert.equal((await store.queryTasks({ limit: 10, q: '%' })).total, 0, '% 必须按字面匹配')

      // 分页：total 是命中总数，不随 limit 变化
      const page = await store.queryTasks({ limit: 2, offset: 2 })
      assert.equal(page.total, 3)
      assert.deepEqual(page.tasks.map((t) => t.id), ['a:1'])
      await store.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test(`[${label}] 周期统计与成功率`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-companion-test-'))
    try {
      const store =
        Backend === SqlitePetStore
          ? new SqlitePetStore(join(dir, 'pet.sqlite'))
          : new JsonPetStore(join(dir, 'pet-data.json'))
      await store.init()
      await store.saveTask(makeTask({ id: 's:1', status: 'success' }))
      await store.saveTask(makeTask({ id: 's:2', status: 'failed' }))
      await store.saveTask(makeTask({ id: 's:3', status: 'interrupted' }))
      const today = await computePeriodStats(store, 'today')
      assert.equal(today.tasks, 3)
      assert.equal(today.success, 1)
      assert.equal(today.failed, 1)
      assert.equal(today.interrupted, 1)
      assert.equal(today.successRate, 33.3)
      assert.equal(today.totalTokens, 6000)
      assert.equal(today.cost, 0.0264)
      const all = await computePeriodStats(store, 'all')
      assert.equal(all.tasks, 3)
      // 环比：带上一周期（等长窗口），「全部」没有上一周期
      assert.equal(typeof today.previous.tasks, 'number', '今日应带上一周期做环比')
      assert.equal(today.previous.tasks, 0, '昨天同期没有任务')
      assert.equal(all.previous, null, '「全部」没有上一周期')
      assert.equal(today.previous.previous, null, '上一周期不再带环比（避免递归）')
      // 成本排行：按模型/项目聚合，share 加总约等于 1
      const ranking = await computeRanking(store, 'today')
      assert.equal(ranking.models.length, 1)
      assert.equal(ranking.models[0].key, 'deepseek-chat')
      assert.equal(ranking.models[0].tasks, 3)
      assert.equal(ranking.projects[0].key, 'demo')
      assert.ok(Math.abs(ranking.models[0].share - 1) < 1e-9, '单一模型占比 100%')
      await store.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}

test('openPetStore: auto 优先 sqlite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-companion-test-'))
  try {
    const opened = await openPetStore(dir, 'auto')
    assert.equal(opened.backend, process.platform === 'win32' ? 'sqlite' : opened.backend)
    assert.ok(['sqlite', 'json'].includes(opened.backend))
    await opened.store.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('openPetStore: json 模式不碰 sqlite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-companion-test-'))
  try {
    const opened = await openPetStore(dir, 'json')
    assert.equal(opened.backend, 'json')
    await opened.store.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('exportSessions: CSV 头与转义', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-companion-test-'))
  try {
    const store = new JsonPetStore(join(dir, 'pet-data.json'))
    await store.init()
    await store.saveTask(makeTask({ project: 'a,b "quoted"' }))
    const csv = await exportSessions(store, 'csv')
    assert.ok(csv.contentType.startsWith('text/csv'))
    assert.ok(csv.body.startsWith('\uFEFFid,sessionId,turn,project'))
    assert.ok(csv.body.includes('"a,b ""quoted""",'))
    const json = await exportSessions(store, 'json')
    const parsed = JSON.parse(json.body)
    assert.equal(parsed.tasks.length, 1)
    assert.equal(parsed.schemaVersion, 1)
    // 带筛选导出：与历史页同口径（模型/项目关键词），缺省仍全量
    await store.saveTask(makeTask({ id: 'session-2:1', model: 'deepseek-flash', project: 'other' }))
    const filtered = await exportSessions(store, 'csv', 5_000, { q: 'other' })
    assert.ok(filtered.body.includes('other'), '筛选命中的行应在导出里')
    assert.ok(!filtered.body.includes('a,b'), '未命中的行不应出现')
    assert.equal((await exportSessions(store, 'json', 5_000, {})).body.includes('"tasks": ['), true,
      '空筛选 = 全量导出')
    await store.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('periodRange: today 边界为本地零点', () => {
  const now = new Date(2026, 9, 15, 23, 59, 59)
  const { from, to } = periodRange('today', now)
  const start = new Date(from)
  assert.equal(start.getHours(), 0)
  assert.equal(to - from, 24 * 3600 * 1000)
})
