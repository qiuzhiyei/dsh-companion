/**
 * 面板页（dist/ui/pages.js panelPageHTML）契约。
 *
 * 视觉契约 = 01-设计稿/DSH-伴侣三方向视觉提案「深海终端 v1.3」：
 * 左侧 rail、页头、任务/统计/会话/设置四页、任务详情抽屉、底部状态栏。
 * 这里锁住结构锚点、数据端点与关键交互，防止后续改动把设计稿的骨架改回去。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { panelPageHTML } from '../dist/ui/pages.js'

test('面板页：深海终端骨架（rail / 页头 / 状态栏 / 详情抽屉）', () => {
  const html = panelPageHTML()
  // 四页签 + 外壳
  for (const tab of ['tasks', 'stats', 'sessions', 'settings']) {
    assert.ok(html.includes('data-tab="' + tab + '"'), '缺导航页签 ' + tab)
    assert.ok(html.includes('id="pane-' + tab + '"'), '缺页面 pane ' + tab)
  }
  for (const id of [
    'head-title', 'head-sub', 'histExport', 'btnRefresh',
    'taskDrawer', 'drawerScrim', 'drawerBody', 'drawerClose', 'drawerCopy', 'drawerSession',
    'stDot', 'stText', 'stAdapter', 'stServer', 'stDemo', 'stTime', 'liveStale',
  ]) {
    assert.ok(html.includes('id="' + id + '"'), '缺 DOM 锚点 ' + id)
  }
  assert.ok(!html.includes('railBalance') && !html.includes('railPeriod'), '余额/峰谷已迁到 DSH 左下角角标，不在面板 rail')
  // 设计稿布局：rail + main + status bar；抽屉覆盖在主区上方
  for (const sel of ['.win{', '.win-body', '.rail{', '.page-head{', '.page-body{', '.win-status{', '.drawer{', '.drawer-scrim']) {
    assert.ok(html.includes(sel), '缺布局样式 ' + sel)
  }
  assert.ok(html.includes('@container (min-width:760px)'), '宽抽屉应走容器查询分两栏')
  assert.ok(html.includes('aria-modal="true"'), '详情抽屉要有对话框语义')
  // 深海终端色板（设计稿 05）
  for (const token of ['--bg:#050d12', '--win:#07141c', '--surface:#0b1b24', '--cyan:#46e5c3', '--line:rgba(126,197,214,.13)', '--r-card:14px']) {
    assert.ok(html.includes(token), '缺设计令牌 ' + token)
  }
  // 不再有旧的“顶栏+胶囊页签”结构，也没有面板里误用的 stopRoam（旧代码从悬浮页拷过来的死引用）
  assert.ok(!html.includes('class="topbar"'), '旧吸顶顶栏应已被 rail 取代')
  assert.ok(!html.includes('stopRoam'), '面板不应引用悬浮页的 stopRoam')
})

test('任务页：筛选 / 实时任务行 / 七列表格 / 分页 / 详情抽屉', () => {
  const html = panelPageHTML()
  for (const id of [
    'histModel', 'histStatus', 'histRange', 'histFrom', 'histTo', 'histQ', 'histReset',
    'customRange', 'liveTask', 'liveName', 'liveMeta', 'liveBudget', 'livePct',
    'historyBody', 'pager', 'pageInfo', 'taskCount',
  ]) {
    assert.ok(html.includes('id="' + id + '"'), '缺任务页锚点 ' + id)
  }
  // 日期预设：今天 / 近 7 天（默认）/ 近 30 天 / 全部 / 自定义
  assert.ok(html.includes('<option value="7d" selected>'), '默认应是近 7 天（设计稿）')
  for (const v of ['today', '30d', 'all', 'custom']) {
    assert.ok(html.includes('<option value="' + v + '">'), '缺日期预设 ' + v)
  }
  // 状态筛选保留 blocked / max-tokens（旧口径不能丢）
  for (const st of ['success', 'failed', 'interrupted', 'blocked', 'max-tokens']) {
    assert.ok(html.includes('<option value="' + st + '">'), '缺状态选项 ' + st)
  }
  // 设计稿七列：开始时间/任务、模型、状态、时长、Token、费用、工具调用
  for (const col of ['开始时间 / 任务', '模型', '状态', '时长', 'Token', '费用', '工具调用']) {
    assert.ok(html.includes('>' + col + '<'), '缺表头 ' + col)
  }
  assert.ok(html.includes('colspan="7"'), '空态/错误态应是 7 列')
  // 骨架屏 + 自动分页（按可用高度 3..12 行）
  assert.ok(html.includes('paintHistorySkeleton'), '缺历史骨架屏')
  assert.ok(html.includes('PAGE_MIN') && html.includes('PAGE_MAX'), '分页行数应有上下界')
  assert.ok(html.includes('function syncPageSize'), '缺按视口调整每页行数')
  // 详情抽屉：打开 / 关闭 / 复制 ID
  assert.ok(html.includes('function openDrawer'), '缺详情抽屉打开逻辑')
  assert.ok(html.includes('function closeDrawer'), '缺详情抽屉关闭逻辑')
  assert.ok(html.includes('function copyText'), '缺复制任务/会话 ID')
  assert.ok(html.includes('dw-stats') && html.includes('tok-bar'), '详情抽屉缺概览/Token 构成')
  assert.ok(html.includes('费用构成 · 官方价估算'), '详情抽屉缺费用构成（标注估算口径）')
  assert.ok(html.includes('逐次工具明细不落库'), '工具调用要说明只有计数、不要假装有明细')
  // 后端端点
  assert.ok(html.includes("fetchJSON('/api/history?'"), '历史分页端点')
  assert.ok(html.includes('/api/models'), '模型筛选候选端点')
  assert.ok(html.includes("p.set('from',") && html.includes("p.set('q',"), '导出/查询应带筛选参数')
  assert.ok(html.includes('/api/export/sessions?'), '导出端点')
  // 骨架与页头显隐：导出只在任务页出现
  assert.ok(html.includes("$('histExport').hidden = tab !== 'tasks'"), '导出按钮只应在任务页显示')
})

test('统计页：消耗/产出指标组 + 诊断 + 图表 + 余额卡 + 排行 + 告警', () => {
  const html = panelPageHTML()
  for (const id of [
    'periodSeg', 'periodNote', 'gridSpend', 'gridOutput', 'diagnosis',
    'metricSeg', 'chartTitle', 'chartNote', 'chartUnit', 'chartLegend', 'chartMax', 'chartFootTime',
    'tokenChart', 'chartTip', 'chartEmpty', 'chartSkeleton',
    'balAmount', 'balCur', 'balChip', 'balToday', 'balMonth', 'balDays', 'balUpdated', 'spark', 'sparkEmpty',
    'rankModels', 'rankProjects', 'rankModelSub', 'rankProjectSub', 'alertList', 'alertCount',
  ]) {
    assert.ok(html.includes('id="' + id + '"'), '缺统计锚点 ' + id)
  }
  // 设计稿指标分组：消耗（Token/费用/缓存）/ 产出（任务数/成功率/平均时长）
  assert.ok(html.includes('>消耗<') && html.includes('>产出<'), '指标应按消耗/产出分组')
  assert.ok(html.includes('function renderMetricGroups'), '缺指标组渲染')
  assert.ok(html.includes('function deltaHTML'), '缺环比计算')
  assert.ok(html.includes("mode === 'pt'"), '成功率/缓存命中率应用百分点差')
  // 三指标切换（Token/费用/时长）同一张 SVG 重画，不重新请求
  for (const m of ['tokens', 'cost', 'duration']) {
    assert.ok(html.includes('data-metric="' + m + '"'), '缺指标按钮 ' + m)
  }
  assert.ok(html.includes('const METRICS = {'), '图表应走指标抽象')
  assert.ok(html.includes('if (lastSeries) renderChart(lastSeries)'), '切指标只能重画缓存数据')
  assert.ok(html.includes('function renderChart'), '缺图表渲染')
  assert.ok(html.includes('activeBucketIndex'), '缺当前时段高亮')
  // SVG 没有 HTMLElement 的 hidden IDL 属性：必须 toggleAttribute，否则无数据时
  // 图表区留一大块空白、骨架屏之后图表也出不来（浅色空数据截图抓到过）。
  assert.ok(html.includes("svg.toggleAttribute('hidden'"), 'SVG 显隐必须用 toggleAttribute')
  assert.ok(!html.includes('svg.hidden ='), '不得给 SVGElement 写 .hidden（只是 expando）')
  // 诊断行（有数据才画，且带 tone）
  assert.ok(html.includes('diag-row tone-'), '缺诊断行样式/结构')
  assert.ok(html.includes('单任务成本'), '缺成本诊断')
  assert.ok(html.includes('缓存命中'), '缺缓存诊断')
  // 余额卡：余额 + 今日/本月消耗 + 预计可用 + 30 天趋势
  assert.ok(html.includes('账户余额') && html.includes('预计可用'), '余额卡缺关键指标')
  assert.ok(html.includes("fetchJSON('/api/balance/summary?period=today'"), '今日余额聚合端点')
  assert.ok(html.includes("fetchJSON('/api/balance/series?days=30'"), '余额趋势端点')
  assert.ok(html.includes('function renderSpark'), '缺余额 sparkline')
  assert.ok(html.includes('function loadBalanceView'), '余额查询不应阻塞统计首屏')
  // 排行 + 告警
  assert.ok(html.includes("'/api/ranking?period='"), '排行端点')
  assert.ok(html.includes('function renderRanking'), '排行渲染')
  assert.ok(html.includes("'/api/alerts?limit=5'"), '告警记录端点')
  assert.ok(html.includes('function renderAlerts'), '告警渲染')
  assert.ok(html.includes('气泡消失后仍可回查'), '告警卡要说明可回查')
  // 隐私模式覆盖统计文本（模型/项目名）
  assert.ok(html.includes('mask(r.key)') || html.includes('mask(top.key)'), '排行/诊断名称应过隐私打码')
})

test('会话页：清单 + 多选 + 搜索排序 + 批量彻底删除', () => {
  const html = panelPageHTML()
  for (const id of [
    'smSummary', 'smBody', 'smSelAll', 'smQ', 'smSort', 'smSelArchived', 'smSelEmpty',
    'smSelNone', 'smRefresh', 'smConfirm', 'smConfirmText', 'smConfirmYes', 'smConfirmNo',
    'smDelete', 'smDeleteBottom', 'bulkBar', 'bulkCount', 'bulkSize', 'smCancelSel', 'sel-count',
  ]) {
    assert.ok(html.includes('id="' + id + '"'), '缺会话锚点 ' + id)
  }
  assert.ok(html.includes('<ul class="session-list" id="smBody">'), '会话清单应是卡片式 ul（设计稿）')
  assert.ok(html.includes('class="session'), '缺会话卡片样式')
  assert.ok(html.includes('function loadSessions'), '缺会话加载')
  assert.ok(html.includes('function renderSessions'), '缺会话渲染')
  assert.ok(html.includes("sortBy === 'size'") && html.includes("sortBy === 'msg'"), '排序分支')
  assert.ok(html.includes("fetchJSON('/api/dsh-sessions'"), '列表端点')
  assert.ok(html.includes('/api/dsh-sessions/delete-many'), '批量删除端点')
  assert.ok(html.includes('不可恢复'), '确认条必须明示不可恢复')
  assert.ok(html.includes('esc(mask(s.title))'), '会话标题必须走隐私打码')
  assert.ok(html.includes('esc(mask(s.workspaceTitle))'), '工作区名必须走隐私打码')
  // 读不到注册表时不能留白：给出可解释的空态
  assert.ok(html.includes('smErrorText'), '错误态文案')
  assert.ok(html.includes('读不到会话清单'), '错误空态标题')
  // 面板页隐藏惯例 = hidden 属性（不是悬浮页的 .hidden 类）
  assert.ok(html.includes('id="bulkBar" hidden'), '批量浮条初始应 hidden')
  assert.ok(html.includes('id="smConfirm" hidden'), '确认条初始应 hidden')
  assert.ok(html.includes('[hidden]{display:none !important}'), 'hidden 属性必须有全局隐藏规则')
})

test('设置页：五组 + 即时生效 + 官方价 + 数据保留 + 本插件快捷键', () => {
  const html = panelPageHTML()
  for (const g of ['pet', 'remind', 'bill', 'data', 'keys']) {
    assert.ok(html.includes('data-group="' + g + '"'), '缺分组按钮 ' + g)
    assert.ok(html.includes('data-pane="' + g + '"'), '缺分组面板 ' + g)
  }
  assert.ok(html.includes('id="shortcut-bar"') && html.includes('id="shortcutSearchKey"'), '缺本插件快捷键条')
  assert.ok(!html.includes('我的快捷键'), '快捷键页不应再出现「我的快捷键」标题')
  assert.ok(!html.includes('只显示 DSH 伴侣的快捷键'), '快捷键页不应再保留长说明')
  assert.ok(html.includes('id="card-search-color"') && html.includes('id="setSearchColor"'), '缺搜索高亮颜色设置')
  assert.ok(html.includes('id="card-search-results"') && html.includes('id="setResultsEnabled"') && html.includes('id="setResultLimit"'), '缺搜索候选开关/数量设置')
  assert.ok(html.includes('dsh-companion:search-color') && html.includes('dsh-companion:search-results'), '搜索设置应下发到搜索浮层')
  assert.ok(html.includes('postMessage('), '搜索设置应通过 postMessage 下发')
  assert.ok(html.includes('<option value="10">10</option>'), '候选数量上限应为 10')
  assert.ok(html.includes('搜索当前会话'), '快捷键条缺搜索命令')
  assert.ok(html.includes('Ctrl+F'), '快捷键条缺默认键位')
  // 长说明收进 ⓘ 的 data-tip
  assert.ok(html.includes('class="info"'), '卡头应有 ⓘ 按钮')
  assert.ok(html.includes('data-tip="'), 'ⓘ 应带 data-tip 说明')
  // 设计稿的 aria-checked 开关（不是旧 checkbox + track）
  assert.ok(html.includes('role="switch"') && html.includes('aria-checked'), '开关应有 switch 语义')
  assert.ok(html.includes('function bindSwitch'), '缺开关接线')
  // 外观 / 行为
  for (const id of [
    'card-appearance', 'card-behavior', 'setSkin', 'skinPreview', 'setOpacity', 'setOpacityVal',
    'setScale', 'setScaleVal', 'setUiScale', 'setUiScaleVal', 'setShowPet', 'setPurePet', 'setRoam',
    'setClickThrough', 'setPrivacy', 'setAutoStart', 'setNotify',
  ]) {
    assert.ok(html.includes('id="' + id + '"'), '缺设置锚点 ' + id)
  }
  assert.ok(html.includes('桌面悬浮窗口（立即生效）'), '显示伴侣改为即时生效的文案')
  // 行为卡不再套「高级设置」折叠层：四个开关直接平铺。
  assert.ok(!html.includes('class="adv"'), '行为卡不应再有 details.adv 折叠层')
  assert.ok(!html.includes('高级设置（点击穿透'), '不应再有高级设置 summary')
  // 面板字号：所有 font-size 乘 --ui-scale；设置页有 90–110% 滑杆并即时应用。
  assert.ok(html.includes('min="90" max="110"'), '界面字号滑杆范围')
  assert.ok(html.includes('function applyUiScale'), '缺字号应用函数')
  assert.ok(html.includes("setProperty('--ui-scale'"), '字号应写到 --ui-scale')
  assert.ok(html.includes('--ui-scale:1'), '缺字号变量默认值')
  assert.ok(html.includes('font-size:calc(') && html.includes('var(--ui-scale, 1)'), 'font-size 应乘 --ui-scale')
  assert.ok(!/calc\((?:[0-9](?:\.\d+)?|10(?:\.\d+)?)px \* var\(--ui-scale/.test(html), '面板标签基准字号不低于 11px（100% 下与宿主侧栏同级）')
  assert.ok(html.includes('只影响面板文字'), '字号说明应写清作用范围')
  assert.ok(html.includes("put({ roam:"), '自由活动开关必须 PUT 到后端 settings')
  assert.ok(!html.includes("localStorage.setItem('pet.roam'"), '面板不得写 localStorage（跨分区不可见）')
  // 久坐提醒
  for (const id of ['card-rest', 'setRestEnabled', 'setRestMinutes', 'restPresets']) {
    assert.ok(html.includes('id="' + id + '"'), '缺久坐锚点 ' + id)
  }
  assert.ok(html.includes('久坐提醒'), '久坐卡片文案')
  assert.ok(html.includes('起来走走或离开电脑会自动重算'), '久坐说明应写清自动重算口径')
  assert.ok(html.includes('put({ restReminder:'), '久坐改动应即时 PUT')
  assert.ok(!html.includes('气泡预览') && !html.includes('坐了好久啦'), '设置页不应再有静态气泡预览')
  assert.ok(!html.includes('preview-bubble'), '静态预览样式应删除')
  assert.ok(!html.includes('右键菜单'), '面板文案不应再提已删除的右键菜单')
  // 计费
  for (const id of [
    'card-budget', 'budgetUsage', 'budgetBarFill', 'budgetText', 'setTaskTokens', 'setTaskCost',
    'setDailyTokens', 'setDailyCost', 'card-balance', 'setBalanceEnabled', 'setBalanceInterval',
    'setBalanceLow', 'card-pricing', 'currencySeg', 'officialBox', 'officialRows', 'btnSyncPricing',
  ]) {
    assert.ok(html.includes('id="' + id + '"'), '缺计费锚点 ' + id)
  }
  assert.ok(html.includes('function renderBudgetUsage'), '缺预算进度')
  assert.ok(html.includes("fetch('/api/stats?period=today')"), '预算进度必须按今日口径取数')
  assert.ok(html.includes('/api/pricing/refresh'), '缺手动同步官方价')
  assert.ok(html.includes('空闲价为高峰价的一半'), '价格表应说明闲时口径')
  assert.ok(html.includes('9:00–12:00') && html.includes('14:00–18:00'), '官方峰谷区间必须写对')
  assert.ok(html.includes('法定节假日'), '必须说明法定节假日全天闲时')
  assert.ok(!html.includes('UTC 16:30–00:30'), '旧版 UTC 峰谷口径必须移除')
  assert.ok(html.includes('id="btnSyncHolidays"'), '缺节假日同步按钮')
  assert.ok(html.includes('/api/holidays/sync'), '节假日同步按钮必须打后端接口')
  assert.ok(html.includes('setInterval(() => {') && html.includes('renderOfficialRows()'), '峰谷必须在时段边界自动重算')
  assert.ok(html.includes('function putBalance'), '余额设置应整体提交（enabled/interval/lowBalance 三件套）')
  assert.ok(html.includes('id="setBalanceLow"'), '余额低告警阈值输入框')
  // 数据：导出 / 暂停 / 保留 / 模拟
  for (const id of [
    'card-ops', 'btnPauseToggle', 'btnExportCsv', 'btnExportJson', 'card-retention',
    'setRetentionMonths', 'retentionInfo', 'btnPruneNow', 'retentionConfirm', 'retentionConfirmText',
    'retentionCancel', 'retentionConfirmYes', 'mockFieldset', 'mockScenario', 'mockStart',
  ]) {
    assert.ok(html.includes('id="' + id + '"'), '缺数据锚点 ' + id)
  }
  assert.ok(html.includes('id="retentionConfirm" hidden'), '确认条初始必须用 hidden 属性')
  assert.ok(/id="retentionConfirm"[^>]*class="[^"]*\bhidden\b/.test(html) === false, '不得误用 .hidden 类')
  assert.ok(html.includes('不可恢复'), '清理确认必须明示不可恢复')
  assert.ok(html.includes('btn.disabled = true'), '永久保留应禁用清理按钮')
  assert.ok(html.includes('.act-btn:disabled'), '禁用态要有可见样式')
  assert.ok(html.includes('retSel.appendChild(opt)'), '非常规保留档位应动态补进下拉')
  assert.ok(html.includes('dropCache()') && html.includes('loadHistory(true)'), '清理后应作废缓存并重载历史')
  assert.ok(html.includes("fetch('/api/retention')"), '保留预览端点')
  assert.ok(html.includes("fetch('/api/retention/prune'"), '清理端点')
  assert.ok(html.includes('function retentionCutoffText'), '清理确认应写明截止日期')
  // 旧功能不能丢
  assert.ok(html.includes('暂停统计') && html.includes('任务 CSV') && html.includes('任务 JSON'), '旧操作卡功能')
  assert.ok(html.includes('function loadSettings'), '缺设置加载')
  assert.ok(html.includes('function renderOfficialBox'), '缺官方价状态')
  assert.ok(html.includes('function renderOfficialRows'), '缺价格表')
})

test('面板页：嵌入式脚本无模板字面量残留 + 深链防 TDZ', () => {
  const html = panelPageHTML()
  assert.ok(!html.includes('${'), 'pages.ts 嵌入 JS 只能字符串拼接，${ 说明混进了模板字面量')
  const at = html.indexOf('const initialTab')
  assert.ok(at > 0, '缺 initialTab 深链处理')
  const body = html.slice(at, at + 500)
  assert.ok(body.includes('setTimeout'), '深链点击必须用 setTimeout 推到脚本收尾之后')
  assert.ok(html.includes('深链'), '该处应有解释性注释，避免后人改回同步点击')
  assert.ok(html.includes('function loadSessions'), 'loadSessions 应存在')
  // 骨架屏延迟出现 + 自定义 tooltip（不用原生 title）
  for (const key of ['history', 'stats', 'sessions']) {
    assert.ok(html.includes("skLater('" + key + "'"), '缺 ' + key + ' 骨架屏')
  }
  assert.ok(html.includes('function fetchJSON') && html.includes('RESP_CACHE_MS'), '页签响应缓存 + 失效')
  assert.ok(html.includes('chart-tip.show'), '图表 tooltip 需要显示态样式')
  assert.ok(html.includes('function dropCache'), '缓存失效函数')
  assert.ok(html.includes('es.onerror'), 'SSE 断开应可感知')
})

test('面板页：跟随系统深浅色 + 设计变量', () => {
  const html = panelPageHTML()
  assert.ok(html.includes('color-scheme: dark'), '深色为默认主题')
  assert.ok(html.includes('@media (prefers-color-scheme: light)'), '缺浅色主题媒体块')
  assert.ok(html.includes('color-scheme: light'), '浅色块须声明 color-scheme: light')
  // 图表 SVG 用色走 CSS 变量（浅色块换值）
  for (const v of ['--chart-grid', '--chart-axis', '--chart-bar', '--chart-now']) {
    assert.ok(html.includes(v + ':'), '缺图表变量定义 ' + v)
    assert.ok(html.includes('var(' + v + ')'), '图表未引用变量 ' + v)
  }
  const light = html.slice(html.indexOf('@media (prefers-color-scheme: light)'))
  for (const sel of ['.drawer{', '.metric-card', '.status.ok', '.official-box', '.save-toast']) {
    assert.ok(light.includes(sel), '浅色块缺覆盖 ' + sel)
  }
  assert.ok(html.includes('prefers-reduced-motion'), '应尊重系统减少动态效果')
  // 数值统一 tabular-nums
  assert.ok(html.includes('font-variant-numeric:tabular-nums'), '数字应等宽对齐')
})
