/**
 * dsh-companion — Electron 伴侣壳（可选，非插件运行时依赖）。
 *
 * 宿主 dsh-desktop-host 不向插件暴露 Electron 托盘/窗口 API，所以真正的
 * “透明、无边框、置顶、点击穿透”悬浮窗由这个独立壳进程提供：
 * 它加载插件内嵌的 HTTP 服务（PET_URL，默认 127.0.0.1:17573），
 * 页面与浏览器模式完全同源。
 *
 * 启动方式（二选一）：
 *   1. 插件 config server.shell: 'auto' 且本机装了 electron 时自动拉起
 *      （TrayController 解析 require('electron') 得到可执行文件）；
 *   2. 手动：npm i -D electron && npx electron electron/main.cjs
 *      （需先让 DSH 运行起插件，即 PET_URL 可访问）。
 *
 * 职责：托盘（状态/暂停统计/打开面板/退出）+ 悬浮窗（拖拽记忆、
 * 点击穿透、置顶）+ 窗口位置持久化（pet-window.json）。
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, powerMonitor, Notification, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const PET_URL = process.env.PET_URL || 'http://127.0.0.1:17573'
const HERE = __dirname
const BOUNDS_FILE = path.join(HERE, 'pet-window.json')

// 16x16 状态监测机器人托盘图标（内嵌，避免外部资源依赖）。
const TRAY_ICON = nativeImage.createFromDataURL(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAFmSURBVDhPY2CgJfDv/y/g1/O/wr//vwK6HFHAv/t/g3/P///+Pf+2o8sRBXx6/mskTnrz37/nfwC6HNFg2tIt/9HFiALTlm6OmLVy575pS7b+ARkCwiD+9OXb8YdH//z1ArNX7Ti+YvvRj/vP3f5/+ubz/5cevANjEH/2yp1PQGrQ9cEBSPO+M7fgmtDxpkMXfk9btrkFXR8YzFy+rWTN7pOflmzc97+sqR8Dg8SPXX38f+aK7ffQ9YLBrBU7nh08fw+sWErFAAODxC/cewsKj9/oesFg2rKtjzcdOv8dpDC0pud//+UX/11Siv/3nH38P3nSYrABIG/gjZm5q3dvjMuq+IFuO8wFBA0AgajUwqaQxNz3ESlF/6PTi38ih8G5O6/+z1i27Ru6HpwAZBtyLOw8cePX7JW71qGrwwlgBoDSw5o9p77OXb3r2Pz5+znQ1eEE05dt/QwyZMaK7a+nLtmUga4ZAOkPH+fMxefPAAAAAElFTkSuQmCC'
)

let win = null
let tray = null
let clickThrough = false
// 最近一次从插件 /api/state 拿到的快照（看门狗每 5s 轮询写入）；托盘菜单读它
// 判断「统计是否暂停」，不必为菜单单独发请求。
let lastPetState = null
function readPetState() { return lastPetState }

// 主进程兜底：任何未捕获异常只记日志，绝不弹模态「A JavaScript error occurred
// in the main process」——桌宠是常驻程序，一个补间里抛异常（用户实测：自由活动
// 时 setPosition 收到非法坐标）会每 16ms 弹一次框，比异常本身还烦人。
// 具体位置仍会进 DSH 日志，照样可排查。
process.on('uncaughtException', (err) => {
  console.error('[dsh-companion] main 未捕获异常:', err && err.stack ? err.stack : err)
})
process.on('unhandledRejection', (err) => {
  console.error('[dsh-companion] main 未处理的 Promise 拒绝:', err && err.stack ? err.stack : err)
})

// 窗口尺寸的合理区间。桌宠窗口尺寸由设置里的 scale 算出（看门狗：240*scale+40 ×
// 200*scale+150），而 scale 在页面侧夹死 0.4..3 → 理论最大约 760×750。
// 上限留足余量取 1200，超出即判定为畸形（DPI 切换/异常事件把窗口撑大的结果）。
// 这些常量是 loadBounds / saveBounds / safeSetBounds / clampBounds 的**单一事实来源**。
const DEFAULT_W = 300
const DEFAULT_H = 340
const MIN_W = 120
const MIN_H = 120
const MAX_W = 1200
const MAX_H = 1200

function isSaneSize(w, h) {
  return Number.isFinite(w) && Number.isFinite(h) &&
    w >= MIN_W && w <= MAX_W && h >= MIN_H && h <= MAX_H
}

/** setPosition 的安全包装：坐标必须是有限值，且失败不向外抛（补间/跟手循环里抛=连环弹窗）。 */
function safeSetPosition(w, x, y) {
  const nx = Math.round(Number(x))
  const ny = Math.round(Number(y))
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return false
  try {
    w.setPosition(nx, ny)
    return true
  } catch (err) {
    return false
  }
}

/** setBounds 的安全包装（同理：缩放/位置异常时宁可不动，也别把非法尺寸喂给原生层）。 */
function safeSetBounds(w, b) {
  const x = Math.round(Number(b.x))
  const y = Math.round(Number(b.y))
  const width = Math.round(Number(b.width))
  const height = Math.round(Number(b.height))
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return false
  // 尺寸校验与 loadBounds/saveBounds/clampBounds 共用同一套常量（单一事实来源）。
  // 旧口径上限 8000 太松——2857×4558 那种畸形尺寸能溜过去，桌宠就被顶出屏幕。
  if (!isSaneSize(width, height)) return false
  try {
    w.setBounds({ x, y, width, height })
    return true
  } catch (err) {
    return false
  }
}

function loadBounds() {
  try {
    const raw = JSON.parse(fs.readFileSync(BOUNDS_FILE, 'utf8'))
    if (!raw || typeof raw !== 'object') return null
    const { x, y, width, height } = raw
    if (![x, y, width, height].every(Number.isFinite)) return null
    // 尺寸畸形就整份丢弃、回落默认位置。
    // 真实事故（多屏）：外接屏 DPI 与内屏不一致，窗口被撑到 2857×4558 并写进了
    // 这个文件；桌宠在窗口内是**居中**的，于是被顶到屏幕下方 2000+px「失踪」，
    // 而旧 clampBounds 只夹坐标不夹尺寸，连托盘「回到屏幕」也救不回来
    // （窗口左上角可见 ≠ 居中的宠物可见）。单屏不会触发，所以只有多屏才复现。
    if (!isSaneSize(width, height)) return null
    return { x, y, width, height }
  } catch {
    return null
  }
}

function saveBounds() {
  if (!win || win.isDestroyed()) return
  try {
    const b = win.getBounds()
    // 畸形尺寸绝不落盘：写进去就等于把「失踪」状态复制到下次启动（自我繁殖的坑）。
    if (!isSaneSize(b.width, b.height)) {
      console.warn(`[dsh-companion] 窗口尺寸异常（${b.width}x${b.height}），拒绝写入位置记忆`)
      return
    }
    fs.writeFileSync(BOUNDS_FILE, JSON.stringify(b, null, 2), 'utf8')
  } catch {
    // 位置记忆失败不致命。
  }
}

// 自由活动/拖拽补间会让 'moved' 每秒触发几十次，直接写盘太浪费——节流到 600ms。
let saveTimer = null
function scheduleSaveBounds() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveBounds()
  }, 600)
}

function defaultBounds() {
  const area = screen.getPrimaryDisplay().workArea
  return {
    x: area.x + area.width - 320,
    y: area.y + area.height - 360,
    width: DEFAULT_W,
    height: DEFAULT_H,
  }
}

/**
 * 把窗口夹回屏幕：**尺寸与坐标都夹**。
 *
 * 尺寸必须先夹——桌宠在窗口内居中，窗口一旦被撑大，宠物就被顶到屏幕外，
 * 此时无论怎么夹坐标都救不回来（旧实现只保证「窗口左上角区域有 80×60 可见」，
 * 对居中的宠物毫无意义）。坐标仍保留「至少 80×60 可见」的老口径。
 * 用户曾把伴侣拖到屏幕外（y=-561）导致失踪，所以所有恢复/显示/挪窗路径都要过这道夹子。
 */
function clampBounds(bounds) {
  const sane = isSaneSize(bounds.width, bounds.height)
  const area = screen.getDisplayMatching({
    x: Number.isFinite(bounds.x) ? bounds.x : 0,
    y: Number.isFinite(bounds.y) ? bounds.y : 0,
    width: sane ? bounds.width : DEFAULT_W,
    height: sane ? bounds.height : DEFAULT_H,
  }).workArea
  // 尺寸：夹进合理区间，且不大于所在屏工作区。
  const width = Math.round(sane ? Math.max(MIN_W, Math.min(bounds.width, MAX_W, area.width)) : DEFAULT_W)
  const height = Math.round(sane ? Math.max(MIN_H, Math.min(bounds.height, MAX_H, area.height)) : DEFAULT_H)
  // 坐标：非法值回落到工作区右下角（默认位置），别把 NaN 传下去。
  const bx = Number.isFinite(bounds.x) ? bounds.x : area.x + area.width - width - 20
  const by = Number.isFinite(bounds.y) ? bounds.y : area.y + area.height - height - 20
  const minW = Math.min(80, width)
  const minH = Math.min(60, height)
  const x = Math.max(area.x + minW - width, Math.min(bx, area.x + area.width - minW))
  const y = Math.max(area.y + minH - height, Math.min(by, area.y + area.height - minH))
  return { x: Math.round(x), y: Math.round(y), width, height }
}

/** 显示器变化（拔插外接屏 / 改分辨率 / 改 DPI）：记忆坐标可能已落在不存在的屏上。 */
function onDisplaysChanged() {
  if (!win || win.isDestroyed()) return
  // 立刻夹回当前屏幕，别等用户发现宠物没了再去翻托盘救援。
  safeSetBounds(win, clampBounds(win.getBounds()))
  scheduleSaveBounds()
}

function createWindow() {
  const bounds = clampBounds({ ...defaultBounds(), ...loadBounds() })
  win = new BrowserWindow({
    ...bounds,
    transparent: true,
    frame: false,
    // 禁止用户拖拽调整窗口尺寸：桌宠尺寸只由设置里的 scale 决定（看门狗统一改），
    // 手动拉伸过就再也算不回来，还会让居中的宠物偏离视觉中心。
    // 最大化/全屏同样禁掉——那会把窗口撑到整屏，桌宠被居中到屏幕正中且尺寸畸形。
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.loadURL(PET_URL)
  // 插件服务可能短暂不可用（GUI 重启、profile 切换）：失败后自动重试加载。
  win.webContents.on('did-fail-load', (_event, code, _desc, validatedURL) => {
    if (validatedURL && validatedURL.startsWith(PET_URL) && code !== -3) {
      setTimeout(() => {
        if (win && !win.isDestroyed()) win.loadURL(PET_URL)
      }, 3000)
    }
  })
  // 智能穿透基线（见 set-mouse-ignore IPC）：常态放行鼠标，页面检测到
  // 鼠标悬在宠物本体上才收回交互——周边透明区域不再挡桌面点击。
  win.setIgnoreMouseEvents(true, { forward: true })
  win.on('moved', scheduleSaveBounds)
  win.on('resized', scheduleSaveBounds)
  // 显隐变化（面板 showPet 开关 / 托盘菜单 / 快捷键都可能改）→ 刷新托盘勾选态。
  win.on('show', scheduleTraySync)
  win.on('hide', scheduleTraySync)
  // 拖拽跟手是主进程定时器：页面崩溃/窗口隐藏时必须停，别让宠物追着光标跑。
  win.webContents.on('render-process-gone', () => { stopDrag(); stopRoamMove() })
  win.on('hide', () => { stopDrag(); stopRoamMove() })
  win.on('closed', () => {
    stopDrag()
    stopRoamMove()
    win = null
  })
}

async function petPost(pathname) {
  try {
    await fetch(`${PET_URL}${pathname}`, { method: 'POST' })
  } catch {
    // 插件服务未就绪/已退出时静默。
  }
}

// 托盘菜单：状态感知（用户吐槽「显示/隐藏」「暂停/恢复」二合一标签，
// 点了不知道现在是什么状态、也不知道有没有按上）。
// 现制：开关类用 checkbox 项（勾选 = 当前状态），标签直接写当前态；
// 托盘悬停 tooltip 也带状态，不点开菜单就能看。
let traySyncTimer = null
function syncTrayMenu() {
  if (!tray || tray.isDestroyed()) return
  const s = readPetState()
  const shown = !!(win && !win.isDestroyed() && win.isVisible())
  const paused = s && s.settings && s.settings.paused === true
  tray.setToolTip(`DSH 伴侣 · 伴侣${shown ? '显示中' : '已隐藏'} · 统计${paused ? '已暂停' : '运行中'}`)
  if (menuShowPet) menuShowPet.checked = shown
  // 标签保持中性（用户反馈：把当前态拼进标签的长文案反而难懂），
  // 当前态全靠勾选表达——跟「显示伴侣」一个逻辑：勾上 = 正在统计。
  if (menuPause) menuPause.checked = !paused
}
// 状态变化后刷新菜单：合并 200ms 内的多次调用（SSE 快照可能连发）。
function scheduleTraySync() {
  if (traySyncTimer) clearTimeout(traySyncTimer)
  traySyncTimer = setTimeout(() => { traySyncTimer = null; syncTrayMenu() }, 200)
}

let menuShowPet = null
let menuPause = null

function createTray() {
  tray = new Tray(TRAY_ICON)
  tray.setToolTip('DSH 伴侣')
  const menu = Menu.buildFromTemplate([
    {
      label: '显示伴侣',
      type: 'checkbox',
      click: (item) => {
        // checkbox 项点击后 Electron 会先翻转 checked，这里以用户意图为准强制对齐。
        if (item.checked) { if (!win) createWindow(); else win.show() }
        else if (win && !win.isDestroyed()) win.hide()
        syncTrayMenu()
      },
    },
    { label: '伴侣回到屏幕', click: () => bringBackToScreen() },
    {
      label: '统计',
      type: 'checkbox',
      click: (item) => {
        // 勾选 = 正在统计（与「显示伴侣」同逻辑）。Electron 点击时会先翻转 checked，
        // 所以 item.checked 就是用户意图：勾上 = 要运行，取消 = 要暂停。
        // /api/pause 是 toggle 端点：意图与当前态不同才发请求，相同（菜单与状态
        // 失同步的罕见情形）只对齐勾选、不发请求。
        const running = !(lastPetState && lastPetState.settings && lastPetState.settings.paused === true)
        const wantRunning = item.checked
        if (menuPause) menuPause.checked = wantRunning // 乐观反馈，请求回来 sync 纠正
        if (wantRunning !== running) petPost('/api/pause').then(syncTrayMenu)
      },
    },
    { label: '打开统计面板', click: () => openPanel() },
    { type: 'separator' },
    { label: '退出伴侣', click: () => app.quit() },
  ])
  menuShowPet = menu.items[0]
  menuPause = menu.items[2]
  tray.setContextMenu(menu)
  tray.on('click', () => toggleWindow())
  syncTrayMenu()
}

function toggleWindow() {
  if (!win) return createWindow()
  if (win.isVisible()) win.hide()
  else {
    // 显示前夹回屏幕：窗口可能被拖到屏幕外隐藏过。
    safeSetBounds(win, clampBounds(win.getBounds()))
    win.show()
  }
}

// 托盘救援：无论窗口在哪，夹回屏幕并显示。
function bringBackToScreen() {
  if (!win) return createWindow()
  safeSetBounds(win, clampBounds(win.getBounds()))
  win.show()
}

function openPanel() {
  const panel = new BrowserWindow({
    width: 980,
    height: 720,
    title: 'DSH 伴侣 · 面板',
  })
  panel.loadURL(`${PET_URL}/panel`)
}

function setClickThrough(enabled) {
  clickThrough = enabled
  if (!win) return
  // 智能穿透基线：窗口常态 ignore+forward——周边透明区域放行到桌面，
  // 鼠标移到宠物本体时页面经 set-mouse-ignore IPC 收回交互。全穿透与智能
  // 模式窗口状态相同，差别只在主进程是否放行页面的 set-mouse-ignore。
  win.setIgnoreMouseEvents(true, { forward: true })
  win.webContents.send('pet-shell:click-through', enabled)
}

ipcMain.handle('pet-shell:toggle-click-through', () => {
  setClickThrough(!clickThrough)
  return clickThrough
})
ipcMain.handle('pet-shell:quit', () => {
  app.quit()
})
// 久坐提醒：页面需要系统级空闲时间（GetLastInputInfo 语义）判断人是否离开。
// powerMonitor.getSystemIdleTime() 返回秒数；浏览器模式没有这个 API。
// 只读、无副作用；异常时回 0（页面按「没离开」处理，最坏只是多重提醒一次）。
ipcMain.handle('pet-shell:idle', () => {
  try { return powerMonitor.getSystemIdleTime() } catch (err) { return 0 }
})
// 拖窗（绝对锚定）：页面按下时取一次窗口位置，移动时给目标坐标。
// 绝对目标不会被逐帧增量误差累积——长按/慢拖时窗口不再自己漂走。
ipcMain.handle('pet-shell:bounds', () => {
  if (!win || win.isDestroyed()) return null
  const b = win.getBounds()
  return { x: b.x, y: b.y, width: b.width, height: b.height }
})
// 当前屏幕的工作区（已扣掉任务栏）：自由活动在「整个屏幕」里随机挑点要用。
ipcMain.handle('pet-shell:work-area', () => {
  if (!win || win.isDestroyed()) return null
  const area = screen.getDisplayMatching(win.getBounds()).workArea
  return { x: area.x, y: area.y, width: area.width, height: area.height }
})
ipcMain.on('pet-shell:move-to', (_event, x, y) => {
  if (!win || win.isDestroyed()) return
  const nx = Number(x)
  const ny = Number(y)
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return
  const b = win.getBounds()
  const c = clampBounds({ ...b, x: Math.round(nx), y: Math.round(ny) })
  safeSetPosition(win, c.x, c.y)
})
// 拖拽跟手（主进程真值）：页面只在越过阈值时通知 drag-start / drag-end，
// 位移由主进程直接读**系统光标**计算。渲染进程的 MouseEvent.screenX/Y 在
// 175% 这类非整数缩放下会与窗口 DIP 坐标系不一致（用户实测：长按宠物自己
// 跑走），窗口位置只能认屏幕光标这一个真值——光标不动，窗口就绝不会动。
let dragTimer = null
let dragGrab = null
function stopDrag() {
  if (dragTimer) clearInterval(dragTimer)
  dragTimer = null
  dragGrab = null
}
ipcMain.on('pet-shell:drag-start', () => {
  if (!win || win.isDestroyed()) return
  stopDrag()
  stopRoamMove() // 用户上手抓 = 立刻结束自由活动
  const p = screen.getCursorScreenPoint()
  const b = win.getBounds()
  dragGrab = { x: p.x - b.x, y: p.y - b.y }
  dragTimer = setInterval(() => {
    if (!win || win.isDestroyed() || !dragGrab) { stopDrag(); return }
    const c = screen.getCursorScreenPoint()
    const cur = win.getBounds()
    const nx = Math.round(c.x - dragGrab.x)
    const ny = Math.round(c.y - dragGrab.y)
    if (nx === cur.x && ny === cur.y) return
    const cb = clampBounds({ ...cur, x: nx, y: ny })
    if (cb.x === cur.x && cb.y === cur.y) return
    safeSetPosition(win, cb.x, cb.y)
  }, 8)
})
ipcMain.on('pet-shell:drag-end', stopDrag)

// —— 自由活动（闲时自己逛）：页面只给「目标坐标 + 时长」，主进程做平滑补间，
// 并且每一步都把窗口夹进目标所在屏幕的工作区（多屏/任务栏都照顾到）。
// 目标来自页面按「起始位置 ± 半径」算的局部随机点，逛完会自己回家。
let roamTimer = null
function stopRoamMove() {
  if (roamTimer) clearInterval(roamTimer)
  roamTimer = null
}
ipcMain.on('pet-shell:roam-to', (_event, x, y, ms) => {
  if (!win || win.isDestroyed()) return
  stopRoamMove()
  const from = win.getBounds()
  const tx0 = Number(x)
  const ty0 = Number(y)
  if (!Number.isFinite(tx0) || !Number.isFinite(ty0)) return
  // 起点也必须是有限值：起点的 width/height 参与算目标（夹进工作区），缺一个就全变 NaN。
  const fw = Number(from.width) || 0
  const fh = Number(from.height) || 0
  if (!Number.isFinite(from.x) || !Number.isFinite(from.y)) return
  const wa = screen.getDisplayNearestPoint({ x: Math.round(tx0), y: Math.round(ty0) }).workArea
  const tx = Math.max(wa.x, Math.min(Math.round(tx0), wa.x + (Number(wa.width) || 0) - fw))
  const ty = Math.max(wa.y, Math.min(Math.round(ty0), wa.y + (Number(wa.height) || 0) - fh))
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return
  const dur = Math.max(150, Math.min(5000, Number(ms) || 900))
  const t0 = Date.now()
  roamTimer = setInterval(() => {
    if (!win || win.isDestroyed()) { stopRoamMove(); return }
    const t = Math.min(1, (Date.now() - t0) / dur)
    // easeInOutCubic：起步和收尾都软，别像瞬移。
    const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    // 坐标异常（t/k 非有限、窗口中途换了屏幕）→ 直接收掉本段补间，别把 NaN 喂给原生层。
    if (!safeSetPosition(win, from.x + (tx - from.x) * k, from.y + (ty - from.y) * k)) {
      stopRoamMove()
      return
    }
    if (t >= 1) stopRoamMove()
  }, 16)
})
ipcMain.on('pet-shell:roam-stop', () => stopRoamMove())
// 页面驱动挪窗：宠物本体 no-drag 后拖拽事件到不了原生 drag region，
// 由页面算指针位移增量发过来（'moved' 事件照旧触发 saveBounds 持久化）。
ipcMain.on('pet-shell:move-by', (_event, dx, dy) => {
  if (!win || win.isDestroyed()) return
  const nx = Number(dx)
  const ny = Number(dy)
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return
  const b = win.getBounds()
  const c = clampBounds({ ...b, x: Math.round(b.x + nx), y: Math.round(b.y + ny) })
  safeSetPosition(win, c.x, c.y)
})
// 智能穿透：页面用 elementFromPoint 判断鼠标是否在宠物本体上，动态交回/
// 放行窗口鼠标事件。全穿透模式（clickThrough）下拒绝页面请求，保持穿透。
ipcMain.on('pet-shell:set-mouse-ignore', (_event, ignore) => {
  if (!win || win.isDestroyed()) return
  if (clickThrough) return
  win.setIgnoreMouseEvents(ignore === true, { forward: true })
})

// 系统通知：长任务完成/失败、预算触顶时用。页面侧已做「短任务不打扰」节流，
// 这里只负责投递；Windows 需要 AppUserModelID 才会显示成应用通知（toast）。
const APP_ID = 'com.dsh.companion'
try { app.setAppUserModelId(APP_ID) } catch (err) { /* 非 Windows 忽略 */ }
let lastNotifyAt = 0
ipcMain.on('pet-shell:notify', (_event, title, body) => {
  if (!Notification.isSupported()) return
  const now = Date.now()
  if (now - lastNotifyAt < 1200) return // 连发两条时只留一条，避免堆叠刷屏
  lastNotifyAt = now
  try {
    const n = new Notification({
      title: String(title || 'DSH 伴侣').slice(0, 80),
      body: String(body || '').slice(0, 200),
      silent: false,
    })
    n.on('click', () => {
      // 点通知 → 打开面板（用户看数据的主入口）
      if (win && !win.isDestroyed()) { win.show(); win.focus() }
      else shell.openExternal(`${PET_URL}/panel`)
    })
    n.show()
  } catch (err) { /* 通知失败不影响伴侣 */ }
})

app.whenReady().then(() => {
  createWindow()
  createTray()
  app.on('window-all-closed', (event) => {
    // 伴侣常驻：关掉最后一个窗口不退出（托盘仍可退出）。
    event.preventDefault()
  })
  // 多屏关键修复：拔掉外接屏 / 改分辨率 / 改 DPI 缩放后，记忆里（或当前）的坐标
  // 可能已经落在不存在的屏幕上了。旧实现完全不监听这些事件，于是桌宠留在已消失
  // 的坐标上「失踪」，只能靠托盘救援。现在变化即刻夹回当前屏幕。
  screen.on('display-removed', onDisplaysChanged)
  screen.on('display-added', onDisplaysChanged)
  screen.on('display-metrics-changed', onDisplaysChanged)
  startWatchdog()
})

// 壳文件比本进程新 → 自己重启一次，免得「改完了却还在跑旧壳」（真实踩坑：
// DSH 重启快于看门狗的 15s 判定时壳会存活，页面代码更新了但 preload/main 还是旧的）。
const SHELL_FILES = [path.join(HERE, 'main.cjs'), path.join(HERE, 'preload.cjs')]
const BOOTED_AT = Date.now()
let selfRestartDone = false
function relaunchIfStale() {
  if (selfRestartDone) return
  let newest = 0
  for (const f of SHELL_FILES) {
    try { newest = Math.max(newest, fs.statSync(f).mtimeMs) } catch { /* 文件缺失就跳过 */ }
  }
  // 3s 缓冲：避免与刚启动时的文件写入抢跑，造成反复重启。
  if (newest <= BOOTED_AT + 3000) return
  selfRestartDone = true
  saveBounds()
  app.relaunch()
  app.exit(0)
}

// 看门狗：伴侣生死跟随 DSH。
// - 优雅路径：插件卸载时服务先广播 bye（页面收到后调用 quit），即时退出；
// - 强杀路径：宿主进程被杀没有 bye——轮询 /api/state，连续 3 次
//   （~15s）不可达即视为 DSH 已退出，伴侣随之退出。短暂闪断由
//   页面级 did-fail-load 重试兜住；DSH 重启超过 15s 时伴侣退出，
//   下次 DSH 启动插件会重新自动拉壳。
// 顺路把插件设置同步到壳窗口：显示/隐藏（showPet）、点击穿透、
// 窗口尺寸随缩放（透明度由页面内的 CSS 应用，SSE 即时生效，壳不再
// 叠加窗口级透明度）。
function startWatchdog() {
  let misses = 0
  let lastClickThrough = null
  let lastScale = null
  let lastShowPet = null
  setInterval(async () => {
    try {
      const res = await fetch(`${PET_URL}/api/state`, { signal: AbortSignal.timeout(2500) })
      if (res.ok) {
        misses = 0
        relaunchIfStale() // 壳文件更新过就自我重启，保证跑的是最新代码
        try {
          const state = await res.json()
          lastPetState = state // 托盘菜单读它判断统计是否暂停（不必单独发请求）
          scheduleTraySync() // paused 可能在面板里被改过，菜单勾选态要跟上
          const s = state && state.settings
          if (win && !win.isDestroyed() && s) {
            // 伴侣显隐：设置页开关（showPet）控制窗口显示/隐藏。
            if (typeof s.showPet === 'boolean' && lastShowPet !== s.showPet) {
              lastShowPet = s.showPet
              if (s.showPet) win.show()
              else win.hide()
            }
            if (typeof s.clickThrough === 'boolean' && lastClickThrough !== s.clickThrough) {
              lastClickThrough = s.clickThrough
              setClickThrough(s.clickThrough)
            }
            if (typeof s.scale === 'number' && lastScale !== s.scale) {
              lastScale = s.scale
              // 内容 = 伴侣 220x200·scale + 气泡区；保持 x/y 不动只伸缩尺寸。
              const w = Math.round(240 * s.scale + 40)
              const h = Math.round(200 * s.scale + 150)
              const b = win.getBounds()
              if (Math.abs(b.width - w) > 4 || Math.abs(b.height - h) > 4) {
                // 过 clampBounds：新尺寸也要夹回屏幕（多屏下直接 setBounds 可能落在屏外）
                safeSetBounds(win, clampBounds({ x: b.x, y: b.y, width: w, height: h }))
              }
            }
          }
        } catch {
          // 状态解析失败不影响看门狗本身。
        }
        return
      }
      misses += 1
    } catch {
      misses += 1
    }
    if (misses >= 3) app.quit()
  }, 5000)
}

app.on('before-quit', () => {
  stopDrag()
  stopRoamMove()
  saveBounds()
})
