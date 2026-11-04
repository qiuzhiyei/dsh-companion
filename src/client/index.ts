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
  project?: string
  model: string
  provider: string
  startTime: number
  tokens: { totalTokens: number; inputTokens: number; outputTokens: number }
}

interface PetStatePayload {
  plugin: string
  state: string
  label: string
  task: TaskPayload | null
  lastResult: { status: string; durationMs: number; tokens: { totalTokens: number } } | null
  paused: boolean
  settings: { currency: string }
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
    '  width: 7px; height: 7px; border-radius: 50%; flex: none; justify-self: end;',
    '  animation: dsh-companion-breath 2s ease-in-out infinite;',
    '}',
    `[${BADGE_ATTR}] .sb-arrow {`,
    '  justify-self: end; color: var(--dsw-alias-text-secondary, #7d959e); font-size: 12px; line-height: 1;',
    '}',
    `@keyframes dsh-companion-breath {`,
    '  0%, 100% { opacity: 1; } 50% { opacity: .35; }',
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
    /* ---- 删除会话确认弹窗 ---- */
    `[${CONFIRM_ATTR}] {`,
    '  position: fixed; inset: 0; z-index: 10002; display: flex;',
    '  align-items: center; justify-content: center; background: rgba(0,0,0,.45);',
    '}',
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

  const working = state.task !== null && state.task !== undefined
  const today = stats?.totalTokens ?? 0

  const icon = el('span', 'sb-icon')
  icon.innerHTML = FIN_SVG
  container.appendChild(icon)

  const text = el('span', 'sb-text')
  const main = el(
    'b',
    '',
    working && state.task
      ? `${fmtTokens(state.task.tokens.totalTokens)} token`
      : `今日 ${fmtTokens(today)} token`,
  )
  const sub = el('span', '')
  const bits: string[] = []
  if (working && state.task) {
    // 进行中：第二行只用任务名 + 状态词，读数留给第一行（设计稿 04）。
    sub.textContent = `${state.task.project || state.label || '任务'} · 进行中`
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
    dot.style.background = tone
    dot.style.boxShadow = `0 0 7px ${tone}`
    container.appendChild(dot)
  } else {
    container.appendChild(el('span', 'sb-arrow', '›'))
  }

  const lines = ['DSH 伴侣']
  if (working && state.task) {
    lines.push(`${state.task.project || state.label || '任务'} · 已 ${fmtElapsed(state.task.startTime, Date.now())}`)
    lines.push(`当前 ${state.task.tokens.totalTokens.toLocaleString()} token · 今日 ${today.toLocaleString()} tokens`)
    if ((stats?.cost ?? 0) > 0) {
      const sym = state.settings.currency === 'USD' ? '$' : '¥'
      lines.push(`今日 ${sym}${(stats?.cost ?? 0).toFixed(2)}`)
    }
  } else {
    lines.push(`今日 ${today.toLocaleString()} tokens · ${stats?.tasks ?? 0} 任务`)
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

/** 二次确认弹窗：确认后 POST 伴侣服务执行 registry 除名 + 软删回收站。 */
function openDeleteConfirm(sessionId: string, displayTitle: string): void {
  if (document.querySelector(`[${CONFIRM_ATTR}]`) !== null) return

  const root = document.createElement('div')
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
    root.remove()
  }
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
          close()
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

/** 供对话标题栏搜索按钮复用 Ctrl+F 的打开逻辑。 */
let openConversationSearch: (() => boolean) | null = null

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
        container.style.display = 'none'
        setLiveText('本地服务 · 离线')
        return
      }
      state = s
      stats = st
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
    if (container.isConnected) return
    placeBadge(container)
  })
  observer.observe(document.body, { childList: true, subtree: true })

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
      // 推理等级：不改模型选择器，只在官方「推理等级」行上接管点击。
      mountReasoningControl(ctx)
      // Ctrl+F：当前对话内搜索；纯 DOM，不需要宿主槽位。
      const disposeSearch = mountConversationSearch()
      ctx.effect(() => disposeSearch)
      mountSearchHeaderButton(ctx, modRequire)
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
