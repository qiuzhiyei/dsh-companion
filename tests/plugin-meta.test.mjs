/**
 * 插件管理器展示元数据契约（locale meta + 图标）。
 *
 * 宿主不激活插件、只读导出文件来渲染插件行的标题/描述/图标
 * （host-plugin.md "Display metadata and icon"）；缺了就回退包名 + 通用画。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'

test('插件元数据：locale 提供 meta.title / meta.description', async () => {
  for (const lang of ['en', 'zh']) {
    const meta = JSON.parse(
      await readFile(new URL(`../locale/${lang}.json`, import.meta.url), 'utf8'),
    )
    assert.ok(typeof meta.meta?.title === 'string' && meta.meta.title !== '', `${lang}: meta.title`)
    assert.ok(
      typeof meta.meta?.description === 'string' && meta.meta.description.length >= 20,
      `${lang}: meta.description 要能描述能力，不是模板占位`,
    )
  }
})

test('插件元数据：icon.svg 是有效 SVG 且不超 256 KiB', async () => {
  const url = new URL('../icon.svg', import.meta.url)
  const { size } = await stat(url)
  assert.ok(size > 0 && size <= 256 * 1024, `图标大小 ${size} 需在 (0, 256KiB]`)
  const svg = await readFile(url, 'utf8')
  assert.match(svg.trimStart(), /^<svg[\s>]/, '必须是 SVG 根元素')
  assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'), 'SVG 命名空间')
})

test('插件元数据：package.json 导出与 files 声明完整', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.exports['./locale/*.json'], './locale/*.json')
  assert.equal(pkg.exports['./icon'], './icon.svg')
  assert.ok(pkg.files.includes('locale/*.json'), 'files 需含 locale')
  assert.ok(pkg.files.includes('icon.svg'), 'files 需含图标')
})
