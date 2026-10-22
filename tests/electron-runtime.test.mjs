/**
 * Electron 运行时解析（dist/ui/electron-runtime.js）契约测试。
 *
 * 这里只测**纯逻辑**（路径拼接、镜像顺序、本地探测优先级）——
 * 真正的 150 MB 下载不在单测里跑（网络 + 体积都不该进测试）。
 * 想验下载逻辑，手动删掉 <dataDir>/runtime 后重启 DSH 看日志。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ELECTRON_VERSION,
  electronZipUrls,
  exeRelativePath,
  installedExe,
  resolveElectronSync,
  runtimeDir,
  runtimeRoot,
} from '../dist/ui/electron-runtime.js'

test('运行时路径：<dataDir>/runtime/electron-<version>', () => {
  const dataDir = join('C:', 'data', 'dsh-companion')
  assert.equal(runtimeRoot(dataDir), join(dataDir, 'runtime'))
  assert.equal(
    runtimeDir(dataDir, '1.2.3'),
    join(dataDir, 'runtime', 'electron-1.2.3'),
  )
  // 默认版本就是钉死的那个
  assert.equal(runtimeDir(dataDir), join(dataDir, 'runtime', `electron-${ELECTRON_VERSION}`))
})

test('可执行文件相对路径按平台区分', () => {
  assert.equal(exeRelativePath('win32'), 'electron.exe')
  assert.equal(exeRelativePath('linux'), 'electron')
  assert.equal(
    exeRelativePath('darwin'),
    join('Electron.app', 'Contents', 'MacOS', 'Electron'),
  )
})

test('下载地址：国内镜像优先，GitHub 兜底，文件名含版本/平台/架构', () => {
  const urls = electronZipUrls('44.7.2', 'win32', 'x64')
  assert.equal(urls.length, 3)
  assert.ok(urls[0].includes('npmmirror.com'), '国内镜像必须排第一（GitHub 常有连通性问题）')
  assert.ok(urls[2].includes('github.com'), 'GitHub 作为最后一档兜底')
  for (const url of urls) {
    assert.ok(url.endsWith('electron-v44.7.2-win32-x64.zip'), `文件名不正确: ${url}`)
    assert.ok(url.startsWith('https://'), '必须走 HTTPS')
  }
  // 架构要跟得上（arm64 机器不能拿到 x64 包）
  assert.ok(electronZipUrls('44.7.2', 'darwin', 'arm64')[0].includes('-darwin-arm64.zip'))
})

test('本地探测：<dataDir>/runtime 里有副本时直接命中，不联网', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'companion-rt-'))
  try {
    assert.equal(installedExe(dataDir), null, '空目录应当探不到')

    const dir = runtimeDir(dataDir)
    await mkdir(dir, { recursive: true })
    const exe = join(dir, exeRelativePath(process.platform))
    await writeFile(exe, 'fake')

    assert.equal(installedExe(dataDir), exe)

    // 环境变量优先级最高：指向别的文件时应当被采用
    const other = join(dataDir, 'custom-electron.exe')
    await writeFile(other, 'fake')
    const previous = process.env.DSH_COMPANION_ELECTRON
    process.env.DSH_COMPANION_ELECTRON = other
    try {
      assert.equal(resolveElectronSync(dataDir), other)
      // 指向不存在的路径要退回已下载副本，而不是返回坏路径
      process.env.DSH_COMPANION_ELECTRON = join(dataDir, 'nope.exe')
      const resolved = resolveElectronSync(dataDir)
      // 开发仓库里装了 electron 时可能命中 require('electron')，两种都算"有效路径"
      assert.ok(resolved === exe || (resolved && resolved.endsWith('electron.exe')), String(resolved))
    } finally {
      if (previous === undefined) delete process.env.DSH_COMPANION_ELECTRON
      else process.env.DSH_COMPANION_ELECTRON = previous
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('托盘控制器把 dataDir 传给了运行时解析（源码契约）', async () => {
  const { readFile } = await import('node:fs/promises')
  const tray = await readFile(new URL('../dist/ui/tray.js', import.meta.url), 'utf8')
  assert.ok(tray.includes('ensureElectronRuntime'), '缺本地 electron 时要自动获取运行时')
  assert.ok(tray.includes('resolveElectronSync'), '先查本地（开发态/已下载副本）再下载')
  assert.ok(tray.includes('dataDir'), '运行时缓存在数据目录，必须透传 dataDir')
  assert.ok(
    !tray.includes('electron 未安装，伴侣以浏览器页面模式运行'),
    '旧的“缺了就放弃”提示已被自动下载取代',
  )
})