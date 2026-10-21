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
const LS_PORT_KEY = 'dsh-companion.badge-port'
const PORT_BASE = 17573
const PORT_RANGE = 10
const POLL_MS = 5000
const DISCOVER_MS = 15000

/** 工作中状态的呼吸点颜色（空闲无点）。 */
const STATE_TONE: Record<string, string> = {
  casting: 'var(--dsw-alias-accent, #4f8cff)',
  waiting: 'var(--dsw-alias-accent, #4f8cff)',
  hooked: '#37b26c',
  reeling: '#e0a23a',
  done: '#37b26c',
  error: '#e0564f',
  interrupted: '#e0a23a',
  blocked: '#e0a23a',
}

interface TaskPayload {
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
    /* ---- 角标（单行大字） ---- */
    `[${BADGE_ATTR}] {`,
    '  display: flex; align-items: center; flex: none;',
    '  padding: 8px 12px; margin: 4px 10px 2px;',
    '  border-radius: 10px; cursor: pointer; user-select: none;',
    '  font-size: 12px; line-height: 1.4;',
    '  color: var(--dsw-alias-text-secondary, rgba(128,128,128,.9));',
    '  background: var(--dsw-alias-bg-elevated, rgba(128,128,128,.06));',
    '  border: 1px solid var(--dsw-alias-separator-primary, transparent);',
    '  transition: background .15s ease, color .15s ease, border-color .15s ease;',
    '}',
    `[${BADGE_ATTR}]:hover {`,
    '  color: var(--dsw-alias-text-primary, inherit);',
    '  background: var(--dsw-alias-bg-hover, rgba(128,128,128,.12));',
    '  border-color: var(--dsw-alias-separator-strong, rgba(128,128,128,.25));',
    '}',
    `[${BADGE_ATTR}] .pet-row { display: flex; align-items: center; gap: 8px; }`,
    `[${BADGE_ATTR}] .pet-emoji { font-size: 16px; line-height: 1; }`,
    `[${BADGE_ATTR}] .pet-dot {`,
    '  width: 8px; height: 8px; border-radius: 50%; flex: none;',
    '  animation: dsh-companion-breath 1.6s ease-in-out infinite;',
    '}',
    `[${BADGE_ATTR}] .pet-main {`,
    '  font-size: 14px; font-weight: 600; letter-spacing: .01em; white-space: nowrap;',
    '  color: var(--dsw-alias-text-primary, inherit);',
    '  font-variant-numeric: tabular-nums;',
    '}',
    `@keyframes dsh-companion-breath {`,
    '  0%, 100% { opacity: .45; } 50% { opacity: 1; }',
    '}',
    /* ---- 完整面板大窗（GUI 内，不跳浏览器） ---- */
    `[${PANEL_ATTR}] {`,
    '  position: fixed; inset: 0; z-index: 10001; display: none;',
    '  background: rgba(0,0,0,.5);',
    '  align-items: center; justify-content: center;',
    '}',
    `[${PANEL_ATTR}][data-open="1"] { display: flex; }`,
    `[${PANEL_ATTR}] .pm-box {`,
    '  display: flex; flex-direction: column;',
    '  width: min(1100px, 94vw); height: min(760px, 90vh);',
    '  border-radius: 14px; overflow: hidden;',
    '  background: var(--dsw-alias-bg-base, #f4f6f8);',
    '  border: 1px solid var(--dsw-alias-separator-strong, rgba(128,128,128,.3));',
    '  box-shadow: 0 24px 80px rgba(0,0,0,.5);',
    '}',
    `[${PANEL_ATTR}] .pm-head {`,
    '  display: flex; align-items: center; gap: 10px; padding: 10px 14px;',
    '  background: var(--dsh-companion-modal-head, var(--dsw-alias-bg-elevated, #20242a));',
    '  color: var(--dsw-alias-text-primary, #eee);',
    '}',
    `[${PANEL_ATTR}] .pm-title { flex: 1; font-size: 13px; font-weight: 600; }`,
    `[${PANEL_ATTR}] .pm-close {`,
    '  width: 24px; height: 24px; border-radius: 6px; cursor: pointer;',
    '  display: flex; align-items: center; justify-content: center;',
    '  color: var(--dsw-alias-text-secondary, rgba(200,200,200,.9));',
    '  background: transparent; border: none; font-size: 15px; line-height: 1;',
    '}',
    `[${PANEL_ATTR}] .pm-close:hover { background: rgba(128,128,128,.2); }`,
    `[${PANEL_ATTR}] iframe.pm-frame { flex: 1; width: 100%; border: none; background: #f4f6f8; }`,
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

/* ---------- 角标渲染 ---------- */

function renderBadge(
  container: HTMLElement,
  state: PetStatePayload | null,
  stats: StatsPayload | null,
): void {
  container.textContent = ''
  if (state === null) {
    container.style.display = 'none'
    return
  }
  container.style.display = ''

  const working = state.task !== null && state.task !== undefined
  const today = stats?.totalTokens ?? 0

  const row = el('div', 'pet-row')
  if (working) {
    const dot = el('span', 'pet-dot')
    dot.style.background = STATE_TONE[state.state] ?? STATE_TONE.hooked
    row.appendChild(dot)
  }
  row.appendChild(el('span', 'pet-emoji', '🤖'))
  const main = el(
    'span',
    'pet-main',
    working && state.task
      ? `${fmtTokens(state.task.tokens.totalTokens)} token`
      : `今日 ${fmtTokens(today)} token`,
  )
  row.appendChild(main)
  container.appendChild(row)

  const taskLine = working && state.task
    ? `${state.label} · 已 ${fmtElapsed(state.task.startTime, Date.now())} · 今日 ${today.toLocaleString()} tokens`
    : `今日 ${today.toLocaleString()} tokens · ${stats?.tasks ?? 0} 任务 · ${stats?.toolCalls ?? 0} 工具调用`
  container.title = `DSH 伴侣\n${taskLine}\n点击打开统计面板`
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

  const box = el('div', 'pm-box')
  const head = el('div', 'pm-head')
  head.appendChild(el('span', 'pm-title', '🤖 DSH 伴侣 · 完整统计面板'))
  const close = el('button', 'pm-close', '×') as HTMLButtonElement
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
        container.style.display = 'none'
        return
      }
      state = s
      stats = st
      renderBadge(container, state, stats)
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
