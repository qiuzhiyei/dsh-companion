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
  assert.ok(
    source.includes("id: '@qiuzhiyei/dsh-companion'"),
    '注册 id 必须逐字等于包名 @qiuzhiyei/dsh-companion（否则宿主静默不加载）',
  )
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

test('客户端角标：设计稿 04 的卡片式结构与 panel 大窗外壳', async () => {
  const source = await readFile(new URL('../dist/client/index.js', import.meta.url), 'utf8')
  // 角标 = 图标 + 主/副两行 + 余额/峰谷第三行 + 状态点/箭头
  for (const cls of ['sb-icon', 'sb-text', 'sb-dot', 'sb-arrow', 'sb-foot', 'sb-period']) {
    assert.ok(source.includes('.' + cls), '角标缺样式 ' + cls)
  }
  assert.ok(source.includes('FIN_SVG'), '角标应使用鲸鱼背鳍标记')
  assert.ok(source.includes('sb-dot') && source.includes('sb-arrow'), '进行中状态点 / 空闲箭头')
  assert.ok(source.includes('font-size: 13px; font-weight: 500'), '角标主行字号对齐宿主侧栏')
  assert.ok(source.includes('font-size: 12.5px; color:'), '角标运行状态字号至少与宿主侧栏一致')
  assert.ok(source.includes('/api/balance'), '余额应从伴侣 API 拉取，显示在左下角')
  assert.ok(source.includes('isOffPeakNow') && source.includes('闲时') && source.includes('高峰'), '缺峰谷文案')
  assert.ok(source.includes('renderBadge(container, state, stats, balanceInfo)'), '余额需参与角标渲染')
  assert.ok(!source.includes('pet-emoji'), '旧 emoji 角标应已移除')
  // 面板大窗：52px 深色标题栏 + 1280×920 上限 + 设计稿图标
  for (const cls of ['pm-icon', 'pm-title', 'pm-sub', 'pm-live', 'pm-close']) {
    assert.ok(source.includes('.' + cls), '面板大窗缺样式 ' + cls)
  }
  assert.ok(source.includes('min(1280px, 96vw)'), '面板宽度按设计稿 1280 上限')
  assert.ok(source.includes('min(920px, 90vh)'), '面板高度按设计稿 920 上限')
  assert.ok(source.includes('panel-live'), '标题栏应显示本地服务连接状态')
  assert.ok(source.includes('统计面板'), '标题栏副标题')
  // 2026-10-30：标题栏字号放大（全屏功能已按用户要求撤回）。
  assert.ok(source.includes('font-size: 15px; font-weight: 600'), '大窗标题字号已放大')
  assert.ok(source.includes('font-size: 11px; letter-spacing: .10em'), '大窗副标题字号已对齐')
  assert.ok(!source.includes('pm-full'), '全屏按钮已撤回')
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

test('客户端推理等级：接管官方「推理等级」行 + 官方 selectModel RPC', async () => {
  const source = await readFile(new URL('../dist/client/index.js', import.meta.url), 'utf8')
  assert.ok(source.includes('mountReasoningControl'), '缺推理等级面板挂载')
  assert.ok(source.includes('reasoning-panel'), '面板需要 data-dsh-part 语义属性')
  assert.ok(source.includes('sessions.selectModel'), '必须走官方 session.selectModel RPC')
  assert.ok(source.includes('reasoningEffort'), '写入字段必须是 reasoningEffort')
  assert.ok(source.includes('sessions.models'), '档位能力必须从宿主导出，不能自造')
  // 当前宿主（0.2.x）走 modelDirectories.directoryFor/load/select；旧宿主才退回
  // connection.api.sessions 的 models/selectModel，两条路径都保留。
  assert.ok(source.includes('modelDirectories'), '缺当前宿主的 modelDirectories 服务')
  assert.ok(source.includes('directoryFor'), '缺 directoryFor 取会话模型目录')
  assert.ok(source.includes('directory.select('), '缺 directory.select 写入档位')
  assert.ok(source.includes('subagentAddress'), '子代理会话应让路给宿主原生逻辑')
  assert.ok(source.includes('uiSession'), '当前会话 id 必须读 uiSession.current（0.2.x）')
  assert.ok(source.includes('binding?.key'), 'uiSession.current.value.key 才是会话 id')
  assert.ok(source.includes('sessions.list'), '保留旧宿主 sessions.list.current 回退')
  // 只接管官方菜单里的 effort 行，不替换模型选择器、不改宿主文件。
  for (const label of ['推理等级', 'Effort']) {
    assert.ok(source.includes(label), '缺少宿主菜单行识别文案 ' + label)
  }
  assert.ok(source.includes("closest('[role=\"menuitem\"]')"), '用官方菜单项语义定位')
  assert.ok(source.includes("closest('[role=\"menu\"]')"), '用官方菜单语义定位')
  assert.ok(source.includes('aria-valuenow'), '声呐条要表达当前档位')
  assert.ok(source.includes('cr-gauge'), '缺声呐深度计结构')
  assert.ok(source.includes('cr-water'), '缺声呐水柱')
  assert.ok(source.includes('border-radius: 999px'), '声呐水柱按用户要求胶囊化')
  assert.ok(source.includes('top: 14px; height: 20px'), '胶囊水柱应足够厚（20px）')
  assert.ok(source.includes('cr-sonar'), '缺声呐面板样式')
  assert.ok(source.includes("'slider'"), '声呐条用 slider 语义')
  // 设计稿 02 的入口：点输入栏档位小字；popover 悬在整条输入栏上方。
  assert.ok(source.includes('triggerEffort'), '缺宿主档位小字入口')
  assert.ok(source.includes('data-composer-seat'), '缺输入栏容器锚点')
  assert.ok(source.includes('placeAbove'), '声呐面板需要悬在输入栏上方')
  assert.ok(!source.includes('conversation.input.model'), '不应替换官方模型选择器座位')
})
