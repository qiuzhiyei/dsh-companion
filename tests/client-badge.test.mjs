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

test('对话搜索：Ctrl+F 浮层、全量文本索引、点击滚动', async () => {
  const source = await readFile(new URL('../dist/client/index.js', import.meta.url), 'utf8')
  assert.ok(source.includes('data-conversation-scroll'), '必须定位 DSH 对话滚动区')
  assert.ok(source.includes('conversation-search'), '搜索浮层缺少可识别标记')
  assert.ok(source.includes('ev.ctrlKey || ev.metaKey'), 'Ctrl+F / Cmd+F 双平台支持')
  assert.ok(source.includes("ev.key.toLowerCase()"), '必须识别 F 键')
  assert.ok(source.includes('preventDefault()'), '必须阻止浏览器默认查找')
  assert.ok(source.includes('data-composer-seat'), '搜索不能把输入框/composer 算进去')
  assert.ok(source.includes('CSS'), '需要 CSS Custom Highlight 高亮')
  assert.ok(source.includes('scrollTo('), '点击结果必须滚动到命中位置')
  assert.ok(source.includes('dsh-companion-find'), '缺少全局高亮标记')
  assert.ok(source.includes('已加载的消息'), '搜索范围要明确是已加载对话')
  assert.ok(source.includes('width: min(300px'), '搜索浮层应收窄，避免占用过宽')
  assert.ok(source.includes('at - 3') && source.includes('at + length + 3'), '结果片段只保留命中前后各 3 个字符')
  assert.ok(source.includes('dsh-companion:search-color'), '搜索高亮颜色应接收面板设置')
  assert.ok(source.includes('dsh-companion:search-results'), '候选开关/数量应接收面板设置')
  assert.ok(source.includes('postMessage('), '搜索设置应通过 postMessage 从面板下发')
  assert.ok(source.includes('dsh-companion.find-results'), '候选设置需要持久化')
  assert.ok(source.includes('DEFAULT_SEARCH_RESULT_LIMIT = 3'), '候选默认数量应为 3')
  assert.ok(source.includes('showResultList'), '候选列表应支持隐藏')
  assert.ok(source.includes('resultLimit'), '候选列表应支持 1-10 个')
  assert.ok(source.includes('dsh-companion.find-color'), '高亮颜色需要持久化')
  assert.ok(source.includes('data-dsh-companion-find-color'), '高亮颜色应有独立样式')
  assert.ok(source.includes('conversation.session.header.utilities'), '缺对话标题栏搜索按钮槽位')
  assert.ok(source.includes('data-dsh-companion-find-button'), '缺标题栏搜索按钮标记')
  assert.ok(source.includes('data-dsh-companion-history'), '缺独立历史对话搜索页')
  assert.ok(source.includes('sidebar.panellist'), '历史搜索应注册到左侧栏全局面板入口')
  assert.ok(source.includes('id: panelId') && source.includes("name: 'main'"), '历史搜索需要侧栏入口和对应主面板')
  assert.ok(source.includes('历史搜索'), '历史搜索入口文案缺失')
  assert.ok(source.includes('/api/history-search'), '历史对话搜索必须走独立接口')
  assert.ok(source.includes('/api/history-turn'), '轮次解析应延迟到点击消息时')
  assert.ok(source.includes('localSessions'), '标题匹配应在客户端本地即时完成')
  assert.ok(source.includes('--dhs-mark'), '历史搜索片段应复用共享高亮颜色')
  assert.ok(source.includes('applyHistoryColor') && source.includes('dsh-companion:search-color'), '历史搜索应跟随面板颜色设置')
  assert.ok(source.includes('highlightQueryInConversation'), '历史搜索打开会话后应高亮命中的搜索内容')
  assert.ok(source.includes('搜索历史对话'), '历史搜索页文案缺失')
  assert.ok(source.includes("['all', '全部']") && source.includes("['messages', '消息']") && source.includes("['sessions', '对话']"), '历史搜索需要全部/消息/对话分组')
  assert.ok(source.includes('aria-keyshortcuts'), '搜索按钮需声明快捷键')
  assert.ok(source.includes('order: -100'), '搜索按钮应排在右上角控件组最左边')
  assert.ok(source.includes('搜索当前会话 (Ctrl+F)'), '搜索按钮需明确只搜当前会话')
  assert.ok(source.includes("ctx.get('shortcuts')"), '快捷键必须走宿主 shortcuts 服务')
  assert.ok(source.includes('shortcuts.register('), '缺官方快捷键注册')
  assert.ok(source.includes("id: 'companion.conversation.search'"), '快捷键应有稳定 id')
  assert.ok(source.includes('KeyF'), '快捷键默认键位应为 F')
  assert.ok(source.includes('search conversation'), '快捷键需要可搜索别名')
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
  assert.ok(source.includes('state.holidays'), '峰谷需要 /api/state 下发节假日日历')
  assert.ok(source.includes('isOffPeakNow(state.holidays)'), '峰谷必须用当前节假日日历判断')
  assert.ok(source.includes('法定节假日'), '角标峰谷说明要覆盖法定节假日')
  assert.ok(source.includes('isOffPeakNow') && source.includes('闲时') && source.includes('高峰'), '缺峰谷文案')
  assert.ok(source.includes('renderBadge(container, state, stats, balanceInfo)'), '余额需参与角标渲染')
  assert.ok(source.includes('state.tasks') && source.includes('个任务运行中'), '角标应聚合显示运行任务数')
  assert.ok(source.includes('今日 ${fmtTokens(today)} token'), '角标主行应固定显示今日总量')
  assert.ok(source.includes('taskPhaseText') || source.includes("p === 'tool' ? '执行工具'"), '角标 tooltip 应显示任务阶段')
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
