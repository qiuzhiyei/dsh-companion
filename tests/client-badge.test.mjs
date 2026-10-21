/**
 * GUI 客户端角标（dist/client/index.js）契约测试：
 * 必须是“脚本模式”ModuleLoader 注册（无顶层 import/export），
 * 否则宿主的 combo 注入无法执行。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('客户端角标：ModuleLoader 脚本形态', async () => {
  const source = await readFile(new URL('../dist/client/index.js', import.meta.url), 'utf8')
  assert.ok(source.includes('__ModuleLoader__'), '必须通过 __ModuleLoader__.load 注册')
  assert.ok(source.includes('dsh-companion'), '注册 id 必须是包名 dsh-companion')
  assert.ok(
    !/^\s*(import|export)\s/m.test(source),
    '脚本模式：不能有顶层 import/export（tsc 会把带 import/export 的文件当模块输出）',
  )
  assert.ok(source.includes('footArea'), '必须实现侧边栏座位逻辑（footArea）')
  assert.ok(source.includes('--dsw-alias-'), '颜色必须走 DSH 皮肤令牌（--dsw-alias-*）')
  // 角标点击直接开完整统计面板大窗：没有中间详情卡。
  assert.ok(source.includes('openPanelModal'), '点击角标必须直接打开面板大窗')
  assert.ok(source.includes('/panel'), '面板大窗加载 /panel 页面')
  assert.ok(
    !source.includes('pd-today') && !source.includes('pet-detail'),
    '不再有详情卡（角标 → 面板大窗一步到位）',
  )
})

test('客户端角标：package.json 声明完整', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.exports['./client'], './dist/client/index.js')
  assert.equal(pkg.dsh.client.platform, 'web')
  // 删除会话菜单项注入 ui-workspace 声明的槽位 → 包级 inject 提示宿主先加载它。
  assert.deepEqual(pkg.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-workspace'])
})

test('客户端删除会话：官方槽位注入 + 皮肤令牌确认弹窗', async () => {
  const source = await readFile(new URL('../dist/client/index.js', import.meta.url), 'utf8')
  assert.ok(
    source.includes('sidebar.workspaces.session.menu.item'),
    '必须注入会话行 "…" 菜单的官方槽位',
  )
  assert.ok(source.includes('companion.delete-session'), '槽位条目需要稳定 id')
  assert.ok(source.includes('/api/dsh-sessions/delete'), '删除必须走伴侣 node 服务')
  assert.ok(
    source.includes('session-delete-confirm'),
    '确认弹窗带 data-dsh-part 语义属性',
  )
  assert.ok(source.includes('删除会话'), '菜单项文案')
  assert.ok(
    source.includes('IconTrashOutlineRegular'),
    '菜单项前置删除图标：用宿主 primitives 图标族，与自带项对齐',
  )
  assert.ok(
    source.includes('--dsw-alias-state-error-primary'),
    '删除是危险操作：菜单项与确认按钮用宿主官方危险色令牌',
  )
  assert.ok(!source.includes('window.confirm'), '不用原生 confirm，用皮肤令牌弹窗')
})
