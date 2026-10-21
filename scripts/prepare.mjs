#!/usr/bin/env node
/**
 * 安装钩子：让「从 git 安装」也能开箱即用。
 *
 * `dsh plugin --profile <p> add github:qiuzhiyei/dsh-companion` 本质是在 profile 目录里
 * 跑 pnpm add —— 对 git 依赖，包管理器会先装依赖、再跑本仓的 prepare、最后按
 * package.json 的 files 打包。dist/ 不进版本库（构建产物），所以必须在这时候把 TS
 * 编译出来，否则装完是个没有入口的空包（表现为插件静默不加载）。
 *
 * 生产安装（依赖树里没有 typescript）时静默跳过，绝不阻断安装。
 * 应急开关：DSH_COMPANION_SKIP_PREPARE=1
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const log = (m) => console.log('[dsh-companion] ' + m)

if (process.env.DSH_COMPANION_SKIP_PREPARE === '1') {
  log('跳过自动构建（DSH_COMPANION_SKIP_PREPARE=1）')
  process.exit(0)
}

const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
if (!existsSync(tsc)) {
  log('未找到 typescript（多半是生产安装），跳过自动构建')
  process.exit(0)
}

// 两份 tsconfig 都要编：主半边（node）+ 客户端半边（浏览器，脚本模式）
for (const cfg of ['tsconfig.json', 'tsconfig.client.json']) {
  log('构建 ' + cfg)
  const r = spawnSync(process.execPath, [tsc, '-p', cfg], { cwd: root, stdio: 'inherit' })
  if (r.status !== 0) {
    console.error('[dsh-companion] 构建失败：' + cfg)
    process.exit(r.status || 1)
  }
}
log('构建完成：dist/ 已生成')