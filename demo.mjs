/**
 * dsh-companion 独立演示 —— 不需要 DSH、不需要 API Key。
 *
 *   node demo.mjs            # mock 自动循环（success/long/error/interrupted 随机）
 *   node demo.mjs fast       # 时间压缩 20 倍，5 秒左右一个任务
 *   node demo.mjs 17699      # 自定义端口
 *
 * 打开 http://127.0.0.1:17573 看伴侣监测状态，http://127.0.0.1:17573/panel 看面板。
 * Ctrl+C 退出（可逆卸载，数据写在临时目录，不污染 $DSH_HOME）。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { apply } from './dist/index.js'

const arg = process.argv[2] ?? ''
const fast = arg === 'fast'
const port = Number.isFinite(Number(arg)) && arg !== '' ? Number(arg) : 17_573
const dataDir = await mkdtemp(join(tmpdir(), 'dsh-companion-demo-'))

const ctx = new Context()
apply(ctx, {
  adapter: 'mock',
  dataDir,
  storage: 'auto',
  currency: 'CNY',
  settleMs: fast ? 2_500 : 6_000,
  logEvents: false,
  server: { enabled: true, host: '127.0.0.1', port, shell: 'off', toast: false },
  mock: {
    auto: true,
    intervalMs: fast ? 3_000 : 12_000,
    speed: fast ? 20 : 3,
  },
})

console.log('')
console.log('  🤖 dsh-companion 演示模式（mock 事件，自动循环）')
console.log(`     伴侣  →  http://127.0.0.1:${port}`)
console.log(`     面板  →  http://127.0.0.1:${port}/panel`)
console.log(`     数据  →  ${dataDir}（临时，退出即弃）`)
console.log('     退出  →  Ctrl+C')
console.log('')

process.on('SIGINT', () => {
  console.log('\n收到 Ctrl+C，卸载插件…')
  ctx.fiber.dispose().then(
    () => process.exit(0),
    () => process.exit(0),
  )
})
