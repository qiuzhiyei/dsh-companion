/**
 * dsh-companion — GUI 客户端：侧边栏角标 + 面板大窗 + 会话行「删除会话」菜单项。
 *
 * 这是插件的“浏览器半边”：package.json 里声明 `dsh.client`（inject 为空，
 * platform web）后，宿主把本文件以 /plugins/dsh-companion/client.js 提供
 * 给 Web GUI 加载。文件用 `window.__ModuleLoader__.load` 注册，导出
 * `apply(ctx)` / `inject`（与宿主半边的 cordis 约定同构）。
 *
 * 三层结构：
 * 1. 角标（单行）：坐在侧边栏 foot 区、Settings 行上方——今日 token
 *    总量（任务中换当前任务实时 token + 呼吸点），详细数字进 tooltip；
 * 2. 面板大窗：点击角标直接打开，GUI 内全屏模态（backdrop + 大 iframe
 *    加载 /panel），Esc/点背景/× 关闭——全程不打开浏览器标签页，没有
 *    中间详情卡。
 * 3. 删除会话（UI 增强）：经 ctx.slots 官方槽位向侧栏会话行 "…" 菜单注入
 *    「删除会话…」（sidebar.workspaces.session.menu.item，order 550），
 *    确认弹窗后 POST /api/dsh-sessions/delete——node 半边做宿主 registry
 *    除名 + 软删回收站（src/ui-enhance/session-manager.ts）。宿主没有
 *    slots 服务或 require 不可用时静默降级，只剩角标/面板。
 *
 * 数据来自插件自己的 HTTP 服务（127.0.0.1:17573 起，端口自动探测 + 记忆），
 * 跨域由插件服务端的 CORS 头放行（仅回环）；服务不在时角标自动隐藏。
 * 颜色全部走 --dsw-alias-* 皮肤令牌并带回退值（DSH Web 皮肤契约），
 * 容器带 data-dsh-plugin / data-dsh-part 语义属性。
 *
 * 注意：本文件是“脚本模式”（无顶层 import/export），tsc 按全局脚本输出，
 * 这样 ModuleLoader 的 factory 包装才能直接生效。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type ClientDisposer = () => void
type ClientCtx = {
  effect: (setup: () => ClientDisposer | void) => ClientDisposer
  /** 宿主槽位服务（dsh-client-ui-slots）；旧 GUI 没有时静默降级。 */
  slots?: {
    inject(name: string, factory: () => unknown): ClientDisposer | void
    register(entry: Record<string, unknown>, component: unknown): ClientDisposer | void
  }
  /** 宿主快捷键服务（dsh-client-shortcuts）；用于把 Ctrl+F 注册进设置里的快捷键列表。 */
  shortcuts?: {
    register(command: Record<string, unknown>): ClientDisposer | void
  }
  /** 无 inject 读取宿主服务（connection / sessions）；旧 GUI 没有时返回 undefined。 */
  get?: (name: string) => unknown
}

interface LoaderEntry {
  id: string
  factory: (require: (id: string) => unknown) => Record<string, unknown>
}
type ModuleLoader = { load: (entry: LoaderEntry) => void }

const BADGE_ATTR = 'data-dsh-companion-badge'
const PANEL_ATTR = 'data-dsh-companion-panel'
const CONFIRM_ATTR = 'data-dsh-companion-delete-confirm'
const TOAST_ATTR = 'data-dsh-companion-toast'
/** 角标轮询发现过的服务地址，删除会话请求复用（空则重新发现）。 */
let cachedServerUrl = ''
let balanceInfo: BalancePayload | null = null
let balanceFetchedAt = 0
const LS_PORT_KEY = 'dsh-companion.badge-port'
const PORT_BASE = 17573
const PORT_RANGE = 10
const POLL_MS = 5000
const DISCOVER_MS = 15000

/** 工作中状态的呼吸点颜色（空闲无点）。 */
const STATE_TONE: Record<string, string> = {
  casting: '#46e5c3',
  waiting: '#46e5c3',
  hooked: '#46e5c3',
  reeling: '#f0b64a',
  done: '#46e5c3',
  error: '#ff7a7a',
  interrupted: '#f0b64a',
  blocked: '#f0b64a',
}

/** 侧栏角标里的鲸鱼背鳍标记（设计稿 04：识别元素只有背鳍与眼睛）。 */
const FIN_SVG =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
  '<path d="M2 12c2.6 0 3.6-1.4 5.1-3.4C8.7 6.3 9.8 4 12 4c1.2 0 2 .7 2 2 0 3.6-3.2 6-7 6H2Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
  '<circle cx="12.2" cy="5.6" r=".8" fill="currentColor"/></svg>'

interface TaskPayload {
  sessionId: string
  project?: string
  model: string
  provider: string
  startTime: number
  phase?: 'waiting' | 'streaming' | 'tool'
  tokens: { totalTokens: number; inputTokens: number; outputTokens: number }
}

interface PetStatePayload {
  plugin: string
  state: string
  label: string
  task: TaskPayload | null
  tasks?: TaskPayload[]
  lastResult: { status: string; durationMs: number; tokens: { totalTokens: number } } | null
  paused: boolean
  settings: { currency: string; privacyMode?: boolean }
  /** 当前生效的中国法定节假日（北京时间 YYYY-MM-DD）。 */
  holidays?: string[]
}

interface StatsPayload {
  totalTokens: number
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  cost: number
  tasks: number
  successRate: number
  toolCalls: number
  toolFail: number
}

/** `/api/balance` 的当前余额视图；未开启/未登录时只用于角标文案。 */
interface BalancePayload {
  enabled?: boolean
  ok?: boolean
  signedIn?: boolean
  currency?: string
  normal?: number
  bonus?: number
}

/**
 * 官方峰谷口径（北京时间）：周一至周五 09:00–12:00、14:00–18:00 为高峰；
 * 周末与中国法定节假日全天为闲时。holidays 由 /api/state 下发。
 */
function isOffPeakNow(holidays?: string[]): boolean {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const weekday = d.getUTCDay()
  if (weekday === 0 || weekday === 6) return true
  const p = (n: number): string => String(n).padStart(2, '0')
  const key = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
  if (Array.isArray(holidays) && holidays.includes(key)) return true
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes()
  return (
    minutes < 9 * 60 ||
    (minutes >= 12 * 60 && minutes < 14 * 60) ||
    minutes >= 18 * 60
  )
}

function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

/** 中文时长：12分34秒 / 1小时23分45秒。 */
function fmtDur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}小时${m}分${sec}秒`
  if (m > 0) return `${m}分${sec}秒`
  return `${sec}秒`
}

function fmtElapsed(from: number, now: number): string {
  return fmtDur(now - from)
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  if (cls !== '') node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

function ensureStyle(): ClientDisposer {
  const style = document.createElement('style')
  style.setAttribute('data-dsh-plugin', 'dsh-companion')
  style.textContent = [
    /* ---- 侧栏角标（设计稿 04：像一张本来就存在的卡片，而不是挂件） ---- */
    `[${BADGE_ATTR}] {`,
    '  display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: center; gap: 10px;',
    '  flex: none; margin: 4px 10px 2px; padding: 10px 11px; border-radius: 11px;',
    '  cursor: pointer; user-select: none; line-height: 1.4;',
    '  color: var(--dsw-alias-text-primary, #e8f3f6);',
    '  background: var(--dsw-alias-bg-elevated, rgba(18,32,42,.9));',
    '  border: 1px solid var(--dsw-alias-separator-primary, rgba(70,229,195,.22));',
    '  box-shadow: 0 1px 0 rgba(255,255,255,.03) inset;',
    '  transition: border-color .15s ease, background .15s ease;',
    '}',
    `[${BADGE_ATTR}]:hover {`,
    '  border-color: rgba(70,229,195,.5);',
    '  background: var(--dsw-alias-bg-hover, rgba(24,42,52,.95));',
    '}',
    `[${BADGE_ATTR}] .sb-icon {`,
    '  width: 24px; height: 24px; flex: none; display: grid; place-items: center;',
    '  border-radius: 8px; background: rgba(70,229,195,.14); color: #46e5c3;',
    '}',
    `[${BADGE_ATTR}] .sb-icon svg { display: block; }`,
    `[${BADGE_ATTR}] .sb-text { display: grid; gap: 2px; min-width: 0; }`,
    `[${BADGE_ATTR}] .sb-text b {`,
    '  font-family: "JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace;',
    '  font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
    '  color: inherit; font-variant-numeric: tabular-nums;',
    '}',
    `[${BADGE_ATTR}] .sb-text span {`,
    '  font-size: 12.5px; color: var(--dsw-alias-text-secondary, #9db4bd);',
    '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
    '}',
    `[${BADGE_ATTR}] .sb-text .sb-foot {`,
    '  display: flex; align-items: center; gap: 6px; min-width: 0; padding-top: 1px;',
    '  font-size: 12px; color: var(--dsw-alias-text-secondary, #9db4bd);',
    '}',
    `[${BADGE_ATTR}] .sb-text .sb-foot b {`,
    '  min-width: 0; overflow: hidden; text-overflow: ellipsis;',
    '  font-family: "JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace;',
    '  font-size: 12px; font-weight: 500; color: var(--dsw-alias-text-primary, #e8f3f6);',
    '  font-variant-numeric: tabular-nums;',
    '}',
    `[${BADGE_ATTR}] .sb-text .sb-period {`,
    '  display: inline-flex; align-items: center; gap: 4px; flex: none; height: 16px; padding: 0 6px;',
    '  border-radius: 999px; border: 1px solid rgba(240,182,74,.24);',
    '  background: rgba(240,182,74,.10); color: #f0b64a;',
    '  font-family: "JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace;',
    '  font-size: 10px; line-height: 1;',
    '}',
    `[${BADGE_ATTR}] .sb-period i { width: 4px; height: 4px; border-radius: 50%; background: currentColor; flex: none; }`,
    `[${BADGE_ATTR}] .sb-text .sb-period.is-off {`,
    '  color: #46e5c3; background: rgba(70,229,195,.08); border-color: rgba(70,229,195,.20);',
    '}',
    `[${BADGE_ATTR}] .sb-dot {`,
    '  width: 10px; height: 10px; border-radius: 50%; flex: none; justify-self: end; position: relative;',
    '  margin-right: 2px; background: currentColor;',
    '  animation: dsh-companion-breath 2s ease-in-out infinite;',
    '}',
    `[${BADGE_ATTR}] .sb-dot::after {`,
    '  content: ""; position: absolute; inset: -4px; border-radius: 50%;',
    '  border: 1px solid currentColor; opacity: 0; pointer-events: none;',
    '  animation: dsh-companion-halo 2s ease-out infinite;',
    '}',
    `[${BADGE_ATTR}] .sb-arrow {`,
    '  justify-self: end; color: var(--dsw-alias-text-secondary, #7d959e); font-size: 12px; line-height: 1;',
    '}',
    `@keyframes dsh-companion-breath {`,
    '  0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .62; transform: scale(.9); }',
    '}',
    `@keyframes dsh-companion-halo {`,
    '  0% { opacity: .55; transform: scale(.5); } 70%, 100% { opacity: 0; transform: scale(1.55); }',
    '}',
    '@media (prefers-reduced-motion: reduce) {',
    `  [${BADGE_ATTR}] .sb-dot, [${BADGE_ATTR}] .sb-dot::after { animation: none !important; }`,
    `  [${BADGE_ATTR}] .sb-dot::after { opacity: .25; }`,
    '}',
    /* ---- 宿主会话行：隐藏原生环形 spinner，换成纯呼吸圆点（方案 B） ---- */
    '[data-row-key^="session:"] svg[data-state="ongoing"] { visibility: hidden !important; }',
    '.dsh-companion-spinner-dot {',
    '  position: fixed; width: 24px; height: 24px;',
    '  transform: translate(-50%, -50%); border-radius: 50% !important; corner-shape: round !important;',
    '  pointer-events: none; z-index: 9999;',
    '  background: radial-gradient(circle, #46e5c3 0 38%, rgba(70,229,195,.55) 43%, rgba(70,229,195,.12) 62%, transparent 72%);',
    '}',
    /* 宿主浅色主题：角标是深色卡片的浅色变体（与面板的浅色令牌同源）。 */
    '@media (prefers-color-scheme: light) {',
    `  [${BADGE_ATTR}] {`,
    '    background: var(--dsw-alias-bg-elevated, #ffffff);',
    '    border-color: var(--dsw-alias-separator-primary, #d5dde0);',
    '    color: var(--dsw-alias-text-primary, #16232b);',
    '    box-shadow: 0 2px 8px rgba(20,40,55,.07);',
    '  }',
    `  [${BADGE_ATTR}]:hover { border-color: #9fc9c0; }`,
    `  [${BADGE_ATTR}] .sb-icon { background: rgba(20,90,80,.09); color: #0e5c4e; }`,
    `  [${BADGE_ATTR}] .sb-text span { color: var(--dsw-alias-text-secondary, #5e727a); }`,
    `  [${BADGE_ATTR}] .sb-text .sb-foot b { color: var(--dsw-alias-text-primary, #16232b); }`,
    `  [${BADGE_ATTR}] .sb-text .sb-period { color: #a86a00; background: rgba(168,106,0,.08); border-color: rgba(168,106,0,.22); }`,
    `  [${BADGE_ATTR}] .sb-text .sb-period.is-off { color: #0e8a74; background: rgba(14,138,116,.08); border-color: rgba(14,138,116,.2); }`,
    '}',
    /* ---- 完整面板大窗（设计稿窗口：52px 标题栏 + 1280×920 上限） ---- */
    `[${PANEL_ATTR}] {`,
    '  position: fixed; inset: 0; z-index: 10001; display: none;',
    '  background: rgba(2,8,11,.72); backdrop-filter: blur(2px);',
    '  align-items: center; justify-content: center; padding: 2vh 2vw;',
    '}',
    `[${PANEL_ATTR}][data-open="1"] { display: flex; }`,
    `[${PANEL_ATTR}] .pm-box {`,
    '  display: flex; flex-direction: column;',
    '  width: min(1280px, 96vw); height: min(920px, 90vh);',
    '  border-radius: 16px; overflow: hidden; background: #07141c;',
    '  border: 1px solid rgba(126,197,214,.22);',
    '  box-shadow: 0 40px 100px rgba(0,0,0,.7), 0 0 0 1px rgba(70,229,195,.04),',
    '    0 1px 0 rgba(255,255,255,.05) inset;',
    '}',
    `[${PANEL_ATTR}] .pm-head {`,
    '  height: 56px; flex: none; display: flex; align-items: center; gap: 10px;',
    '  padding: 0 12px 0 16px; background: #061119;',
    '  border-bottom: 1px solid rgba(126,197,214,.13); color: #e8f3f6;',
    '}',
    `[${PANEL_ATTR}] .pm-icon {`,
    '  width: 28px; height: 28px; flex: none; display: grid; place-items: center;',
    '  border: 1px solid rgba(70,229,195,.22); border-radius: 8px;',
    '  background: rgba(70,229,195,.10); color: #46e5c3;',
    '}',
    `[${PANEL_ATTR}] .pm-title { font-size: 15px; font-weight: 600; letter-spacing: .01em; }`,
    `[${PANEL_ATTR}] .pm-sub {`,
    '  font-family: "JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace;',
    '  font-size: 11px; letter-spacing: .10em; text-transform: uppercase; color: #4f6a74;',
    '}',
    `[${PANEL_ATTR}] .pm-spacer { flex: 1; }`,
    `[${PANEL_ATTR}] .pm-live {`,
    '  font-family: "JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace;',
    '  font-size: 11px; color: #7d959e; white-space: nowrap;',
    '}',
    `[${PANEL_ATTR}] .pm-close {`,
    '  width: 30px; height: 28px; border-radius: 6px; cursor: pointer;',
    '  display: grid; place-items: center;',
    '  color: #7d959e; background: transparent; border: none; padding: 0;',
    '}',
    `[${PANEL_ATTR}] .pm-close:hover { background: #8e2f2f; color: #fff; }`,
    `[${PANEL_ATTR}] .pm-close svg { width: 12px; height: 12px; display: block; }`,
    `[${PANEL_ATTR}] iframe.pm-frame { flex: 1; width: 100%; border: none; background: #07141c; }`,
    '@media (max-width: 760px) {',
    `  [${PANEL_ATTR}] { padding: 0; }`,
    `  [${PANEL_ATTR}] .pm-box { width: 100vw; height: 100vh; border-radius: 0; border: none; }`,
    `  [${PANEL_ATTR}] .pm-sub, [${PANEL_ATTR}] .pm-live { display: none; }`,
    '}',
    /* ---- 删除会话确认弹窗（dialog 顶层，避免被页面滚动容器带到底部） ---- */
    `[${CONFIRM_ATTR}] {`,
    '  position: fixed; inset: 0; width: 100vw; height: 100vh; max-width: none; max-height: none;',
    '  margin: 0; padding: 0; border: 0; background: transparent; z-index: 10002;',
    '  align-items: center; justify-content: center;',
    '}',
    `[${CONFIRM_ATTR}][open] { display: flex; }`,
    `[${CONFIRM_ATTR}]:not([open]) { display: none; }`,
    `[${CONFIRM_ATTR}]::backdrop { background: rgba(0,0,0,.48); }`,
    `[${CONFIRM_ATTR}] .dc-box {`,
    '  width: min(420px, 92vw); border-radius: 12px; padding: 18px 20px;',
    '  background: var(--dsw-alias-bg-base, #f4f6f8);',
    '  border: 1px solid var(--dsw-alias-separator-strong, rgba(128,128,128,.3));',
    '  box-shadow: 0 16px 48px rgba(0,0,0,.4);',
    '  color: var(--dsw-alias-text-primary, #222);',
    '}',
    `[${CONFIRM_ATTR}] .dc-title { font-size: 14px; font-weight: 600; margin-bottom: 8px; }`,
    `[${CONFIRM_ATTR}] .dc-name {`,
    '  font-size: 12px; margin-bottom: 10px; word-break: break-all;',
    '  color: var(--dsw-alias-text-secondary, #666);',
    '}',
    `[${CONFIRM_ATTR}] .dc-note {`,
    '  font-size: 12px; line-height: 1.6; margin-bottom: 14px;',
    '  color: var(--dsw-alias-text-secondary, #666);',
    '}',
    `[${CONFIRM_ATTR}] .dc-error {`,
    '  font-size: 12px; margin-bottom: 10px; display: none;',
    '  color: var(--dsw-alias-state-error-primary, #e0564f);',
    '}',
    `[${CONFIRM_ATTR}] .dc-actions { display: flex; justify-content: flex-end; gap: 8px; }`,
    `[${CONFIRM_ATTR}] button {`,
    '  font-size: 12px; padding: 6px 14px; border-radius: 8px; cursor: pointer;',
    '  border: 1px solid var(--dsw-alias-separator-strong, rgba(128,128,128,.3));',
    '  background: var(--dsw-alias-bg-elevated, rgba(128,128,128,.08));',
    '  color: var(--dsw-alias-text-primary, #222);',
    '}',
    `[${CONFIRM_ATTR}] button.dc-danger {`,
    '  background: var(--dsw-alias-state-error-primary, #e0564f);',
    '  border-color: var(--dsw-alias-state-error-primary, #e0564f);',
    '  color: #fff;',
    '}',
    `[${CONFIRM_ATTR}] button:disabled { opacity: .6; cursor: default; }`,
    /* ---- 推理等级：官方模型选择器「推理等级」行 → 能量条面板 ---- */
    '.cr-host { position: fixed; z-index: 10006; width: 322px; max-width: calc(100vw - 16px); }',
    '.cr-host[hidden] { display: none !important; }',
    '.cr-panel {',
    '  --cr-surface: var(--dsw-alias-bg-elevated, #0b1b24);',
    '  --cr-line: var(--dsw-alias-separator-strong, rgba(126,197,214,.22));',
    '  --cr-ink: var(--dsw-alias-text-primary, #e8f3f6);',
    '  --cr-muted: var(--dsw-alias-text-secondary, #9db4bd);',
    '  --cr-accent: var(--dsw-alias-accent, #46e5c3);',
    '  color: var(--cr-ink); background: var(--cr-surface);',
    '  border: 1px solid var(--cr-line); border-radius: 12px;',
    '  padding: 14px 14px 12px; box-shadow: 0 20px 50px rgba(0,0,0,.42);',
    '  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);',
    '  font-family: inherit; font-size: 12px; line-height: 1.5;',
    '}',
    '.cr-sub { margin-top: 3px; font-size: 10px; color: var(--cr-muted); line-height: 1.55; }',
    '.cr-foot { display: flex; justify-content: space-between; gap: 8px; margin-top: 10px;',
    '  padding-top: 8px; border-top: 1px solid var(--cr-line);',
    '  font-family: "JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace;',
    '  font-size: 8.5px; color: var(--cr-muted); }',
    '.cr-error { color: var(--dsw-alias-state-error-primary, #ff7a7a); }',
    '.cr-retry { margin-left: 8px; padding: 2px 8px; border: 1px solid var(--cr-line);',
    '  border-radius: 6px; background: transparent; color: var(--cr-ink); font: inherit;',
    '  font-size: 10px; cursor: pointer; }',
    '.cr-retry:hover { border-color: var(--cr-accent); color: var(--cr-accent); }',
    /* ---- 推理深度 · 声呐深度计（设计稿 02） ---- */
    '.cr-sonar { padding: 14px 16px 12px; border-radius: 16px; position: relative; }',
    '.cr-sonar::after { content: ""; position: absolute; right: 30px; bottom: -6px; width: 10px; height: 10px;',
    '  background: var(--cr-surface); border-right: 1px solid var(--cr-line); border-bottom: 1px solid var(--cr-line);',
    '  transform: rotate(45deg); }',
    '.cr-sonar[data-level="off"] { --cr-accent: #8fa0a8; --cr-accent-soft: rgba(143,160,168,.4); }',
    '.cr-sonar[data-level="low"] { --cr-accent: #37b39c; --cr-accent-soft: rgba(55,179,156,.4); }',
    '.cr-sonar[data-level="high"] { --cr-accent: #46e5c3; --cr-accent-soft: rgba(70,229,195,.45); }',
    '.cr-sonar[data-level="max"] { --cr-accent: #a78bfa; --cr-accent-soft: rgba(167,139,250,.45); }',
    '.cr-sonar-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }',
    '.cr-sonar-text { min-width: 0; }',
    '.cr-kicker { font-family: "JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace;',
    '  font-size: 8px; letter-spacing: .18em; text-transform: uppercase; color: var(--cr-muted); }',
    '.cr-tier { padding-top: 1px; font-family: "JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace;',
    '  font-size: 11px; letter-spacing: .16em; color: var(--cr-accent); white-space: nowrap; }',
    '.cr-sonar-desc { min-height: 15px; margin-top: 7px; font-size: 10.5px; color: var(--cr-muted); line-height: 1.45; }',
    '.cr-gauge { position: relative; height: 52px; margin-top: 10px; cursor: pointer;',
    '  touch-action: none; user-select: none; outline: none; }',
    '.cr-gauge:focus-visible .cr-water { box-shadow: inset 0 0 0 1px var(--cr-accent), 0 0 0 1px var(--cr-accent); }',
    '.cr-water { position: absolute; left: 0; right: 0; top: 14px; height: 20px; overflow: hidden;',
    '  border-radius: 999px; background: var(--dsw-alias-bg-hover, rgba(0,0,0,.24));',
    '  box-shadow: inset 0 1px 3px rgba(0,0,0,.35), inset 0 0 0 1px var(--cr-line), 0 0 18px var(--cr-accent-soft); }',
    '.cr-water-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; border-radius: 999px 0 0 999px;',
    '  background: linear-gradient(180deg, rgba(255,255,255,.18), transparent 48%), linear-gradient(90deg, rgba(70,229,195,.3), var(--cr-accent));',
    '  box-shadow: inset 0 1px 0 rgba(255,255,255,.22);',
    '  transition: width .3s cubic-bezier(.2,.7,.2,1), background .2s ease; }',
    '.cr-gauge.is-drag .cr-water-fill, .cr-gauge.is-drag .cr-cursor { transition: none; }',
    '.cr-water::after { content: ""; position: absolute; top: 0; bottom: 0; width: 48px;',
    '  background: linear-gradient(90deg, transparent, rgba(255,255,255,.3), transparent);',
    '  animation: cr-sweep 4.4s linear infinite; }',
    '@keyframes cr-sweep { 0% { left: -48px; } 100% { left: 100%; } }',
    '.cr-ticks { position: absolute; left: 0; right: 0; top: 14px; height: 20px; pointer-events: none; }',
    '.cr-ticks i { position: absolute; top: 0; bottom: 0; width: 1px; background: rgba(126,197,214,.14); }',
    '.cr-major { position: absolute; top: 10px; height: 28px; width: 1px;',
    '  background: var(--cr-surface); pointer-events: none; }',
    '.cr-cursor { position: absolute; top: 6px; left: 0; width: 2px; height: 36px; margin-left: -1px;',
    '  background: var(--cr-accent); box-shadow: 0 0 14px var(--cr-accent);',
    '  transition: left .3s cubic-bezier(.2,.7,.2,1), background .2s ease; }',
    '.cr-cursor::before { content: ""; position: absolute; top: -5px; left: 50%; width: 9px; height: 9px;',
    '  margin-left: -4.5px; background: var(--cr-accent); transform: rotate(45deg);',
    '  box-shadow: 0 0 14px var(--cr-accent); }',
    '.cr-cursor::after { content: ""; position: absolute; top: 25px; left: 50%; width: 6px; height: 6px;',
    '  margin-left: -3px; border-radius: 50%; background: #fff; box-shadow: 0 0 10px var(--cr-accent); }',
    '.cr-scale { position: relative; height: 14px; margin-top: 4px;',
    '  font-family: "JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace;',
    '  font-size: 8.5px; color: var(--cr-muted); }',
    '.cr-scale span { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap;',
    '  transition: color .18s ease; }',
    '.cr-scale span.on { color: var(--cr-accent); }',
    '.cr-sonar .cr-sub { margin-top: 8px; }',
    '@media (prefers-reduced-motion: reduce) {',
    '  .cr-water-fill, .cr-cursor { transition: none; }',
    '  .cr-water::after { animation: none; }',
    '}',
    /* ---- 轻量 toast ---- */
    `[${TOAST_ATTR}] {`,
    '  position: fixed; left: 50%; bottom: 40px; transform: translateX(-50%); z-index: 10003;',
    '  padding: 8px 16px; border-radius: 10px; font-size: 12px; max-width: 80vw;',
    '  background: var(--dsw-alias-bg-elevated, rgba(20,28,38,.92));',
    '  color: var(--dsw-alias-text-primary, #e8f1fa);',
    '  border: 1px solid var(--dsw-alias-separator-primary, rgba(255,255,255,.14));',
    '  box-shadow: 0 8px 24px rgba(0,0,0,.35);',
    '}',
  ].join('\n')
  document.head.appendChild(style)
  return () => style.remove()
}

function footArea(): HTMLElement | null {
  const sidebar = document.querySelector(
    '[data-pane="sidebar"], [class*="sidebarCol"]',
  )
  return sidebar?.querySelector<HTMLElement>('[class*="footArea"]') ?? null
}

/** 座位：插到 Settings 行上方；被 GUI 重渲染挤掉时由观察器重放。 */
function placeBadge(container: HTMLElement): void {
  const foot = footArea()
  if (foot === null) return
  const settings = foot.querySelector('[class*="settingsArea"]')
  if (settings !== null) {
    if (container.nextElementSibling !== settings) foot.insertBefore(container, settings)
    return
  }
  if (foot.lastElementChild !== container) foot.append(container)
}

async function probePort(port: number): Promise<PetStatePayload | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/state`, {
      signal: AbortSignal.timeout(1500),
    })
    if (!res.ok) return null
    const data = (await res.json()) as PetStatePayload
    if (data && data.plugin === 'dsh-companion') return data
    return null
  } catch {
    return null
  }
}

async function discoverServer(): Promise<{ url: string; state: PetStatePayload } | null> {
  const candidates: number[] = []
  const cached = Number(window.localStorage.getItem(LS_PORT_KEY))
  if (Number.isInteger(cached) && cached >= PORT_BASE) candidates.push(cached)
  for (let p = PORT_BASE; p < PORT_BASE + PORT_RANGE; p += 1) {
    if (!candidates.includes(p)) candidates.push(p)
  }
  for (const port of candidates) {
    const state = await probePort(port)
    if (state !== null) {
      window.localStorage.setItem(LS_PORT_KEY, String(port))
      return { url: `http://127.0.0.1:${port}`, state }
    }
  }
  return null
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

/* ---------- 推理等级（官方模型选择器的「推理等级」行 → 能量条面板） ---------- */

/**
 * 宿主模型选择器把「推理等级 / Effort」做成 root 菜单里的一行；点它原本会
 * drill 到宿主自带的档位 pane。这里在捕获阶段接管这一行，换成设计稿的能量条
 * 面板，写入仍走官方 `connection.api.sessions.selectModel({ reasoningEffort })`。
 *
 * 刻意不替换官方模型选择器（不占宿主单实例模型座位槽位），也不直接改宿主
 * 文件：旧宿主没有 connection/sessions 服务时静默放行，原生菜单照旧可用。
 * 做法与 dsh-adaptive-reasoning 相同的官方 RPC 路径。
 */

const REASONING_ROW_LABELS = ['推理等级', '思考强度', '推理强度', 'Effort', 'Reasoning effort', 'Thinking']
const REASONING_LEVEL_NAMES: Record<string, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

interface ReasoningState {
  sessionId: string
  /** 当前宿主走 modelDirectories；旧宿主才退回 connection.api.sessions。 */
  mode: 'directory' | 'legacy'
  models: any
  api: any
  /** directory 模式下 directoryFor() 的实例（load/select/store 都在它身上）。 */
  live: any
  rect: { left: number; top: number; right?: number }
  /** true = 锚在输入栏档位小字上方；false = 替换官方模型菜单的位置。 */
  placeAbove: boolean
  directory: any
  busy: boolean
  error: string
  token: number
  /** 当前预览档位（拖动时先行高亮，松手才写 RPC）。 */
  preview: number
  /** 渲染句柄：声呐条各部件，paint() 直接改，不重建 DOM。 */
  ui: any
}

function mountReasoningControl(ctx: ClientCtx): void {
  const getter = ctx.get
  if (typeof getter !== 'function') return
  const safeGet = (name: string): any => {
    try {
      return getter.call(ctx, name)
    } catch {
      return undefined
    }
  }

  const host = document.createElement('div')
  host.className = 'cr-host'
  host.setAttribute('data-dsh-plugin', 'dsh-companion')
  host.setAttribute('data-dsh-part', 'reasoning-panel')
  host.hidden = true
  document.body.appendChild(host)

  let state: ReasoningState | null = null

  const currentSessionId = (): string | null => {
    // 0.2.x：uiSession.current 是主视图的 binding source，value.key 才是会话 id；
    // sessions.list 的快照只有 ids/byId，没有 current（旧插件口径已失效）。
    const uiSession = safeGet('uiSession')
    const binding = uiSession?.current?.value
    const fromBinding = binding?.key ?? binding?.sessionId
    if (typeof fromBinding === 'string' && fromBinding.length > 0) return fromBinding
    const sessions = safeGet('sessions')
    const legacy = sessions?.list?.getSnapshot?.()?.current
    return typeof legacy === 'string' && legacy.length > 0 ? legacy : null
  }

  /** 从 session.models 的目录里找当前 provider/model（与宿主选择器同口径）。 */
  const currentModel = (directory: any): { group: any; model: any; current: any } | null => {
    if (directory === null || directory === undefined || directory.current === null) return null
    for (const group of directory.groups || []) {
      const model = (group.models || []).find((candidate: any) => candidate.id === directory.current.model)
      if (group.id === directory.current.provider && model !== undefined) {
        return { group, model, current: directory.current }
      }
    }
    return null
  }

  const levelName = (effort: any): string =>
    (effort && (effort.name || REASONING_LEVEL_NAMES[String(effort.id)] || String(effort.id))) || '—'

  const levelTone = (effort: any): 'off' | 'low' | 'high' | 'max' => {
    const id = String(effort?.id ?? '').toLowerCase()
    if (id === 'off' || id === 'none') return 'off'
    if (id === 'minimal' || id === 'low') return 'low'
    if (id === 'max' || id === 'xhigh') return 'max'
    return 'high'
  }

  const levelDescription = (effort: any): string => {
    if (effort?.description) return String(effort.description)
    const id = String(effort?.id ?? '').toLowerCase()
    if (id === 'off' || id === 'none') return '关闭推理 · 最快，也最省'
    if (id === 'minimal' || id === 'low') return '轻量推理 · 更快'
    if (id === 'max' || id === 'xhigh') return '最高档 · 推理更深，也更慢'
    return '深度推理 · 速度与质量的平衡'
  }

  const close = (): void => {
    if (state === null) return
    state = null
    host.hidden = true
    host.textContent = ''
    document.removeEventListener('keydown', onKey, true)
  }

  /** 把面板贴在锚点上方/原位；再夹进视口。 */
  const position = (rect: { left: number; top: number; right?: number }): void => {
    host.style.visibility = 'hidden'
    host.style.left = '0px'
    host.style.top = '0px'
    const w = host.offsetWidth || 322
    const h = host.offsetHeight || 210
    const anchorRight = state?.placeAbove === true && rect.right !== undefined
    let left = anchorRight ? rect.right! - w : rect.left
    let top = state?.placeAbove === true ? rect.top - h - 14 : rect.top
    left = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - w - 8))
    top = Math.min(Math.max(8, top), Math.max(8, window.innerHeight - h - 8))
    host.style.left = Math.round(left) + 'px'
    host.style.top = Math.round(top) + 'px'
    host.style.visibility = ''
  }

  const choose = (effort: any): void => {
    if (state === null || state.busy) return
    const selection = currentModel(state.directory)
    if (selection === null) return
    const currentEffort = selection.current.reasoningEffort ?? selection.model.reasoning?.defaultEffort
    if (effort.id === currentEffort) {
      close()
      return
    }
    state.busy = true
    state.error = ''
    render()
    const mode = state.mode
    Promise.resolve()
      .then(() => {
        if (state === null) return null
        if (mode === 'directory') {
          const directory = state.live || state.models.directoryFor(state.sessionId)
          state.live = directory
          return directory.select({
            provider: selection.current.provider,
            model: selection.current.model,
            reasoningEffort: String(effort.id),
          })
        }
        return state.api.sessions.selectModel({
          sessionId: state.sessionId,
          provider: selection.current.provider,
          model: selection.current.model,
          reasoningEffort: String(effort.id),
        })
      })
      .then((response: any) => {
        if (state === null) return
        const ok =
          mode === 'directory'
            ? response !== null && response !== undefined && response.ok === true
            : !!(response && response.result && response.result.ok === true)
        if (!ok) {
          state.busy = false
          state.error =
            response?.error?.message ||
            response?.result?.error?.message ||
            '无法更新推理等级'
          render()
          return
        }
        close()
      })
      .catch((error: unknown) => {
        if (state === null) return
        state.busy = false
        state.error = error instanceof Error ? error.message : String(error)
        render()
      })
  }

  const paint = (index: number): void => {
    if (state === null || state.ui === null) return
    const ui = state.ui
    const efforts: any[] = ui.efforts
    const bounded = Math.max(0, Math.min(efforts.length - 1, index))
    const pct = efforts.length <= 1 ? 100 : (bounded / (efforts.length - 1)) * 100
    state.preview = bounded
    ui.panel.setAttribute('data-level', levelTone(efforts[bounded]))
    ui.tier.textContent = levelName(efforts[bounded]).toUpperCase()
    ui.desc.textContent = levelDescription(efforts[bounded])
    ui.fill.style.width = pct + '%'
    ui.cursor.style.left = pct + '%'
    ui.gauge.setAttribute('aria-valuenow', String(bounded))
    ui.gauge.setAttribute('aria-valuetext', levelName(efforts[bounded]))
    for (let i = 0; i < ui.labels.length; i += 1) {
      ui.labels[i].classList.toggle('on', i === bounded)
    }
  }

  const render = (): void => {
    if (state === null) return
    host.textContent = ''
    state.ui = null
    const selection = currentModel(state.directory)
    const reasoning = selection?.model?.reasoning
    const efforts: any[] = Array.isArray(reasoning?.efforts) ? reasoning.efforts : []
    const effective = selection?.current?.reasoningEffort ?? reasoning?.defaultEffort
    const activeIndex = efforts.findIndex((effort) => effort.id === effective)
    const active = activeIndex >= 0 ? efforts[activeIndex] : null

    const panel = el('div', 'cr-panel cr-sonar')
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', '推理等级')
    panel.setAttribute('aria-busy', state.busy ? 'true' : 'false')
    panel.setAttribute('data-level', active ? levelTone(active) : 'high')

    const head = el('div', 'cr-sonar-head')
    const text = el('div', 'cr-sonar-text')
    text.appendChild(el('div', 'cr-kicker', 'REASONING · 推理等级'))
    const desc = el('div', 'cr-sonar-desc', active ? levelDescription(active) : '越高越慢，也越贵。')
    text.appendChild(desc)
    head.appendChild(text)
    const tier = el('span', 'cr-tier', active ? levelName(active).toUpperCase() : effective ? String(effective).toUpperCase() : '—')
    head.appendChild(tier)
    panel.appendChild(head)

    if (state.directory === null) {
      panel.appendChild(el('div', 'cr-sub', state.busy ? '正在更新…' : '正在读取模型能力…'))
      if (state.error) {
        const err = el('div', 'cr-sub cr-error', state.error)
        const retry = el('button', 'cr-retry', '重试') as HTMLButtonElement
        retry.type = 'button'
        retry.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          load()
        })
        err.appendChild(retry)
        panel.appendChild(err)
      }
    } else if (selection === null) {
      desc.textContent = '当前会话没有可读取的模型。'
    } else if (efforts.length === 0) {
      desc.textContent = '当前模型没有可调推理等级。'
    } else {
      const gauge = el('div', 'cr-gauge')
      gauge.setAttribute('role', 'slider')
      gauge.setAttribute('tabindex', '0')
      gauge.setAttribute('aria-label', '推理等级')
      gauge.setAttribute('aria-valuemin', '0')
      gauge.setAttribute('aria-valuemax', String(efforts.length - 1))
      gauge.setAttribute('aria-valuenow', String(activeIndex >= 0 ? activeIndex : 0))
      gauge.setAttribute('aria-valuetext', active ? levelName(active) : '—')
      const water = el('div', 'cr-water')
      const fill = el('i', 'cr-water-fill')
      water.appendChild(fill)
      gauge.appendChild(water)
      const ticks = el('div', 'cr-ticks')
      for (let i = 0; i <= 16; i += 1) {
        const tick = el('i', '')
        tick.style.left = (i / 16) * 100 + '%'
        ticks.appendChild(tick)
      }
      gauge.appendChild(ticks)
      for (let i = 1; i < efforts.length - 1; i += 1) {
        const major = el('span', 'cr-major')
        major.style.left = (i / (efforts.length - 1)) * 100 + '%'
        gauge.appendChild(major)
      }
      const cursor = el('span', 'cr-cursor')
      gauge.appendChild(cursor)
      panel.appendChild(gauge)

      const scale = el('div', 'cr-scale')
      const labels: HTMLElement[] = []
      efforts.forEach((effort, index) => {
        const label = el('span', 'cr-scale-label', levelName(effort))
        const pct = efforts.length <= 1 ? 100 : (index / (efforts.length - 1)) * 100
        label.style.left = pct + '%'
        if (index === 0) {
          label.style.left = '0%'
          label.style.transform = 'none'
        }
        if (index === efforts.length - 1) {
          label.style.left = 'auto'
          label.style.right = '0%'
          label.style.transform = 'none'
        }
        scale.appendChild(label)
        labels.push(label)
      })
      panel.appendChild(scale)
      state.ui = { panel, efforts, fill, cursor, tier, desc, gauge, labels }
      paint(activeIndex >= 0 ? activeIndex : 0)

      let dragging = false
      const indexAt = (clientX: number): number => {
        const rect = gauge.getBoundingClientRect()
        const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0
        const bounded = Math.max(0, Math.min(1, ratio))
        return Math.round(bounded * (efforts.length - 1))
      }
      gauge.addEventListener('pointerdown', (event) => {
        if (state === null || state.busy) return
        dragging = true
        gauge.classList.add('is-drag')
        try {
          gauge.setPointerCapture(event.pointerId)
        } catch {
          // 合成事件在个别环境没有 active pointer；拖动仍可用。
        }
        paint(indexAt(event.clientX))
        gauge.focus()
        event.preventDefault()
      })
      gauge.addEventListener('pointermove', (event) => {
        if (!dragging || state === null) return
        paint(indexAt(event.clientX))
      })
      const finish = (event: PointerEvent): void => {
        if (!dragging || state === null) return
        dragging = false
        gauge.classList.remove('is-drag')
        const index = indexAt(event.clientX)
        paint(index)
        const effort = state.ui?.efforts[index]
        if (effort !== undefined) choose(effort)
      }
      gauge.addEventListener('pointerup', finish)
      gauge.addEventListener('pointercancel', () => {
        dragging = false
        gauge.classList.remove('is-drag')
      })
      gauge.addEventListener('keydown', (event) => {
        if (state === null || state.busy) return
        const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
        if (!keys.includes(event.key)) return
        const current = state.preview
        let next = current
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = Math.max(0, current - 1)
        else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = Math.min(efforts.length - 1, current + 1)
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = efforts.length - 1
        event.preventDefault()
        paint(next)
        choose(efforts[next])
      })
      if (state.error) panel.appendChild(el('div', 'cr-sub cr-error', state.error))
    }

    const foot = el('div', 'cr-foot')
    foot.appendChild(el('span', '', '仅影响之后的请求'))
    foot.appendChild(el('span', '', state.busy ? '更新中…' : 'Esc 关闭'))
    panel.appendChild(foot)

    host.appendChild(panel)
    host.hidden = false
    position(state.rect)
  }

  const load = (): void => {
    if (state === null) return
    const token = ++state.token
    const mode = state.mode
    const sessionId = state.sessionId
    state.directory = null
    state.error = ''
    state.busy = true
    render()
    const read = async (): Promise<any> => {
      if (state === null) return null
      if (mode === 'directory') {
        const directory = state.models.directoryFor(sessionId)
        state.live = directory
        await directory.load()
        return { ok: true, value: directory.store.getSnapshot() }
      }
      const response = await state.api.sessions.models({ sessionId })
      if (!response || !response.result || response.result.ok !== true) {
        return { ok: false, error: response?.result?.error }
      }
      return { ok: true, value: response.result.value }
    }
    Promise.resolve()
      .then(read)
      .then((result: any) => {
        if (state === null || state.token !== token) return
        state.busy = false
        if (!result || result.ok !== true) {
          state.error = result?.error?.message || '无法读取模型能力'
          render()
          return
        }
        state.directory = result.value
        render()
        requestAnimationFrame(() => {
          if (state === null) return
          host.querySelector<HTMLElement>('.cr-gauge')?.focus()
        })
      })
      .catch((error: unknown) => {
        if (state === null || state.token !== token) return
        state.busy = false
        state.error = error instanceof Error ? error.message : String(error)
        render()
      })
  }

  const onKey = (event: KeyboardEvent): void => {
    if (state === null) return
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    close()
  }

  /** 解析当前会话 + 当前宿主可用的模型目录服务（0.2.x directory / 旧 connection）。 */
  const resolveContext = (): {
    sessionId: string
    mode: 'directory' | 'legacy'
    models: any
    api: any
  } | null => {
    const sessionId = currentSessionId()
    if (sessionId === null) return null
    const sessions = safeGet('sessions')
    try {
      if (sessions && typeof sessions.subagentAddress === 'function' && sessions.subagentAddress(sessionId) !== undefined) {
        return null // 子代理会话不提供模型/档位选择，交给宿主原生逻辑
      }
    } catch {
      return null
    }
    const modelDirectories = safeGet('modelDirectories')
    const connection = safeGet('connection')
    const legacyApi = connection?.api?.sessions ? connection.api : null
    const directoryMode = !!(modelDirectories && typeof modelDirectories.directoryFor === 'function')
    if (!directoryMode && legacyApi === null) return null
    return {
      sessionId,
      mode: directoryMode ? 'directory' : 'legacy',
      models: modelDirectories,
      api: legacyApi,
    }
  }

  const openAt = (
    rect: { left: number; top: number; right?: number },
    context: ReturnType<typeof resolveContext>,
    placeAbove = false,
  ): void => {
    if (context === null) return
    state = {
      sessionId: context.sessionId,
      mode: context.mode,
      models: context.models,
      api: context.api,
      live: null,
      rect,
      placeAbove,
      directory: null,
      busy: true,
      error: '',
      token: 0,
      preview: 0,
      ui: null,
    }
    render()
    load()
    document.addEventListener('keydown', onKey, true)
  }

  const onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null
    if (target === null) return
    if (host.contains(target)) return
    if (state !== null) {
      close()
      return
    }

    // 设计稿 02 的入口：宿主模型触发器里的「当前档位」小字。
    // 点它直接开声呐面板；点模型名仍然开官方模型菜单。
    const effortChip = target.closest('[class*="triggerEffort"]')
    if (effortChip instanceof HTMLElement && effortChip.getBoundingClientRect().width > 0) {
      const context = resolveContext()
      if (context === null) return
      event.preventDefault()
      event.stopPropagation()
      const box = effortChip.getBoundingClientRect()
      // 设计稿里 popover 悬在整条输入栏上方，而不是只压在档位小字上。
      const seat = effortChip.closest('[data-composer-seat]')
      const seatRect = seat instanceof HTMLElement ? seat.getBoundingClientRect() : null
      openAt(
        {
          left: box.left,
          top: seatRect?.top ?? box.top,
          right: seatRect !== null ? seatRect.right - 56 : box.right,
        },
        context,
        true,
      )
      return
    }

    const row = target.closest('[role="menuitem"]')
    if (!(row instanceof HTMLElement)) return
    const menu = row.closest('[role="menu"]')
    if (!(menu instanceof HTMLElement)) return
    const text = (row.textContent || '').trim()
    if (!REASONING_ROW_LABELS.some((label) => text === label || text.startsWith(label))) return
    const context = resolveContext()
    if (context === null) return
    event.preventDefault()
    event.stopPropagation()
    const box = menu.getBoundingClientRect()
    menu.style.display = 'none'
    openAt({ left: box.left, top: box.top }, context)
  }

  document.addEventListener('click', onClick, true)
  ctx.effect(() => () => {
    close()
    document.removeEventListener('click', onClick, true)
    host.remove()
  })
}

/* ---------- 角标渲染 ---------- */

function renderBadge(
  container: HTMLElement,
  state: PetStatePayload | null,
  stats: StatsPayload | null,
  balance: BalancePayload | null,
): void {
  container.textContent = ''
  if (state === null) {
    container.style.display = 'none'
    return
  }
  container.style.display = ''

  const tasks = Array.isArray(state.tasks) && state.tasks.length
    ? state.tasks
    : (state.task ? [state.task] : [])
  const working = tasks.length > 0
  const today = stats?.totalTokens ?? 0
  const privacy = !!state.settings.privacyMode

  const icon = el('span', 'sb-icon')
  icon.innerHTML = FIN_SVG
  container.appendChild(icon)

  const text = el('span', 'sb-text')
  // 主行永远是今日总量：不随某个任务开始/结束跳动；单任务读数放 tooltip。
  const main = el('b', '', `今日 ${fmtTokens(today)} token`)
  const sub = el('span', '')
  const bits: string[] = []
  if (working) {
    // 角标只做聚合，具体项目名交给桌宠/tooltip，避免和桌宠重复。
    sub.textContent = `${tasks.length} 个任务运行中`
  } else {
    bits.push(`${stats?.tasks ?? 0} 个任务`)
    const cost = Number(stats?.cost) || 0
    if (cost > 0) {
      const sym = state.settings.currency === 'USD' ? '$' : '¥'
      bits.push(`${sym}${cost.toFixed(2)}`)
    }
    sub.textContent = bits.join(' · ')
  }
  text.appendChild(main)
  text.appendChild(sub)
  // 第三行：余额 + 峰谷。用户要求放在 DSH 左下角角标，不占面板左栏。
  const sym = state.settings.currency === 'USD' ? '$' : '¥'
  let balText = '余额 —'
  if (balance !== null) {
    if (balance.enabled === false) balText = '余额 未开启'
    else if (balance.ok === true) {
      const balSym = balance.currency === 'USD' ? '$' : sym
      balText = '余额 ' + balSym + (Number(balance.normal) || 0).toFixed(2)
    }
  }
  const offPeak = isOffPeakNow(state.holidays)
  const foot = el('span', 'sb-foot')
  foot.appendChild(el('b', '', balText))
  const period = el('span', 'sb-period' + (offPeak ? ' is-off' : ''))
  period.appendChild(el('i', ''))
  period.appendChild(document.createTextNode(offPeak ? '闲时' : '高峰'))
  period.title = offPeak
    ? '闲时（周末/法定节假日，或工作日 9–12、14–18 以外），官方高峰价 5 折'
    : '高峰时段（北京时间工作日 9:00–12:00 / 14:00–18:00）'
  foot.appendChild(period)
  text.appendChild(foot)
  container.appendChild(text)

  if (working) {
    const dot = el('i', 'sb-dot')
    const tone = STATE_TONE[state.state] ?? STATE_TONE.hooked
    dot.style.color = tone
    dot.style.background = tone
    dot.style.boxShadow = `0 0 8px ${tone}`
    container.appendChild(dot)
  } else {
    container.appendChild(el('span', 'sb-arrow', '›'))
  }

  const lines = ['DSH 伴侣']
  const phaseText = (p?: TaskPayload['phase']): string =>
    p === 'tool' ? '执行工具' : p === 'streaming' ? '输出中' : '等待模型'
  if (working) {
    lines.push(`${tasks.length} 个任务运行中`)
    const shown = tasks.slice(0, 4)
    for (let i = 0; i < shown.length; i++) {
      const t = shown[i]
      const name = privacy ? `任务 ${i + 1}` : (t.project || t.model || '未命名任务')
      const bits = [name, phaseText(t.phase), `已 ${fmtElapsed(t.startTime, Date.now())}`]
      if (!privacy) bits.push(`${fmtTokens(t.tokens.totalTokens)} token`)
      lines.push('● ' + bits.join(' · '))
    }
    if (tasks.length > shown.length) lines.push(`还有 ${tasks.length - shown.length} 个任务`)
    lines.push(`今日 ${today.toLocaleString()} tokens`)
    if (!privacy && (stats?.cost ?? 0) > 0) {
      const sym = state.settings.currency === 'USD' ? '$' : '¥'
      lines.push(`今日 ${sym}${(stats?.cost ?? 0).toFixed(2)}`)
    }
  } else {
    lines.push(`空闲 · 今日 ${stats?.tasks ?? 0} 个任务 · ${today.toLocaleString()} tokens`)
    if ((stats?.cost ?? 0) > 0) {
      const sym = state.settings.currency === 'USD' ? '$' : '¥'
      lines.push(`今日 ${sym}${(stats?.cost ?? 0).toFixed(2)}`)
    }
  }
  lines.push('点击打开统计面板')
  lines.push(balText + ' · ' + (offPeak ? '闲时' : '高峰'))
  container.title = lines.join('\n')
}

/* ---------- 完整面板大窗（GUI 内，不跳浏览器） ---------- */

interface PanelModalRefs {
  root: HTMLElement
  iframe: HTMLIFrameElement
}

function buildPanelModal(onClose: () => void): PanelModalRefs {
  const root = document.createElement('div')
  root.setAttribute(PANEL_ATTR, '')
  root.setAttribute('data-dsh-plugin', 'dsh-companion')
  root.setAttribute('data-dsh-part', 'panel-modal')
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-modal', 'true')
  root.setAttribute('aria-label', 'DSH 伴侣统计面板')

  const box = el('div', 'pm-box')
  const head = el('div', 'pm-head')
  const icon = el('span', 'pm-icon')
  icon.innerHTML =
    '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
    '<path d="M2 12c2.6 0 3.6-1.4 5.1-3.4C8.7 6.3 9.8 4 12 4c1.2 0 2 .7 2 2 0 3.6-3.2 6-7 6H2Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
    '<circle cx="12.2" cy="5.6" r=".8" fill="currentColor"/></svg>'
  head.appendChild(icon)
  head.appendChild(el('span', 'pm-title', 'DSH 伴侣'))
  head.appendChild(el('span', 'pm-sub', '统计面板'))
  head.appendChild(el('span', 'pm-spacer'))
  const live = el('span', 'pm-live', '本地服务 · 已连接')
  live.setAttribute('data-dsh-part', 'panel-live')
  head.appendChild(live)
  const close = el('button', 'pm-close') as HTMLButtonElement
  close.innerHTML =
    '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m3 3 6 6M9 3 3 9" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>'
  close.setAttribute('aria-label', '关闭')
  close.addEventListener('click', onClose)
  head.appendChild(close)

  const iframe = document.createElement('iframe')
  iframe.className = 'pm-frame'
  iframe.title = '统计面板'
  iframe.src = 'about:blank'

  box.appendChild(head)
  box.appendChild(iframe)
  root.appendChild(box)
  // 点背景（盒子外）关闭。
  root.addEventListener('mousedown', (ev) => {
    if (ev.target === root) onClose()
  })
  document.body.appendChild(root)
  return { root, iframe }
}

/* ---------- 删除会话（UI 增强：官方槽位注入侧栏会话行 "…" 菜单） ---------- */

function showToast(message: string): void {
  document.querySelector(`[${TOAST_ATTR}]`)?.remove()
  const toast = el('div', '', message)
  toast.setAttribute(TOAST_ATTR, '')
  toast.setAttribute('data-dsh-plugin', 'dsh-companion')
  toast.setAttribute('data-dsh-part', 'toast')
  document.body.appendChild(toast)
  window.setTimeout(() => toast.remove(), 3200)
}

async function resolveServerUrl(): Promise<string> {
  if (cachedServerUrl !== '') return cachedServerUrl
  const found = await discoverServer()
  if (found !== null) cachedServerUrl = found.url
  return cachedServerUrl
}

/** 删除成功后把宿主残留行从侧栏隐藏，避免宿主把已删会话重新渲染到「未分组」。 */
const hiddenDeletedSessions = new Set<string>()
function hideDeletedSessionRow(sessionId: string): void {
  const selector = `[data-row-key=${JSON.stringify(`session:${sessionId}`)}]`
  for (const row of document.querySelectorAll<HTMLElement>(selector)) row.style.display = 'none'
  if (hiddenDeletedSessions.has(sessionId)) return
  const style = document.createElement('style')
  style.setAttribute('data-dsh-companion-hidden-session', sessionId)
  style.textContent = `${selector}{display:none!important}`
  document.head.appendChild(style)
  hiddenDeletedSessions.add(sessionId)
  if (hiddenDeletedSessions.size > 500) {
    const oldest = hiddenDeletedSessions.values().next().value
    if (typeof oldest === 'string') {
      hiddenDeletedSessions.delete(oldest)
      document
        .querySelector(`style[data-dsh-companion-hidden-session=${JSON.stringify(oldest)}]`)
        ?.remove()
    }
  }
}

/** 删除后对账：后端已经不存在的会话，侧栏里残留的行一律隐藏。 */
async function reconcileSidebarSessions(includeSelected = false): Promise<void> {
  const url = await resolveServerUrl()
  if (url === '') return
  try {
    const res = await fetch(`${url}/api/dsh-sessions`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return
    const data = (await res.json()) as { ok?: boolean; sessions?: Array<{ sessionId?: unknown }> } | null
    if (data?.ok !== true || !Array.isArray(data.sessions)) return
    const alive = new Set<string>()
    for (const session of data.sessions) {
      if (typeof session.sessionId === 'string') alive.add(session.sessionId)
    }
    for (const row of document.querySelectorAll<HTMLElement>('[data-row-key^="session:"]')) {
      if (!includeSelected && row.getAttribute('aria-selected') === 'true') continue
      const key = row.getAttribute('data-row-key') ?? ''
      const sessionId = key.startsWith('session:') ? key.slice('session:'.length) : ''
      if (sessionId !== '' && !alive.has(sessionId)) hideDeletedSessionRow(sessionId)
    }
  } catch {
    /* 对账失败不影响已完成的删除 */
  }
}

/** 二次确认弹窗：确认后 POST 伴侣服务执行 registry 除名 + 软删回收站。 */
function openDeleteConfirm(sessionId: string, displayTitle: string): void {
  if (document.querySelector(`[${CONFIRM_ATTR}]`) !== null) return

  const root = document.createElement('dialog')
  root.setAttribute(CONFIRM_ATTR, '')
  root.setAttribute('data-dsh-plugin', 'dsh-companion')
  root.setAttribute('data-dsh-part', 'session-delete-confirm')

  const box = el('div', 'dc-box')
  box.appendChild(el('div', 'dc-title', '删除会话'))
  box.appendChild(el('div', 'dc-name', displayTitle !== '' ? `「${displayTitle}」` : sessionId))
  box.appendChild(
    el(
      'div',
      'dc-note',
      '将从会话列表移除，并彻底删除会话文件，不可恢复。运行中的会话不能删除。',
    ),
  )
  const error = el('div', 'dc-error')
  box.appendChild(error)

  const actions = el('div', 'dc-actions')
  const cancel = el('button', '', '取消') as HTMLButtonElement
  cancel.type = 'button'
  const danger = el('button', 'dc-danger', '删除') as HTMLButtonElement
  danger.type = 'button'
  actions.appendChild(cancel)
  actions.appendChild(danger)
  box.appendChild(actions)
  root.appendChild(box)

  function close(): void {
    document.removeEventListener('keydown', onKey, true)
    if (root.open) root.close()
    root.remove()
  }
  root.addEventListener('cancel', (ev) => {
    ev.preventDefault()
    close()
  })
  function onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') close()
  }
  document.addEventListener('keydown', onKey, true)
  root.addEventListener('mousedown', (ev) => {
    if (ev.target === root) close()
  })
  cancel.addEventListener('click', close)

  function fail(message: string): void {
    error.textContent = message
    error.style.display = 'block'
    danger.disabled = false
    cancel.disabled = false
    danger.textContent = '删除'
  }

  danger.addEventListener('click', () => {
    danger.disabled = true
    cancel.disabled = true
    danger.textContent = '删除中…'
    error.style.display = 'none'
    void (async () => {
      const url = await resolveServerUrl()
      if (url === '') {
        fail('伴侣服务不可用（未发现本机 17573+ 端口服务）')
        return
      }
      try {
        const res = await fetch(`${url}/api/dsh-sessions/delete`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId }),
          signal: AbortSignal.timeout(10_000),
        })
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean
          pending?: boolean
          message?: string
        } | null
        if (res.ok && data?.ok === true) {
          hideDeletedSessionRow(sessionId)
          close()
          void reconcileSidebarSessions(true)
          showToast(
            data.pending === true
              ? '会话已删除；个别文件被占用，稍后自动清除'
              : '会话已彻底删除',
          )
          return
        }
        if (res.status === 409) fail(data?.message || '会话正在运行，请等任务结束后再删除')
        else if (res.status === 404) fail('会话不存在或已被删除')
        else if (res.status === 503) fail('宿主工作区注册表未就绪，请稍后再试')
        else fail(data?.message || `删除失败（HTTP ${res.status}）`)
      } catch {
        fail('无法连接伴侣服务')
      }
    })()
  })

  document.body.appendChild(root)
  root.showModal()
}

/**
 * 官方槽位注入：会话行 "…" 菜单的「删除会话…」。
 * 槽位契约（dsh-client-ui-workspace README）：条目只收 { sessionId,
 * displayTitle } 与 hookContext 提供的 useMenuOpenState；Module Loader lane
 * 用 factory 的 require 解析 react 与 ui-primitives（MenuItemButton 是隐式
 * baseline external）。宿主没有 slots 服务或 require 不可用时静默降级。
 */
function mountSessionDeleteAction(ctx: ClientCtx, modRequire?: (id: string) => any): void {
  const slots = ctx.slots
  if (slots === undefined) return
  let React: any = null
  let MenuItemButton: any = null
  let TrashIcon: any = null
  try {
    React = modRequire !== undefined ? modRequire('react') : null
  } catch {
    React = null
  }
  if (React === null || typeof React.createElement !== 'function') return
  try {
    const primitives: any =
      modRequire !== undefined ? modRequire('@deepseek-ai/dsh-client-ui-primitives') : null
    MenuItemButton = primitives != null ? primitives.MenuItemButton : null
    // 宿主图标族里的删除图标（pin/fork/archive 用的同族 Outline Regular，size 14）。
    TrashIcon = primitives != null ? primitives.IconTrashOutlineRegular : null
  } catch {
    MenuItemButton = null
    TrashIcon = null
  }
  const h = React.createElement

  function DeleteSessionMenuItem(props: {
    sessionId: string
    displayTitle?: string
    useMenuOpenState?: () => [boolean, (open: boolean) => void]
  }): any {
    const menuState = props.useMenuOpenState !== undefined ? props.useMenuOpenState() : null
    const onSelect = (): void => {
      if (menuState !== null) menuState[1](false)
      openDeleteConfirm(props.sessionId, props.displayTitle ?? '')
    }
    // 危险操作红色：用宿主官方危险色令牌（带回退），span 内联色穿透
    // MenuItemButton 的默认前景。
    const dangerColor = 'var(--dsw-alias-state-error-primary, #e0564f)'
    const label = h('span', { style: { color: dangerColor } }, '删除会话…')
    if (typeof MenuItemButton === 'function') {
      const itemProps: Record<string, unknown> = { separatorBefore: true, onSelect }
      if (typeof TrashIcon === 'function') {
        // icon 槽位与宿主自带项对齐；包一层红色 flex span 让图标随文字吃危险色。
        itemProps.icon = h(
          'span',
          { style: { color: dangerColor, display: 'flex', alignItems: 'center' } },
          h(TrashIcon, { size: 14 }),
        )
      }
      return h(MenuItemButton, itemProps, label)
    }
    // primitives 不可用时的兜底：原生 menuitem 按钮 + 内联 SVG 垃圾桶
    //（槽位协议允许自渲染；图标 14px 与宿主菜单项同规格）。
    return h(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        onClick: onSelect,
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          width: '100%',
          textAlign: 'left',
          padding: '6px 10px',
          fontSize: '12px',
          borderRadius: '6px',
          border: 'none',
          cursor: 'pointer',
          background: 'transparent',
          color: dangerColor,
        },
      },
      h(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          'aria-hidden': 'true',
          style: { flex: 'none' },
        },
        h('path', { d: 'M2.5 4h11M6.5 4V2.8h3V4M4.2 4l.6 9.2h6.4l.6-9.2M6.6 6.6v4.2M9.4 6.6v4.2' }),
      ),
      '删除会话…',
    )
  }

  ctx.effect(() => {
    const dispose = slots.inject('sidebar.workspaces.session.menu.item', () =>
      slots.register(
        {
          name: 'sidebar.workspaces.session.menu.item',
          id: 'companion.delete-session',
          // 宿主自带 pin(100)/rename(200)/fork(300)/archive(400)/session-id(450)；
          // 550 排最后，separatorBefore 开出插件分组。
          order: 550,
        },
        DeleteSessionMenuItem,
      ),
    )
    return typeof dispose === 'function' ? dispose : undefined
  })
}

/* ---------- 对话内搜索（Ctrl+F） ---------- */

const SEARCH_ATTR = 'data-dsh-companion-find'
const SEARCH_STYLE_ATTR = 'data-dsh-companion-find-style'
const SEARCH_COLOR_STYLE_ATTR = 'data-dsh-companion-find-color'
const SEARCH_COLOR_KEY = 'dsh-companion.find-color'
const SEARCH_RESULTS_KEY = 'dsh-companion.find-results'
const DEFAULT_SEARCH_COLOR = '#f0b64a'
const DEFAULT_SEARCH_RESULT_LIMIT = 3
const MIN_SEARCH_RESULT_LIMIT = 1
const MAX_SEARCH_RESULT_LIMIT = 10
const SEARCH_HIGHLIGHT = 'dsh-companion-find'
const SEARCH_CURRENT_HIGHLIGHT = 'dsh-companion-find-current'
const HISTORY_ATTR = 'data-dsh-companion-history'
const HISTORY_STYLE_ATTR = 'data-dsh-companion-history-style'

/** 供对话标题栏搜索按钮复用 Ctrl+F 的打开逻辑。 */
let openConversationSearch: (() => boolean) | null = null
/** 独立的侧栏「历史搜索」入口。 */
let openHistorySearchIn: ((host: HTMLElement) => boolean) | null = null
let closeHistorySearch: (() => void) | null = null
let historySearchServerUrl = ''

interface SearchTextSlice {
  node: Text
  start: number
  end: number
}

interface SearchHit {
  range: Range
  snippet: string
}

/** 只给对话页注入一次样式；颜色优先跟 DSH 令牌，旧 GUI 用深海回退。 */
function ensureSearchStyle(): HTMLStyleElement {
  const old = document.querySelector<HTMLStyleElement>(`[${SEARCH_STYLE_ATTR}]`)
  if (old !== null) return old
  const style = document.createElement('style')
  style.setAttribute(SEARCH_STYLE_ATTR, '')
  style.textContent = `
[${SEARCH_ATTR}] {
  position: fixed;
  z-index: 10007;
  box-sizing: border-box;
  width: min(300px, calc(100vw - 16px));
  overflow: hidden;
  border-radius: 11px;
  border: 1px solid var(--dsw-alias-separator-primary, rgba(126,197,214,.26));
  background: var(--dsw-alias-bg-elevated, #07141c);
  color: var(--dsw-alias-text-primary, #e8f3f6);
  box-shadow: 0 18px 60px rgba(0,0,0,.55), 0 1px 0 rgba(255,255,255,.04) inset;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
[${SEARCH_ATTR}] .dcs-head {
  display: flex; align-items: center; gap: 7px;
  padding: 9px 10px;
  border-bottom: 1px solid var(--dsw-alias-separator-primary, rgba(126,197,214,.16));
}
[${SEARCH_ATTR}] .dcs-icon { width: 16px; height: 16px; flex: none; color: #46e5c3; display: grid; place-items: center; }
[${SEARCH_ATTR}] .dcs-icon svg { width: 16px; height: 16px; display: block; }
[${SEARCH_ATTR}] input {
  flex: 1; min-width: 0; height: 24px; padding: 0; margin: 0;
  border: 0; outline: none; background: transparent;
  color: inherit; font: inherit; font-size: 13px;
}
[${SEARCH_ATTR}] input::placeholder { color: var(--dsw-alias-text-tertiary, #6f8992); }
[${SEARCH_ATTR}] .dcs-count {
  flex: none; min-width: 44px; text-align: right;
  font-family: "JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace;
  font-size: 10.5px; color: var(--dsw-alias-text-secondary, #9db4bd);
  font-variant-numeric: tabular-nums;
}
[${SEARCH_ATTR}] .dcs-btn {
  width: 24px; height: 24px; flex: none; display: grid; place-items: center;
  border: 0; border-radius: 5px; background: transparent; cursor: pointer;
  color: var(--dsw-alias-text-secondary, #9db4bd); font: inherit; font-size: 14px;
}
[${SEARCH_ATTR}] .dcs-btn:hover { background: var(--dsw-alias-bg-hover, rgba(70,229,195,.1)); color: #46e5c3; }
[${SEARCH_ATTR}] .dcs-btn:disabled { opacity: .3; cursor: default; }
[${SEARCH_ATTR}] .dcs-results { max-height: min(360px, 55vh); overflow: auto; padding: 4px; }
[${SEARCH_ATTR}] .dcs-empty {
  padding: 14px 12px; color: var(--dsw-alias-text-secondary, #7d959e);
  font-size: 12px; line-height: 1.55;
}
[${SEARCH_ATTR}] .dcs-result {
  display: block; width: 100%; margin: 0; padding: 7px 8px;
  border: 0; border-radius: 6px; background: transparent; cursor: pointer;
  text-align: left; color: var(--dsw-alias-text-secondary, #c9dde3);
  font: inherit; font-size: 12px; line-height: 1.5;
}
[${SEARCH_ATTR}] .dcs-result:hover { background: var(--dsw-alias-bg-hover, rgba(70,229,195,.08)); }
[${SEARCH_ATTR}] .dcs-result[aria-current="true"] {
  background: rgba(70,229,195,.13);
  color: var(--dsw-alias-text-primary, #eafff9);
}
[${SEARCH_ATTR}] .dcs-snippet { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[${SEARCH_ATTR}] .dcs-snippet mark {
  padding: 0 1px; border-radius: 2px;
  background: rgba(240,182,74,.26); color: inherit;
}
[${SEARCH_ATTR}] .dcs-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 5px 8px 6px; border-top: 1px solid var(--dsw-alias-separator-primary, rgba(126,197,214,.1));
  color: var(--dsw-alias-text-tertiary, #6f8992); font-size: 9.5px;
}
[${SEARCH_ATTR}] .dcs-foot-hint {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
[${SEARCH_ATTR}] .dcs-more { padding: 5px 8px 2px; color: var(--dsw-alias-text-tertiary, #6f8992); font-size: 10px; }
::highlight(${SEARCH_HIGHLIGHT}) { background-color: rgba(240,182,74,.34); color: inherit; }
::highlight(${SEARCH_CURRENT_HIGHLIGHT}) { background-color: rgba(70,229,195,.58); color: #031015; }
[data-dsh-companion-find-button] {
  width: 26px; height: 26px; flex: none; display: grid; place-items: center;
  padding: 0; border: 0; border-radius: 6px; background: transparent; cursor: pointer;
  color: var(--dsw-alias-text-secondary, #9db4bd);
}
[data-dsh-companion-find-button]:hover {
  background: var(--dsw-alias-bg-hover, rgba(70,229,195,.1));
  color: #46e5c3;
}
[data-dsh-companion-find-button] svg { width: 16px; height: 16px; display: block; }
`
  document.head.appendChild(style)
  return style
}

/** Ctrl+F：在当前对话滚动区里找文本，点结果滚到对应位置。 */
function mountConversationSearch(): ClientDisposer {
  document.querySelector(`[${SEARCH_ATTR}]`)?.remove()
  document.querySelector(`[${SEARCH_COLOR_STYLE_ATTR}]`)?.remove()
  const style = ensureSearchStyle()

  let panel: HTMLElement | null = null
  let input: HTMLInputElement | null = null
  let count: HTMLElement | null = null
  let results: HTMLElement | null = null
  let prevBtn: HTMLButtonElement | null = null
  let nextBtn: HTMLButtonElement | null = null
  let colorStyle: HTMLStyleElement | null = null
  let currentSearchColor = DEFAULT_SEARCH_COLOR
  let showResultList = true
  let resultLimit = DEFAULT_SEARCH_RESULT_LIMIT
  let matches: SearchHit[] = []
  let current = -1
  let composing = false
  let debounce = 0
  let openSession = ''

  function normalizeSearchColor(raw: string | null): string {
    return raw !== null && /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : DEFAULT_SEARCH_COLOR
  }

  function colorParts(hex: string): [number, number, number] {
    const n = Number.parseInt(hex.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }

  function rgbaOf(hex: string, alpha: number): string {
    const [r, g, b] = colorParts(hex)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  function contrastOn(hex: string): string {
    const [r, g, b] = colorParts(hex)
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#031015' : '#ffffff'
  }

  function applySearchColor(raw: string, persist: boolean): void {
    const color = normalizeSearchColor(raw)
    currentSearchColor = color
    if (colorStyle === null) {
      colorStyle = document.createElement('style')
      colorStyle.setAttribute(SEARCH_COLOR_STYLE_ATTR, '')
      document.head.appendChild(colorStyle)
    }
    colorStyle.textContent = `
::highlight(${SEARCH_HIGHLIGHT}) { background-color: ${rgbaOf(color, 0.34)}; color: inherit; }
::highlight(${SEARCH_CURRENT_HIGHLIGHT}) { background-color: ${rgbaOf(color, 0.62)}; color: ${contrastOn(color)}; }
[${SEARCH_ATTR}] .dcs-snippet mark { background: ${rgbaOf(color, 0.26)}; color: inherit; }
`
    if (persist) {
      try {
        localStorage.setItem(SEARCH_COLOR_KEY, color)
      } catch {
        /* 隐私模式/禁用存储时只影响持久化 */
      }
    }
  }

  function storedSearchColor(): string {
    try {
      return normalizeSearchColor(localStorage.getItem(SEARCH_COLOR_KEY))
    } catch {
      return DEFAULT_SEARCH_COLOR
    }
  }

  function normalizeResultLimit(raw: unknown): number {
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(n)) return DEFAULT_SEARCH_RESULT_LIMIT
    return Math.min(MAX_SEARCH_RESULT_LIMIT, Math.max(MIN_SEARCH_RESULT_LIMIT, Math.round(n)))
  }

  function storedResultPrefs(): { show: boolean; limit: number } {
    try {
      const raw = localStorage.getItem(SEARCH_RESULTS_KEY)
      if (raw === null) return { show: true, limit: DEFAULT_SEARCH_RESULT_LIMIT }
      const parsed = JSON.parse(raw) as { show?: unknown; limit?: unknown }
      return { show: parsed.show !== false, limit: normalizeResultLimit(parsed.limit) }
    } catch {
      return { show: true, limit: DEFAULT_SEARCH_RESULT_LIMIT }
    }
  }

  function applySearchResults(show: boolean, rawLimit: unknown, persist: boolean): void {
    showResultList = show === true
    resultLimit = normalizeResultLimit(rawLimit)
    if (results !== null) results.style.display = showResultList ? '' : 'none'
    if (persist) {
      try {
        localStorage.setItem(SEARCH_RESULTS_KEY, JSON.stringify({ show: showResultList, limit: resultLimit }))
      } catch {
        /* 隐私模式/禁用存储时只影响持久化 */
      }
    }
    renderResults()
  }

  /** 面板「设置 → 快捷键」通过 postMessage 改搜索高亮颜色与候选列表。 */
  const onSearchColorMessage = (ev: MessageEvent): void => {
    const data = ev.data as { type?: unknown; color?: unknown; show?: unknown; limit?: unknown } | null
    if (data === null || typeof data !== 'object' || typeof data.type !== 'string') return
    if (data.type === 'dsh-companion:search-color') {
      if (typeof data.color === 'string') applySearchColor(data.color, true)
      return
    }
    if (data.type === 'dsh-companion:search-results') {
      applySearchResults(data.show === true, data.limit, true)
      return
    }
    if (data.type === 'dsh-companion:search-color:request') {
      const source = ev.source as Window | null
      source?.postMessage({ type: 'dsh-companion:search-color', color: currentSearchColor }, '*')
      return
    }
    if (data.type === 'dsh-companion:search-results:request') {
      const source = ev.source as Window | null
      source?.postMessage(
        { type: 'dsh-companion:search-results', show: showResultList, limit: resultLimit },
        '*',
      )
    }
  }
  window.addEventListener('message', onSearchColorMessage)

  const resultPrefs = storedResultPrefs()
  showResultList = resultPrefs.show
  resultLimit = resultPrefs.limit

  applySearchColor(storedSearchColor(), false)

  function scroller(): HTMLElement | null {
    const el = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    if (el === null) return null
    const rect = el.getBoundingClientRect()
    return rect.width > 1 && rect.height > 1 ? el : null
  }

  function contentRoot(): HTMLElement | null {
    const el = document.querySelector<HTMLElement>('[data-conversation-content]')
    return el ?? scroller()
  }

  function collectText(root: HTMLElement): { text: string; slices: SearchTextSlice[] } {
    const slices: SearchTextSlice[] = []
    let text = ''
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node: Node): number {
        const parent = node.parentElement
        if (parent === null || node.nodeValue === null || node.nodeValue === '') {
          return NodeFilter.FILTER_REJECT
        }
        if (
          parent.closest(
            '[data-composer-seat], [aria-hidden="true"], [hidden], script, style, noscript, input, textarea, button, [role="button"]',
          ) !== null
        ) {
          return NodeFilter.FILTER_REJECT
        }
        return NodeFilter.FILTER_ACCEPT
      },
    })
    let node = walker.nextNode()
    while (node !== null) {
      const value = node.nodeValue ?? ''
      if (value !== '') {
        slices.push({ node: node as Text, start: text.length, end: text.length + value.length })
        text += value
      }
      node = walker.nextNode()
    }
    return { text, slices }
  }

  function locate(slices: SearchTextSlice[], offset: number): { node: Text; offset: number } | null {
    if (slices.length === 0) return null
    let lo = 0
    let hi = slices.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (offset < slices[mid].end) hi = mid
      else lo = mid + 1
    }
    const slice = slices[lo]
    const value = slice.node.nodeValue ?? ''
    return {
      node: slice.node,
      offset: Math.max(0, Math.min(value.length, offset - slice.start)),
    }
  }

  function rangeAt(slices: SearchTextSlice[], start: number, end: number): Range | null {
    const from = locate(slices, start)
    const to = locate(slices, end)
    if (from === null || to === null) return null
    const range = document.createRange()
    try {
      range.setStart(from.node, from.offset)
      range.setEnd(to.node, to.offset)
      return range.collapsed ? null : range
    } catch {
      return null
    }
  }

  function visible(range: Range): boolean {
    try {
      return range.getClientRects().length > 0
    } catch {
      return false
    }
  }

  function snippetOf(text: string, at: number, length: number): string {
    // 只取命中词前后各 3 个字符，避免结果行又宽又长。
    const before = text.slice(Math.max(0, at - 3), at).replace(/\s+/g, ' ')
    const hit = text.slice(at, at + length).replace(/\s+/g, ' ')
    const after = text.slice(at + length, at + length + 3).replace(/\s+/g, ' ')
    return `${at > 3 ? '…' : ''}${before}${hit}${after}${at + length < text.length ? '…' : ''}`
  }

  function highlightRegistry(): { set(name: string, value: unknown): void; delete(name: string): void } | null {
    const api = (CSS as unknown as { highlights?: { set(name: string, value: unknown): void; delete(name: string): void } }).highlights
    return api ?? null
  }

  function clearHighlights(): void {
    const registry = highlightRegistry()
    if (registry === null) return
    try {
      registry.delete(SEARCH_HIGHLIGHT)
      registry.delete(SEARCH_CURRENT_HIGHLIGHT)
    } catch {
      /* ignore */
    }
  }

  function applyHighlights(): void {
    const registry = highlightRegistry()
    const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
    if (registry === null || HighlightCtor === undefined) return
    try {
      registry.delete(SEARCH_HIGHLIGHT)
      registry.delete(SEARCH_CURRENT_HIGHLIGHT)
      if (matches.length > 0) {
        registry.set(SEARCH_HIGHLIGHT, new HighlightCtor(...matches.map((m) => m.range)))
      }
      if (current >= 0 && matches[current] !== undefined) {
        registry.set(SEARCH_CURRENT_HIGHLIGHT, new HighlightCtor(matches[current].range))
      }
    } catch {
      /* DOM 重绘时 Range 失效，忽略即可 */
    }
  }

  function jump(index: number): void {
    const hit = matches[index]
    const scroll = scroller()
    if (hit === undefined || scroll === null) return
    try {
      const rects = hit.range.getClientRects()
      const rect = rects[0]
      if (rect === undefined || rect.height === 0) return
      const box = scroll.getBoundingClientRect()
      const top = scroll.scrollTop + rect.top - box.top - (box.height - rect.height) / 2
      scroll.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    } catch {
      /* range 已失效 */
    }
  }

  function updateCount(): void {
    if (count === null) return
    if (input === null || input.value.trim() === '') {
      count.textContent = ''
    } else if (matches.length === 0) {
      count.textContent = '0'
    } else {
      count.textContent = `${current + 1} / ${matches.length}`
    }
    if (prevBtn !== null) prevBtn.disabled = matches.length === 0
    if (nextBtn !== null) nextBtn.disabled = matches.length === 0
  }

  function markSnippet(snippet: string, needle: string): DocumentFragment {
    const fragment = document.createDocumentFragment()
    const at = snippet.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase())
    if (at < 0) {
      fragment.appendChild(document.createTextNode(snippet))
      return fragment
    }
    fragment.appendChild(document.createTextNode(snippet.slice(0, at)))
    const mark = document.createElement('mark')
    mark.textContent = snippet.slice(at, at + needle.length)
    fragment.appendChild(mark)
    fragment.appendChild(document.createTextNode(snippet.slice(at + needle.length)))
    return fragment
  }

  function renderResults(): void {
    if (results === null || count === null) return
    results.style.display = showResultList ? '' : 'none'
    results.replaceChildren()
    if (!showResultList) {
      updateCount()
      return
    }
    if (input === null || input.value.trim() === '') {
      results.appendChild(el('div', 'dcs-empty', '输入关键词，搜索当前会话里已加载的消息。'))
      updateCount()
      return
    }
    if (matches.length === 0) {
      results.appendChild(el('div', 'dcs-empty', '没有找到。试试更短的关键词，或向上滚动加载更早的对话。'))
      updateCount()
      return
    }
    const needle = input.value.trim()
    const limit = Math.min(matches.length, resultLimit)
    for (let i = 0; i < limit; i++) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'dcs-result'
      button.setAttribute('aria-current', i === current ? 'true' : 'false')
      button.title = '跳转到这个位置'
      const snippet = el('span', 'dcs-snippet')
      snippet.appendChild(markSnippet(matches[i].snippet, needle))
      button.appendChild(snippet)
      button.addEventListener('click', () => select(i, true))
      results.appendChild(button)
    }
    if (matches.length > limit) {
      results.appendChild(el('div', 'dcs-more', `仅显示前 ${limit} 条，共 ${matches.length} 条`))
    }
    updateCount()
  }

  function runSearch(): void {
    clearHighlights()
    matches = []
    current = -1
    if (panel === null || panel.style.display === 'none' || input === null) return
    const query = input.value.trim()
    if (query === '') {
      renderResults()
      applyHighlights()
      return
    }
    const scroll = scroller()
    const root = contentRoot()
    if (scroll === null || root === null) {
      renderResults()
      return
    }
    const { text, slices } = collectText(scroll)
    if (text === '' || slices.length === 0) {
      renderResults()
      return
    }
    const haystack = text.toLocaleLowerCase()
    const needle = query.toLocaleLowerCase()
    let from = 0
    while (matches.length < 400) {
      const at = haystack.indexOf(needle, from)
      if (at < 0) break
      const range = rangeAt(slices, at, at + needle.length)
      if (range !== null && visible(range)) {
        matches.push({ range, snippet: snippetOf(text, at, needle.length) })
      }
      from = at + Math.max(1, needle.length)
    }
    current = matches.length > 0 ? 0 : -1
    renderResults()
    applyHighlights()
  }

  function scheduleSearch(): void {
    window.clearTimeout(debounce)
    debounce = window.setTimeout(() => {
      if (!composing) runSearch()
    }, 120)
  }

  function select(index: number, reveal: boolean): void {
    if (matches.length === 0) return
    current = ((index % matches.length) + matches.length) % matches.length
    if (results !== null) {
      const items = results.querySelectorAll<HTMLElement>('.dcs-result')
      items.forEach((item, i) => item.setAttribute('aria-current', i === current ? 'true' : 'false'))
    }
    applyHighlights()
    updateCount()
    if (reveal) jump(current)
  }

  function positionPanel(): void {
    if (panel === null) return
    const scroll = scroller()
    if (scroll === null) return
    const region = scroll.closest<HTMLElement>('[data-conversation-region="chat"]') ?? scroll
    const rect = region.getBoundingClientRect()
    const width = Math.min(300, Math.max(240, rect.width - 24))
    const left = Math.max(8, Math.min(rect.right - width - 12, window.innerWidth - width - 8))
    const top = Math.max(8, rect.top + 10)
    panel.style.width = `${width}px`
    panel.style.left = `${left}px`
    panel.style.top = `${top}px`
  }

  function createPanel(): void {
    if (panel !== null) return
    panel = document.createElement('div')
    panel.setAttribute(SEARCH_ATTR, '')
    panel.setAttribute('data-dsh-plugin', 'dsh-companion')
    panel.setAttribute('data-dsh-part', 'conversation-search')
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', '搜索当前会话')
    panel.style.display = 'none'

    const head = el('div', 'dcs-head')
    const icon = el('span', 'dcs-icon')
    icon.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.6" stroke="currentColor" stroke-width="1.3"/><path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'
    input = document.createElement('input')
    input.type = 'search'
    input.placeholder = '搜索当前会话'
    input.setAttribute('aria-label', '搜索当前会话')
    input.autocomplete = 'off'
    input.spellcheck = false
    count = el('span', 'dcs-count')
    count.setAttribute('aria-live', 'polite')
    prevBtn = document.createElement('button')
    prevBtn.type = 'button'
    prevBtn.className = 'dcs-btn'
    prevBtn.textContent = '↑'
    prevBtn.title = '上一个（Shift+Enter）'
    prevBtn.setAttribute('aria-label', '上一个匹配')
    nextBtn = document.createElement('button')
    nextBtn.type = 'button'
    nextBtn.className = 'dcs-btn'
    nextBtn.textContent = '↓'
    nextBtn.title = '下一个（Enter）'
    nextBtn.setAttribute('aria-label', '下一个匹配')
    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'dcs-btn'
    closeBtn.textContent = '×'
    closeBtn.title = '关闭（Esc）'
    closeBtn.setAttribute('aria-label', '关闭搜索')
    head.appendChild(icon)
    head.appendChild(input)
    head.appendChild(count)
    head.appendChild(prevBtn)
    head.appendChild(nextBtn)
    head.appendChild(closeBtn)

    results = el('div', 'dcs-results')
    results.style.display = showResultList ? '' : 'none'
    results.setAttribute('role', 'list')
    results.setAttribute('aria-label', '搜索结果')
    const foot = el('div', 'dcs-foot', 'Enter 下一个 · Shift+Enter 上一个 · Esc 关闭')
    panel.appendChild(head)
    panel.appendChild(results)
    panel.appendChild(foot)
    document.body.appendChild(panel)

    input.addEventListener('input', () => {
      scheduleSearch()
    })
    input.addEventListener('compositionstart', () => {
      composing = true
    })
    input.addEventListener('compositionend', () => {
      composing = false
      scheduleSearch()
    })
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        ev.stopPropagation()
        close()
        return
      }
      if (ev.key === 'Enter') {
        ev.preventDefault()
        ev.stopPropagation()
        if (matches.length === 0) runSearch()
        if (matches.length > 0) {
          const base = current < 0 ? 0 : current + (ev.shiftKey ? -1 : 1)
          select(base, true)
        }
        return
      }
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault()
        ev.stopPropagation()
        if (matches.length > 0) {
          const base = current + (ev.key === 'ArrowDown' ? 1 : -1)
          select(base, true)
        }
      }
    })
    prevBtn.addEventListener('click', () => select(current - 1, true))
    nextBtn.addEventListener('click', () => select(current + 1, true))
    closeBtn.addEventListener('click', close)
    updateCount()
  }

  function open(): boolean {
    const scroll = scroller()
    if (scroll === null) return false
    createPanel()
    if (panel === null || input === null) return false
    const content = contentRoot()
    openSession = content?.getAttribute('data-conversation-session') ?? ''
    panel.style.display = 'block'
    positionPanel()
    input.focus({ preventScroll: true })
    input.select()
    if (input.value.trim() !== '') runSearch()
    else renderResults()
    return true
  }

  function close(): void {
    if (panel === null) return
    panel.style.display = 'none'
    clearHighlights()
    matches = []
    current = -1
    if (results !== null) results.replaceChildren()
    updateCount()
    input?.blur()
  }

  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape' && panel !== null && panel.style.display !== 'none') {
      ev.preventDefault()
      ev.stopPropagation()
      close()
    }
  }

  const onResize = (): void => {
    if (panel !== null && panel.style.display !== 'none') positionPanel()
  }

  // 切会话时不要留着上一会话的命中；范围也会失效。
  let sessionObserver: MutationObserver | null = null
  const watchSession = (): void => {
    const content = contentRoot()
    if (content === null || sessionObserver !== null) return
    sessionObserver = new MutationObserver(() => {
      if (panel === null || panel.style.display === 'none') return
      const next = contentRoot()?.getAttribute('data-conversation-session') ?? ''
      if (openSession !== '' && next !== openSession) close()
    })
    sessionObserver.observe(content, {
      attributes: true,
      attributeFilter: ['data-conversation-session'],
    })
  }

  document.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('resize', onResize)
  watchSession()
  openConversationSearch = open

  return () => {
    document.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('resize', onResize)
    window.removeEventListener('message', onSearchColorMessage)
    sessionObserver?.disconnect()
    sessionObserver = null
    window.clearTimeout(debounce)
    clearHighlights()
    panel?.remove()
    panel = null
    input = null
    count = null
    results = null
    prevBtn = null
    nextBtn = null
    colorStyle?.remove()
    colorStyle = null
    if (openConversationSearch === open) openConversationSearch = null
    style.remove()
  }
}

/* ---------- 独立历史对话搜索（标题栏按钮） ---------- */

function ensureHistoryStyle(): HTMLStyleElement {
  const old = document.querySelector<HTMLStyleElement>(`[${HISTORY_STYLE_ATTR}]`)
  if (old !== null) return old
  const style = document.createElement('style')
  style.setAttribute(HISTORY_STYLE_ATTR, '')
  style.textContent = `
[${HISTORY_ATTR}] {
  position: fixed; inset: 0; z-index: 10008; display: none;
  align-items: flex-start; justify-content: center;
  padding: 8vh 16px 16px; background: rgba(2,8,12,.62); backdrop-filter: blur(3px);
}
[${HISTORY_ATTR}][data-open="1"] { display: flex; }
[${HISTORY_ATTR}] .dhs-modal {
  width: min(720px, calc(100vw - 32px)); max-height: min(620px, 80vh);
  display: flex; flex-direction: column; overflow: hidden;
  border: 1px solid var(--dsw-alias-separator-primary, rgba(126,197,214,.24));
  border-radius: 16px; background: var(--dsw-alias-bg-elevated, #0b1b24);
  color: var(--dsw-alias-text-primary, #e8f3f6);
  box-shadow: 0 28px 90px rgba(0,0,0,.6), 0 1px 0 rgba(255,255,255,.04) inset;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
[${HISTORY_ATTR}] .dhs-search {
  display: flex; align-items: center; gap: 9px; margin: 14px 14px 8px; padding: 0 12px;
  height: 44px; border-radius: 12px; background: var(--dsw-alias-bg-base, #07141c);
  border: 1px solid var(--dsw-alias-separator-primary, rgba(126,197,214,.28));
}
[${HISTORY_ATTR}] .dhs-search svg { width: 18px; height: 18px; flex: none; color: #46e5c3; }
[${HISTORY_ATTR}] .dhs-input {
  flex: 1; min-width: 0; height: 40px; border: 0; outline: none; background: transparent;
  color: inherit; font: inherit; font-size: 14px;
}
[${HISTORY_ATTR}] .dhs-input::placeholder { color: var(--dsw-alias-text-tertiary, #6f8992); }
[${HISTORY_ATTR}] .dhs-clear, [${HISTORY_ATTR}] .dhs-close {
  flex: none; border: 0; background: transparent; color: var(--dsw-alias-text-secondary, #9db4bd);
  cursor: pointer; font: inherit; border-radius: 6px;
}
[${HISTORY_ATTR}] .dhs-clear { padding: 4px 7px; font-size: 12px; display: none; }
[${HISTORY_ATTR}] .dhs-clear[data-show="1"] { display: block; }
[${HISTORY_ATTR}] .dhs-close { width: 28px; height: 28px; font-size: 20px; line-height: 1; }
[${HISTORY_ATTR}] .dhs-clear:hover, [${HISTORY_ATTR}] .dhs-close:hover { color: #46e5c3; background: rgba(70,229,195,.08); }
[${HISTORY_ATTR}] .dhs-tabs { display: flex; gap: 8px; padding: 0 16px 10px; }
[${HISTORY_ATTR}] .dhs-tab {
  border: 0; border-radius: 999px; padding: 5px 12px; cursor: pointer;
  background: var(--dsw-alias-bg-base, #07141c); color: var(--dsw-alias-text-secondary, #9db4bd);
  font: inherit; font-size: 12px;
}
[${HISTORY_ATTR}] .dhs-tab.on { background: rgba(70,229,195,.16); color: #46e5c3; }
[${HISTORY_ATTR}] .dhs-body { flex: 1; min-height: 0; overflow: auto; padding: 0 10px 14px; }
[${HISTORY_ATTR}] .dhs-section-title {
  padding: 10px 8px 5px; font-size: 11px; color: var(--dsw-alias-text-tertiary, #6f8992);
}
[${HISTORY_ATTR}] .dhs-row {
  display: flex; align-items: flex-start; gap: 9px; width: 100%; margin: 0 0 1px;
  padding: 8px; border: 0; border-radius: 8px; background: transparent; cursor: pointer;
  color: var(--dsw-alias-text-secondary, #c9dde3); font: inherit; text-align: left;
}
[${HISTORY_ATTR}] .dhs-row:hover { background: var(--dsw-alias-bg-hover, rgba(70,229,195,.08)); }
[${HISTORY_ATTR}] .dhs-avatar {
  width: 24px; height: 24px; flex: none; display: grid; place-items: center;
  border-radius: 50%; background: rgba(70,229,195,.12); color: #46e5c3;
}
[${HISTORY_ATTR}] .dhs-avatar svg { width: 14px; height: 14px; }
[${HISTORY_ATTR}] .dhs-main { flex: 1; min-width: 0; display: grid; gap: 2px; }
[${HISTORY_ATTR}] .dhs-line { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; min-width: 0; }
[${HISTORY_ATTR}] .dhs-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--dsw-alias-text-primary, #e8f3f6); }
[${HISTORY_ATTR}] .dhs-where { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10.5px; color: var(--dsw-alias-text-tertiary, #6f8992); }
[${HISTORY_ATTR}] .dhs-time { flex: none; font-size: 10px; color: var(--dsw-alias-text-tertiary, #6f8992); }
[${HISTORY_ATTR}] .dhs-snippet {
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  font-size: 12px; line-height: 1.45; color: var(--dsw-alias-text-secondary, #9db4bd);
}
[${HISTORY_ATTR}] .dhs-body mark { background: var(--dhs-mark, rgba(70,229,195,.24)); color: inherit; border-radius: 2px; }
[${HISTORY_ATTR}] .dhs-empty { padding: 26px 12px; text-align: center; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-text-secondary, #7d959e); }
[${HISTORY_ATTR}] .dhs-foot { padding: 0 18px 12px; font-size: 10px; color: var(--dsw-alias-text-tertiary, #6f8992); }
[${HISTORY_ATTR}][data-inline="1"] {
  position: static; inset: auto; z-index: auto; display: block; width: 100%; height: 100%;
  padding: 0; background: transparent; backdrop-filter: none;
}
[${HISTORY_ATTR}][data-inline="1"] .dhs-modal {
  width: 100%; max-width: 920px; height: 100%; max-height: none; margin: 0 auto;
  border: 0; border-radius: 0; box-shadow: none; background: transparent;
}
[${HISTORY_ATTR}][data-inline="1"] .dhs-search { margin: 0 0 12px; background: var(--dsw-alias-bg-layer-1, #0b1b24); }
[${HISTORY_ATTR}][data-inline="1"] .dhs-close { display: none; }
[${HISTORY_ATTR}][data-inline="1"] .dhs-foot { padding-left: 8px; padding-right: 8px; }
[data-dsh-companion-history-page] { height: 100%; min-height: 0; padding: 22px 26px; box-sizing: border-box; }
[data-dsh-companion-history-page] .dhs-page-host { height: 100%; min-height: 0; }
@media (max-width: 560px) {
  [${HISTORY_ATTR}] { padding: 3vh 8px 8px; }
  [${HISTORY_ATTR}] .dhs-modal { width: 100%; max-height: 92vh; border-radius: 12px; }
}
`
  document.head.appendChild(style)
  return style
}

interface HistorySessionHit {
  sessionId: string
  title: string
  cwd?: string
}
interface HistoryMessageHit {
  sessionId: string
  title: string
  snippet: string
  time: number
  type: string
  seq?: number
  turn?: number
}
interface HistoryResult {
  sessions: HistorySessionHit[]
  messages: HistoryMessageHit[]
  nextCursor?: number
  done?: boolean
  error?: string
}
type HistoryTab = 'all' | 'messages' | 'sessions'

/** 独立历史对话搜索：标题栏按钮打开，不与 Ctrl+F 当前会话搜索共用 UI/状态。 */
function mountHistorySearch(ctx: ClientCtx): ClientDisposer {
  document.querySelector(`[${HISTORY_ATTR}]`)?.remove()
  const style = ensureHistoryStyle()
  let root: HTMLElement | null = null
  let input: HTMLInputElement | null = null
  let body: HTMLElement | null = null
  let foot: HTMLElement | null = null
  let clearBtn: HTMLButtonElement | null = null
  let tab: HistoryTab = 'all'
  let result: HistoryResult = { sessions: [], messages: [] }
  let loading = false
  let error = ''
  let debounce = 0
  let sequence = 0
  let composing = false
  let controller: AbortController | null = null
  let visible = false
  let currentHistoryColor = DEFAULT_SEARCH_COLOR

  function normalizeHistoryColor(raw: string | null): string {
    return raw !== null && /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : DEFAULT_SEARCH_COLOR
  }

  function historyRgba(hex: string, alpha: number): string {
    const n = Number.parseInt(hex.slice(1), 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
  }

  function applyHistoryColor(raw: string): void {
    currentHistoryColor = normalizeHistoryColor(raw)
    if (root === null) return
    root.style.setProperty('--dhs-mark', historyRgba(currentHistoryColor, 0.28))
  }

  function storedHistoryColor(): string {
    try {
      return normalizeHistoryColor(localStorage.getItem(SEARCH_COLOR_KEY))
    } catch {
      return DEFAULT_SEARCH_COLOR
    }
  }

  applyHistoryColor(storedHistoryColor())

  function icon(kind: 'search' | 'chat'): string {
    return kind === 'search'
      ? '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.6" stroke="currentColor" stroke-width="1.3"/><path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'
      : '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 3.5h9v7h-5l-2.5 2v-2h-1.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>'
  }

  function formatTime(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return ''
    const d = new Date(ms)
    const now = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
    return d.toDateString() === now.toDateString() ? time : `${d.getMonth() + 1}月${d.getDate()}日 ${time}`
  }

  function marked(text: string, query: string): DocumentFragment {
    const fragment = document.createDocumentFragment()
    const at = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
    if (at < 0) {
      fragment.appendChild(document.createTextNode(text))
      return fragment
    }
    fragment.appendChild(document.createTextNode(text.slice(0, at)))
    const mark = document.createElement('mark')
    mark.textContent = text.slice(at, at + query.length)
    fragment.appendChild(mark)
    fragment.appendChild(document.createTextNode(text.slice(at + query.length)))
    return fragment
  }

  function section(title: string): HTMLElement {
    return el('div', 'dhs-section-title', title)
  }

  function sessionIndex(): Array<{ id: string; title: string; cwd?: string }> {
    try {
      const snapshot = (
        typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
      ) as
        | {
            list?: {
              getSnapshot?: () => {
                ids?: string[]
                byId?: Record<string, { title?: string; cwd?: string }>
              }
            }
          }
        | undefined
      const current = snapshot?.list?.getSnapshot?.()
      const byId = current?.byId ?? {}
      const ids = Array.isArray(current?.ids) ? current.ids : Object.keys(byId)
      return ids.map((id) => {
        const summary = byId[id] ?? {}
        const title = summary.title?.trim() ?? ''
        const cwd = summary.cwd ?? ''
        const base = cwd.split(/[\\/]/).filter(Boolean).pop() ?? ''
        return {
          id,
          title: title !== '' ? title : base !== '' ? base : id.slice(0, 8),
          ...(cwd === '' ? {} : { cwd }),
        }
      })
    } catch {
      return []
    }
  }

  function titleFor(id: string): string {
    return sessionIndex().find((entry) => entry.id === id)?.title ?? id.slice(0, 8)
  }

  function localSessions(query: string): HistorySessionHit[] {
    const needle = query.toLocaleLowerCase()
    const hits: HistorySessionHit[] = []
    for (const entry of sessionIndex()) {
      if (!entry.title.toLocaleLowerCase().includes(needle)) continue
      hits.push({
        sessionId: entry.id,
        title: entry.title,
        ...(entry.cwd === undefined ? {} : { cwd: entry.cwd }),
      })
      if (hits.length >= 12) break
    }
    return hits
  }

  function sessionRow(hit: HistorySessionHit): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'dhs-row'
    const avatar = el('span', 'dhs-avatar')
    avatar.innerHTML = icon('chat')
    const main = el('span', 'dhs-main')
    const line = el('span', 'dhs-line')
    const title = el('span', 'dhs-title')
    title.appendChild(marked(hit.title, input?.value.trim() ?? ''))
    line.appendChild(title)
    if (hit.cwd !== undefined && hit.cwd !== '') {
      line.appendChild(el('span', 'dhs-where', hit.cwd.split(/[\\/]/).filter(Boolean).pop() ?? ''))
    }
    main.appendChild(line)
    button.appendChild(avatar)
    button.appendChild(main)
    button.addEventListener('click', () => openSession(hit.sessionId, undefined, input?.value.trim() ?? ''))
    return button
  }

  function messageRow(hit: HistoryMessageHit): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'dhs-row'
    const avatar = el('span', 'dhs-avatar')
    avatar.innerHTML = icon('chat')
    const main = el('span', 'dhs-main')
    const line = el('span', 'dhs-line')
    line.appendChild(el('span', 'dhs-where', hit.title))
    line.appendChild(el('span', 'dhs-time', formatTime(hit.time)))
    const snippet = el('span', 'dhs-snippet')
    snippet.appendChild(marked(hit.snippet, input?.value.trim() ?? ''))
    main.appendChild(line)
    main.appendChild(snippet)
    button.appendChild(avatar)
    button.appendChild(main)
    button.addEventListener('click', () => openMessage(hit))
    return button
  }

  function render(): void {
    if (body === null) return
    body.replaceChildren()
    if (input === null || input.value.trim() === '') {
      body.appendChild(el('div', 'dhs-empty', '输入关键词，搜索所有历史对话的标题和消息。'))
      return
    }
    const sessions = result.sessions
    const messages = result.messages
    const showSessions = tab === 'all' || tab === 'sessions'
    const showMessages = tab === 'all' || tab === 'messages'
    const sessionLimit = tab === 'all' ? 5 : sessions.length
    const messageLimit = tab === 'all' ? 8 : messages.length
    if (showSessions && sessions.length > 0) {
      body.appendChild(section('对话'))
      for (const hit of sessions.slice(0, sessionLimit)) body.appendChild(sessionRow(hit))
    }
    if (showMessages && messages.length > 0) {
      body.appendChild(section('消息'))
      for (const hit of messages.slice(0, messageLimit)) body.appendChild(messageRow(hit))
    }
    if (loading) {
      body.appendChild(el('div', 'dhs-empty', '搜索中…'))
      return
    }
    if (error !== '') {
      body.appendChild(el('div', 'dhs-empty', error))
      return
    }
    if (
      (showSessions && sessions.length > 0) ||
      (showMessages && messages.length > 0)
    ) {
      return
    }
    body.appendChild(el('div', 'dhs-empty', '没有找到匹配的历史对话。试试更短的关键词。'))
  }

  function setTab(next: HistoryTab): void {
    tab = next
    root?.querySelectorAll<HTMLElement>('.dhs-tab').forEach((button) => {
      button.classList.toggle('on', button.dataset.tab === next)
    })
    render()
  }

  function runSearch(): void {
    if (input === null) return
    const query = input.value.trim()
    sequence++
    const mySequence = sequence
    controller?.abort()
    controller = null
    window.clearTimeout(debounce)
    loading = false
    error = ''
    result = { sessions: [], messages: [] }
    if (query === '') {
      render()
      return
    }
    // 标题匹配在本地瞬时完成，先显示「对话」；消息由 Node 扫描后补上。
    result = { sessions: localSessions(query), messages: [] }
    loading = true
    render()
    const ac = new AbortController()
    controller = ac
    void (async () => {
      try {
        if (historySearchServerUrl === '') {
          const found = await discoverServer()
          if (found === null) throw new Error('伴侣本地服务不可用')
          historySearchServerUrl = found.url
        }
        const seen = new Set<string>()
        const allMessages: HistoryMessageHit[] = []
        let cursor = 0
        for (;;) {
          const res = await fetch(
            `${historySearchServerUrl}/api/history-search?q=${encodeURIComponent(query)}&cursor=${cursor}`,
            { signal: ac.signal },
          ).catch((reason: unknown) => {
            historySearchServerUrl = ''
            throw reason
          })
          if (!res.ok) throw new Error(`本地搜索服务返回 ${res.status}`)
          const data = (await res.json()) as HistoryResult
          if (mySequence !== sequence) return
          if (typeof data.error === 'string' && data.error !== '') throw new Error(data.error)
          for (const hit of Array.isArray(data.messages) ? data.messages : []) {
            const key = `${hit.sessionId}:${String(hit.seq ?? hit.time)}:${hit.type}`
            if (seen.has(key)) continue
            seen.add(key)
            allMessages.push({ ...hit, title: hit.title || titleFor(hit.sessionId) })
          }
          result = {
            sessions: localSessions(query),
            messages: allMessages,
            done: data.done === true,
          }
          if (foot !== null) foot.textContent = '正在搜索全部会话…'
          render()
          if (data.done === true || typeof data.nextCursor !== 'number' || data.nextCursor <= cursor) break
          cursor = data.nextCursor
          // 让出一帧，避免连续分页把渲染和宿主事件循环堵住。
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
          if (mySequence !== sequence) return
        }
        if (mySequence !== sequence) return
        loading = false
        result = { ...result, done: true }
        if (foot !== null) foot.textContent = '搜索完成 · 点击消息打开并跳到对应轮次'
        render()
      } catch (reason) {
        if (mySequence !== sequence) return
        loading = false
        error = `历史搜索失败：${reason instanceof Error ? reason.message : String(reason)}`
        if (foot !== null) foot.textContent = '搜索中断 · 点击消息打开并跳到对应轮次'
        render()
      }
    })()
  }

  function scheduleSearch(): void {
    window.clearTimeout(debounce)
    debounce = window.setTimeout(() => {
      if (!composing) runSearch()
    }, 350)
  }

  function openSession(sessionId: string, turn?: number, query = ''): void {
    let workspace: { openSession?: (id: string) => void } | null = null
    try {
      workspace = (typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined) as
        | { openSession?: (id: string) => void }
        | null
    } catch {
      workspace = null
    }
    if (typeof workspace?.openSession !== 'function') {
      error = '无法打开会话：宿主导航服务不可用'
      render()
      return
    }
    try {
      workspace.openSession(sessionId)
    } catch (reason) {
      error = `无法打开会话：${reason instanceof Error ? reason.message : String(reason)}`
      render()
      return
    }
    close()
    if (typeof turn === 'number') jumpToTurn(sessionId, turn, query)
    else if (query !== '') highlightWhenReady(sessionId, query)
  }

  async function fetchTurn(sessionId: string, seq: number): Promise<number | undefined> {
    try {
      if (historySearchServerUrl === '') {
        const found = await discoverServer()
        if (found === null) return undefined
        historySearchServerUrl = found.url
      }
      const res = await fetch(
        `${historySearchServerUrl}/api/history-turn?sessionId=${encodeURIComponent(sessionId)}&seq=${seq}`,
      )
      if (!res.ok) return undefined
      const data = (await res.json()) as { turn?: unknown }
      return typeof data.turn === 'number' ? data.turn : undefined
    } catch {
      return undefined
    }
  }

  function openMessage(hit: HistoryMessageHit): void {
    const query = input?.value.trim() ?? ''
    if (typeof hit.turn === 'number') {
      openSession(hit.sessionId, hit.turn, query)
      return
    }
    // 先打开会话，轮次解析只在这条消息上做一次，不拖慢整次搜索。
    openSession(hit.sessionId, undefined, query)
    if (typeof hit.seq !== 'number') return
    void fetchTurn(hit.sessionId, hit.seq).then((turn) => {
      if (typeof turn === 'number') jumpToTurn(hit.sessionId, turn, query)
    })
  }

  function highlightQueryInConversation(query: string): void {
    const needle = query.trim()
    const scroll = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    const registry = (
      CSS as unknown as { highlights?: { set(name: string, value: unknown): void; delete(name: string): void } }
    ).highlights
    const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
    if (needle === '' || scroll === null || registry === undefined || HighlightCtor === undefined) return
    const ranges: Range[] = []
    const lower = needle.toLocaleLowerCase()
    const walker = document.createTreeWalker(scroll, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement
        if (parent === null) return NodeFilter.FILTER_REJECT
        if (parent.closest('button, [data-composer-seat], [hidden], [aria-hidden="true"]') !== null) {
          return NodeFilter.FILTER_REJECT
        }
        return NodeFilter.FILTER_ACCEPT
      },
    })
    while (ranges.length < 300) {
      const node = walker.nextNode()
      if (node === null) break
      const text = node.nodeValue ?? ''
      let at = text.toLocaleLowerCase().indexOf(lower)
      while (at >= 0 && ranges.length < 300) {
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + needle.length)
        ranges.push(range)
        at = text.toLocaleLowerCase().indexOf(lower, at + needle.length)
      }
    }
    try {
      registry.delete(SEARCH_CURRENT_HIGHLIGHT)
      if (ranges.length === 0) {
        registry.delete(SEARCH_HIGHLIGHT)
        return
      }
      registry.set(SEARCH_HIGHLIGHT, new HighlightCtor(...ranges))
      const first = ranges[0]?.getClientRects()[0]
      if (first !== undefined) {
        const box = scroll.getBoundingClientRect()
        scroll.scrollBy({
          top: first.top - box.top - box.height / 2,
          behavior: 'smooth',
        })
      }
    } catch {
      /* DOM 重绘时 Range 失效，忽略即可 */
    }
  }

  function highlightWhenReady(sessionId: string, query: string, attempt = 0): void {
    const content =
      document.querySelector<HTMLElement>('[data-conversation-content]') ??
      document.querySelector<HTMLElement>('[data-conversation-scroll]')
    const current = content?.getAttribute('data-conversation-session') ?? ''
    if (current !== sessionId || document.querySelector('[data-conversation-scroll]') === null) {
      if (attempt < 30) window.setTimeout(() => highlightWhenReady(sessionId, query, attempt + 1), 150)
      return
    }
    highlightQueryInConversation(query)
  }

  function clickTurnRail(turn: number): boolean {
    const nav = [...document.querySelectorAll<HTMLElement>('nav')].find((node) => {
      const label = node.getAttribute('aria-label') ?? ''
      return label === '轮次导航' || label === 'Turn navigation'
    })
    if (nav === undefined) return false
    const labels = [
      `跳转到第 ${turn} 轮`,
      `加载并跳转到第 ${turn} 轮`,
      `Jump to turn ${turn}`,
      `Load and jump to turn ${turn}`,
    ]
    const button = [...nav.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find(
      (node) => labels.includes(node.getAttribute('aria-label') ?? '') && node.offsetParent !== null,
    )
    if (button !== undefined) {
      button.click()
      return true
    }
    const marks = [...nav.querySelectorAll<HTMLButtonElement>('button[data-index]')]
    let offset: number | undefined
    for (const mark of marks) {
      const match = (mark.getAttribute('aria-label') ?? '').match(/(\d+)/)
      const index = Number(mark.dataset.index)
      if (match !== null && Number.isSafeInteger(index)) {
        offset = Number(match[1]) - index
        break
      }
    }
    if (offset === undefined) return false
    const scroller = [...nav.querySelectorAll<HTMLElement>('div')].find(
      (node) => node.scrollHeight > node.clientHeight + 2,
    )
    if (scroller === undefined) return false
    scroller.scrollTop = Math.max(0, (turn - offset) * 10 - scroller.clientHeight / 2)
    return false
  }

  function jumpToTurn(sessionId: string, turn: number, query: string, attempt = 0): void {
    const content =
      document.querySelector<HTMLElement>('[data-conversation-content]') ??
      document.querySelector<HTMLElement>('[data-conversation-scroll]')
    const current = content?.getAttribute('data-conversation-session') ?? ''
    if (current !== sessionId || document.querySelector('[data-conversation-scroll]') === null) {
      if (attempt < 30) window.setTimeout(() => jumpToTurn(sessionId, turn, query, attempt + 1), 150)
      return
    }
    const row = [...document.querySelectorAll<HTMLElement>(`[data-chat-turn="${turn}"]`)].find(
      (node) => node.offsetParent !== null,
    )
    if (row !== undefined) {
      row.scrollIntoView({ block: 'start' })
      highlightQueryInConversation(query)
      return
    }
    if (clickTurnRail(turn)) {
      if (attempt < 30) window.setTimeout(() => jumpToTurn(sessionId, turn, query, attempt + 1), 180)
      return
    }
    if (attempt < 30) window.setTimeout(() => jumpToTurn(sessionId, turn, query, attempt + 1), 150)
  }

  function createPanel(): void {
    if (root !== null) return
    root = document.createElement('div')
    root.setAttribute(HISTORY_ATTR, '')
    root.setAttribute('data-dsh-plugin', 'dsh-companion')
    root.setAttribute('data-dsh-part', 'history-search')
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-modal', 'true')
    root.setAttribute('aria-label', '搜索历史对话')
    const modal = el('div', 'dhs-modal')
    const searchRow = el('div', 'dhs-search')
    const searchIcon = el('span', '')
    searchIcon.innerHTML = icon('search')
    input = document.createElement('input')
    input.className = 'dhs-input'
    input.type = 'search'
    input.placeholder = '搜索历史对话'
    input.setAttribute('aria-label', '搜索历史对话')
    input.autocomplete = 'off'
    input.spellcheck = false
    clearBtn = document.createElement('button')
    clearBtn.type = 'button'
    clearBtn.className = 'dhs-clear'
    clearBtn.textContent = '清空'
    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'dhs-close'
    closeBtn.textContent = '×'
    closeBtn.title = '关闭（Esc）'
    closeBtn.setAttribute('aria-label', '关闭历史搜索')
    searchRow.appendChild(searchIcon)
    searchRow.appendChild(input)
    searchRow.appendChild(clearBtn)
    searchRow.appendChild(closeBtn)
    const tabs = el('div', 'dhs-tabs')
    for (const [id, label] of [['all', '全部'], ['messages', '消息'], ['sessions', '对话']] as const) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'dhs-tab'
      button.dataset.tab = id
      button.textContent = label
      button.addEventListener('click', () => setTab(id))
      tabs.appendChild(button)
    }
    body = el('div', 'dhs-body')
    body.setAttribute('role', 'list')
    foot = el('div', 'dhs-foot', '点击消息打开会话并跳到对应轮次')
    modal.appendChild(searchRow)
    modal.appendChild(tabs)
    modal.appendChild(body)
    modal.appendChild(foot)
    root.appendChild(modal)

    root.addEventListener('click', (event) => {
      if (event.target === root && root?.dataset.inline !== '1') close()
    })
    input.addEventListener('input', () => {
      if (clearBtn !== null) clearBtn.dataset.show = input?.value.trim() === '' ? '0' : '1'
      if (!composing) scheduleSearch()
    })
    input.addEventListener('compositionstart', () => {
      composing = true
    })
    input.addEventListener('compositionend', () => {
      composing = false
      scheduleSearch()
    })
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && root?.dataset.inline !== '1') {
        event.preventDefault()
        event.stopPropagation()
        close()
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const first = body?.querySelector<HTMLElement>('.dhs-row')
        first?.click()
      }
    })
    clearBtn.addEventListener('click', () => {
      if (input === null || clearBtn === null) return
      input.value = ''
      clearBtn.dataset.show = '0'
      runSearch()
      input.focus()
    })
    closeBtn.addEventListener('click', close)
    setTab('all')
    applyHistoryColor(currentHistoryColor)
  }

  function openIn(host: HTMLElement): boolean {
    if (!host.isConnected) return false
    createPanel()
    if (root === null || input === null) return false
    if (root.parentElement !== host) host.appendChild(root)
    root.dataset.inline = '1'
    root.removeAttribute('aria-modal')
    visible = true
    root.dataset.open = '1'
    if (foot !== null) foot.textContent = '点击消息打开会话并跳到对应轮次'
    applyHistoryColor(storedHistoryColor())
    input.focus({ preventScroll: true })
    if (input.value.trim() !== '') runSearch()
    else render()
    return true
  }

  function close(): void {
    visible = false
    if (root === null) return
    root.dataset.open = '0'
    controller?.abort()
    controller = null
    window.clearTimeout(debounce)
    input?.blur()
    root.remove()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (visible && root?.dataset.inline !== '1' && event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }
  const onHistoryColorMessage = (event: MessageEvent): void => {
    const data = event.data as { type?: unknown; color?: unknown } | null
    if (data === null || typeof data !== 'object') return
    if (data.type === 'dsh-companion:search-color' && typeof data.color === 'string') {
      applyHistoryColor(data.color)
    }
  }
  window.addEventListener('message', onHistoryColorMessage)
  document.addEventListener('keydown', onKeyDown, true)
  openHistorySearchIn = openIn
  closeHistorySearch = close

  return () => {
    document.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('message', onHistoryColorMessage)
    controller?.abort()
    controller = null
    window.clearTimeout(debounce)
    if (openHistorySearchIn === openIn) openHistorySearchIn = null
    if (closeHistorySearch === close) closeHistorySearch = null
    root?.remove()
    root = null
    input = null
    body = null
    foot = null
    clearBtn = null
    style.remove()
  }
}

/** 侧栏「历史搜索」入口：挂在「插件」上方，点开是独立的搜索页。 */
function mountHistorySidebarEntry(
  ctx: ClientCtx,
  modRequire?: (id: string) => any,
): void {
  const slots = ctx.slots
  if (slots === undefined || openHistorySearchIn === null) return
  let React: any = null
  try {
    React = modRequire !== undefined ? modRequire('react') : null
  } catch {
    React = null
  }
  if (React === null || typeof React.createElement !== 'function') return
  const h = React.createElement
  const panelId = 'companion-history'

  function HistoryIcon(props: { size?: number }): any {
    const size = typeof props?.size === 'number' ? props.size : 16
    return h(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': 'true',
      },
      h('circle', { cx: 7, cy: 7, r: 4.5, stroke: 'currentColor', strokeWidth: 1.3 }),
      h('path', {
        d: 'm10.4 10.4 3.1 3.1',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
      }),
      h('path', {
        d: 'M7 4.6V7l1.7 1',
        stroke: 'currentColor',
        strokeWidth: 1.1,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    )
  }

  function HistoryPage(): any {
    const hostRef = React.useRef(null)
    React.useEffect(() => {
      const host = hostRef.current
      if (host !== null) openHistorySearchIn?.(host)
      return () => closeHistorySearch?.()
    }, [])
    return h(
      'div',
      { 'data-dsh-companion-history-page': '' },
      h('div', { className: 'dhs-page-host', ref: hostRef }),
    )
  }

  try {
    ctx.effect(() => {
      const disposeList = slots.inject('sidebar.panellist', () =>
        slots.register(
          {
            name: 'sidebar.panellist',
            id: panelId,
            // 插件是 0，自动化任务是 10；-100 让它排在「插件」上方。
            order: -100,
            label: '历史搜索',
          },
          HistoryIcon,
        ),
      )
      const disposeMain = slots.inject('main', () =>
        slots.register(
          {
            name: 'main',
            key: panelId,
          },
          HistoryPage,
        ),
      )
      return () => {
        if (typeof disposeList === 'function') disposeList()
        if (typeof disposeMain === 'function') disposeMain()
      }
    })
  } catch {
    /* 旧宿主没有侧栏面板槽位时静默降级。 */
  }
}

/** 对话标题栏 utilities 槽位放一个搜索图标；点击等价 Ctrl+F，不抢快捷键。 */
function mountSearchHeaderButton(
  ctx: ClientCtx,
  modRequire?: (id: string) => any,
): void {
  const slots = ctx.slots
  if (slots === undefined) return
  let React: any = null
  try {
    React = modRequire !== undefined ? modRequire('react') : null
  } catch {
    React = null
  }
  if (React === null || typeof React.createElement !== 'function') return
  const h = React.createElement

  function SearchHeaderButton(): any {
    return h(
      'button',
      {
        type: 'button',
        'data-dsh-companion-find-button': '',
        'aria-label': '搜索当前会话',
        'aria-keyshortcuts': 'Control+F Meta+F',
        title: '搜索当前会话 (Ctrl+F)',
        onClick: () => {
          openConversationSearch?.()
        },
      },
      h(
        'svg',
        {
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': 'true',
        },
        h('circle', {
          cx: 7,
          cy: 7,
          r: 4.6,
          stroke: 'currentColor',
          strokeWidth: 1.3,
        }),
        h('path', {
          d: 'm10.5 10.5 3 3',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
        }),
      ),
    )
  }

  try {
    ctx.effect(() => {
      const dispose = slots.inject('conversation.session.header.utilities', () =>
        slots.register(
          {
            name: 'conversation.session.header.utilities',
            id: 'companion.search-conversation',
            // 排在 open-in-app(-10) / schedule(-5) / session-log(0) 之前，做右上角控件组最左边。
            order: -100,
          },
          SearchHeaderButton,
        ),
      )
      return typeof dispose === 'function' ? dispose : undefined
    })
  } catch {
    /* 旧宿主没有这个槽位时只保留 Ctrl+F */
  }
}

/** 没有 shortcuts 服务，或注册失败时的本地兜底（不会出现在设置列表里）。 */
function installFallbackSearchShortcut(): ClientDisposer {
  const onKey = (ev: KeyboardEvent): void => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.key.toLowerCase() !== 'f') return
    const el = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    if (el === null) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 1 || rect.height <= 1) return
    ev.preventDefault()
    ev.stopPropagation()
    openConversationSearch?.()
  }
  document.addEventListener('keydown', onKey, true)
  return () => document.removeEventListener('keydown', onKey, true)
}

/**
 * 用宿主官方 shortcuts 服务注册 Ctrl+F。
 * 这样 DSH 设置 → 通用 → 编辑快捷键（或 Mod+/）会列出「搜索当前会话」，
 * 也能跟随宿主改绑，而不是插件自己硬编码。
 */
function mountConversationSearchShortcut(ctx: ClientCtx): void {
  let shortcuts: { register(command: Record<string, unknown>): ClientDisposer | void } | undefined
  try {
    shortcuts =
      typeof ctx.get === 'function'
        ? (ctx.get('shortcuts') as { register(command: Record<string, unknown>): ClientDisposer | void } | undefined)
        : undefined
  } catch {
    shortcuts = undefined
  }
  const installFallback = (): void => {
    ctx.effect(() => installFallbackSearchShortcut())
  }
  if (shortcuts === undefined || typeof shortcuts.register !== 'function') {
    installFallback()
    return
  }

  try {
    ctx.effect(() => {
      const dispose = shortcuts.register({
        id: 'companion.conversation.search',
        label: () => '搜索当前会话',
        aliases: ['搜索当前会话', '搜索对话', 'find in conversation', 'search conversation'],
        defaults: {
          'desktop:macos': { code: 'KeyF', modifiers: ['primary'] },
          'desktop:windows': { code: 'KeyF', modifiers: ['primary'] },
          'desktop:linux': { code: 'KeyF', modifiers: ['primary'] },
          // Web 下 Ctrl+F 是浏览器查找，按 DSH 惯例用 Mod+Alt+F，避免被浏览器抢走。
          'web:macos': { code: 'KeyF', modifiers: ['primary', 'alt'] },
          'web:windows': { code: 'KeyF', modifiers: ['primary', 'alt'] },
          'web:linux': { code: 'KeyF', modifiers: ['primary', 'alt'] },
        },
        regions: ['page', 'editable', 'terminal'],
        modals: [],
        resolve: () => {
          if (openConversationSearch === null) {
            return { status: 'blocked', reason: '搜索暂不可用' }
          }
          const el = document.querySelector<HTMLElement>('[data-conversation-scroll]')
          if (el === null) {
            return { status: 'blocked', reason: '当前没有打开的会话' }
          }
          const rect = el.getBoundingClientRect()
          if (rect.width <= 1 || rect.height <= 1) {
            return { status: 'blocked', reason: '当前没有打开的会话' }
          }
          return {
            status: 'handled',
            run: () => {
              openConversationSearch?.()
            },
          }
        },
      })
      return typeof dispose === 'function' ? dispose : undefined
    })
  } catch {
    // 与已有 Ctrl+F 冲突或旧服务不支持时，至少保留本地快捷键。
    installFallback()
  }
}

/* ---------- 主装配 ---------- */

function mountBadge(): ClientDisposer {
  if (document.querySelector(`[${BADGE_ATTR}]`) !== null) return () => {}

  const container = document.createElement('div')
  container.setAttribute(BADGE_ATTR, '')
  container.setAttribute('data-dsh-plugin', 'dsh-companion')
  container.setAttribute('data-dsh-part', 'usage-badge')
  container.setAttribute('role', 'button')
  container.setAttribute('tabindex', '0')
  container.style.display = 'none'

  let serverUrl = ''
  let state: PetStatePayload | null = null
  let stats: StatsPayload | null = null
  let stopped = false
  let pollTimer = 0
  let discoverTimer = 0
  let panelModal: PanelModalRefs | null = null
  let offPanelKeys: (() => void) | null = null
  let attentionFrame = 0
  type AttentionKind = 'running' | 'unread'
  const attentionDots = new Map<Element, { dot: HTMLElement; kind: AttentionKind }>()
  const unreadSessions = new Set<string>()
  let previousActive = new Set<string>()
  const ATTENTION_DOT_CLASS = 'dsh-companion-spinner-dot'

  const sessionRow = (sessionId: string): HTMLElement | null =>
    document.querySelector<HTMLElement>(`[data-row-key="session:${CSS.escape(sessionId)}"]`)

  const stopAttentionDots = (): void => {
    if (attentionFrame !== 0) window.cancelAnimationFrame(attentionFrame)
    attentionFrame = 0
  }
  const startAttentionDots = (): void => {
    if (attentionFrame !== 0) return
    const tick = (now: number): void => {
      const t = (Math.sin(now / 300) + 1) / 2
      for (const [target, entry] of attentionDots) {
        const r = target.getBoundingClientRect()
        if (r.width === 0 || r.bottom < 0 || r.top > window.innerHeight) {
          entry.dot.style.display = 'none'
          continue
        }
        entry.dot.style.display = 'block'
        entry.dot.style.left = `${r.left + r.width / 2}px`
        entry.dot.style.top = `${r.top + r.height / 2}px`
        if (entry.kind === 'running') {
          entry.dot.style.opacity = (0.35 + t * 0.65).toFixed(2)
          entry.dot.style.transform = `translate(-50%, -50%) scale(${(0.78 + t * 0.30).toFixed(3)})`
        } else {
          // 已完成待查看：常亮，不呼吸。
          entry.dot.style.opacity = '1'
          entry.dot.style.transform = 'translate(-50%, -50%) scale(1)'
        }
      }
      attentionFrame = window.requestAnimationFrame(tick)
    }
    attentionFrame = window.requestAnimationFrame(tick)
  }
  const syncAttentionDots = (): void => {
    const desired = new Map<Element, AttentionKind>()
    for (const spinner of document.querySelectorAll<SVGElement>('[data-row-key^="session:"] svg[data-state="ongoing"]')) {
      desired.set(spinner, 'running')
    }
    for (const sessionId of [...unreadSessions]) {
      const row = sessionRow(sessionId)
      if (row === null) continue
      if (row.getAttribute('aria-selected') === 'true') {
        unreadSessions.delete(sessionId)
        continue
      }
      const target = row.querySelector<HTMLElement>('span[class*="_slot"]') ?? row
      if (!desired.has(target)) desired.set(target, 'unread')
    }
    for (const [target, entry] of [...attentionDots]) {
      if (!desired.has(target)) {
        entry.dot.remove()
        attentionDots.delete(target)
      }
    }
    for (const [target, kind] of desired) {
      let entry = attentionDots.get(target)
      if (entry === undefined) {
        const dot = document.createElement('span')
        dot.className = ATTENTION_DOT_CLASS
        dot.setAttribute('aria-hidden', 'true')
        dot.dataset.kind = kind
        document.body.appendChild(dot)
        entry = { dot, kind }
        attentionDots.set(target, entry)
      } else if (entry.kind !== kind) {
        entry.kind = kind
        entry.dot.dataset.kind = kind
      }
    }
    if (attentionDots.size > 0) startAttentionDots()
    else stopAttentionDots()
  }
  const trackTaskTransitions = (snapshot: PetStatePayload): void => {
    const active = new Set((snapshot.tasks ?? []).map((task) => task.sessionId).filter(Boolean))
    for (const sessionId of active) unreadSessions.delete(sessionId)
    for (const sessionId of previousActive) {
      if (active.has(sessionId)) continue
      const row = sessionRow(sessionId)
      if (row !== null && row.getAttribute('aria-selected') === 'true') continue
      unreadSessions.add(sessionId)
    }
    previousActive = active
    syncAttentionDots()
  }
  const onSessionClick = (ev: MouseEvent): void => {
    const target = ev.target instanceof Element ? ev.target : null
    const row = target?.closest<HTMLElement>('[data-row-key^="session:"]') ?? null
    if (row === null) return
    const key = row.getAttribute('data-row-key') ?? ''
    const sessionId = key.startsWith('session:') ? key.slice('session:'.length) : ''
    if (sessionId !== '' && unreadSessions.delete(sessionId)) syncAttentionDots()
  }
  document.addEventListener('click', onSessionClick, true)

  const openPanelModal = (): void => {
    if (serverUrl === '' || panelModal === null) return
    panelModal.iframe.src = `${serverUrl}/panel`
    panelModal.root.setAttribute('data-open', '1')
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') closePanelModal()
    }
    document.addEventListener('keydown', onKey, true)
    offPanelKeys = () => document.removeEventListener('keydown', onKey, true)
  }

  const setLiveText = (text: string): void => {
    if (panelModal === null) return
    const live = panelModal.root.querySelector('[data-dsh-part="panel-live"]')
    if (live !== null) live.textContent = text
  }

  const closePanelModal = (): void => {
    if (panelModal === null) return
    offPanelKeys?.()
    offPanelKeys = null
    panelModal.iframe.src = 'about:blank'
    panelModal.root.setAttribute('data-open', '0')
  }

  // 角标点击 = 直接进完整统计面板（不要中间详情卡）。
  container.addEventListener('click', openPanelModal)
  container.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault()
      openPanelModal()
    }
  })

  const refresh = (): void => {
    if (stopped) return
    void (async () => {
      if (serverUrl === '') {
        const found = await discoverServer()
        if (found === null) {
          container.style.display = 'none'
          setLiveText('本地服务 · 离线')
          return
        }
        serverUrl = found.url
        cachedServerUrl = found.url
        state = found.state
      }
      const [s, st] = await Promise.all([
        fetchJson<PetStatePayload>(`${serverUrl}/api/state`),
        fetchJson<StatsPayload>(`${serverUrl}/api/stats?period=today`),
      ])
      if (s === null) {
        // 服务消失（DSH 关闭/插件卸载）：收起大窗、隐藏角标，回到发现模式。
        closePanelModal()
        serverUrl = ''
        cachedServerUrl = ''
        state = null
        stats = null
        balanceInfo = null
        balanceFetchedAt = 0
        previousActive = new Set()
        syncAttentionDots()
        container.style.display = 'none'
        setLiveText('本地服务 · 离线')
        return
      }
      state = s
      stats = st
      trackTaskTransitions(s)
      setLiveText('本地服务 · 已连接')
      renderBadge(container, state, stats, balanceInfo)
      // 余额/峰谷：用户要求放在左下角角标。余额 30s 拉一次，不阻塞状态/统计。
      if (Date.now() - balanceFetchedAt > 30_000) {
        balanceFetchedAt = Date.now()
        void fetchJson<BalancePayload>(`${serverUrl}/api/balance`).then((bal) => {
          if (stopped || serverUrl === '') return
          balanceInfo = bal
          renderBadge(container, state, stats, balanceInfo)
        }, () => {})
      }
    })()
  }

  const removeStyle = ensureStyle()
  placeBadge(container)
  if (panelModal === null) {
    panelModal = buildPanelModal(() => closePanelModal())
  }

  const observer = new MutationObserver(() => {
    if (!container.isConnected) placeBadge(container)
    syncAttentionDots()
  })
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-state', 'aria-selected'],
  })
  syncAttentionDots()

  pollTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') refresh()
  }, POLL_MS)
  discoverTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible' && serverUrl === '') refresh()
  }, DISCOVER_MS)
  refresh()

  return () => {
    stopped = true
    window.clearInterval(pollTimer)
    window.clearInterval(discoverTimer)
    stopAttentionDots()
    for (const entry of attentionDots.values()) entry.dot.remove()
    attentionDots.clear()
    document.removeEventListener('click', onSessionClick, true)
    closePanelModal()
    observer.disconnect()
    removeStyle()
    panelModal?.root.remove()
    panelModal = null
    container.remove()
  }
}

const loader = (window as unknown as { __ModuleLoader__?: ModuleLoader }).__ModuleLoader__

const entry = {
  id: '@qiuzhiyei/dsh-companion',
  factory: (modRequire?: (id: string) => any): Record<string, unknown> => {
    /** 角标/面板纯 DOM + fetch；「删除会话」菜单项依赖宿主 slots 服务。 */
    const inject: string[] = ['slots']
    function apply(ctx: ClientCtx): void {
      const dispose = mountBadge()
      if (dispose !== undefined) ctx.effect(() => dispose)
      mountSessionDeleteAction(ctx, modRequire)
      // 面板 iframe 删除成功后通知主窗口隐藏侧栏残留行。
      const onPanelMessage = (ev: MessageEvent): void => {
        const data = ev.data as { type?: unknown; sessionIds?: unknown } | null
        if (data === null || data.type !== 'dsh-companion:sessions-deleted') return
        if (!Array.isArray(data.sessionIds)) return
        for (const id of data.sessionIds) {
          if (typeof id === 'string' && id !== '') hideDeletedSessionRow(id)
        }
        void reconcileSidebarSessions(true)
      }
      window.addEventListener('message', onPanelMessage)
      ctx.effect(() => () => window.removeEventListener('message', onPanelMessage))
      // 启动后对账一次：宿主重启后仍残留的旧「未分组」行，后端已没有就隐藏。
      const reconcileTimer = window.setTimeout(() => void reconcileSidebarSessions(), 3000)
      ctx.effect(() => () => window.clearTimeout(reconcileTimer))
      // 推理等级：不改模型选择器，只在官方「推理等级」行上接管点击。
      mountReasoningControl(ctx)
      // Ctrl+F：当前对话内搜索；纯 DOM，不需要宿主槽位。
      const disposeSearch = mountConversationSearch()
      ctx.effect(() => disposeSearch)
      mountSearchHeaderButton(ctx, modRequire)
      // 独立历史对话搜索：侧栏「历史搜索」入口（在「插件」上方），自己独立的搜索页。
      const disposeHistory = mountHistorySearch(ctx)
      ctx.effect(() => disposeHistory)
      mountHistorySidebarEntry(ctx, modRequire)
      // 官方快捷键注册：设置里的快捷键列表能看到「搜索当前会话」并改绑。
      mountConversationSearchShortcut(ctx)
    }
    return { apply, inject }
  },
}

if (loader !== undefined) {
  loader.load(entry)
} else {
  // ModuleLoader 尚未就绪（加载顺序边缘情况）：晚一点再注册。
  window.addEventListener('DOMContentLoaded', () => {
    const late = (window as unknown as { __ModuleLoader__?: ModuleLoader }).__ModuleLoader__
    if (late !== undefined) late.load(entry)
  })
}
