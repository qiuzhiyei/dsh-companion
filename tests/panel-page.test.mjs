/**
 * 面板页（dist/ui/pages.js panelPageHTML）会话管理页签契约。
 *
 * pages.ts 的嵌入式 JS 只能字符串拼接（整页在一个 TS 模板字面量里），
 * 这里锁住：产物不得出现 ${ 残留；会话页签的关键 DOM 锚点与 API 端点齐全。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { panelPageHTML } from '../dist/ui/pages.js'

test('面板页：会话管理页签结构与端点齐全', () => {
  const html = panelPageHTML()
  // 页签与骨架
  assert.ok(html.includes('data-tab="sessions"'), '导航页签')
  assert.ok(html.includes('<section id="tab-sessions">'), '会话 section')
  for (const id of ['smSummary', 'smBody', 'smSelAll', 'smSelArchived', 'smSelEmpty', 'smConfirm', 'smConfirmYes', 'smDelete']) {
    assert.ok(html.includes('id="' + id + '"'), '缺少 DOM 锚点 ' + id)
  }
  // API 端点
  assert.ok(html.includes("fetchJSON('/api/dsh-sessions'"), '列表端点')
  assert.ok(html.includes('/api/dsh-sessions/delete-many'), '批量删除端点')
  // 会话搜索/排序（纯前端过滤内存清单，不打网络）
  for (const id of ['smQ', 'smSort']) {
    assert.ok(html.includes('id="' + id + '"'), '缺少会话搜索/排序控件 ' + id)
  }
  assert.ok(html.includes("sortBy === 'size'") && html.includes("sortBy === 'msg'"), '排序分支')
  // 危险语义：不可恢复警告必须在页面里
  assert.ok(html.includes('不可恢复'), '确认条必须明示不可恢复')
  // 隐私模式覆盖会话清单（用户明确要求）：标题/工作区必须走 mask()
  assert.ok(html.includes('esc(mask(s.title))'), '会话标题必须走隐私打码')
  assert.ok(html.includes('esc(mask(s.workspaceTitle))'), '工作区名必须走隐私打码')
})

test('面板页：嵌入式脚本无模板字面量残留', () => {
  const html = panelPageHTML()
  assert.ok(!html.includes('${'), 'pages.ts 嵌入 JS 只能字符串拼接，${ 说明混进了模板字面量')
  assert.ok(html.includes('function loadSessions'), 'loadSessions 应存在')
})

test('面板页：深链（?tab=）必须推迟到脚本收尾再点', () => {
  const html = panelPageHTML()
  // 真实事故：/panel?tab=stats 在脚本中段就 b.click()，loadStats 第一行读 currentPeriod
  // （后面才用 let 声明）→ TDZ ReferenceError 被 catch 吞掉，页面只剩空白 KPI 区。
  const at = html.indexOf('const initialTab')
  assert.ok(at > 0, '缺 initialTab 深链处理')
  const body = html.slice(at, at + 400)
  assert.ok(body.includes('setTimeout'), '深链点击必须用 setTimeout 推到脚本收尾之后')
  assert.ok(!/if \(initialTab\) \{ const b = [^}]*b\.click\(\) \}/.test(body), '不能同步 b.click()（会撞 TDZ）')
  assert.ok(html.includes('深链'), '该处应有解释性注释，避免后人改回同步点击')
})

test('面板页：设置分组 + ⓘ 说明 + 统计指标切换', () => {
  const html = panelPageHTML()
  // 设置页左栏分组（伴侣/提醒/计费/数据），每组一个 pane
  for (const g of ['pet', 'remind', 'bill', 'data']) {
    assert.ok(html.includes('data-group="' + g + '"'), '缺分组按钮 ' + g)
    assert.ok(html.includes('data-pane="' + g + '"'), '缺分组面板 ' + g)
  }
  // 长说明收进 ⓘ 的 data-tip，卡面只留短句
  assert.ok(html.includes('class="info"'), '卡头应有 ⓘ 按钮')
  assert.ok(html.includes('data-tip="'), 'ⓘ 应带 data-tip 说明')
  // 分组后设置项 id 不能丢（群控/测试都按 id 抓）
  for (const id of ['card-appearance', 'card-rest', 'card-budget', 'card-currency', 'card-pricing', 'card-ops', 'setSkin', 'setShowPet', 'setPurePet', 'setClickThrough', 'setRestMinutes', 'setRestEnabled', 'restPresets', 'setTaskTokens', 'setDailyCost', 'currencySeg', 'btnExportCsv']) {
    assert.ok(html.includes('id="' + id + '"'), '缺设置锚点 ' + id)
  }
  // 统计图三指标切换：Token / 费用 / 时长，同一张 SVG 重画
  assert.ok(html.includes('id="metricSeg"'), '缺指标分段控件')
  for (const m of ['tokens', 'cost', 'duration']) {
    assert.ok(html.includes('data-metric="' + m + '"'), '缺指标按钮 ' + m)
  }
  assert.ok(html.includes('const METRICS = {'), '图表应走指标抽象')
  assert.ok(html.includes("$('chartTitle')"), '图表标题应随指标切换')
  assert.ok(html.includes("$('chartNote')"), '峰值结论行应随指标切换')
  // 粘性顶栏（毛玻璃）+ 表头让位
  assert.ok(html.includes('class="topbar"'), '头部与页签应包在吸顶 .topbar 里')
  assert.ok(html.includes('backdrop-filter'), '顶栏应有毛玻璃')
  assert.ok(html.includes('top: var(--topbar-h, 0px)'), '表头 sticky 应让位吸顶顶栏')
  assert.ok(html.includes('--topbar-h'), '顶栏高度应写进 CSS 变量')
  // 骨架屏（延迟出现）+ 图表自定义 tooltip
  assert.ok(html.includes('id="chartSkeleton"'), '缺图表骨架屏')
  assert.ok(html.includes('id="chartTip"'), '缺图表自定义 tooltip')
  assert.ok(html.includes("skLater('history'"), '历史页应有骨架屏')
  assert.ok(html.includes("skLater('stats'"), '统计页应有骨架屏')
  assert.ok(html.includes("skLater('sessions'"), '会话页应有骨架屏')
  assert.ok(html.includes('chart-tip.show'), 'tooltip 需要显示态样式')
  // 筛选芯片化：搜索常驻 + 已选条件胶囊 + ＋筛选 弹层（底层 select/date 仍在，群控按 id 抓）
  assert.ok(html.includes('id="histChips"'), '缺筛选芯片容器')
  assert.ok(html.includes('id="histFilterPop"'), '缺筛选弹层')
  assert.ok(html.includes('function renderHistChips'), '筛选芯片应有渲染函数')
  assert.ok(html.includes('id="histReset"'), '清除全部筛选按钮应保留')
  // 会话批量浮动操作条
  assert.ok(html.includes('id="bulkBar"'), '缺会话批量浮条')
  assert.ok(html.includes('id="smCancelSel"'), '浮条应有取消选择')
  assert.ok(html.includes('id="smConfirm"'), '二次确认条应保留')
  // KPI 数字分级 + 空态插画
  assert.ok(html.includes('kpi-unit'), 'KPI 数值应有单位分级样式')
  assert.ok(html.includes('kpi-value.long'), '超长数值应降档')
  assert.ok(html.includes('EMPTY_ART'), '空态应有插画常量')
  assert.ok(html.includes('.empty-art'), '空态插画应有样式')
  // 环比（KPI delta）+ 成本排行 + 导出筛选 + 预算进度 + 离线徽标 + 通知开关
  assert.ok(html.includes('.kpi-delta'), '环比徽标应有样式')
  assert.ok(html.includes('function deltaHTML'), '环比计算函数应存在')
  assert.ok(html.includes('/api/stats?period=') && html.includes('previous'), '统计页应读上一周期做环比')
  assert.ok(html.includes("fetchJSON('/api/ranking?period='") || html.includes("'/api/ranking?period='"), '排名端点')
  assert.ok(html.includes('id="rankModels"') && html.includes('id="rankProjects"'), '成本排行两栏')
  assert.ok(html.includes('id="histExport"'), '历史页应能导出当前筛选结果')
  assert.ok(html.includes("p.set('from',") && html.includes("p.set('q',"), '导出应带上筛选参数')
  assert.ok(html.includes('id="budgetUsage"') && html.includes('id="budgetBarFill"'), '预算进度条')
  assert.ok(html.includes('function renderBudgetUsage'), '预算进度渲染函数')
  assert.ok(html.includes('id="liveStale"'), 'SSE 断线徽标')
  assert.ok(html.includes('es.onerror'), 'SSE 断开应可感知')
  assert.ok(html.includes('id="setNotify"'), '系统通知开关')
  assert.ok(html.includes('function dropCache') && html.includes('RESP_CACHE_MS'), '页签响应缓存 + 失效')
  assert.ok(html.includes('id="histRefresh"') && html.includes('id="statsRefresh"'), '手动刷新入口')
})

test('面板页：跟随系统深浅色（深色默认 + 浅色媒体覆盖 + 图表变量）', () => {
  const html = panelPageHTML()
  // 深色默认，浅色跟随系统
  assert.ok(html.includes(':root { color-scheme: dark;'), '深色为默认主题')
  assert.ok(html.includes('@media (prefers-color-scheme: light)'), '缺浅色主题媒体块')
  assert.ok(html.includes('color-scheme: light'), '浅色块须声明 color-scheme: light')
  // 图表 SVG 用色走 CSS 变量（内联属性直接引用，浅色块换值）
  for (const v of ['--chart-grid', '--chart-axis', '--chart-slot', '--chart-bar-top', '--chart-now-top']) {
    assert.ok(html.includes(v + ':'), '缺图表变量定义 ' + v)
    assert.ok(html.includes('var(' + v + ')'), '图表未引用变量 ' + v)
  }
  // 浅色块应覆盖主要表面（抽查），且不得残留旧深色 body 底
  const light = html.slice(html.indexOf('@media (prefers-color-scheme: light)'))
  for (const sel of ['body { background: #f4f6f9', '.kpi, .chart-card, .set-card', 'th {', '.sm-confirm']) {
    assert.ok(light.includes(sel), '浅色块缺覆盖 ' + sel)
  }
})
