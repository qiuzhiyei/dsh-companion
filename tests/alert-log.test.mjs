/**
 * 告警记录（面板「告警记录」卡的数据源）契约。
 *
 * 环形日志：最新在前、最多 max 条、坏文件/坏行不炸、写入串行化。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AlertLog } from '../dist/storage/alert-log.js'

async function tempFile(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-companion-alerts-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return join(dir, 'alerts.json')
}

test('AlertLog: 缺失文件从空日志开始；记录后落盘、新的在前', async (t) => {
  const file = await tempFile(t)
  const log = new AlertLog(file)
  await log.load()
  assert.deepEqual(log.list(5), [])

  const first = await log.record({ type: 'budget', level: 'warn', text: '预算超限', time: 1000 })
  const second = await log.record({ type: 'failed', level: 'error', text: '任务失败', time: 2000 })
  assert.ok(first && second)
  assert.deepEqual(log.list(5).map((a) => a.text), ['任务失败', '预算超限'])

  const disk = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(disk.length, 2)
  // 新实例读回同一份（气泡消失后仍可回查）
  const reloaded = new AlertLog(file)
  await reloaded.load()
  assert.deepEqual(reloaded.list(5).map((a) => a.text), ['任务失败', '预算超限'])
})

test('AlertLog: 环形上限（默认 50，可注入）', async (t) => {
  const file = await tempFile(t)
  const log = new AlertLog(file, 3)
  await log.load()
  for (let i = 1; i <= 5; i += 1) {
    await log.record({ type: 'interrupted', level: 'error', text: '告警 ' + i, time: i })
  }
  assert.deepEqual(log.list(10).map((a) => a.text), ['告警 5', '告警 4', '告警 3'])
  const disk = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(disk.length, 3, '落盘也只能保留上限条数')
})

test('AlertLog: 非法类型/级别/空文案一律拒收，不落盘', async (t) => {
  const file = await tempFile(t)
  const log = new AlertLog(file)
  await log.load()
  assert.equal(await log.record({ type: 'bogus', level: 'warn', text: 'x' }), null)
  assert.equal(await log.record({ type: 'budget', level: 'bogus', text: 'x' }), null)
  assert.equal(await log.record({ type: 'budget', level: 'warn', text: '   ' }), null)
  assert.equal(log.list(5).length, 0)
  await assert.rejects(readFile(file, 'utf8'), '没有合法记录就不应创建文件')
})

test('AlertLog: 坏 JSON / 坏行被丢弃，不抛', async (t) => {
  const file = await tempFile(t)
  await writeFile(file, '{oops', 'utf8')
  const broken = new AlertLog(file)
  await broken.load()
  assert.deepEqual(broken.list(5), [])

  await writeFile(
    file,
    JSON.stringify([
      { id: 'a', time: 1, type: 'budget', level: 'warn', text: '保留' },
      { id: 'b', time: 2, type: 'nope', level: 'warn', text: '丢弃' },
      { id: 'c', time: 'x', type: 'failed', level: 'error', text: '丢' },
      null,
    ]),
    'utf8',
  )
  const partial = new AlertLog(file)
  await partial.load()
  assert.deepEqual(partial.list(5).map((a) => a.text), ['保留'])
})

test('AlertLog: 长文案截断到 240 字，id 唯一', async (t) => {
  const file = await tempFile(t)
  const log = new AlertLog(file)
  await log.load()
  const a = await log.record({ type: 'budget', level: 'warn', text: 'x'.repeat(500) })
  const b = await log.record({ type: 'budget', level: 'warn', text: 'y' })
  assert.equal(a.text.length, 240)
  assert.notEqual(a.id, b.id)
  assert.ok(a.id.length > 0)
})
