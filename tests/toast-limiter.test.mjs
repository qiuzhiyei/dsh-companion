/**
 * ToastLimiter：滚动 1 小时窗口限流。
 * 旧实现「每进程 8 条」用光后永久静音（连带卡死余额低告警），改为窗口滚动。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { ToastLimiter } from '../dist/ui/tray.js'

test('ToastLimiter: 窗口内超额拒绝，不超额放行', () => {
  let now = 1_000_000
  const limiter = new ToastLimiter(3, 3_600_000, () => now)
  assert.equal(limiter.allow(), true)
  assert.equal(limiter.allow(), true)
  assert.equal(limiter.allow(), true)
  assert.equal(limiter.allow(), false, '第 4 条应被拒绝（窗口满）')
})

test('ToastLimiter: 窗口滑过后额度恢复（旧实现永久静音的回归测试）', () => {
  let now = 0
  const limiter = new ToastLimiter(2, 3_600_000, () => now)
  assert.equal(limiter.allow(), true)
  now = 60_000 // 第二条落在 +1min
  assert.equal(limiter.allow(), true)
  assert.equal(limiter.allow(), false, '窗口内已满')
  // 推进到恰好让第一条（ts=0）滑出、第二条（ts=60000）仍在窗口内 → 只恢复一个额度。
  now = 3_600_000
  assert.equal(limiter.allow(), true, '窗口滚过应恢复额度，不得永久静音')
  assert.equal(limiter.allow(), false, '第二条仍在窗口内，额度只有一个')
  // 再推进让第二条也滑出（ts=60000 + 1h）。
  now = 3_660_000
  assert.equal(limiter.allow(), true)
})
