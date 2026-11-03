/**
 * 官方峰谷口径 + 法定节假日日历：
 * 北京时间工作日 9–12 / 14–18 为高峰；周末和法定节假日全天闲时。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  getHolidayDates,
  isPeakTime,
  parseHolidayPayload,
  syncHolidayCalendar,
} from '../dist/pricing/holidays.js'

// 2026-10-20 周二，把北京时间转成 UTC 时刻。
const bj = (hour, minute = 0) => Date.UTC(2026, 9, 20, hour - 8, minute)

test('峰谷：工作日 9–12 / 14–18 高峰，午休/夜间/周末/节假日闲时', () => {
  assert.equal(isPeakTime(bj(8, 59)), false)
  assert.equal(isPeakTime(bj(9, 0)), true)
  assert.equal(isPeakTime(bj(11, 59)), true)
  assert.equal(isPeakTime(bj(12, 0)), false)
  assert.equal(isPeakTime(bj(13, 59)), false)
  assert.equal(isPeakTime(bj(14, 0)), true)
  assert.equal(isPeakTime(bj(17, 59)), true)
  assert.equal(isPeakTime(bj(18, 0)), false)
  assert.equal(isPeakTime(bj(23, 0)), false)
  // 周六 10:00、国庆 10:00 都算闲时。
  assert.equal(isPeakTime(Date.UTC(2026, 9, 24, 2, 0)), false)
  assert.equal(isPeakTime(Date.UTC(2026, 9, 1, 2, 0)), false)
  assert.equal(getHolidayDates().includes('2026-10-01'), true)
  assert.equal(getHolidayDates().includes('2025-01-28'), true)
})

test('节假日 API：只取 holiday=true，忽略调休上班日与非法日期', () => {
  const dates = parseHolidayPayload(2027, {
    holiday: {
      '01-01': { holiday: true },
      '01-04': { holiday: false },
      '02-30': { holiday: true },
      'bad': { holiday: true },
      '05-01': { holiday: true },
    },
  })
  assert.deepEqual(dates, ['2027-01-01', '2027-05-01'])
})

test('同步：新增年份落盘；官方未发布年份保留原数据', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-holidays-'))
  try {
    const fetcher = async (url) => {
      assert.match(String(url), /2027$/)
      return {
        ok: true,
        async json() {
          return { holiday: { '01-01': { holiday: true }, '01-04': { holiday: false } } }
        },
      }
    }
    const added = await syncHolidayCalendar(dir, [2027], fetcher)
    assert.equal(added.ok, true)
    assert.equal(added.years[0].year, 2027)
    assert.equal(added.years[0].count, 1)
    assert.equal(getHolidayDates().includes('2027-01-01'), true)
    const saved = JSON.parse(await readFile(join(dir, 'holidays.json'), 'utf8'))
    assert.deepEqual(saved.years['2027'], ['2027-01-01'])

    const empty = async () => ({
      ok: true,
      async json() {
        return { holiday: {} }
      },
    })
    const kept = await syncHolidayCalendar(dir, [2028], empty)
    assert.equal(kept.ok, false)
    assert.equal(kept.years[0].updated, false)
    assert.match(kept.years[0].reason, /尚未发布/)
    assert.equal(getHolidayDates().includes('2027-01-01'), true, '旧年份不能被空结果清空')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
