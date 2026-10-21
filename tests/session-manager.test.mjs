/**
 * DSH 会话删除（dist/ui-enhance/session-manager.js）单元测试。
 *
 * 假 registry + 临时目录模拟 ~/.dsh 布局（sessions/<编码>/<id>/ 与
 * storages/session_projcache/sessions/<id>.json），覆盖：成功彻底删除、
 * 活动会话拒绝、companion 跟踪中拒绝、未找到、非法 id、registry 缺失、
 * getRegistry 同步抛收口、isTrackedRunning 抛、文件被占用 → pending
 * 登记与补删、pending 旧字段名兼容、冷会话（未落盘）；
 * 会话清单（标题/消息数/磁盘占用/归档置顶标记/无归属 id 并入）与
 * 批量删除（聚合结果、单个失败不中断、入参形状校验）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionDeleter } from '../dist/ui-enhance/session-manager.js'

const SID = 'session-97c66d45-80fa-43a3-b55b-8f32fd182ebb'
const OTHER = 'session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const ORPHAN = 'session-cccccccc-1111-2222-3333-444444444444'

async function setup(opts = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-companion-sm-'))
  const dshHome = join(root, 'dsh-home')
  const dataDir = join(root, 'data')
  const sessionDir = join(dshHome, 'sessions', '--D-test-ws--', SID)
  await mkdir(sessionDir, { recursive: true })
  await writeFile(join(sessionDir, 'session.v4.jsonl.zstd'), 'dummy')
  const projcacheFile = join(dshHome, 'storages', 'session_projcache', 'sessions', SID + '.json')
  await mkdir(join(projcacheFile, '..'), { recursive: true })
  // 宿主投影缓存的真实形状：rows.title.val / rows.titleInput.val.count。
  await writeFile(
    projcacheFile,
    JSON.stringify({
      version: 7,
      record: { rows: { title: { ver: 1, val: '测试会话标题' }, titleInput: { ver: 3, val: { count: 3 } } } },
    }),
  )

  const calls = { unarchive: [], unpin: [], detach: [] }
  const ws = {
    id: 'w1',
    path: 'D:\\test\\ws',
    title: 'ws',
    sessionIds: [SID, OTHER],
    detachSession: async (id) => {
      calls.detach.push(id)
      ws.sessionIds = ws.sessionIds.filter((x) => x !== id)
    },
  }
  const registry = {
    list: () => [ws],
    // 宿主 registry 的全局集合是属性 getter；本模块防御性读取。
    archivedSessionIds: opts.archivedIds ?? [],
    pinnedSessionIds: opts.pinnedIds ?? [],
    unarchiveSession: async (id) => {
      calls.unarchive.push(id)
    },
    unpinSession: async (id) => {
      calls.unpin.push(id)
    },
  }
  const deleter = new SessionDeleter({
    getRegistry: () => {
      // 模拟 cordis Proxy：未声明 inject 直读服务属性会同步抛。
      if (opts.getRegistryThrows) {
        throw new Error('cannot get property "workspaceRegistry" without inject')
      }
      return opts.registry === undefined ? registry : opts.registry
    },
    // activity 可以是数组（对所有会话生效）或函数（按 id 判定）。
    queryActivity: async (id) =>
      typeof opts.activity === 'function' ? opts.activity(id) : (opts.activity ?? []),
    dshHome,
    pendingFile: join(dataDir, 'delete-pending.json'),
    isTrackedRunning: () => {
      if (opts.trackedThrows) throw new Error('tracker exploded')
      return opts.trackedRunning ?? false
    },
    ...(opts.remove !== undefined ? { remove: opts.remove } : {}),
    now: () => 1_760_000_000_000,
  })
  return { root, dataDir, sessionDir, projcacheFile, ws, calls, deleter }
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

test('会话删除：成功 = 除名 + 归档/置顶清理 + 文件彻底删除', async () => {
  const s = await setup()
  try {
    const out = await s.deleter.delete(SID)
    assert.equal(out.ok, true)
    assert.equal(out.deleted, true)
    assert.equal(out.pending, false)
    assert.equal(out.workspaceId, 'w1')
    // registry：除名只动目标会话；全局集合清理幂等调用。
    assert.deepEqual(s.calls.detach, [SID])
    assert.deepEqual(s.calls.unarchive, [SID])
    assert.deepEqual(s.calls.unpin, [SID])
    assert.ok(!s.ws.sessionIds.includes(SID))
    assert.ok(s.ws.sessionIds.includes(OTHER), '其他会话不受影响')
    // 文件：会话目录与投影缓存行直接消失（用户口径：删除就是删除，不留回收站）。
    assert.equal(await exists(s.sessionDir), false)
    assert.equal(await exists(s.projcacheFile), false)
    assert.equal(await exists(join(s.dataDir, 'trash')), false, '不再产生回收站目录')
    assert.equal(await exists(join(s.dataDir, 'delete-pending.json')), false, '无 pending')
  } finally {
    await rm(s.root, { recursive: true, force: true })
  }
})

test('会话删除：宿主活动探测命中 → session-active，一切原样', async () => {
  const s = await setup({ activity: [{ kind: 'task' }] })
  try {
    const out = await s.deleter.delete(SID)
    assert.equal(out.ok, false)
    assert.equal(out.error, 'session-active')
    assert.deepEqual(s.calls.detach, [], '不得除名')
    assert.ok(s.ws.sessionIds.includes(SID))
    assert.equal(await exists(s.sessionDir), true)
  } finally {
    await rm(s.root, { recursive: true, force: true })
  }
})

test('会话删除：companion 正在跟踪该会话 → session-active', async () => {
  const s = await setup({ trackedRunning: true })
  try {
    const out = await s.deleter.delete(SID)
    assert.equal(out.ok, false)
    assert.equal(out.error, 'session-active')
    assert.deepEqual(s.calls.detach, [])
  } finally {
    await rm(s.root, { recursive: true, force: true })
  }
})

test('会话删除：未知会话 → session-not-found', async () => {
  const s = await setup()
  try {
    const out = await s.deleter.delete('session-00000000-1111-2222-3333-444444444444')
    assert.equal(out.ok, false)
    assert.equal(out.error, 'session-not-found')
  } finally {
    await rm(s.root, { recursive: true, force: true })
  }
})

test('会话删除：非法 id（路径穿越/形状不对）→ bad-request', async () => {
  const s = await setup()
  try {
    assert.equal((await s.deleter.delete('../evil')).error, 'bad-request')
    assert.equal((await s.deleter.delete('session-xy')).error, 'bad-request')
    assert.equal((await s.deleter.delete('')).error, 'bad-request')
    assert.equal((await s.deleter.delete('D:\\..\\session-aaaaaa-bb')).error, 'bad-request')
    assert.deepEqual(s.calls.detach, [])
  } finally {
    await rm(s.root, { recursive: true, force: true })
  }
})

test('会话删除：registry 未就绪 → registry-unavailable', async () => {
  const s = await setup({ registry: null })
  try {
    const out = await s.deleter.delete(SID)
    assert.equal(out.ok, false)
    assert.equal(out.error, 'registry-unavailable')
  } finally {
    await rm(s.root, { recursive: true, force: true })
  }
})

test('会话删除：getRegistry 同步抛（cordis Proxy 未 inject 服务）→ 收口为 registry-unavailable', async () => {
  const s = await setup({ getRegistryThrows: true })
  try {
    const out = await s.deleter.delete(SID)
    assert.equal(out.ok, false, '异常不得穿透 delete()，否则 HTTP 层只剩 text 500')
    assert.equal(out.error, 'registry-unavailable')
    assert.deepEqual(s.calls.detach, [])
    assert.equal(await exists(s.sessionDir), true)
  } finally {
    await rm(s.root, { recursive: true, force: true })
  }
})

test('会话删除：isTrackedRunning 抛异常 → 按未运行处理（宿主活动探测仍是主闸门）', async () => {
  const s = await setup({ trackedThrows: true })
  try {
    const out = await s.deleter.delete(SID)
    assert.equal(out.ok, true)
    assert.equal(out.deleted, true)
    assert.deepEqual(s.calls.detach, [SID])
  } finally {
    await rm(s.root, { recursive: true, force: true })
  }
})

test('会话删除：文件被占用 → 除名照常完成、pending 登记、补删后彻底消失', async () => {
  let failOnce = true
  const remove = async (target) => {
    if (failOnce && target.endsWith(SID)) {
      failOnce = false
      const err = new Error('EBUSY: resource busy or locked')
      err.code = 'EBUSY'
      throw err
    }
    await rm(target, { recursive: true, force: true })
  }
  const s = await setup({ remove })
  try {
    const out = await s.deleter.delete(SID)
    assert.equal(out.ok, true, '除名已成功，删除整体算完成')
    assert.equal(out.deleted, false)
    assert.equal(out.pending, true)
    assert.equal(await exists(s.sessionDir), true, '被占用的目录还在原处等待补删')
    const pendingFile = join(s.dataDir, 'delete-pending.json')
    const pending = JSON.parse(await readFile(pendingFile, 'utf8'))
    assert.equal(pending.length, 1)
    assert.equal(pending[0].sessionId, SID)
    assert.equal(pending[0].sessionDir, s.sessionDir)
    assert.match(pending[0].lastError, /EBUSY/)

    // 句柄释放后：补删成功，pending 清空。
    await s.deleter.retryPending()
    assert.equal(await exists(s.sessionDir), false)
    const pendingAfter = JSON.parse(await readFile(pendingFile, 'utf8'))
    assert.deepEqual(pendingAfter, [])
  } finally {
    await rm(s.root, { recursive: true, force: true })
  }
})

test('会话删除：pending 兼容旧软删时代的 sourceDir 字段名', async () => {
  const s = await setup()
  try {
    // 旧版 trash-pending.json 的条目形状：sourceDir 而非 sessionDir。
    await mkdir(s.dataDir, { recursive: true })
    await writeFile(
      join(s.dataDir, 'delete-pending.json'),
      JSON.stringify([{ sessionId: SID, sourceDir: s.sessionDir, projcacheFile: null, deletedAt: 0 }]),
      'utf8',
    )
    await s.deleter.retryPending()
    assert.equal(await exists(s.sessionDir), false, '旧字段名照常补删')
    const pendingAfter = JSON.parse(await readFile(join(s.dataDir, 'delete-pending.json'), 'utf8'))
    assert.deepEqual(pendingAfter, [])
  } finally {
    await rm(s.root, { recursive: true, force: true })
  }
})

test('会话删除：冷会话（从未落盘）→ 除名即完成', async () => {
  const s = await setup()
  try {
    await rm(s.sessionDir, { recursive: true, force: true })
    await rm(s.projcacheFile, { force: true })
    const out = await s.deleter.delete(SID)
    assert.equal(out.ok, true)
    assert.equal(out.deleted, false)
    assert.equal(out.pending, false)
    assert.deepEqual(s.calls.detach, [SID])
    assert.equal(await exists(join(s.dataDir, 'delete-pending.json')), false)
  } finally {
    await rm(s.root, { recursive: true, force: true })
  }
})

test('会话清单：标题/消息数/占用/归档置顶标记，无归属归档 id 并入', async () => {
  const s = await setup({ archivedIds: [OTHER, ORPHAN], pinnedIds: [SID] })
  try {
    const out = await s.deleter.listSessions()
    assert.equal(out.ok, true)
    assert.equal(out.sessions.length, 3, '工作区槽位 ∪ 全局集合，去重')
    const byId = new Map(out.sessions.map((x) => [x.sessionId, x]))

    const main = byId.get(SID)
    assert.equal(main.title, '测试会话标题')
    assert.equal(main.messageCount, 3)
    assert.equal(main.workspaceId, 'w1')
    assert.equal(main.workspaceTitle, 'ws')
    assert.equal(main.pinned, true)
    assert.equal(main.archived, false)
    assert.ok(main.sizeBytes > 0, '会话目录占用')
    assert.ok(main.lastActivityAt > 0)
    assert.equal(main.hasFiles, true)

    const other = byId.get(OTHER)
    assert.equal(other.archived, true)
    assert.equal(other.workspaceId, 'w1', '归档不触碰 workspace 槽位（宿主承诺）')
    assert.equal(other.title, null, '无投影缓存 → 标题未知')
    assert.equal(other.sizeBytes, null, '未落盘')
    assert.equal(other.hasFiles, false)

    const orphan = byId.get(ORPHAN)
    assert.ok(orphan, '只在全局归档集合里的 id 也要列出')
    assert.equal(orphan.workspaceId, null)
    assert.equal(orphan.archived, true)

    assert.ok(out.totalSizeBytes >= main.sizeBytes)
  } finally {
    await rm(s.root, { recursive: true, force: true })
  }
})

test('会话清单：registry 未就绪 → registry-unavailable', async () => {
  const s = await setup({ registry: null })
  try {
    const out = await s.deleter.listSessions()
    assert.equal(out.ok, false)
    assert.equal(out.error, 'registry-unavailable')
  } finally {
    await rm(s.root, { recursive: true, force: true })
  }
})

test('会话删除：只在全局归档集合的无归属 id → 免除名放行，集合清理照做', async () => {
  const s = await setup({ archivedIds: [ORPHAN] })
  try {
    const out = await s.deleter.delete(ORPHAN)
    assert.equal(out.ok, true)
    assert.equal(out.workspaceId, null)
    assert.deepEqual(s.calls.detach, [], '没有归属，无从除名')
    assert.deepEqual(s.calls.unarchive, [ORPHAN])
    assert.deepEqual(s.calls.unpin, [ORPHAN])
  } finally {
    await rm(s.root, { recursive: true, force: true })
  }
})

test('批量删除：聚合结果，单个失败不中断整批', async () => {
  const s = await setup({ activity: (id) => (id === OTHER ? [{ kind: 'task' }] : []) })
  try {
    const unknown = 'session-00000000-1111-2222-3333-444444444444'
    const out = await s.deleter.deleteMany([SID, OTHER, unknown])
    assert.equal(out.ok, true)
    assert.equal(out.deletedCount, 1)
    assert.equal(out.failedCount, 2)
    const byId = new Map(out.results.map((r) => [r.sessionId, r]))
    assert.equal(byId.get(SID).ok, true)
    assert.equal(byId.get(SID).deleted, true)
    assert.equal(byId.get(OTHER).ok, false)
    assert.equal(byId.get(OTHER).error, 'session-active', '活动闸门逐个生效')
    assert.equal(byId.get(unknown).error, 'session-not-found')
    assert.equal(await exists(s.sessionDir), false)
    assert.ok(s.ws.sessionIds.includes(OTHER), '活动会话原样保留')
  } finally {
    await rm(s.root, { recursive: true, force: true })
  }
})

test('批量删除：入参形状不合法 → bad-request', async () => {
  const s = await setup()
  try {
    assert.equal((await s.deleter.deleteMany(null)).error, 'bad-request')
    assert.equal((await s.deleter.deleteMany([])).error, 'bad-request')
    assert.equal((await s.deleter.deleteMany(SID)).error, 'bad-request', '单个 id 字符串不是批量入参')
    assert.equal((await s.deleter.deleteMany(new Array(501).fill(SID))).error, 'bad-request')
    assert.deepEqual(s.calls.detach, [])
  } finally {
    await rm(s.root, { recursive: true, force: true })
  }
})
