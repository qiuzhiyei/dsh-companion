/**
 * dsh-companion — 内嵌 Web 页面（伴侣 overlay 页 + 统计面板页）。
 *
 * 页面以模板字符串内嵌（不落盘、无静态目录依赖）；皮肤资源经
 * /skins/<skin>/<state> 由 server 从 assets 目录提供。
 * 伴侣页在浏览器中为悬浮卡片，在 Electron 壳中为全透明置顶 overlay。
 */
/** 伴侣悬浮页。 */
export function petPageHTML() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>DSH 伴侣</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; user-select: none; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }
  body.browser { background: linear-gradient(160deg, #1d2b3a 0%, #24405a 55%, #2c5a7a 100%); }
  #stage { position: fixed; display: flex; flex-direction: column; align-items: center; gap: 6px; }
  body.electron #stage { left: 0; top: 0; width: 100vw; height: 100vh; justify-content: center; }
  body.browser #stage { right: 36px; bottom: 36px; }
  /* embed：GUI 详情卡 iframe 内嵌——居中、去边距。 */
  body.embed #stage { left: 0; top: 0; right: auto; bottom: auto; width: 100vw; height: 100vh; justify-content: center; -webkit-app-region: no-drag; }
  #pet { width: 220px; height: 200px; filter: drop-shadow(0 6px 14px rgba(0,0,0,.35));
    position: relative; transform-origin: 50% 92%; cursor: pointer; }
  /* object-fit: contain——皮肤图不强制 11:10（AI 生成的方形 PNG 原样完整显示，不拉伸） */
  #pet img { width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
  /* Electron：整窗不设原生拖拽区（用户要求命中区域收窄到宠物本体：周边透明
     区域经智能穿透直接放行，见 setIgnoreMouseEvents + set-mouse-ignore IPC）。
     拖窗走页面指针捕获 + petShell.moveBy；no-drag 声明保留兜底。 */
  body.electron #pet { -webkit-app-region: no-drag; cursor: grab; }
  /* ---- 交互动画：全部 CSS transform，不加皮肤素材，所有皮肤通用 ---- */
  #pet.anim-squish { animation: pet-squish .45s ease; }
  #pet.anim-wobble { animation: pet-wobble .6s ease; }
  #pet.anim-look { animation: pet-look 1.4s ease-in-out; }
  #pet.anim-stretch { animation: pet-stretch 1.1s ease; }
  #pet.anim-doze { animation: pet-doze 2.8s ease-in-out; }
  /* 自由活动的走路姿态：轻微上下颠 + 左右晃，无限循环（不进 ANIMS，手动摘）。 */
  #pet.anim-walk { animation: pet-walk .58s ease-in-out infinite; }
  @keyframes pet-walk { 0%, 100% { transform: translateY(0) rotate(-1.2deg) } 50% { transform: translateY(-6px) rotate(1.2deg) } }
  @keyframes pet-squish { 0% { transform: scale(1, 1) } 30% { transform: scale(1.08, .86) } 55% { transform: scale(.96, 1.06) } 100% { transform: scale(1, 1) } }
  @keyframes pet-wobble { 0% { transform: rotate(0) } 20% { transform: rotate(-5deg) } 45% { transform: rotate(4.5deg) } 70% { transform: rotate(-3deg) } 100% { transform: rotate(0) } }
  @keyframes pet-look { 0% { transform: translateX(0) rotate(0) } 25% { transform: translateX(-7px) rotate(-4deg) } 55% { transform: translateX(7px) rotate(4deg) } 100% { transform: translateX(0) rotate(0) } }
  @keyframes pet-stretch { 0% { transform: scaleY(1) } 40% { transform: scaleY(1.07) } 70% { transform: scaleY(.98) } 100% { transform: scaleY(1) } }
  @keyframes pet-doze { 0% { transform: rotate(0) } 30% { transform: rotate(-7deg) } 75% { transform: rotate(-7deg) } 88% { transform: rotate(2deg) } 100% { transform: rotate(0) } }
  .pet-particle { position: absolute; font-size: 16px; pointer-events: none; z-index: 5; animation: pet-float 1.2s ease-out forwards; }
  @keyframes pet-float { from { opacity: 1; transform: translateY(0) scale(.9) } to { opacity: 0; transform: translateY(-48px) scale(1.3) } }
  #bubble { position: relative; background: rgba(20, 28, 38, .88); color: #e8f1fa; border: 1px solid rgba(255,255,255,.14);
    border-radius: 12px; padding: 8px 12px; font-size: 12px; line-height: 1.6; max-width: 260px; white-space: normal;
    -webkit-app-region: no-drag; pointer-events: none; box-shadow: 0 4px 16px rgba(0,0,0,.3); }
  #bubbleText { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; white-space: normal; word-break: break-word; }
  #bubble b { color: #ffd766; }
  #bubble .muted { color: #9db4c8; }
  /* 久坐提醒的操作出口：气泡里两个按钮（父级 pointer-events:none，这里收回） */
  .rest-actions { display: flex; gap: 8px; margin-top: 8px; pointer-events: auto; }
  .rest-btn { background: #2c5a7a; color: #eaf6ff; border: 1px solid #3a7ab0; border-radius: 8px;
    padding: 4px 10px; font-size: 11.5px; cursor: pointer; -webkit-app-region: no-drag; }
  .rest-btn:hover { background: #356a92; }
  .rest-btn.rest-ghost { background: transparent; color: #9db4c8; border-color: #3a4a5c; }
  .rest-btn.rest-ghost:hover { border-color: #54708a; color: #dbe7f2; }
  #bubble.alert { border-color: #ff7a5c; background: rgba(64, 20, 12, .92); }
  #bubble.done-ok { border-color: rgba(55, 178, 108, .75); }
  #bubble.done-bad { border-color: #e0564f; background: rgba(64, 20, 12, .92); }
  .hidden { display: none !important; }
  /* 减少动态效果：尊重系统设置，别让桌宠在「减少动画」模式下继续抖 */
  @media (prefers-reduced-motion: reduce) {
    #pet.anim-squish, #pet.anim-wobble, #pet.anim-look, #pet.anim-stretch, #pet.anim-doze, #pet.anim-walk { animation: none !important; }
    .pet-particle { animation: none !important; }
  }
</style>
</head>
<body class="browser">
  <div id="stage">
    <div id="pet"><img id="petImg" alt="pet" draggable="false"></div>
    <div id="bubble"><span id="bubbleText">连接中…</span>
      <div id="restActions" class="rest-actions hidden">
        <button id="restWalk" class="rest-btn" type="button">起来走走 ✓</button>
        <button id="restLater" class="rest-btn rest-ghost" type="button">稍后 10 分钟</button>
      </div>
    </div>
  </div>
<script>
'use strict'
const $ = (id) => document.getElementById(id)
const inElectron = !!window.petShell
if (inElectron) document.body.classList.replace('browser', 'electron')
if (new URLSearchParams(location.search).has('embed')) document.body.classList.add('embed')

let snap = null
let stateShown = ''
// 抚摸台词：短暂覆盖 HUD 气泡（到期自动回落）。
let lineUntil = 0
let lineText = ''

function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  if (h > 0) return h + 'h ' + m + 'm ' + (s % 60) + 's'
  if (m > 0) return m + 'm ' + (s % 60) + 's'
  return s + 's'
}
function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(n)
}
function currencySymbol(c) { return c === 'USD' ? '$' : '¥' }

function applySkin(skin, state) {
  const key = skin + '/' + state
  if (stateShown === key) return
  stateShown = key
  // 状态切换优先于反应帧：新状态直接顶掉反应图并撤销在途计时。
  if (reactionTimer) { clearTimeout(reactionTimer); reactionTimer = null }
  reactionName = null
  $('petImg').src = '/skins/' + encodeURIComponent(skin) + '/' + encodeURIComponent(state) + '.svg?t=' + Date.now()
}

// ---- 反应帧（manifest reactions 段）：抚摸/拖拽/连点时整图临时替换，
//      让桌宠「点有反应、拖有脾气」。没有反应帧的皮肤自动退回纯 CSS 动画，
//      行为与旧版一致。状态帧优先级更高（SSE 一来就顶掉）。----
let skinReactions = {} // 皮肤名 → 可用反应名（/api/skins 加载一次）
let reactions = [] // 当前皮肤的反应名
let reactionName = null // 正在显示的反应帧（null = 状态帧）
let reactionTimer = null
function refreshReactions() {
  reactions = (snap && snap.settings && skinReactions[snap.settings.skin]) || []
}
function loadSkinReactions() {
  fetch('/api/skins').then((r) => r.json()).then((list) => {
    for (const s of list) skinReactions[s.name] = s.reactions || []
    refreshReactions()
  }).catch(() => {})
}
function showReaction(name, ms) {
  if (!snap || !snap.settings || reactions.indexOf(name) < 0) return false
  reactionName = name
  $('petImg').src = '/skins/' + encodeURIComponent(snap.settings.skin) + '/' + encodeURIComponent(name) + '.png?t=' + Date.now()
  if (reactionTimer) clearTimeout(reactionTimer)
  reactionTimer = ms > 0 ? setTimeout(clearReaction, ms) : null
  return true
}
function clearReaction() {
  if (reactionTimer) { clearTimeout(reactionTimer); reactionTimer = null }
  if (!reactionName) return
  reactionName = null
  stateShown = null // 强制 applySkin 重挂当前状态帧
  if (snap) applySkin(snap.settings.skin, snap.state)
}

// ---- HUD 两行信息条：运行中「状态+计时 / 模型+Token」；空闲「今日概览」一行；
//      任务完成/失败气泡停留 5 秒；纯宠物模式全部隐藏（规格经用户讨论确定） ----
let today = null // GET /api/stats?period=today（空闲行数据源）
let flashUntil = 0 // 完成气泡的过期时间戳
let flashResult = null

function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  const p = (n) => String(n).padStart(2, '0')
  return h > 0 ? h + ':' + p(m) + ':' + p(s % 60) : p(m) + ':' + p(s % 60)
}
function loadToday() {
  fetch('/api/stats?period=today').then((r) => r.json())
    .then((d) => { today = d; renderHud() })
    .catch(() => {})
}
function renderHud() {
  if (!snap) return
  const b = $('bubble')
  if (snap.settings && snap.settings.purePetMode) {
    b.classList.add('hidden')
    return
  }
  b.classList.remove('hidden')
  b.classList.remove('alert', 'done-ok', 'done-bad')
  // 久坐提醒提示优先：到点后亮出两个出口（起来走走 / 稍后），60s 后自动收起。
  if (restPromptUntil > 0 && Date.now() < restPromptUntil) {
    $('bubbleText').innerHTML = '<b>' + restLine + '</b>'
    $('restActions').classList.remove('hidden')
    return
  }
  $('restActions').classList.add('hidden')
  if (lineText && Date.now() < lineUntil) {
    // 抚摸台词优先展示，到期由 tick 清掉并还原 HUD。
    $('bubbleText').textContent = lineText
    return
  }
  let text
  if (snap.task) {
    const t = snap.task
    text = '<b>' + snap.label + '</b> <span class="muted">⏱ ' + fmtClock(Date.now() - t.startTime) + '</span>'
    if (snap.alert) {
      b.classList.add('alert')
      text += '<br>⚠ ' + snap.alert.message
    } else {
      const bits = []
      if (t.model) bits.push(t.model)
      const tot = t.tokens.totalTokens || (t.tokens.inputTokens + t.tokens.outputTokens)
      if (tot > 0) bits.push(fmtTokens(tot) + ' tok')
      if (bits.length) text += '<br><span class="muted">' + bits.join(' · ') + '</span>'
    }
  } else if (Date.now() < flashUntil && flashResult) {
    const r = flashResult
    const ok = r.status === 'success'
    b.classList.add(ok ? 'done-ok' : 'done-bad')
    const word = ok ? '完成' : (r.status === 'interrupted' ? '中断' : '失败')
    text = '<b>' + (ok ? '✓ ' : '✗ ') + word + '</b> <span class="muted">' + fmtDuration(r.durationMs) +
      ' · ' + fmtTokens(r.tokens.totalTokens) + ' tok' +
      (r.cost > 0 ? ' · ' + currencySymbol(snap.currency) + r.cost.toFixed(2) : '') + '</span>'
  } else {
    text = '<b>' + snap.label + '</b>'
    if (today && today.totalTokens > 0) {
      text += ' <span class="muted">· 今日 ' + fmtTokens(today.totalTokens) + ' tok' +
        (today.cost > 0 ? ' · ' + currencySymbol(snap.currency) + today.cost.toFixed(2) : '') + '</span>'
    }
    if (snap.alert) {
      b.classList.add('alert')
      text += '<br>⚠ ' + snap.alert.message
    } else if (snap.paused) {
      text += '<br><span class="muted">⏸ 统计已暂停</span>'
    }
  }
  $('bubbleText').innerHTML = text
}

function tick() {
  if (!snap) return
  // 久坐提醒提示到期：收起按钮、回落正常 HUD。
  if (restPromptUntil > 0 && Date.now() >= restPromptUntil) {
    restPromptUntil = 0
    $('restActions').classList.add('hidden')
    renderHud()
  }
  restCheck()
  // 台词到期：清掉并还原 HUD。
  if (lineUntil > 0 && Date.now() >= lineUntil) {
    lineUntil = 0
    lineText = ''
    renderHud()
    return
  }
  // 运行中每秒刷计时；完成气泡与抚摸台词期间也刷（到期自动落回空闲行）。
  if (snap.task || Date.now() < flashUntil || Date.now() < lineUntil) renderHud()
}

function render() {
  if (!snap) return
  refreshReactions()
  applySkin(snap.settings.skin, snap.state)
  applyLook()
  renderHud()
}

// ---- 系统通知（Electron 壳）----
// 气泡在桌面上常被窗口挡住；长任务完成/失败、预算触顶时补一条系统通知。
// 节流：短任务（<60s）不弹（气泡够用、避免刷屏），预算告警必弹（稀有且重要）。
function canNotify() {
  return !!(inElectron && window.petShell && typeof window.petShell.notify === 'function' &&
    snap && snap.settings && snap.settings.notify !== false)
}
function notifyFinished(r) {
  if (!canNotify() || !r) return
  const dur = Number(r.durationMs) || 0
  if (dur < 60000) return
  const ok = r.status === 'success'
  const word = ok ? '完成' : (r.status === 'interrupted' ? '中断' : '失败')
  const bits = [fmtDuration(dur)]
  const tot = r.tokens && r.tokens.totalTokens
  if (tot) bits.push(fmtTokens(tot) + ' tok')
  if (r.cost > 0) bits.push(currencySymbol(snap.currency) + r.cost.toFixed(2))
  window.petShell.notify((ok ? '✓ ' : '✗ ') + '任务' + word, bits.join(' · '))
}
function notifyAlert(a) {
  if (!canNotify() || !a) return
  window.petShell.notify('⚠ 预算告警', a.message || '')
}

const es = new EventSource('/api/events')
es.onmessage = (e) => {
  try {
    const msg = JSON.parse(e.data)
    if (msg && msg.bye) {
      // 插件服务正在优雅关闭（DSH 退出/插件卸载）：伴侣壳随之退出，
      // 浏览器模式忽略（页面很快自然失联）。
      if (inElectron && window.petShell) window.petShell.quit()
      return
    }
    const hadTask = !!(snap && snap.task)
    const prevAlertTime = snap && snap.alert ? snap.alert.time : 0
    snap = msg
    // 任务刚结束 → 完成/失败气泡停留 5 秒，并刷新今日累计。
    if (hadTask && !msg.task && msg.lastResult) {
      flashResult = msg.lastResult
      flashUntil = Date.now() + 5000
      loadToday()
      notifyFinished(msg.lastResult)
    }
    // 预算告警只在「新的一条」弹出，避免快照每 5s 重复推同一条时反复通知。
    if (msg.alert && msg.alert.time !== prevAlertTime) notifyAlert(msg.alert)
    render()
  } catch (err) { /* ignore */ }
}
setInterval(tick, 1000)
loadToday()
setInterval(loadToday, 60000)

// ---- 拖拽（浏览器模式移动元素；Electron 模式见交互段的 moveBy IPC 拖窗） ----
// busyDrag：任一模式拖拽进行中——空闲小动作调度器据此让路。
function savePosition(x, y) {
  try { localStorage.setItem('pet.pos', JSON.stringify({ x, y })) } catch (err) {}
  fetch('/api/position', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x, y }) }).catch(() => {})
}
let busyDrag = false
if (!inElectron) {
  const stage = $('stage')
  const petEl = $('pet')
  let dragging = false, sx = 0, sy = 0, bx = 0, by = 0, downT = 0, moved = false
  // 拖拽/抚摸命中区域 = 宠物本体；舞台周边（气泡、空白）不再响应（用户要求收窄）。
  petEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    stopRoam(); noteNudge() // 上手 = 结束自由活动（立刻回原位），并按「有人陪」重置计时
    dragging = true; moved = false; downT = Date.now()
    sx = e.clientX; sy = e.clientY
    const rect = stage.getBoundingClientRect(); bx = rect.left; by = rect.top
    stage.style.right = 'auto'; stage.style.bottom = 'auto'
    petEl.setPointerCapture(e.pointerId)
  })
  petEl.addEventListener('pointermove', (e) => {
    if (!dragging) return
    // ≤5px 视为手抖，不算拖拽（松手时按点击 = 抚摸处理）。
    if (!moved && Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 5) { moved = true; busyDrag = true; showReaction('drag', 0) }
    if (!moved) return
    const x = Math.max(4, Math.min(window.innerWidth - 60, bx + e.clientX - sx))
    const y = Math.max(4, Math.min(window.innerHeight - 60, by + e.clientY - sy))
    stage.style.left = x + 'px'; stage.style.top = y + 'px'
  })
  petEl.addEventListener('pointerup', () => {
    if (!dragging) return
    dragging = false
    busyDrag = false
    if (!moved) {
      if (Date.now() - downT < 600) petReact()
      return
    }
    const rect = stage.getBoundingClientRect()
    savePosition(Math.round(rect.left), Math.round(rect.top))
    landingReact()
  })
  try {
    const pos = JSON.parse(localStorage.getItem('pet.pos') || 'null')
    if (pos && typeof pos.x === 'number') {
      stage.style.right = 'auto'; stage.style.bottom = 'auto'
      stage.style.left = pos.x + 'px'; stage.style.top = pos.y + 'px'
    }
  } catch (err) {}
}

// ---- 外观（不透明度 / 缩放）：以设置为准；滚轮即时调整并回写服务端 ----
function applyLook() {
  if (!snap) return
  const pet = $('pet')
  pet.style.opacity = String(snap.settings.opacity)
  pet.style.width = Math.round(220 * snap.settings.scale) + 'px'
  pet.style.height = Math.round(200 * snap.settings.scale) + 'px'
}
// 必须按住 Ctrl（mac 上 ⌘）+ 滚轮才缩放：桌面壳常驻点击穿透（ignoreMouseEvents forward），
// 裸滚轮会被转发进来——用户滚动文档、看长网页时经过宠物就把她改小了（用户实测反馈）。
// 同时要 preventDefault，否则浏览器模式下 Ctrl+滚轮还会缩放整个页面。
window.addEventListener('wheel', (e) => {
  if (!snap) return
  if (!e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  const next = Math.max(0.4, Math.min(3, snap.settings.scale + (e.deltaY < 0 ? 0.08 : -0.08)))
  snap.settings.scale = Math.round(next * 100) / 100
  applyLook()
  fetch('/api/scale', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scale: snap.settings.scale }) }).catch(() => {})
}, { passive: false })

// ---- 交互：抚摸 / 连点彩蛋 / 拖拽落地 / 空闲随机小动作 ----
// 全部 CSS transform 动画 + DOM 粒子，不加皮肤素材，所有皮肤通用；
// 台词走 sayLine 短暂覆盖 HUD 气泡（纯宠物模式只动画不出字）。
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }
// 台词跟皮肤走（用户定案：独立「台词风格」系统已退役——服装即人格）。
// SKIN_LINES 皮肤名 → 台词包；未列的皮肤（自制皮肤）用 default 中性口吻。
// 新服装配台词 = LINE_PACKS 加一包 + SKIN_LINES 加一行映射，两处即可。
const LINE_PACKS = {
  default: {
    idle: ['嘿嘿，好痒', '充能完毕，随时伴飞', '摸我一下，代码无 bug（迷信）', '今天的数据我帮你盯着呢', '要一起飞吗？开个任务就走', '喵？我不是猫'],
    work: ['嘘…模型在思考', '正在努力搬砖，别闹', '盯着 token 呢，一个都跑不掉', '摸一下不会加速的（真的）'],
    dizzy: ['晕了晕了…摸太多啦', '别摸了，要秃了', '爱意太猛烈，承受不住'],
    land: ['哇，稳稳落地', '搬新家？我在哪都行', '下次轻点扔'],
    doze: ['Zzz… 惊醒！我没睡，我在冥想', '刚才只是在闭目养神'],
    rest: ['起来活动一下吧，坐太久啦', '该伸个懒腰了，眼睛也歇会儿', '休息五分钟，我帮你盯着'],
    roam: ['四处看看，说不定有 bug 藏着', '巡逻一圈，安全', '游到这儿了，风景不错', '活动活动尾巴～'],
  },
  yujie: {
    idle: ['哎呀，胆子不小嘛~', '摸头可是要付出代价的哦', '呵呵，今天就这么有精神？', '累了就歇会儿，姐姐看着你', '想撒娇的话，也不是不可以', '嗯？手还想往哪放呢'],
    work: ['在忙呢，乖，别闹', '工作时间就专心点，嗯？', '数据姐姐帮你盯着，你只管往前冲', '急什么，好戏在后头'],
    dizzy: ['好了好了，姐姐认输', '这么热情，可招架不住呢', '再闹……要惩罚你了哦'],
    land: ['哎呀，真是粗鲁呢', '放稳一点，头都要晕了', '下次温柔点，嗯？'],
    doze: ['呼……被你看到姐姐打盹了', '只是闭目养神，不许说出去哦'],
    rest: ['歇会儿吧，姐姐可不想看你累垮', '起来走走，别坐太久', '喝口水，回来再继续'],
    roam: ['四处走走，顺便看看你在忙什么', '姐姐巡场，谁在摸鱼呢', '散散步，别多想', '景色不错，就是缺杯茶'],
  },
  ceo: {
    idle: ['本总裁的时间很宝贵，摸一下收费一个亿', '嗯，表现不错，年终奖有着落了', '有什么事？说重点', '批准你的抚摸申请，仅此一次', 'KPI 没完成之前，不许偷懒', '咖啡续上了，继续干活'],
    work: ['会议进行中，有事发邮件', '这个项目我亲自盯，你放心', '效率就是生命，别打断我', '做完这单就给你加薪（画的）'],
    dizzy: ['你被解雇了……开玩笑的', '本季度的抚摸额度用完了', '注意你的工作态度！'],
    land: ['出差可以，但请提前报备', '嗯，落地姿势还算体面', '下次搬我请走行政流程'],
    doze: ['那不是打盹，是战略性闭目', '午休时间，谁也不许吵……啊，醒了'],
    rest: ['效率靠节奏，先休息五分钟', '本总裁批准你的带薪休息', '起来走动，劳逸结合才出活'],
    roam: ['巡视一下办公区，看看谁在摸鱼', '走动管理，古德', '本总裁视察，继续工作', '路演中，勿扰'],
  },
  academy: {
    idle: ['前辈！摸头的话…要负责哦', '今天的作业写完了吗？', '图书馆见？我帮你占座', '嘿嘿，被前辈摸到了', '下节是自习，可以陪你一会', '交换日记要不要写我呀'],
    work: ['前辈在刷题吗？我不吵你', '这个任务加油！我给你递水', '再忙也要记得休息哦', '笔记借你抄，摸头抵账'],
    dizzy: ['前辈太过分了！记小本本上', '再欺负我就告诉老师了', '呜呜，头晕了要前辈负责'],
    land: ['哇，体育课都没这么刺激', '前辈的手劲要练练了', '落地成功！十分给六分'],
    doze: ['上课睡觉被抓到了…嘘', 'Zzz…这道题选 C……啊？没睡！'],
    rest: ['前辈，该课间休息啦！', '站起来伸个懒腰吧，我等你', '眼睛累了吧？看看远处'],
    roam: ['前辈！我来回走两步～', '课间散步，一起吗？', '绕一圈，看看有没有人找我玩', '操场上跑两圈！'],
  },
  gufeng: {
    idle: ['公子今日得闲，陪奴家看海么', '风平浪静，正宜晒尾', '鲸歌一曲，公子可愿听', '潮起潮落，唯有相伴不减', '公子头发乱了，让奴家替你理理'],
    work: ['此事包在奴家身上，公子放心', '奴家自当尽力，公子稍候片刻', '海中算珠，粒粒 token 都替公子数着呢', '公子且歇息，让奴家给你沏茶'],
    dizzy: ['哎呀……天旋地转了', '公子轻些，奴家头晕', '再闹，奴家可要告诉龙王了'],
    land: ['呀，失礼了', '公子怎的这般粗鲁', '裙摆都弄皱了啦……'],
    doze: ['唔……梦里也在摆尾', '容奴家……再眯一小会儿', 'Zzz……星河入海来……'],
    rest: ['公子，久坐了，且起来走走', '奴家替你温了茶，歇歇吧', '窗外天色正好，莫负了春光'],
    roam: ['奴家且四处走走', '庭院深深，正好散步', '公子看，这海光甚好', '尾鳍轻摆，踏浪而行'],
  },
}
// 皮肤 → 台词包：JK=学院少女、OL=总裁、女警/旗袍=御姐、中华娘=古风。
const SKIN_LINES = {
  'whale': 'academy',
  'whale-ol': 'ceo',
  'whale-police': 'yujie',
  'whale-qipao': 'yujie',
  'whale-hanfu': 'gufeng',
}
function skinLines(cat) {
  const key = (snap && snap.settings && SKIN_LINES[snap.settings.skin]) || 'default'
  const pack = LINE_PACKS[key] || LINE_PACKS.default
  return pack[cat] || LINE_PACKS.default[cat]
}

// ---- 久坐提醒（健康提醒）：墙钟计时，不看任务在不在跑 ----
// 坐够 intervalMinutes 就提醒；以下任一发生即归零重计：
//  ① 系统空闲 ≥3 分钟（Electron 壳的 powerMonitor.getSystemIdleTime，人真离开了 = 休息过）
//  ② 点气泡「起来走走」 ③ 系统空闲 ≥3 分钟（真的离开过就算重新坐）
// 「稍后 10 分钟」= 现在归零 + 10 分钟后再提醒一次（不吃掉整个间隔）。
// 浏览器模式没有系统空闲 API：只有墙钟 + 手动归零，提醒本身照常。
const IDLE_RESET_SEC = 180
let restBaseTs = Date.now()
let restPromptUntil = 0
let restSnoozeUntil = 0
let restIdleSec = 0
let restIdleAt = 0
let restLine = ''
function restCheck() {
  if (!snap) return
  const rr = snap.settings && snap.settings.restReminder
  if (!rr || rr.enabled === false) { restBaseTs = Date.now(); return }
  // 系统空闲采样：5 秒一次就够（invoke 往返不便宜，别把主进程当心跳用）。
  if (inElectron && window.petShell && typeof window.petShell.systemIdle === 'function' && Date.now() - restIdleAt > 5000) {
    restIdleAt = Date.now()
    Promise.resolve(window.petShell.systemIdle()).then((secs) => {
      restIdleSec = Number(secs) || 0
      if (restIdleSec >= IDLE_RESET_SEC) restBaseTs = Date.now()
    }).catch(() => {})
  }
  if (restPromptUntil > 0 || Date.now() < restSnoozeUntil) return
  const limit = Math.max(5, Math.min(480, Number(rr.intervalMinutes) || 60)) * 60000
  if (Date.now() - restBaseTs >= limit) restRemind()
}
function restRemind() {
  restBaseTs = Date.now()
  restPromptUntil = Date.now() + 60000
  restLine = pick(skinLines('rest'))
  playAnim('anim-stretch')
  spawnParticles(['☕', '🌿', '🍅'], 3)
  if (!(snap.settings && snap.settings.purePetMode)) renderHud()
}
function restClearPrompt() {
  restPromptUntil = 0
  $('restActions').classList.add('hidden')
}
function restAck() {
  restClearPrompt()
  restSnoozeUntil = 0
  restBaseTs = Date.now()
  renderHud()
}
function restLater() {
  restClearPrompt()
  restBaseTs = Date.now()
  restSnoozeUntil = Date.now() + 10 * 60000
  renderHud()
}
$('restWalk').onclick = (e) => { e.stopPropagation(); restAck() }
$('restLater').onclick = (e) => { e.stopPropagation(); restLater() }

function sayLine(text, ms) {
  if (snap && snap.settings && snap.settings.purePetMode) return
  lineText = text
  lineUntil = Date.now() + (ms || 2800)
  renderHud()
}

const ANIMS = ['anim-squish', 'anim-wobble', 'anim-look', 'anim-stretch', 'anim-doze']
function playAnim(cls) {
  const pet = $('pet')
  for (const c of ANIMS) pet.classList.remove(c)
  void pet.offsetWidth // 重触发同名动画
  pet.classList.add(cls)
}
$('pet').addEventListener('animationend', (e) => {
  if (e.target !== $('pet')) return // 粒子动画冒泡上来，别误清
  for (const c of ANIMS) $('pet').classList.remove(c)
})

function spawnParticles(chars, n) {
  const pet = $('pet')
  for (let i = 0; i < n; i++) {
    const sp = document.createElement('span')
    sp.className = 'pet-particle'
    sp.textContent = pick(chars)
    sp.style.left = (30 + Math.random() * 40) + '%'
    sp.style.top = (8 + Math.random() * 30) + '%'
    sp.style.animationDelay = (i * 90) + 'ms'
    pet.appendChild(sp)
    setTimeout(() => sp.remove(), 1600)
  }
}

let clickTimes = []
let dizzyUntil = 0
function petReact() {
  const now = Date.now()
  if (now < dizzyUntil) return
  clickTimes = clickTimes.filter((t) => now - t < 1800)
  clickTimes.push(now)
  // 连点彩蛋：1.8 秒内摸 5 下 → 晕头转向 + 3 秒冷静期。
  if (clickTimes.length >= 5) {
    clickTimes = []
    dizzyUntil = now + 3000
    playAnim('anim-wobble')
    showReaction('dizzy', 3000) // 晕头帧撑满整个冷静期
    spawnParticles(['💫', '😵'], 3)
    sayLine(pick(skinLines('dizzy')), 3200)
    return
  }
  playAnim('anim-squish')
  showReaction('pat', 1500) // 舒服~（1.5 秒后回到状态帧）
  spawnParticles(['❤', '💛', '✨'], 3 + Math.floor(Math.random() * 2))
  sayLine(pick(skinLines(snap && snap.task ? 'work' : 'idle')))
}
function landingReact() {
  playAnim('anim-wobble')
  // 拖拽松手：有生气帧就气 2 秒；没有也得把拖拽帧收掉（clearReaction 兜底）。
  if (!showReaction('angry', 2000)) clearReaction()
  if (Math.random() < 0.35) sayLine(pick(skinLines('land')), 2200)
}

// Electron 模式：宠物本体 no-drag（见 CSS），拖窗交给**主进程跟手**。
// 页面只负责判别「这是点击还是拖拽」，越过阈值就发 dragStart，松手发 dragEnd；
// 位移由主进程读系统光标算（screen.getCursorScreenPoint），不再用渲染进程的
// screenX —— 175% 这类非整数缩放下它与窗口 DIP 坐标不一致，会把位移放大，
// 表现为「手没动，宠物自己跑走」（用户实测两次的老问题）。
// 阈值 = 总位移 ≤12px 算点击；非拖拽的松手（任意时长）都算抚摸。
if (inElectron) {
  const petEl = $('pet')
  let pd = null
  const DRAG_PX = 12
  petEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    stopRoam(); noteNudge() // 抓住它 = 自由活动结束并回原位（主进程也会停补间）
    if (window.petShell && window.petShell.dragEnd) window.petShell.dragEnd() // 收掉上一轮可能残留的跟手
    pd = { sx: e.screenX, sy: e.screenY, t: Date.now(), moved: false }
    petEl.setPointerCapture(e.pointerId)
    setInteractive(true) // 拖拽期间锁住交互，窗口不能中途变穿透
    e.preventDefault()
  })
  petEl.addEventListener('pointermove', (e) => {
    lastMouse.x = e.clientX; lastMouse.y = e.clientY
    if (!pd) return
    // 漏掉 pointerup（穿透切换/失焦/窗口被挪动时都可能）→ 发现按键已松开就收尾，
    // 否则残留状态会让宠物随后跟着鼠标自己跑。
    if (e.buttons === 0) { endPetDrag(); return }
    if (pd.moved) return // 一旦开拖，位移全权交给主进程，页面不再插手
    if (Math.abs(e.screenX - pd.sx) + Math.abs(e.screenY - pd.sy) > DRAG_PX) {
      pd.moved = true
      busyDrag = true
      showReaction('drag', 0)
      if (window.petShell && window.petShell.dragStart) window.petShell.dragStart()
    }
  })
  const endPetDrag = () => {
    if (!pd) return
    const moved = pd.moved
    pd = null
    busyDrag = false
    if (moved && window.petShell && window.petShell.dragEnd) window.petShell.dragEnd()
    evalHover(lastMouse.x, lastMouse.y) // 松手后按鼠标位置重估穿透
    if (moved) landingReact()
    else petReact() // 点击与长按都算抚摸（按住很久也不该一动不动）
  }
  petEl.addEventListener('pointerup', endPetDrag)
  petEl.addEventListener('pointercancel', endPetDrag)
  petEl.addEventListener('lostpointercapture', endPetDrag)
}

// ---- Electron 智能穿透：命中区域 = 宠物本体 ----
// 窗口常态 setIgnoreMouseEvents(true, {forward:true})——周边透明区域的点击/拖拽
// 直接穿到桌面或下层窗口；mousemove 仍会转发进页面，据此用 elementFromPoint
// 判断鼠标是否悬在宠物本体上，是才发 IPC 收回鼠标事件（窗口可交互）。
// 拖拽进行中强制保持交互；全穿透模式（settings.clickThrough）不干预。
let hoverOn = false
const lastMouse = { x: 0, y: 0 }
function setInteractive(on) {
  if (!inElectron) return
  if (hoverOn === on) return
  hoverOn = on
  if (window.petShell && window.petShell.setMouseIgnore) window.petShell.setMouseIgnore(!on)
}
function evalHover(x, y) {
  if (!inElectron) return
  if (snap && snap.settings && snap.settings.clickThrough) return
  if (busyDrag) { setInteractive(true); return }
  const pet = $('pet')
  const el = document.elementFromPoint(x, y)
  const onPet = !!(el && (el === pet || pet.contains(el)))
  // 久坐提醒的按钮浮在气泡里（宠物本体之外），不收回交互就点不到。
  const onRest = !!(el && el.closest && el.closest('#restActions'))
  setInteractive(onPet || onRest)
}
document.addEventListener('mousemove', (e) => {
  lastMouse.x = e.clientX; lastMouse.y = e.clientY
  // 鼠标在宠物身上打转也算「有人陪」——别在用户眼皮底下自己溜达。
  if (e.target && e.target.closest && e.target.closest('#pet')) noteNudge()
  evalHover(e.clientX, e.clientY)
})

// 空闲随机小动作：14 秒一拍、45% 概率——张望 / 伸懒腰 / 打瞌睡（带 💤 和梦话）。
setInterval(() => {
  if (!snap || snap.task) return
  if (Date.now() < flashUntil || Date.now() < lineUntil || Date.now() < dizzyUntil) return
  if (busyDrag) return
  if (Math.random() > 0.45) return
  const pure = !!(snap.settings && snap.settings.purePetMode)
  const r = Math.random()
  if (r < 0.2) {
    playAnim('anim-doze')
    if (!pure) {
      spawnParticles(['💤'], 2)
      if (Math.random() < 0.5) sayLine(pick(skinLines('doze')), 3000)
    }
  } else if (r < 0.6) {
    playAnim('anim-look')
  } else {
    playAnim('anim-stretch')
  }
}, 14000)

// ---- 自由活动：长时间没人理它，就自己在**整个屏幕**上慢慢逛、做动作、说两句 ----
// 触发条件 = 真的闲：没有任务在跑、没在拖、久坐提示没弹、无人碰它 ≥75s。
// 行为 = 随机挑屏幕工作区内的点，按固定步速（ROAM_SPEED）平滑走过去，到站歇一下；
// 被打断（上手 / 任务开始 / 关开关）**立刻回原位**，一轮逛满也会自己回家，
// 所以位置永远收敛。浏览器模式退化为在页面内挪 #stage。
const ROAM_IDLE_MS = 75000
const ROAM_SPEED = 210 // px/s：慢慢挪，不是瞬移
const ROAM_MAX_SEG = 8
const ROAM_MARGIN = 24
let lastNudge = Date.now()
let busyRoam = false
let roamHome = null
let roamPending = []
function roamEnabled() {
  try { return localStorage.getItem('pet.roam') !== '0' } catch (err) { return true }
}
function noteNudge() { lastNudge = Date.now() }
// 等待也要能被「打断」唤醒：只 clearTimeout 会留下永不 resolve 的 Promise。
function roamSleep(ms) {
  return new Promise((resolve) => {
    const id = setTimeout(() => {
      roamPending = roamPending.filter((p) => p.id !== id)
      resolve()
    }, ms)
    roamPending.push({ id, resolve })
  })
}
function clearRoamTimers() {
  const pending = roamPending
  roamPending = []
  for (const p of pending) { clearTimeout(p.id); p.resolve() }
}
function roamMoveTo(x, y, ms) {
  // 防御：坐标不成立就别发 IPC——主进程那边宁可不动，也不能拿 NaN 去 setPosition
  // （Electron 会在主进程弹「A JavaScript error occurred…」模态框，补间里就是连环弹窗）。
  if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return
  if (inElectron && window.petShell && window.petShell.roamTo) {
    window.petShell.roamTo(Math.round(x), Math.round(y), ms)
    return
  }
  // 浏览器模式：挪舞台元素（跟拖拽同一套 left/top 定位）。
  const stage = $('stage')
  stage.style.right = 'auto'; stage.style.bottom = 'auto'
  stage.style.transition = 'left ' + ms + 'ms cubic-bezier(.4,0,.2,1), top ' + ms + 'ms cubic-bezier(.4,0,.2,1)'
  stage.style.left = Math.round(x) + 'px'
  stage.style.top = Math.round(y) + 'px'
}
// 当前屏幕的工作区（Electron 问主进程；浏览器用视口）。
function roamArea() {
  const fallback = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
  const ok = (a) => !!(a && Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.width) &&
    Number.isFinite(a.height) && a.width > 0 && a.height > 0)
  if (inElectron && window.petShell && window.petShell.workArea) {
    // 壳给 {x,y,width,height}；拿不到或字段不全（旧壳 / IPC 异常）就退回视口，别让后续算术变 NaN。
    return Promise.resolve(window.petShell.workArea()).then((a) => (ok(a) ? a : fallback)).catch(() => fallback)
  }
  return Promise.resolve(fallback)
}
// 在工作区里随机挑一个点；尽量离当前位置远一点，别在原地打转。
function roamPick(area, from, size) {
  const w = Number(size.width) || 280
  const h = Number(size.height) || 340
  const maxX = Math.max(1, Number(area.width) - w - ROAM_MARGIN * 2)
  const maxY = Math.max(1, Number(area.height) - h - ROAM_MARGIN * 2)
  let best = null
  for (let i = 0; i < 8; i++) {
    const x = Number(area.x) + ROAM_MARGIN + Math.random() * maxX
    const y = Number(area.y) + ROAM_MARGIN + Math.random() * maxY
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const d = Math.hypot(x - from.x, y - from.y)
    if (!Number.isFinite(d)) continue
    if (!best || d > best.d) best = { x, y, d }
    if (d > 180) return { x, y, d }
  }
  return best
}
function goHome(ms) {
  if (!roamHome) return
  roamMoveTo(roamHome.x, roamHome.y, ms || 450)
}
// 任何打断：立刻收手并回原位（用户口径：被抓 / 任务开始 / 关掉 → 马上回去）。
function stopRoam() {
  if (!busyRoam) return
  busyRoam = false
  clearRoamTimers()
  $('pet').classList.remove('anim-walk')
  goHome(450)
  lastNudge = Date.now() // 回位后重新计时，别马上又出去
}
async function roamStart() {
  if (busyRoam || !roamEnabled()) return
  busyRoam = true
  clearRoamTimers()
  let home = null
  if (inElectron && window.petShell && window.petShell.bounds) {
    try { home = await window.petShell.bounds() } catch (err) { home = null }
  }
  if (!home) {
    const r = $('stage').getBoundingClientRect()
    home = { x: r.left, y: r.top, width: r.width, height: r.height }
  }
  roamHome = home
  const area = await roamArea()
  // 起点必须是有限值：拿到坏 bounds（旧壳 / IPC 空值）就干脆不逛，绝不把 NaN 传给主进程。
  if (!Number.isFinite(home.x) || !Number.isFinite(home.y)) { busyRoam = false; return }
  let pos = { x: home.x, y: home.y }
  for (let i = 0; i < ROAM_MAX_SEG; i++) {
    if (!busyRoam) return
    const target = roamPick(area, pos, home)
    if (!target) break // 一个点都选不出来（工作区比宠物还小）→ 收工回家
    const dist = Math.hypot(target.x - pos.x, target.y - pos.y)
    const dur = Math.max(700, Math.min(7000, (dist / ROAM_SPEED) * 1000))
    $('pet').classList.add('anim-walk')
    roamMoveTo(target.x, target.y, dur)
    await roamSleep(dur + 40)
    pos = target
    if (!busyRoam) return
    $('pet').classList.remove('anim-walk')
    // 到站歇口气：张望 / 伸懒腰 / 打瞌睡，多半还会说一句「逛到这儿了」。
    const r = Math.random()
    if (r < 0.35) playAnim('anim-look')
    else if (r < 0.6) playAnim('anim-stretch')
    else if (r < 0.75) playAnim('anim-doze')
    if (Math.random() < 0.5) sayLine(pick(skinLines('roam')), 2600)
    if (Math.random() < 0.25) spawnParticles(['✨'], 2)
    await roamSleep(800 + Math.random() * 1400)
  }
  if (!busyRoam) return
  busyRoam = false
  $('pet').classList.remove('anim-walk')
  goHome(700) // 逛满一轮也回家
  lastNudge = Date.now()
}
setInterval(() => {
  if (busyRoam || !roamEnabled()) return
  if (!snap || snap.task) return
  if (busyDrag) return
  if (restPromptUntil > 0) return
  if (snap.settings && snap.settings.showPet === false) return
  if (Date.now() - lastNudge < ROAM_IDLE_MS) return
  roamStart()
}, 5000)

// ---- 右键菜单已整体移除（用户 2026-10-21：「右击他会出选项，不要这个」）----
// 菜单里的入口都有更自然的位置：面板页签（历史/统计/设置）、设置页开关
// （纯宠物模式 / 久坐提醒 / 点击穿透 / 自由活动）、托盘（显示隐藏/退出/回屏幕）。
// 宠物本体只响应左键抚摸与拖拽；右键什么都不弹（浏览器默认菜单也不拦）。
function loadState() {
  fetch('/api/state').then((r) => r.json()).then((data) => { snap = data; render() }).catch(() => {})
  loadSkinReactions()
}
loadState()
</script>
</body>
</html>`;
}
/** 统计面板页（历史 / 统计 / 设置 / 导出）。 */
export function panelPageHTML() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>DSH 伴侣 · 面板</title>
<style>
  :root { color-scheme: dark;
    /* 图表用色走变量：SVG 内联属性可直接引用，浅色主题在下方媒体块换值 */
    --chart-grid: #26323e; --chart-axis: #8aa0b5; --chart-slot: #22303d;
    --chart-bar-top: #5b9dff; --chart-bar-bottom: #2c5a7a;
    --chart-now-top: #ffd766; --chart-now-bottom: #c98f1e; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #141b23; color: #dbe7f2; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 14px; }
  /* 顶栏（头部 + 页签）吸顶 + 毛玻璃：滚动时页签永远在，内容从下面穿过 */
  .topbar { position: sticky; top: 0; z-index: 30; background: rgba(20, 27, 35, .86); backdrop-filter: blur(12px) saturate(1.15); -webkit-backdrop-filter: blur(12px) saturate(1.15); border-bottom: 1px solid #26323e; }
  header { display: flex; align-items: center; gap: 12px; padding: 14px 22px; }
  header, nav { max-width: 1180px; margin-inline: auto; width: 100%; }
  header img { width: 44px; height: 40px; }
  header h1 { font-size: 17px; font-weight: 600; }
  header .sub { color: #8aa0b5; font-size: 12px; }
  header .live { margin-left: auto; font-size: 12px; color: #9db4c8; }
  header .live b { color: #ffd766; }
  nav { display: flex; gap: 6px; padding: 8px 22px 12px; }
  nav button { background: transparent; color: #9db4c8; border: 1px solid transparent; padding: 7px 16px; border-radius: 999px; cursor: pointer; font-size: 13px; transition: background .15s, color .15s, border-color .15s; }
  nav button:hover { background: #1d2935; color: #dbe7f2; }
  nav button.active { background: #1e3a52; color: #9cc9ff; border-color: #2c5a7a; }
  main { padding: 18px 22px 44px; max-width: 1180px; margin-inline: auto; }
  section { display: none; }
  section.active { display: block; }
  /* ---- 统计页：KPI 卡片 + 图表 ---- */
  .stats-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
  .stats-toolbar .seg:last-child { margin-left: auto; }
  .seg { display: inline-flex; background: #1d2935; border: 1px solid #2c3b49; border-radius: 8px; padding: 3px; gap: 2px; }
  .seg button { background: transparent; color: #9db4c8; border: none; border-radius: 6px; padding: 6px 16px; cursor: pointer; font-size: 13px; }
  .seg button.active { background: #2c5a7a; color: #eaf6ff; }
  .kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
  @media (max-width: 1020px) { .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 640px) { .kpis { grid-template-columns: 1fr; } }
  .kpi { background: #1a242f; border: 1px solid #293745; border-radius: 14px; padding: 14px 16px 13px 19px; position: relative; overflow: hidden; }
  .kpi::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--kpi-tone, #4f8cff); }
  .kpi-head { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; }
  .kpi-ico { width: 26px; height: 26px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; color: #fff; background: var(--kpi-tone, #4f8cff); flex: none; }
  .kpi-label { color: #8aa0b5; font-size: 12px; }
  .kpi-value { font-size: 26px; font-weight: 700; color: #eaf3fb; font-variant-numeric: tabular-nums; line-height: 1.15; }
  /* 数值/单位分级：大数字 + 小单位，长串（时长）降一档避免撑破卡 */
  .kpi-value.long { font-size: 19px; }
  .kpi-unit { margin-left: 3px; font-size: 12px; font-weight: 600; color: #8aa0b5; font-style: normal; vertical-align: 2px; }
  .kpi-unit.pre { margin-left: 0; margin-right: 3px; vertical-align: 7px; font-size: 14px; }
  .kpi-sub { margin-top: 5px; color: #8aa0b5; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tone-blue { --kpi-tone: #4f8cff; }
  .tone-green { --kpi-tone: #37b26c; }
  .tone-violet { --kpi-tone: #9a6cff; }
  .tone-gold { --kpi-tone: #e0a23a; }
  .tone-cyan { --kpi-tone: #39c5d8; }
  .tone-teal { --kpi-tone: #2fa89a; }
  .chart-card { position: relative; background: #1a242f; border: 1px solid #293745; border-radius: 14px; padding: 16px 18px; margin-bottom: 14px; }
  /* 图表 hover：自定义 tooltip 跟随鼠标 + 其余柱降透明 */
  .chart-tip { position: absolute; z-index: 20; transform: translate(-50%, -100%); padding: 6px 9px; border-radius: 8px; background: #0f151c; border: 1px solid #2c3b49; color: #dbe7f2; font-size: 11.5px; line-height: 1.45; white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity .1s; box-shadow: 0 8px 20px rgba(0, 0, 0, .35); }
  .chart-tip.show { opacity: 1; }
  #tokenChart rect.bar { transition: opacity .1s; }
  #tokenChart.has-hot rect.bar:not(.hot) { opacity: .45; }
  /* 骨架屏：延迟 120ms 才出现，本地请求够快时不闪 */
  .sk { display: inline-block; height: 10px; border-radius: 6px; background: linear-gradient(90deg, #1f2b37 25%, #2b3a49 37%, #1f2b37 63%); background-size: 400% 100%; animation: skShimmer 1.4s ease-in-out infinite; }
  .sk-line { display: block; height: 9px; }
  .sk-ico { width: 26px; height: 26px; border-radius: 8px; }
  .sk-num { display: block; width: 62%; height: 22px; margin-top: 8px; }
  .sk-chart { display: block; width: 100%; height: 208px; border-radius: 10px; }
  @keyframes skShimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
  .chart-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
  .chart-title { font-size: 14px; font-weight: 600; }
  .chart-note { margin-left: auto; color: #ffd766; font-size: 12px; font-variant-numeric: tabular-nums; }
  #tokenChart { width: 100%; height: auto; display: block; }
  /* ---- 设置页：现代卡片网格、即时生效 ---- */
  .settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  /* 卡片锚点导航（卡片多了以后跳转用） */
  .set-layout { display: grid; grid-template-columns: 168px minmax(0, 1fr); gap: 16px; align-items: start; }
  /* 设置分组：左栏竖向导航（宽屏）/ 顶部胶囊（窄屏） */
  .set-nav { display: flex; flex-direction: column; gap: 4px; position: sticky; top: calc(var(--topbar-h, 0px) + 14px); }
  .set-nav button { display: block; width: 100%; text-align: left; background: transparent; border: 1px solid transparent; color: #9db4c8; border-radius: 8px; padding: 9px 12px; font-size: 13px; cursor: pointer; transition: background .15s, color .15s, border-color .15s; }
  .set-nav button:hover { background: #1d2935; color: #dbe7f2; }
  .set-nav button.active { background: #1e3a52; color: #9cc9ff; border-color: #2c5a7a; }
  .set-pane { display: none; }
  .set-pane.active { display: grid; }
  /* 提醒组只有一张卡：限宽左对齐，避免拉成一整行太空 */
  .set-pane[data-pane=remind] { grid-template-columns: minmax(0, 680px); }
  /* 卡头 ⓘ：长说明收进悬浮提示，卡面只留一句短说明 */
  .info { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; padding: 0; margin-left: 6px; vertical-align: 1px; border: 1px solid #3a4d60; border-radius: 50%; background: #16202a; color: #8aa0b5; font-family: inherit; font-size: 10px; font-weight: 600; line-height: 1; cursor: help; }
  .info:hover, .info:focus { color: #dbe7f2; border-color: #3a7ab0; outline: none; }
  .info::after { content: attr(data-tip); position: absolute; left: -6px; top: calc(100% + 9px); width: 282px; padding: 9px 11px; border-radius: 8px; background: #0f151c; border: 1px solid #2c3b49; color: #b9c9d8; font-size: 11.5px; font-weight: 400; line-height: 1.55; text-align: left; white-space: normal; opacity: 0; transform: translateY(-3px); transition: opacity .12s, transform .12s; pointer-events: none; z-index: 30; box-shadow: 0 6px 18px rgba(0, 0, 0, .35); }
  .info:hover::after, .info:focus::after { opacity: 1; transform: none; }
  @media (max-width: 980px) {
    .set-layout { grid-template-columns: 1fr; }
    .set-nav { flex-direction: row; flex-wrap: wrap; position: static; }
    .set-nav button { width: auto; border-radius: 999px; padding: 6px 14px; }
  }
  .set-card { background: #1a242f; border: 1px solid #293745; border-radius: 14px; padding: 20px; box-shadow: 0 1px 3px rgba(0, 0, 0, .18); position: relative; overflow: hidden; }
  /* 卡片左沿细色条：与 KPI 卡同一套语言（设置卡也带 tone） */
  .set-card::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--kpi-tone, #4f8cff); }
  .set-card.span-2 { grid-column: span 2; }
  .set-head { display: flex; align-items: center; gap: 11px; margin-bottom: 14px; }
  .set-ico { width: 30px; height: 30px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; font-size: 15px; background: var(--kpi-tone, #4f8cff); flex: none; }
  .set-head h2 { font-size: 14.5px; font-weight: 600; color: #eaf3fb; }
  .set-head p { font-size: 11.5px; color: #8aa0b5; margin-top: 2px; }
  .set-item { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 11px 0; margin: 0; position: relative; }
  .set-list .set-item + .set-item { border-top: 1px solid #202c38; }
  .item-text { min-width: 0; }
  .item-text > span { display: block; color: #dbe7f2; font-size: 13px; }
  .item-text small { display: block; color: #8aa0b5; font-size: 11px; margin-top: 2px; }
  /* 开关（整行 label 可点击切换） */
  .switch-input { position: absolute; opacity: 0; pointer-events: none; }
  .switch-track { flex: none; width: 40px; height: 22px; border-radius: 11px; background: #2c3b49; position: relative; cursor: pointer; transition: background .18s; }
  .switch-track::after { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #9db4c8; transition: transform .18s, background .18s; }
  .switch-input:checked + .switch-track { background: #2c5a7a; }
  .switch-input:checked + .switch-track::after { transform: translateX(18px); background: #ffd766; }
  .switch-input:focus-visible + .switch-track { outline: 2px solid #4f8cff; outline-offset: 2px; }
  .toggle-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; margin-top: 14px; }
  .toggle-grid .set-item { background: #16202a; border: 1px solid #22303d; border-radius: 12px; padding: 11px 14px; cursor: pointer; transition: border-color .15s; }
  .toggle-grid .set-item:hover { border-color: #33475a; }
  /* 高级设置折叠（点击穿透/隐私模式/随 DSH 启动这类低频项） */
  .adv { margin-top: 14px; border-top: 1px dashed #22303d; padding-top: 10px; }
  .adv summary { cursor: pointer; color: #8aa0b5; font-size: 12px; list-style: none; user-select: none; }
  .adv summary::-webkit-details-marker { display: none; }
  .adv summary::before { content: '▸ '; color: #5f7183; }
  .adv[open] summary::before { content: '▾ '; }
  .adv summary:hover { color: #dbe7f2; }
  .adv .toggle-grid { margin-top: 10px; }
  /* 滑杆 / 数字输入 */
  .slider-box { display: flex; align-items: center; gap: 12px; flex: none; width: 250px; }
  .slider-box input[type=range] { flex: 1; -webkit-appearance: none; appearance: none; height: 6px; border-radius: 3px; background: #22303d; outline: none; cursor: pointer; }
  .slider-box input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 16px; height: 16px; border-radius: 50%; background: #4f8cff; border: 2px solid #101820; cursor: pointer; transition: transform .15s; }
  .slider-box input[type=range]::-webkit-slider-thumb:hover { transform: scale(1.18); }
  .slider-box input[type=range]::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #4f8cff; border: 2px solid #101820; cursor: pointer; }
  .slider-val { min-width: 44px; text-align: right; color: #ffd766; font-size: 12.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .set-item .num-input { width: 150px; flex: none; text-align: right; }
  /* 数字输入的单位后缀（tok / ¥ / 分钟） */
  .unit { position: relative; display: inline-flex; align-items: center; flex: none; width: 170px; }
  .unit .num-input { width: 100%; padding-right: 46px; }
  .unit i { position: absolute; right: 12px; font-style: normal; color: #8aa0b5; font-size: 11.5px; pointer-events: none; }
  .unit.minute i { right: 14px; }
  .rest-pick { display: flex; align-items: center; gap: 10px; flex: none; flex-wrap: wrap; justify-content: flex-end; }
  .rest-pick .seg button { padding: 5px 12px; }
  /* 皮肤选择 */
  .skin-pick { display: flex; align-items: center; gap: 12px; flex: none; }
  .skin-pick img { width: 64px; height: 58px; flex: none; background: #10161d; border: 1px solid #293745; border-radius: 12px; padding: 4px; }
  .skin-pick select { width: 230px; }
  /* 模型计价（仅 DeepSeek 官方价，只读展示 + 手动同步） */
  .official-box { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; background: #16202a; border: 1px solid #22303d; border-radius: 10px; padding: 9px 12px; margin-bottom: 10px; font-size: 11.5px; color: #9db4c8; line-height: 1.7; }
  .official-box b { color: #dbe7f2; }
  .official-box button { flex: none; margin: 0; padding: 5px 12px; font-size: 12px; }
  .official-box .off-ok { color: #6fe3a1; }
  .official-box .off-warn { color: #ffd766; }
  .op-head, .op-row { display: grid; grid-template-columns: 1fr 118px 128px 118px; gap: 10px; align-items: center; }
  .op-head { color: #8aa0b5; font-size: 11.5px; padding: 0 4px 9px; border-bottom: 1px solid #202c38; margin-bottom: 10px; }
  .op-head span:not(:first-child) { text-align: right; }
  .op-row { background: #16202a; border: 1px solid #22303d; border-radius: 10px; padding: 8px 12px; margin-bottom: 8px; font-size: 12.5px; color: #c6d6e4; }
  .op-row .op-name { color: #dbe7f2; font-weight: 600; font-size: 13px; min-width: 0; }
  .op-row .op-ver { display: block; color: #8aa0b5; font-weight: 400; font-size: 11px; margin-top: 2px; }
  .op-row .op-off { display: block; color: #6fbf8b; font-weight: 400; font-size: 11px; margin-top: 2px; }
  .op-row span:not(.op-name) { text-align: right; font-variant-numeric: tabular-nums; }
  .price-empty { color: #8aa0b5; font-size: 12px; text-align: center; padding: 14px; background: #16202a; border: 1px dashed #2c3b49; border-radius: 10px; margin-bottom: 8px; }
  /* 货币分段 / 操作按钮 */
  .seg-wide { display: flex; width: 100%; }
  .seg-wide button { flex: 1; }
  .btn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .act-btn { background: #1d2935; color: #9db4c8; border: 1px solid #2c3b49; border-radius: 10px; padding: 10px 12px; cursor: pointer; font-size: 13px; width: 100%; transition: border-color .15s, color .15s, background .15s; }
  .act-btn:hover { border-color: #3a7ab0; color: #dbe7f2; background: #22303d; }
  @media (max-width: 900px) {
    .settings-grid { grid-template-columns: 1fr; }
    .set-card.span-2 { grid-column: auto; }
    .set-item { flex-wrap: wrap; }
    .slider-box { width: 100%; }
  }
  .save-toast { position: fixed; right: 26px; bottom: 26px; background: #123524; color: #6fe3a1; border: 1px solid #37b26c; border-radius: 10px; padding: 9px 18px; font-size: 13px; opacity: 0; transform: translateY(10px); transition: opacity .25s, transform .25s; pointer-events: none; z-index: 50; }
  .save-toast.show { opacity: 1; transform: none; }
  .save-toast.err { background: #3a1c1c; color: #ff9c85; border-color: #b05252; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: #8aa0b5; font-weight: 500; padding: 8px 10px; border-bottom: 1px solid #2c3b49; position: sticky; top: var(--topbar-h, 0px); background: #141b23; }
  td { padding: 7px 10px; border-bottom: 1px solid #202c38; }
  tr:hover td { background: #1a242f; }
  /* 斑马纹（极浅）+ 数字列右对齐等宽，长表横向跟读更省力 */
  tbody tr:nth-child(even) td { background: rgba(255, 255, 255, .015); }
  tbody tr:nth-child(even):hover td { background: #1a242f; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .empty-cell { text-align: center; padding: 30px 10px; color: #8aa0b5; }
  .empty-cell b { display: block; color: #dbe7f2; font-size: 13px; font-weight: 600; margin-bottom: 4px; }
  .empty-art { display: block; width: 84px; height: 56px; margin: 0 auto 10px; color: #35506a; }
  .tag { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11px; }
  .tag.success { background: #123524; color: #6fe3a1; }
  .tag.failed { background: #3a1712; color: #ff9c85; }
  label { color: #9db4c8; font-size: 12px; }
  input[type=text], input[type=number], input[type=date], select, textarea { width: 100%; background: #0f151c; color: #dbe7f2; border: 1px solid #2c3b49; border-radius: 8px; padding: 7px 10px; font-size: 13px; }
  input[type=range] { width: 100%; }
  textarea { font-family: Consolas, monospace; min-height: 140px; }
  button.primary { background: #2c5a7a; color: #eaf6ff; border: 1px solid #3a7ab0; border-radius: 8px; padding: 8px 18px; cursor: pointer; font-size: 13px; }
  button.primary:hover { background: #356a92; }
  button.ghost { background: #1d2935; color: #9db4c8; border: 1px solid #2c3b49; border-radius: 8px; padding: 8px 14px; cursor: pointer; font-size: 13px; margin-right: 8px; }
  .muted { color: #8aa0b5; }
  .pager { display: flex; gap: 8px; align-items: center; margin-top: 14px; color: #8aa0b5; font-size: 12px; }
  .pager .ghost { padding: 6px 12px; font-size: 12.5px; }
  .pager .ghost:disabled { opacity: .4; cursor: default; }
  /* 历史页筛选条 */
  .hist-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; position: relative; }
  .hist-toolbar select { width: 158px; flex: none; }
  .hist-toolbar input[type=date] { width: 148px; flex: none; }
  .hist-toolbar input[type=text] { width: 190px; flex: none; }
  /* 筛选芯片化：搜索常驻，模型/状态/日期收进「＋筛选」，已选条件变成可 × 的胶囊 */
  .search-box { display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px; background: #1a242f; border: 1px solid #2b3a49; border-radius: 8px; flex: 1 1 180px; max-width: 300px; }
  .search-box .search-ico { font-size: 12px; opacity: .65; }
  .hist-toolbar .search-box input { width: 100%; flex: 1 1 auto; border: none; background: transparent; outline: none; color: #dbe7f2; font-size: 13px; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 6px 0 10px; border-radius: 999px; background: #1e3a52; border: 1px solid #2c5a7a; color: #9cc9ff; font-size: 12px; white-space: nowrap; }
  .chip b { font-weight: 600; color: #cfe3f6; }
  .chip button { border: none; background: transparent; color: #9cc9ff; font-size: 13px; line-height: 1; padding: 0 3px; cursor: pointer; }
  .chip button:hover { color: #fff; }
  .filter-pop { position: absolute; left: 0; top: calc(100% + 8px); z-index: 25; display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; padding: 14px; background: #1a242f; border: 1px solid #2c3b49; border-radius: 12px; box-shadow: 0 14px 34px rgba(0, 0, 0, .45); max-width: calc(100vw - 44px); }
  .filter-pop[hidden] { display: none; }
  .filter-pop label { display: flex; flex-direction: column; gap: 5px; font-size: 11.5px; color: #8aa0b5; }
  .filter-pop .pop-foot { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 8px; }
  /* ---- 会话管理页：清单 + 批量彻底删除 ---- */
  .sm-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
  .sm-toolbar .ghost { margin-right: 0; }
  /* 会话工具栏：低频动作收进「更多」 */
  details.more { position: relative; }
  details.more summary { list-style: none; cursor: pointer; }
  details.more summary::-webkit-details-marker { display: none; }
  .more-body { position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; display: flex; flex-direction: column; gap: 6px; background: #1a242f; border: 1px solid #2c3b49; border-radius: 10px; padding: 8px; min-width: 140px; box-shadow: 0 8px 22px rgba(0,0,0,.35); }
  .more-body .ghost { margin: 0; text-align: left; }
  .sm-spacer { flex: 1; }
  /* 批量选择 / 二次确认：固定浮条，表格不再被顶部条挤压 */
  .bulk-bar, .sm-confirm { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 40; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 12px; font-size: 13px; max-width: min(1180px, calc(100vw - 44px)); box-shadow: 0 10px 30px rgba(0, 0, 0, .42); backdrop-filter: blur(10px); }
  .bulk-bar { background: rgba(26, 36, 47, .94); border: 1px solid #2c3b49; color: #dbe7f2; }
  .bulk-bar[hidden] { display: none; }
  .bulk-text b { color: #ffd766; font-weight: 600; font-variant-numeric: tabular-nums; }
  .sm-confirm { background: rgba(58, 28, 28, .95); border: 1px solid #b05252; color: #ffb4a0; }
  button.sm-danger { background: #8f3a34; color: #ffe3da; border-color: #b05252; }
  button.sm-danger:hover:not(:disabled) { background: #a9443c; }
  button.sm-danger:disabled { opacity: .45; cursor: default; }
  .tag.arch { background: #2c3b49; color: #9db4c8; }
  .tag.pin { background: #3a3020; color: #ffd766; }
  #smBody td { vertical-align: middle; }
  #smBody input[type=checkbox], #tab-sessions thead input[type=checkbox] { width: 15px; height: 15px; cursor: pointer; accent-color: #4f8cff; }
  .sm-title small { display: block; color: #67809a; font-size: 10.5px; margin-top: 1px; }
  .sm-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.sm-empty .sm-title { color: #8aa0b5; font-style: italic; }
  /* ---- 浅色主题：跟随系统（深色为默认；用户要求适配系统浅色/深色模式） ---- */
  @media (prefers-color-scheme: light) {
    :root { color-scheme: light; --chart-grid: #dde4ec; --chart-axis: #7b8b9a; --chart-slot: #e2e8ef; }
    body { background: #f4f6f9; color: #26333f; }
    .topbar { background: rgba(244, 246, 249, .88); border-bottom-color: #dde4ec; }
    .sk { background: linear-gradient(90deg, #e7ecf2 25%, #f3f6f9 37%, #e7ecf2 63%); background-size: 400% 100%; }
    .chart-tip { background: #fff; border-color: #d5dde6; color: #26333f; box-shadow: 0 8px 20px rgba(20, 35, 55, .14); }
    header .sub { color: #7b8b9a; }
    header .live { color: #5f7183; }
    header .live b { color: #9a6b00; }
    nav button { background: transparent; color: #5b6d7e; border-color: transparent; }
    nav button:hover { background: #e8edf3; color: #26333f; }
    nav button.active { background: #e3eefb; color: #1f5f9e; border-color: #b9d4ef; }
    .seg { background: #e8edf3; border-color: #d5dde6; }
    .seg button { color: #5b6d7e; }
    .seg button.active { background: #2c5a7a; color: #fff; }
    .kpi, .chart-card, .set-card { background: #fff; border-color: #e0e6ed; box-shadow: 0 1px 3px rgba(20, 35, 55, .06); }
    .kpi-label, .kpi-sub, .set-head p, .item-text small { color: #7b8b9a; }
    .kpi-value, .set-head h2 { color: #26333f; }
    .kpi-unit { color: #7b8b9a; }
    .set-list .set-item + .set-item { border-top-color: #e8edf3; }
    .item-text > span { color: #26333f; }
    .switch-track { background: #c6d0da; }
    .switch-track::after { background: #fff; }
    .switch-input:checked + .switch-track { background: #2c5a7a; }
    .toggle-grid .set-item { background: #f0f3f7; border-color: #dde4ec; }
    .toggle-grid .set-item:hover { border-color: #b9c6d2; }
    .slider-box input[type=range] { background: #d5dde6; }
    .slider-box input[type=range]::-webkit-slider-thumb { border-color: #fff; }
    .slider-box input[type=range]::-moz-range-thumb { border-color: #fff; }
    .slider-val { color: #9a6b00; }
    .skin-pick img { background: #eef2f6; border-color: #dde4ec; }
    .official-box { background: #f7f9fb; border-color: #e0e6ed; color: #5f7183; }
    .official-box b { color: #26333f; }
    .official-box .off-ok { color: #1d7a46; }
    .official-box .off-warn { color: #9a6b00; }
    .op-head { color: #7b8b9a; border-bottom-color: #e0e6ed; }
    .op-row { background: #f7f9fb; border-color: #e0e6ed; color: #3c4c5c; }
    .op-row .op-name { color: #26333f; }
    .op-row .op-ver { color: #7b8b9a; }
    .op-row .op-off { color: #1f8a4c; }
    .price-empty { color: #7b8b9a; background: #f7f9fb; border-color: #c9d4df; }
    .act-btn { background: #eef2f6; color: #5b6d7e; border-color: #d5dde6; }
    .act-btn:hover { border-color: #3a7ab0; color: #26333f; background: #e2ecf5; }
    .save-toast { background: #dff5e7; color: #1d7a46; border-color: #8fd4ab; }
    .save-toast.err { background: #fdeae5; color: #b3402e; border-color: #d98d7e; }
    th { color: #7b8b9a; border-bottom-color: #d5dde6; background: #f4f6f9; }
    td { border-bottom-color: #e8edf3; }
    tr:hover td { background: #eef2f7; }
    .tag.success { background: #dff5e7; color: #1d7a46; }
    .tag.failed { background: #fdeae5; color: #b3402e; }
    .tag.arch { background: #e2e8ef; color: #5b6d7e; }
    .tag.pin { background: #fdf3d7; color: #9a6b00; }
    label { color: #5f7183; }
    input[type=text], input[type=number], input[type=date], select, textarea { background: #fff; color: #26333f; border-color: #c9d4df; }
    button.ghost { background: #eef2f6; color: #5b6d7e; border-color: #d5dde6; }
    .muted { color: #7b8b9a; }
    .sm-confirm { background: rgba(253, 234, 229, .96); border-color: #d98d7e; color: #a13c29; }
    .bulk-bar { background: rgba(255, 255, 255, .97); border-color: #d5dde6; color: #26333f; }
    .bulk-text b { color: #9a6b00; }
    .chip { background: #e3eefb; border-color: #b9d4ef; color: #1f5f9e; }
    .chip b { color: #16496f; }
    .chip button { color: #1f5f9e; }
    .chip button:hover { color: #0d2f4a; }
    .search-box { background: #fff; border-color: #d5dde6; }
    .hist-toolbar .search-box input { color: #26333f; }
    .filter-pop { background: #fff; border-color: #d5dde6; box-shadow: 0 14px 34px rgba(20, 35, 55, .16); }
    .filter-pop label { color: #7b8b9a; }
    button.sm-danger { background: #b3402e; color: #fff; border-color: #b3402e; }
    button.sm-danger:hover:not(:disabled) { background: #9c3626; }
    .sm-title small { color: #93a1af; }
    tr.sm-empty .sm-title { color: #7b8b9a; }
    .set-nav button { background: transparent; color: #5b6d7e; border-color: transparent; }
    .set-nav button:hover { background: #e8edf3; color: #26333f; }
    .set-nav button.active { background: #e3eefb; color: #1f5f9e; border-color: #b9d4ef; }
    .info { background: #fff; border-color: #c9d4df; color: #7b8b9a; }
    .info:hover, .info:focus { color: #26333f; border-color: #3a7ab0; }
    .info::after { background: #fff; border-color: #d5dde6; color: #3c4c5c; box-shadow: 0 6px 18px rgba(20, 35, 55, .14); }
    .adv { border-top-color: #e8edf3; }
    .adv summary { color: #7b8b9a; }
    .adv summary:hover { color: #26333f; }
    .unit i { color: #7b8b9a; }
    .empty-cell { color: #7b8b9a; }
    .empty-cell b { color: #26333f; }
    .empty-art { color: #becfdd; }
    tbody tr:nth-child(even) td { background: rgba(20, 35, 55, .022); }
    tbody tr:nth-child(even):hover td { background: #eef2f6; }
    .more-body { background: #fff; border-color: #d5dde6; box-shadow: 0 8px 22px rgba(20,35,55,.12); }
    .chart-note { color: #9a6b00; }
  }
  /* ---- 环比 delta / 成本排行 / 离线徽标 / 预算进度 / 会话搜索 ---- */
  .kpi-delta { display: inline-block; margin-left: 6px; font-variant-numeric: tabular-nums; font-weight: 600; }
  .kpi-delta.good { color: #37b26c; }
  .kpi-delta.bad { color: #e06b5f; }
  .kpi-delta.flat { color: #8aa0b5; font-weight: 500; }
  .stale { margin-left: 8px; padding: 1px 7px; border-radius: 999px; background: rgba(224,107,95,.16); color: #e8897f; font-size: 11px; }
  .stale[hidden] { display: none; }
  .rank-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
  @media (max-width: 900px) { .rank-grid { grid-template-columns: 1fr; } }
  .rank-card { padding: 14px 16px; }
  .rank-body { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
  .rank-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "name val" "bar bar"; row-gap: 4px; align-items: center; }
  .rank-name { grid-area: name; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #dbe7f2; }
  .rank-val { grid-area: val; color: #e0a23a; font-weight: 600; font-variant-numeric: tabular-nums; }
  .rank-bar { grid-area: bar; height: 5px; border-radius: 3px; background: #233140; overflow: hidden; }
  .rank-bar i { display: block; height: 100%; background: linear-gradient(90deg, #4f8cff, #39c5d8); border-radius: 3px; }
  .budget-usage { margin-top: 12px; }
  .budget-usage .bar { height: 6px; border-radius: 3px; background: #233140; overflow: hidden; }
  .budget-usage .bar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #37b26c, #e0a23a); transition: width .3s ease; }
  .budget-usage .bar i.warn { background: linear-gradient(90deg, #e0a23a, #e06b5f); }
  .budget-text { margin-top: 6px; font-size: 12px; color: #8aa0b5; }
  .sm-search { flex: 0 1 240px; min-width: 160px; }
  .sm-sort { background: #1a242f; color: #dbe7f2; border: 1px solid #2c3b49; border-radius: 8px; padding: 6px 8px; font: inherit; font-size: 13px; }
  @media (prefers-color-scheme: light) {
    .kpi-delta.good { color: #1f8a4c; }
    .kpi-delta.bad { color: #c2453a; }
    .kpi-delta.flat { color: #6b7c8c; }
    .stale { background: rgba(194,69,58,.12); color: #b23a30; }
    .rank-name { color: #26333f; }
    .rank-val { color: #b5761c; }
    .rank-bar, .budget-usage .bar { background: #e4eaf1; }
    .sm-sort { background: #fff; color: #26333f; border-color: #d5dde6; }
  }
  /* 减少动态效果：系统开了「减少动画」就关掉过渡/动画（可访问性） */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
  }
</style>
</head>
<body>
<div class="topbar">
<header>
  <img id="headerPet" src="" alt="">
  <div>
    <h1>DSH 伴侣</h1>
    <div class="sub" id="subline">数据后端加载中…</div>
  </div>
  <div class="live"><span id="liveState">—</span> · <span id="liveTime">—</span><span id="liveStale" class="stale" hidden>离线</span></div>
</header>
<nav>
  <button data-tab="history" class="active">历史任务</button>
  <button data-tab="stats">统计</button>
  <button data-tab="sessions">会话</button>
  <button data-tab="settings">设置</button>
</nav>
</div>
<main>
  <section id="tab-history" class="active">
    <div class="hist-toolbar">
      <div class="search-box"><span class="search-ico">🔍</span><input type="text" id="histQ" placeholder="搜项目名…"></div>
      <div class="chips" id="histChips"></div>
      <button class="ghost" id="histFilterBtn">＋ 筛选</button>
      <span class="sm-spacer"></span>
      <button class="ghost" id="histRefresh">⟳ 刷新</button>
      <button class="ghost" id="histExport">导出结果</button>
      <div class="filter-pop" id="histFilterPop" hidden>
        <label>模型<select id="histModel"><option value="">全部模型</option></select></label>
        <label>状态
          <select id="histStatus">
            <option value="">全部状态</option>
            <option value="success">完成</option>
            <option value="failed">失败</option>
            <option value="interrupted">中断</option>
          </select>
        </label>
        <label>起始日期<input type="date" id="histFrom"></label>
        <label>结束日期<input type="date" id="histTo"></label>
        <div class="pop-foot"><button class="ghost" id="histReset">清除全部筛选</button></div>
      </div>
    </div>
    <table>
      <thead><tr>
        <th>开始时间</th><th>项目</th><th>模型</th><th>状态</th><th class="num">时长</th>
        <th class="num">输入</th><th class="num">输出</th><th class="num">总Token</th>
      </tr></thead>
      <tbody id="historyBody"></tbody>
    </table>
    <div class="pager">
      <button class="ghost" id="histFirst">« 首页</button>
      <button class="ghost" id="histPrev">上一页</button>
      <span id="histPage" class="muted">第 1 / 1 页</span>
      <button class="ghost" id="histNext">下一页</button>
      <button class="ghost" id="histLast">末页 »</button>
      <span class="muted" id="histCount"></span>
    </div>
  </section>
  <section id="tab-stats">
    <div class="stats-toolbar">
      <div class="seg" id="periodSeg">
        <button data-period="today" class="active">今日</button>
        <button data-period="week">本周</button>
        <button data-period="month">本月</button>
        <button data-period="all">全部</button>
      </div>
      <div class="seg" id="metricSeg">
        <button data-metric="tokens" class="active">Token</button>
        <button data-metric="cost">费用</button>
        <button data-metric="duration">时长</button>
      </div>
      <span class="sm-spacer"></span>
      <button class="ghost" id="statsRefresh">⟳ 刷新</button>
    </div>
    <div class="kpis" id="kpiCards"></div>
    <div class="chart-card">
      <div class="chart-head">
        <span class="chart-title" id="chartTitle">Token 消耗分布</span>
        <span class="muted" id="chartSub"></span>
        <span class="chart-note" id="chartNote"></span>
      </div>
      <svg id="tokenChart" viewBox="0 0 720 220" width="100%"></svg>
      <div class="muted" id="chartEmpty" style="display:none">该周期暂无任务数据</div>
      <div id="chartSkeleton" style="display:none"><div class="sk sk-chart"></div></div>
      <div class="chart-tip" id="chartTip"></div>
    </div>
    <div class="rank-grid">
      <div class="card rank-card">
        <div class="chart-head"><span class="chart-title">费用去向 · 按模型</span><span class="muted" id="rankModelSub"></span></div>
        <div class="rank-body" id="rankModels"></div>
      </div>
      <div class="card rank-card">
        <div class="chart-head"><span class="chart-title">费用去向 · 按项目</span><span class="muted" id="rankProjectSub"></span></div>
        <div class="rank-body" id="rankProjects"></div>
      </div>
    </div>
  </section>
  <section id="tab-sessions">
    <div class="sm-toolbar">
      <span class="muted" id="smSummary">加载中…</span>
      <div class="search-box sm-search"><span class="search-ico">🔍</span><input type="text" id="smQ" placeholder="搜标题/工作区/ID…"></div>
      <select id="smSort" class="sm-sort" title="排序方式">
        <option value="time">最近活动</option>
        <option value="size">占用大小</option>
        <option value="msg">消息数</option>
      </select>
      <span class="sm-spacer"></span>
      <details class="more">
        <summary class="ghost">更多 ▾</summary>
        <div class="more-body">
          <button class="ghost" id="smSelArchived">选归档</button>
          <button class="ghost" id="smSelEmpty">选空会话</button>
          <button class="ghost" id="smSelNone">清除选择</button>
          <button class="ghost" id="smRefresh">⟳ 刷新</button>
        </div>
      </details>
    </div>
    <div class="bulk-bar" id="bulkBar" hidden>
      <span class="bulk-text">已选 <b id="bulkCount">0</b> 个 · 合计 <b id="bulkSize">0 B</b></span>
      <span class="sm-spacer"></span>
      <button class="ghost" id="smCancelSel">取消选择</button>
      <button class="ghost sm-danger" id="smDelete" disabled>删除所选</button>
    </div>
    <div class="sm-confirm" id="smConfirm" style="display:none">
      <span id="smConfirmText"></span>
      <span class="sm-spacer"></span>
      <button class="ghost" id="smConfirmNo">取消</button>
      <button class="ghost sm-danger" id="smConfirmYes">确认彻底删除</button>
    </div>
    <table>
      <thead><tr>
        <th style="width:36px"><input type="checkbox" id="smSelAll"></th>
        <th>标题</th>
        <th>工作区</th>
        <th>标记</th>
        <th style="text-align:right">消息</th>
        <th style="text-align:right">占用</th>
        <th>最后活动</th>
      </tr></thead>
      <tbody id="smBody"></tbody>
    </table>
  </section>
  <section id="tab-settings">
    <div class="set-layout">
      <aside class="set-nav">
        <button class="active" data-group="pet">🧸 伴侣</button>
        <button data-group="remind">🍅 提醒</button>
        <button data-group="bill">💰 计费</button>
        <button data-group="data">📦 数据</button>
      </aside>
      <div class="set-panes">
        <div class="settings-grid set-pane active" data-pane="pet">
          <div class="set-card span-2 tone-blue" id="card-appearance">
            <div class="set-head">
              <span class="set-ico">🤖</span>
              <div><h2>伴侣外观<button class="info" type="button" data-tip="皮肤决定形象、状态文案与台词口吻（换装即换性格）；不透明度与缩放同时作用于伴侣窗口。点击穿透 / 隐私模式 / 随 DSH 启动在下方「高级设置」里。">i</button></h2><p>改动即时生效，无需保存</p></div>
            </div>
            <div class="set-list">
              <div class="set-item">
                <div class="item-text"><span>皮肤</span><small>换装即换性格</small></div>
                <div class="skin-pick">
                  <img id="skinPreview" alt="skin">
                  <select id="setSkin"></select>
                </div>
              </div>
              <div class="set-item">
                <div class="item-text"><span>不透明度</span><small>伴侣与悬浮窗整体</small></div>
                <div class="slider-box"><input type="range" id="setOpacity" min="0.2" max="1" step="0.05"><b class="slider-val" id="setOpacityVal"></b></div>
              </div>
              <div class="set-item">
                <div class="item-text"><span>缩放</span><small>悬浮页 Ctrl + 滚轮也可调</small></div>
                <div class="slider-box"><input type="range" id="setScale" min="0.4" max="3" step="0.05"><b class="slider-val" id="setScaleVal"></b></div>
              </div>
            </div>
            <div class="toggle-grid">
              <label class="set-item"><div class="item-text"><span>显示伴侣</span><small>桌面悬浮窗口（≤5s 生效）</small></div><input type="checkbox" id="setShowPet" class="switch-input"><span class="switch-track"></span></label>
              <label class="set-item"><div class="item-text"><span>纯宠物模式</span><small>隐藏全部文字只留动画</small></div><input type="checkbox" id="setPurePet" class="switch-input"><span class="switch-track"></span></label>
              <label class="set-item"><div class="item-text"><span>自由活动</span><small>闲着没事时自己在屏幕上逛逛</small></div><input type="checkbox" id="setRoam" class="switch-input"><span class="switch-track"></span></label>
            </div>
            <details class="adv">
              <summary>高级设置（点击穿透 / 隐私模式 / 随 DSH 启动 / 系统通知）</summary>
              <div class="toggle-grid">
                <label class="set-item"><div class="item-text"><span>点击穿透</span><small>鼠标穿过伴侣（Electron 壳）</small></div><input type="checkbox" id="setClickThrough" class="switch-input"><span class="switch-track"></span></label>
                <label class="set-item"><div class="item-text"><span>隐私模式</span><small>面板中隐藏工作区路径</small></div><input type="checkbox" id="setPrivacy" class="switch-input"><span class="switch-track"></span></label>
                <label class="set-item"><div class="item-text"><span>随 DSH 启动伴侣</span><small>下次启动生效</small></div><input type="checkbox" id="setAutoStart" class="switch-input"><span class="switch-track"></span></label>
                <label class="set-item"><div class="item-text"><span>系统通知</span><small>长任务（≥60s）完成/失败、预算触顶时弹通知（Electron 壳）</small></div><input type="checkbox" id="setNotify" class="switch-input"><span class="switch-track"></span></label>
              </div>
            </details>
          </div>
        </div>
        <div class="settings-grid set-pane" data-pane="remind">
          <div class="set-card span-2 tone-cyan" id="card-rest">
            <div class="set-head">
              <span class="set-ico">🍅</span>
              <div><h2>久坐提醒<button class="info" type="button" data-tip="墙钟计时：坐够设定分钟数就提醒，不管有没有任务在跑；鼠标键盘空闲 ≥3 分钟视为离开，自动重置计时。到点气泡里有「起来走走 / 稍后 10 分钟」两个出口。">i</button></h2><p>坐够就提醒，不管有没有任务</p></div>
            </div>
            <div class="set-list">
              <div class="set-item">
                <div class="item-text"><span>提醒间隔</span><small>点预设即生效，也可手填（5–480）</small></div>
                <div class="rest-pick">
                  <div class="seg" id="restPresets">
                    <button data-min="25">25</button>
                    <button data-min="45">45</button>
                    <button data-min="60">60</button>
                    <button data-min="90">90</button>
                  </div>
                  <span class="unit"><input type="number" class="num-input" id="setRestMinutes" min="5" max="480" step="5" placeholder="60"><i>分钟</i></span>
                </div>
              </div>
            </div>
            <div class="toggle-grid">
              <label class="set-item"><div class="item-text"><span>启用久坐提醒</span><small>坐够就伸个懒腰；起来走走或离开电脑会自动重算</small></div><input type="checkbox" id="setRestEnabled" class="switch-input"><span class="switch-track"></span></label>
            </div>
          </div>
        </div>
        <div class="settings-grid set-pane" data-pane="bill">
          <div class="set-card tone-gold" id="card-budget">
            <div class="set-head">
              <span class="set-ico">🧮</span>
              <div><h2>预算告警<button class="info" type="button" data-tip="单任务 / 每日 × Token / 费用共四档，填 0 = 不限制；触顶时伴侣气泡提醒一次。只统计 DeepSeek 账号或官方 API key 的任务，自定义渠道不计费。">i</button></h2><p>0 = 不限制，触顶气泡提醒</p></div>
            </div>
            <div class="set-list">
              <div class="set-item"><div class="item-text"><span>单任务 Token 上限</span></div><span class="unit"><input type="number" class="num-input" id="setTaskTokens" min="0" step="10000" placeholder="0"><i>tok</i></span></div>
              <div class="set-item"><div class="item-text"><span>单任务费用上限</span></div><span class="unit"><input type="number" class="num-input" id="setTaskCost" min="0" step="1" placeholder="0"><i>¥</i></span></div>
              <div class="set-item"><div class="item-text"><span>每日 Token 上限</span></div><span class="unit"><input type="number" class="num-input" id="setDailyTokens" min="0" step="100000" placeholder="0"><i>tok</i></span></div>
              <div class="set-item"><div class="item-text"><span>每日费用上限</span></div><span class="unit"><input type="number" class="num-input" id="setDailyCost" min="0" step="1" placeholder="0"><i>¥</i></span></div>
            </div>
            <div class="budget-usage" id="budgetUsage" hidden>
              <div class="bar"><i id="budgetBarFill"></i></div>
              <div class="budget-text" id="budgetText"></div>
            </div>
          </div>
          <div class="set-card tone-teal" id="card-currency">
            <div class="set-head">
              <span class="set-ico">💱</span>
              <div><h2>货币<button class="info" type="button" data-tip="切换后统计、预算与费用估算都按新货币显示；官方价按内置汇率折算，历史任务费用不重算。">i</button></h2><p>统计与预算的计价单位</p></div>
            </div>
            <div class="seg seg-wide" id="currencySeg">
              <button data-cur="CNY">¥ 人民币</button>
              <button data-cur="USD">$ 美元</button>
            </div>
          </div>
          <div class="set-card span-2 tone-violet" id="card-pricing">
            <div class="set-head">
              <span class="set-ico">💰</span>
              <div><h2>模型计价<button class="info" type="button" data-tip="只统计用 DeepSeek 账号（官方 API）跑的任务：模型名与最新价格从官网自动同步；自定义渠道（如阿里云百炼）与其他模型一律不计费，Token 照记。">i</button></h2><p>官方价自动同步，只认 DeepSeek</p></div>
            </div>
            <div class="official-box" id="officialBox">官方价格：加载中…</div>
            <div id="officialRows"></div>
          </div>
        </div>
        <div class="settings-grid set-pane" data-pane="data">
          <div class="set-card tone-green" id="card-ops">
            <div class="set-head">
              <span class="set-ico">📦</span>
              <div><h2>操作<button class="info" type="button" data-tip="暂停统计只停记账，伴侣和面板照常；导出 CSV 带 BOM，Excel 直接打开。">i</button></h2><p>统计开关与数据导出</p></div>
            </div>
            <div class="btn-grid">
              <button class="act-btn" id="btnPauseToggle">⏸ 暂停统计</button>
              <button class="act-btn" id="btnExportCsv">⬇ 任务 CSV</button>
              <button class="act-btn" id="btnExportJson">⬇ 任务 JSON</button>
              <button class="act-btn" id="btnExportToolsCsv">⬇ 工具调用 CSV</button>
            </div>
          </div>
          <div class="set-card tone-cyan" id="mockFieldset">
            <div class="set-head">
              <span class="set-ico">🧪</span>
              <div><h2>事件模拟<button class="info" type="button" data-tip="适配层为 mock 时可用：注入一轮模拟事件，演示伴侣状态切换与统计落库。">i</button></h2><p>适配层为 mock 时可用</p></div>
            </div>
            <div class="set-item">
              <div class="item-text"><span>模拟场景</span><small>注入一轮模拟事件</small></div>
              <select id="mockScenario" style="width:150px;flex:none">
                <option value="success">成功</option>
                <option value="long">长任务</option>
                <option value="error">失败</option>
                <option value="interrupted">中断</option>
              </select>
            </div>
            <button class="act-btn" id="mockStart" style="margin-top:12px">▶ 跑一次模拟任务</button>
          </div>
        </div>
      </div>
    </div>
    <div class="save-toast" id="saveToast">✓ 已保存</div>
  </section>
</main>
<script>
'use strict'
const $ = (id) => document.getElementById(id)
let snap = null
let histPage = 0
const HIST_PAGE_SIZE = 20

// ---- 骨架屏（延迟 120ms 出现：本地请求够快就直接出数据，不闪灰条）与吸顶高度 ----
const skTimers = {}
function skLater(key, paint) {
  skCancel(key)
  skTimers[key] = setTimeout(() => { delete skTimers[key]; paint() }, 120)
}
function skCancel(key) {
  if (skTimers[key]) { clearTimeout(skTimers[key]); delete skTimers[key] }
}
let histLoaded = false
let statsLoaded = false
let smLoaded = false
/** 吸顶顶栏高度 → CSS 变量：表头 sticky 与设置分组导航据此让位。 */
function syncTopbarHeight() {
  const tb = document.querySelector('.topbar')
  if (tb) document.documentElement.style.setProperty('--topbar-h', tb.offsetHeight + 'px')
}
syncTopbarHeight()
addEventListener('resize', syncTopbarHeight)
function skRows(widths, n) {
  let html = ''
  for (let i = 0; i < n; i++) {
    html += '<tr>' + widths.map((w) => '<td><span class="sk sk-line" style="width:' + w + '%"></span></td>').join('') + '</tr>'
  }
  return html
}
function paintHistorySkeleton() { $('historyBody').innerHTML = skRows([16, 26, 20, 12, 14, 11, 11, 13], 6) }
function paintSessionsSkeleton() { $('smBody').innerHTML = skRows([6, 40, 22, 12, 10, 10, 16], 5) }
function paintStatsSkeleton() {
  const tones = ['tone-blue', 'tone-cyan', 'tone-green', 'tone-violet', 'tone-gold', 'tone-teal']
  $('kpiCards').innerHTML = tones.map((t) =>
    '<div class="kpi ' + t + '"><div class="kpi-head"><span class="sk sk-ico"></span><span class="sk sk-line" style="width:42%"></span></div>' +
    '<div class="sk sk-num"></div><div class="sk sk-line" style="width:60%;margin-top:8px"></div></div>'
  ).join('')
  $('tokenChart').style.display = 'none'
  $('chartEmpty').style.display = 'none'
  $('chartSkeleton').style.display = ''
}
// 空态插画：一只极简线稿鲸鱼（纯装饰，颜色跟 currentColor 走深浅色）
const EMPTY_ART = '<svg class="empty-art" viewBox="0 0 96 64" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 40c0-10 10-17 24-17 13 0 22 6 25 14 2-2 6-3 9-1l8 5-8 5c-3 2-7 1-9-1-3 8-12 14-25 14-14 0-24-7-24-19z"/>' +
  '<circle cx="30" cy="33" r="1.9" fill="currentColor" stroke="none"/>' +
  '<path d="M33 22c1-6 5-9 10-10M26 22c-1-4-3-6-6-7"/></g></svg>'
function emptyHTML(title, hint) {
  return EMPTY_ART + '<b>' + title + '</b>' + (hint || '')
}

function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  if (h > 0) return h + 'h ' + m + 'm ' + (s % 60) + 's'
  if (m > 0) return m + 'm ' + (s % 60) + 's'
  return s + 's'
}
function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(n)
}
function fmtTime(t) { return new Date(t).toLocaleString('zh-CN', { hour12: false }) }
function cur() { return snap ? (snap.currency === 'USD' ? '$' : '¥') : '¥' }
function mask(s) { return snap && snap.settings.privacyMode ? '***' : (s || '') }

// ---- tabs ----
// 页签来回点不重复打网络：响应缓存 30s，任何写操作/SSE 消息都会清空。
const RESP_CACHE_MS = 30000
let respCache = {}
function dropCache() { respCache = {} }
async function fetchJSON(url, force) {
  const hit = respCache[url]
  if (!force && hit && Date.now() - hit.at < RESP_CACHE_MS) return hit.data
  const data = await (await fetch(url)).json()
  respCache[url] = { at: Date.now(), data }
  return data
}
for (const btn of document.querySelectorAll('nav button')) {
  btn.onclick = () => {
    document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b === btn))
    document.querySelectorAll('main section').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + btn.dataset.tab))
    if (btn.dataset.tab === 'history') loadHistory()
    if (btn.dataset.tab === 'stats') loadStats()
    if (btn.dataset.tab === 'sessions') loadSessions()
  }
}
const initialTab = new URLSearchParams(location.search).get('tab')
// 深链（/panel?tab=stats 等）必须等整段脚本跑完再点：currentPeriod / histTotal /
// smSessions 这些是后面用 let 声明的，此刻点进 loadStats 会撞 TDZ（呈现出来就是
// 「统计页骨架之后一片空白，控制台还没有报错」）。setTimeout(0) 排在脚本收尾之后。
if (initialTab) {
  setTimeout(() => {
    const b = document.querySelector('nav button[data-tab="' + initialTab + '"]')
    if (b) b.click()
  }, 0)
}

// ---- live state (SSE)：仅更新头部小型指示器（大状态区已移除，状态看桌面伴侣） ----
const es = new EventSource('/api/events')
es.onopen = () => { const b = $('liveStale'); if (b) b.hidden = true }
es.onerror = () => { const b = $('liveStale'); if (b) b.hidden = false }
es.onmessage = (e) => {
  try {
    const next = JSON.parse(e.data)
    // 只在「数据真变了」（任务开始/结束、出了新的完成结果）时作废 30s 响应缓存；
    // 否则心跳/计时快照每几秒来一次，缓存永远命中不了，页签缓存就白做了。
    const wasTask = !!(snap && snap.task)
    const nextDone = next.lastResult ? JSON.stringify(next.lastResult) : ''
    if (wasTask !== !!next.task || nextDone !== lastDoneKey) {
      dropCache()
      lastDoneKey = nextDone
    }
    snap = next
    renderLive()
  } catch (err) {}
}
let lastDoneKey = ''
setInterval(() => {
  if (snap && snap.task) {
    stopRoam() // 任务来了就别闲逛了：回原位、回到工作状态
    renderLive()
  }
}, 1000)
function renderLive() {
  if (!snap) return
  $('liveState').textContent = snap.label
  $('liveTime').textContent = fmtTime(snap.time)
  const img = $('headerPet')
  const src = '/skins/' + encodeURIComponent(snap.settings.skin) + '/' + encodeURIComponent(snap.state) + '.svg'
  if (!img.src.endsWith(src)) img.src = src
  $('subline').textContent = '适配层: ' + snap.adapter + ' · 面板: ' + snap.serverUrl
}

function statusText(status) {
  return status === 'success' ? '完成' : status === 'interrupted' ? '中断' : '失败'
}
function tagClass(status) {
  return status === 'success' ? 'success' : status === 'interrupted' ? 'arch' : 'failed'
}

// ---- history：筛选（模型 / 状态 / 日期 / 项目关键词）+ 分页 ----
let histTotal = 0
let histModelsLoaded = false
function histParams() {
  const p = new URLSearchParams()
  p.set('limit', String(HIST_PAGE_SIZE))
  p.set('offset', String(histPage * HIST_PAGE_SIZE))
  const model = $('histModel').value
  const status = $('histStatus').value
  const from = $('histFrom').value
  const to = $('histTo').value
  const q = $('histQ').value.trim()
  if (model) p.set('model', model)
  if (status) p.set('status', status)
  // 日期按本地时区整天计入：from 当天 00:00，to 次日 00:00（右开区间）
  if (from) p.set('from', String(new Date(from + 'T00:00:00').getTime()))
  if (to) p.set('to', String(new Date(to + 'T00:00:00').getTime() + 86400000))
  if (q) p.set('q', q)
  return p.toString()
}
async function loadHistModels() {
  if (histModelsLoaded) return
  histModelsLoaded = true
  try {
    const data = await (await fetch('/api/models')).json()
    const sel = $('histModel')
    for (const m of data.models || []) {
      const opt = document.createElement('option')
      opt.value = m
      opt.textContent = m
      sel.appendChild(opt)
    }
  } catch (err) { /* 模型清单拿不到不影响其他筛选维度 */ }
}
async function loadHistory(force) {
  if (!histLoaded) skLater('history', paintHistorySkeleton)
  try {
    await loadHistModels()
    const data = await fetchJSON('/api/history?' + histParams(), force)
    histTotal = Number(data.total) || 0
    const pages = Math.max(1, Math.ceil(histTotal / HIST_PAGE_SIZE))
    if (histPage > pages - 1) histPage = pages - 1
    const rows = (data.tasks || []).map((t) => {
      const dur = t.endTime ? fmtDuration(t.endTime - t.startTime) : '…'
      return '<tr><td>' + fmtTime(t.startTime) + '</td><td>' + esc(mask(t.project)) + '</td><td>' + esc(mask(t.model)) +
        '</td><td><span class="tag ' + tagClass(t.status) + '">' + statusText(t.status) + '</span></td><td class="num">' + dur +
        '</td><td class="num">' + fmtTokens(t.promptTokens) + '</td><td class="num">' + fmtTokens(t.completionTokens) +
        '</td><td class="num">' + fmtTokens(t.totalTokens) + '</td></tr>'
    })
    $('historyBody').innerHTML = rows.join('') ||
      '<tr><td colspan="8" class="empty-cell">' + emptyHTML('没有匹配的任务', '换个筛选条件，或先跑一个任务') + '</td></tr>'
    $('histPage').textContent = '第 ' + (histPage + 1) + ' / ' + pages + ' 页'
    $('histCount').textContent = '共 ' + histTotal + ' 条'
    $('histFirst').disabled = histPage === 0
    $('histPrev').disabled = histPage === 0
    $('histNext').disabled = histPage >= pages - 1
    $('histLast').disabled = histPage >= pages - 1
  } catch (err) {
    $('historyBody').innerHTML = '<tr><td colspan="8" class="empty-cell">' + emptyHTML('加载失败', '伴侣服务没起来？重启 DSH 再试') + '</td></tr>'
  } finally {
    skCancel('history')
    histLoaded = true
    renderHistChips()
  }
}
for (const id of ['histModel', 'histStatus', 'histFrom', 'histTo']) {
  $(id).onchange = () => { histPage = 0; loadHistory() }
}
let histQTimer = null
$('histQ').oninput = () => {
  if (histQTimer) clearTimeout(histQTimer)
  histQTimer = setTimeout(() => { histPage = 0; loadHistory() }, 300)
}
$('histReset').onclick = () => {
  $('histModel').value = ''
  $('histStatus').value = ''
  $('histFrom').value = ''
  $('histTo').value = ''
  $('histQ').value = ''
  histPage = 0
  setHistPop(false)
  loadHistory()
}
$('histRefresh').onclick = () => loadHistory(true)
// 导出当前筛选结果（与页面同口径，不含分页）：规则见 /api/export/sessions。
$('histExport').onclick = () => {
  const p = new URLSearchParams()
  p.set('format', 'csv')
  const model = $('histModel').value
  const status = $('histStatus').value
  const from = $('histFrom').value
  const to = $('histTo').value
  const q = $('histQ').value.trim()
  if (model) p.set('model', model)
  if (status) p.set('status', status)
  if (from) p.set('from', String(new Date(from + 'T00:00:00').getTime()))
  if (to) p.set('to', String(new Date(to + 'T23:59:59.999').getTime()))
  if (q) p.set('q', q)
  window.location = '/api/export/sessions?' + p.toString()
}

// ---- 筛选芯片：搜索常驻，模型/状态/日期收进「＋筛选」，已选条件变成可 × 的胶囊 ----
function renderHistChips() {
  const model = $('histModel').value
  const status = $('histStatus').value
  const from = $('histFrom').value
  const to = $('histTo').value
  const chips = []
  if (model) chips.push(['model', '模型', model])
  if (status) chips.push(['status', '状态', $('histStatus').selectedOptions[0].textContent])
  if (from || to) chips.push(['dates', '日期', (from || '…') + ' → ' + (to || '…')])
  $('histChips').innerHTML = chips.map((c) =>
    '<span class="chip"><b>' + c[1] + '</b>' + esc(c[2]) + '<button data-clear="' + c[0] + '" title="移除该条件">×</button></span>'
  ).join('')
  $('histFilterBtn').textContent = chips.length ? '＋ 筛选（' + chips.length + '）' : '＋ 筛选'
}
function setHistPop(open) { $('histFilterPop').hidden = !open }
$('histFilterBtn').onclick = (e) => { e.stopPropagation(); setHistPop($('histFilterPop').hidden) }
$('histFilterPop').onclick = (e) => { e.stopPropagation() }
$('histChips').onclick = (e) => {
  const b = e.target.closest('button[data-clear]')
  if (!b) return
  const k = b.dataset.clear
  if (k === 'model') $('histModel').value = ''
  if (k === 'status') $('histStatus').value = ''
  if (k === 'dates') { $('histFrom').value = ''; $('histTo').value = '' }
  histPage = 0
  loadHistory()
}
document.addEventListener('click', () => { if (!$('histFilterPop').hidden) setHistPop(false) })
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('histFilterPop').hidden) setHistPop(false) })
$('histFirst').onclick = () => { histPage = 0; loadHistory() }
$('histPrev').onclick = () => { if (histPage > 0) { histPage -= 1; loadHistory() } }
$('histNext').onclick = () => { histPage += 1; loadHistory() }
$('histLast').onclick = () => {
  histPage = Math.max(1, Math.ceil(histTotal / HIST_PAGE_SIZE)) - 1
  loadHistory()
}

// ---- stats：KPI 卡片 + SVG 柱状图 ----
let currentPeriod = 'today'
let currentMetric = 'tokens'
let lastSeries = null
const PERIOD_SUB = { today: '按小时（0–23时）', week: '按天（本周）', month: '按天（本月）', all: '按月（最近 24 个月）' }

/** 轴刻度：时长（比 fmtDuration 省宽度）。 */
function fmtDurAxis(ms) {
  if (ms >= 3600000) return (ms / 3600000).toFixed(1) + 'h'
  if (ms >= 60000) return Math.round(ms / 60000) + 'm'
  return Math.round(ms / 1000) + 's'
}
/** 图表指标：Token / 费用 / 时长，同一张 SVG 三选一（数据都来自 /api/stats/series 的桶）。 */
const METRICS = {
  tokens: {
    title: 'Token 消耗分布',
    value: (b) => b.tokens,
    tip: (b) => b.label + ' · ' + b.tokens.toLocaleString() + ' tokens · ' + fmtDuration(b.durationMs) + ' · ' + b.tasks + ' 个任务',
    axis: (v) => fmtAxis(v),
    peak: (v) => fmtTokens(v) + ' tok',
  },
  cost: {
    title: '费用分布',
    value: (b) => b.cost,
    tip: (b) => b.label + ' · ' + cur() + b.cost.toFixed(4) + ' · ' + b.tasks + ' 个任务',
    axis: (v) => (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(3)),
    peak: (v) => cur() + v.toFixed(2),
  },
  duration: {
    title: '任务时长分布',
    value: (b) => b.durationMs,
    tip: (b) => b.label + ' · ' + fmtDuration(b.durationMs) + ' · ' + b.tasks + ' 个任务',
    axis: (v) => fmtDurAxis(v),
    peak: (v) => fmtDuration(v),
  },
}

async function loadStats(force) {
  if (!statsLoaded) skLater('stats', paintStatsSkeleton)
  try {
    const [s, series, ranking] = await Promise.all([
      fetchJSON('/api/stats?period=' + currentPeriod, force),
      fetchJSON('/api/stats/series?period=' + currentPeriod, force),
      // 排行是附加信息：它单独失败（旧版服务 / 瞬时错误）不该把整页统计带崩
      fetchJSON('/api/ranking?period=' + currentPeriod, force).catch(() => null),
    ])
    $('chartSkeleton').style.display = 'none'
    renderKpis(s)
    renderChart(series)
    if (ranking) renderRanking(ranking)
  } catch (err) {
    // 静默失败排查不了：把真实原因打出来（用户报「统计页空白」时第一手证据）。
    console.error('[panel] 统计加载失败', currentPeriod, err && (err.stack || err.message || err))
    $('chartSkeleton').style.display = 'none'
    $('chartEmpty').style.display = ''
    $('chartEmpty').innerHTML = emptyHTML('统计加载失败', '伴侣服务可能没起来')
    $('rankModels').innerHTML = ''
    $('rankProjects').innerHTML = ''
  } finally {
    skCancel('stats')
    statsLoaded = true
  }
}

/** 成本排行（模型 / 项目）：费用与 Token 二选一展示，条长按占比。 */
function renderRanking(ranking) {
  const paint = (el, sub, rows) => {
    if (!rows || rows.length === 0) {
      el.innerHTML = emptyHTML('暂无数据', '换个周期，或先跑一个任务')
      if (sub) sub.textContent = ''
      return
    }
    const useCost = rows.some((r) => r.cost > 0)
    if (sub) sub.textContent = useCost ? '按费用' : '按 Token（无计费任务）'
    el.innerHTML = rows.map((r) => {
      const pct = Math.max(0, Math.min(100, Math.round((r.share || 0) * 100)))
      const val = useCost ? cur() + r.cost.toFixed(2) : fmtTokens(r.tokens)
      return '<div class="rank-row" title="' + esc(r.key) + ' · ' + r.tasks + ' 个任务">' +
        '<span class="rank-name">' + esc(r.key) + '</span>' +
        '<span class="rank-val">' + val + '</span>' +
        '<span class="rank-bar"><i style="width:' + pct + '%"></i></span></div>'
    }).join('')
  }
  paint($('rankModels'), $('rankModelSub'), ranking && ranking.models)
  paint($('rankProjects'), $('rankProjectSub'), ranking && ranking.projects)
}

for (const btn of document.querySelectorAll('#periodSeg button')) {
  btn.onclick = () => {
    currentPeriod = btn.dataset.period
    document.querySelectorAll('#periodSeg button').forEach((b) => b.classList.toggle('active', b === btn))
    loadStats()
  }
}
$('statsRefresh').onclick = () => loadStats(true)
// 切指标不重新请求：用缓存的上一次 series 直接重画
for (const btn of document.querySelectorAll('#metricSeg button')) {
  btn.onclick = () => {
    currentMetric = btn.dataset.metric
    document.querySelectorAll('#metricSeg button').forEach((b) => b.classList.toggle('active', b === btn))
    if (lastSeries) renderChart(lastSeries)
  }
}

function renderKpis(s) {
  const cacheRate = s.totalTokens > 0 ? Math.round((s.cachedTokens / s.totalTokens) * 100) : 0
  const prev = s.previous || null
  const pCacheRate = prev && prev.totalTokens > 0 ? Math.round((prev.cachedTokens / prev.totalTokens) * 100) : null
  // [图标, 标签, 数值, 单位, 单位在前, 副标题, 色调, 环比 HTML]——数值与单位分级排版
  const tok = tokParts(s.totalTokens)
  const cards = [
    ['Σ', '总 Token', tok[0], tok[1], false, '输入 ' + fmtTokens(s.promptTokens) + ' · 输出 ' + fmtTokens(s.completionTokens), 'tone-blue', deltaHTML(s.totalTokens, prev && prev.totalTokens)],
    ['🧩', '任务数', String(s.tasks), '个', false, '成功 ' + s.success + ' 轮', 'tone-cyan', deltaHTML(s.tasks, prev && prev.tasks)],
    ['✅', '成功率', s.tasks > 0 ? String(s.successRate) : '—', s.tasks > 0 ? '%' : '', false, '失败 ' + s.failed + ' · 中断 ' + s.interrupted, 'tone-green', deltaHTML(s.tasks > 0 ? s.successRate : null, prev && prev.tasks > 0 ? prev.successRate : null, true, 'pt')],
    ['⏱', '总时长', fmtDuration(s.totalDurationMs), '', false, s.tasks > 0 ? '平均 ' + fmtDuration(s.totalDurationMs / s.tasks) : '—', 'tone-violet', deltaHTML(s.totalDurationMs, prev && prev.totalDurationMs, false)],
    ['¥', '费用估算', s.cost.toFixed(2), cur(), true, '仅统计 DeepSeek 账号任务', 'tone-gold', deltaHTML(s.cost, prev && prev.cost, false)],
    ['⚡', '缓存命中', String(cacheRate), '%', false, fmtTokens(s.cachedTokens) + ' tokens', 'tone-teal', deltaHTML(cacheRate, pCacheRate, true, 'pt')],
  ]
  $('kpiCards').innerHTML = cards.map((c) => {
    const unit = c[3] ? '<i class="kpi-unit' + (c[4] ? ' pre' : '') + '">' + c[3] + '</i>' : ''
    const value = c[4] ? unit + c[2] : c[2] + unit
    return '<div class="kpi ' + c[6] + '"><div class="kpi-head"><span class="kpi-ico">' + c[0] +
      '</span><span class="kpi-label">' + c[1] + '</span></div><div class="kpi-value' + (c[2].length > 9 ? ' long' : '') + '">' + value +
      '</div><div class="kpi-sub">' + c[5] + (c[7] || '') + '</div></div>'
  }).join('')
}
/**
 * KPI 环比徽标。upGood 决定「变大」是好事还是坏事（成功率/缓存命中 upGood，
 * 费用/时长/Token 变大是坏事）；mode='pt' 表示数值本身是百分比（用百分点差）。
 */
function deltaHTML(now, before, upGood, mode) {
  if (before === null || before === undefined || now === null || now === undefined) return ''
  const up = Number(now), old = Number(before)
  if (!isFinite(up) || !isFinite(old)) return ''
  if (old === 0) return up > 0 ? '<span class="kpi-delta ' + (upGood ? 'good' : 'bad') + '">新增</span>' : ''
  if (mode === 'pt') {
    const diff = Math.round((up - old) * 10) / 10
    if (Math.abs(diff) < 0.1) return '<span class="kpi-delta flat">持平</span>'
    const grewPt = diff > 0
    const goodPt = upGood === undefined ? !grewPt : upGood ? grewPt : !grewPt
    return '<span class="kpi-delta ' + (goodPt ? 'good' : 'bad') + '">' + (grewPt ? '+' : '−') + Math.abs(diff) + 'pt</span>'
  }
  const pct = Math.round(((up - old) / old) * 1000) / 10
  if (Math.abs(pct) < 0.1) return '<span class="kpi-delta flat">持平</span>'
  const grew = pct > 0
  const good = upGood === undefined ? !grew : upGood ? grew : !grew
  const text = Math.abs(pct) >= 999 ? (grew ? '↑' : '↓') + '10 倍+' : (grew ? '↑' : '↓') + Math.abs(pct) + '%'
  return '<span class="kpi-delta ' + (good ? 'good' : 'bad') + '">' + text + '</span>'
}
/** Token 数拆成「数字 + k/M 单位」，供 KPI 分级排版。 */
function tokParts(n) {
  if (n >= 1e6) return [(n / 1e6).toFixed(2), 'M']
  if (n >= 1e3) return [(n / 1e3).toFixed(1), 'k']
  return [String(n), '']
}

/** 轴刻度紧凑格式（比 fmtTokens 更省宽度）。 */
function fmtAxis(n) {
  if (n >= 1e6) return +(n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return +(n / 1e3).toFixed(1) + 'k'
  return String(Math.round(n))
}
/** 1/2/2.5/5×10^n 向上取整，让网格线落整。 */
function niceCeil(v) {
  if (v <= 0) return 1
  const exp = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 2, 2.5, 5, 10]) { if (v <= m * exp) return m * exp }
  return 10 * exp
}

function renderChart(series) {
  lastSeries = series
  const metric = METRICS[currentMetric] || METRICS.tokens
  const buckets = (series && series.buckets) || []
  const svg = $('tokenChart')
  const empty = $('chartEmpty')
  const tip = $('chartTip')
  $('chartSkeleton').style.display = 'none'
  tip.classList.remove('show')
  const values = buckets.map((b) => metric.value(b) || 0)
  const hasData = values.some((v) => v > 0)
  svg.style.display = hasData ? '' : 'none'
  empty.style.display = hasData ? 'none' : ''
  empty.innerHTML = emptyHTML(
    currentMetric === 'cost' ? '没有可计费任务' : currentMetric === 'duration' ? '暂无任务时长' : '暂无任务数据',
    currentMetric === 'cost' ? '自定义渠道任务不计费，Token 照记' : '换个周期，或先跑一个任务'
  )
  $('chartTitle').textContent = metric.title
  $('chartSub').textContent = PERIOD_SUB[currentPeriod] || ''
  // 结论行：峰值桶一句话，省得用户自己找
  const peak = values.reduce((acc, v, i) => (v > 0 && (acc < 0 || v > values[acc]) ? i : acc), -1)
  $('chartNote').textContent = peak >= 0 ? '峰值 ' + buckets[peak].label + ' · ' + metric.peak(values[peak]) : ''
  if (!hasData) return

  const W = 720, H = 220, PL = 56, PR = 10, PT = 16, PB = 28
  const iw = W - PL - PR, ih = H - PT - PB
  const max = niceCeil(Math.max(...values))
  const bw = iw / buckets.length
  const parts = [
    '<defs>',
    '<linearGradient id="barG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--chart-bar-top)"/><stop offset="1" stop-color="var(--chart-bar-bottom)"/></linearGradient>',
    '<linearGradient id="barNow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--chart-now-top)"/><stop offset="1" stop-color="var(--chart-now-bottom)"/></linearGradient>',
    '</defs>',
  ]
  for (let i = 0; i <= 4; i++) {
    const y = PT + ih - (ih * i) / 4
    parts.push('<line x1="' + PL + '" y1="' + y.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + y.toFixed(1) + '" stroke="var(--chart-grid)" stroke-width="1"/>')
    parts.push('<text x="' + (PL - 7) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" fill="var(--chart-axis)" font-size="10.5">' + metric.axis((max * i) / 4) + '</text>')
  }
  const step = Math.max(1, Math.ceil(buckets.length / 12))
  buckets.forEach((b, i) => {
    const x = PL + i * bw + bw * 0.18
    const w = bw * 0.64
    const v = values[i]
    if (v > 0) {
      const h = Math.max(3, (v / max) * ih)
      const y = PT + ih - h
      const fill = i === buckets.length - 1 ? 'url(#barNow)' : 'url(#barG)'
      parts.push('<rect class="bar" data-i="' + i + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) +
        '" rx="3.5" fill="' + fill + '"></rect>')
    } else {
      parts.push('<rect x="' + x.toFixed(1) + '" y="' + (PT + ih - 2.5).toFixed(1) + '" width="' + w.toFixed(1) + '" height="2.5" rx="1.25" fill="var(--chart-slot)"/>')
    }
    if (i % step === 0) {
      parts.push('<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle" fill="var(--chart-axis)" font-size="10.5">' + b.label + '</text>')
    }
  })
  svg.innerHTML = parts.join('')

  // hover：就近取桶 → 自定义 tooltip 跟随鼠标（原生 <title> 要等 1s，太钝）+ 其余柱降透明
  svg.onmousemove = (ev) => {
    const rect = svg.getBoundingClientRect()
    if (!rect.width) return
    const x = (ev.clientX - rect.left) * (W / rect.width)
    const idx = Math.max(0, Math.min(buckets.length - 1, Math.floor((x - PL) / bw)))
    for (const r of svg.querySelectorAll('rect.bar')) r.classList.toggle('hot', Number(r.dataset.i) === idx)
    if (!(values[idx] > 0)) {
      svg.classList.remove('has-hot')
      tip.classList.remove('show')
      return
    }
    svg.classList.add('has-hot')
    tip.textContent = metric.tip(buckets[idx])
    const crect = svg.parentElement.getBoundingClientRect()
    tip.style.left = Math.max(84, Math.min(crect.width - 84, ev.clientX - crect.left)) + 'px'
    tip.style.top = (ev.clientY - crect.top - 10) + 'px'
    tip.classList.add('show')
  }
  svg.onmouseleave = () => {
    svg.classList.remove('has-hot')
    for (const r of svg.querySelectorAll('rect.bar.hot')) r.classList.remove('hot')
    tip.classList.remove('show')
  }
}

// ---- settings：全部即时生效（改一个 PUT 一个，右下角气泡确认） ----
// 分组导航：伴侣 / 提醒 / 计费 / 数据（只切显示，不重载任何状态）
for (const b of document.querySelectorAll('.set-nav button')) {
  b.onclick = () => {
    document.querySelectorAll('.set-nav button').forEach((x) => x.classList.toggle('active', x === b))
    document.querySelectorAll('.set-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === b.dataset.group))
  }
}
let toastTimer = null
function showToast(text, ok) {
  const t = $('saveToast')
  if (text != null) t.textContent = text
  t.classList.toggle('err', ok === false)
  t.classList.add('show')
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.classList.remove('show'), 1600)
}
function toastSaved() {
  showToast('✓ 已保存', true)
}
async function put(patch) {
  try {
    const res = await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
    if (res.ok) toastSaved()
  } catch (err) { /* 服务失联时静默：下次拉 /api/settings 会以服务端为准覆盖回来 */ }
}

let officialPricing = null // GET /api/pricing：官方自动价格（已换算为设置货币）

function officialNames() {
  return officialPricing && officialPricing.models ? Object.keys(officialPricing.models) : []
}
function fmtAgo(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}
async function loadOfficialPricing() {
  try {
    officialPricing = await (await fetch('/api/pricing')).json()
  } catch (err) {
    officialPricing = null
  }
  renderOfficialBox()
}
function renderOfficialBox() {
  const box = $('officialBox')
  if (!box) return
  let text
  if (officialPricing && officialPricing.ok && officialNames().length) {
    text = '<span class="off-ok">✓ 官方价已同步 ' + fmtAgo(officialPricing.fetchedAt) + '</span>（高峰价' +
      (officialPricing.currency === 'CNY' ? '，1 USD = ' + officialPricing.rate + ' CNY' : '') +
      '，低峰半价；单位：每百万 Token）'
  } else {
    const why = officialPricing && officialPricing.error ? '：' + esc(officialPricing.error) : ''
    text = '<span class="off-warn">官方价未同步' + why + '</span>，当前按内置兜底价计'
  }
  box.innerHTML = '<span>' + text + '</span><button class="ghost" id="btnSyncPricing">⟳ 立即同步</button>'
  $('btnSyncPricing').onclick = async (e) => {
    e.target.disabled = true
    let res = null
    try {
      res = await (await fetch('/api/pricing/refresh', { method: 'POST' })).json()
    } catch (err) { /* res 保持 null */ }
    await loadOfficialPricing()
    if (res && res.ok) showToast('✓ 官方价格已同步', true)
    else showToast('⚠ 同步失败：' + ((res && res.error) || '网络错误'), false)
  }
  renderOfficialRows()
}
function renderOfficialRows() {
  const box = $('officialRows')
  if (!box) return
  const names = officialNames()
  const sym = officialPricing && officialPricing.currency === 'USD' ? '$' : '¥'
  if (!names.length) {
    box.innerHTML = '<div class="price-empty">等待官方价同步 — 同步成功后自动列出 DeepSeek 当前模型与价格</div>'
    return
  }
  box.innerHTML =
    '<div class="op-head"><span>模型</span><span>输入 / 百万</span><span>缓存命中 / 百万</span><span>输出 / 百万</span></div>' +
    names.map((n) => {
      const p = officialPricing.models[n]
      const ver = (officialPricing.versions && officialPricing.versions[n]) || ''
      // 闲时（OFF-PEAK，UTC 16:30–00:30 = 北京 00:30–08:30）按高峰价 5 折。
      const off = (v) => (v != null && v > 0 ? '<small class="op-off">闲时 ' + sym + v + '</small>' : '')
      return '<div class="op-row"><span class="op-name">' + esc(n) +
        (ver ? '<small class="op-ver">官网版本：' + esc(ver) + '</small>' : '') +
        '</span>' +
        '<span>' + sym + p.inputPerMillion + off(p.inputOffPeakPerMillion) + '</span>' +
        '<span>' + sym + (p.cacheInputPerMillion != null ? p.cacheInputPerMillion : 0) + off(p.cacheInputOffPeakPerMillion) + '</span>' +
        '<span>' + sym + p.outputPerMillion + off(p.outputOffPeakPerMillion) + '</span></div>'
    }).join('')
}

function esc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function updateSkinPreview(skin, state) {
  $('skinPreview').src = '/skins/' + encodeURIComponent(skin) + '/' + encodeURIComponent(state || 'idle') + '.svg'
}

async function loadSettings() {
  const [stateRes, skinsRes] = await Promise.all([
    fetch('/api/state'),
    fetch('/api/skins'),
    loadOfficialPricing(),
  ])
  snap = await stateRes.json()
  const skins = await skinsRes.json()
  const s = snap.settings
  const sel = $('setSkin')
  sel.innerHTML = skins.map((sk) => '<option value="' + esc(sk.name) + '">' + esc(sk.displayName) + '（' + esc(sk.name) + '）</option>').join('')
  sel.value = s.skin
  updateSkinPreview(s.skin, snap.state)
  $('setOpacity').value = s.opacity; $('setOpacityVal').textContent = Math.round(s.opacity * 100) + '%'
  $('setScale').value = s.scale; $('setScaleVal').textContent = Math.round(s.scale * 100) + '%'
  $('setClickThrough').checked = s.clickThrough
  $('setShowPet').checked = s.showPet !== false
  $('setPurePet').checked = !!s.purePetMode
  $('setRoam').checked = roamPref()
  $('setPrivacy').checked = s.privacyMode
  $('setAutoStart').checked = s.autoStart
  $('setNotify').checked = s.notify !== false
  const rr = s.restReminder || {}
  $('setRestEnabled').checked = rr.enabled !== false
  $('setRestMinutes').value = rr.intervalMinutes || 60
  syncRestPresets(rr.intervalMinutes || 60)
  document.querySelectorAll('#currencySeg button').forEach((b) => b.classList.toggle('active', b.dataset.cur === s.currency))
  const budget = s.budget || {}
  $('setTaskTokens').value = budget.taskMaxTokens || 0
  $('setTaskCost').value = budget.taskMaxCost || 0
  $('setDailyTokens').value = budget.dailyMaxTokens || 0
  $('setDailyCost').value = budget.dailyMaxCost || 0
  $('mockFieldset').style.display = snap.adapter === 'mock' ? 'block' : 'none'
  $('btnPauseToggle').textContent = s.paused ? '▶ 恢复统计' : '⏸ 暂停统计'
  renderLive()
  renderBudgetUsage()
}

/**
 * 预算进度：今日已用 vs 每日上限。没有设上限就不显示（不做空进度条）。
 * 只算今日（预算本身是日口径），费用/Token 两条哪个设了就用哪个。
 */
async function renderBudgetUsage() {
  const box = $('budgetUsage')
  if (!box || !snap) return
  const budget = (snap.settings && snap.settings.budget) || {}
  const costCap = Number(budget.dailyMaxCost) || 0
  const tokenCap = Number(budget.dailyMaxTokens) || 0
  if (costCap <= 0 && tokenCap <= 0) { box.hidden = true; return }
  let today = null
  try { today = await (await fetch('/api/stats?period=today')).json() } catch (err) { today = null }
  if (!today) { box.hidden = true; return }
  // 两个上限都设了就按「更吃紧的那个」显示，避免条子含义含糊。
  const useCost = costCap > 0 && (tokenCap <= 0 || (today.cost / costCap) >= (today.totalTokens / tokenCap))
  const used = useCost ? today.cost : today.totalTokens
  const cap = useCost ? costCap : tokenCap
  const pctRaw = cap > 0 ? (used / cap) * 100 : 0
  const pct = Math.max(0, Math.min(100, Math.round(pctRaw)))
  box.hidden = false
  const fill = $('budgetBarFill')
  fill.style.width = pct + '%'
  fill.classList.toggle('warn', pct >= 80)
  const fmt = (v) => useCost ? cur() + v.toFixed(2) : fmtTokens(v) + ' tok'
  const left = Math.max(0, cap - used)
  $('budgetText').innerHTML = '今日已用 <b>' + fmt(used) + '</b> / ' + fmt(cap) +
    '（' + pct + '%）· 剩余 ' + fmt(left) +
    (pctRaw >= 100 ? ' <span class="kpi-delta bad">已超预算</span>' : '')
}

// ---- 即时生效接线 ----
$('setSkin').onchange = (e) => {
  updateSkinPreview(e.target.value, snap && snap.state)
  put({ skin: e.target.value })
}
function bindSlider(id, labelId, key) {
  const input = $(id)
  let timer = null
  input.oninput = () => {
    $(labelId).textContent = Math.round(input.value * 100) + '%'
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => put({ [key]: parseFloat(input.value) }), 200)
  }
}
bindSlider('setOpacity', 'setOpacityVal', 'opacity')
bindSlider('setScale', 'setScaleVal', 'scale')
$('setShowPet').onchange = (e) => put({ showPet: e.target.checked })
$('setPurePet').onchange = (e) => put({ purePetMode: e.target.checked })
// 自由活动是纯宠物行为偏好，存 localStorage（与悬浮页同源的 pet.roam 键），不进后端 settings；
// 悬浮页每 5s 的调度器每次重读它，所以这里一改那边立刻生效。
function roamPref() { try { return localStorage.getItem('pet.roam') !== '0' } catch (err) { return true } }
$('setRoam').onchange = (e) => {
  try { localStorage.setItem('pet.roam', e.target.checked ? '1' : '0') } catch (err) { /* 禁 localStorage 时忽略 */ }
  showToast(e.target.checked ? '✓ 闲时会自己逛逛' : '✓ 已关闭自由活动', true)
}
$('setClickThrough').onchange = (e) => put({ clickThrough: e.target.checked })
$('setPrivacy').onchange = (e) => put({ privacyMode: e.target.checked })
$('setAutoStart').onchange = (e) => put({ autoStart: e.target.checked })
$('setNotify').onchange = (e) => put({ notify: e.target.checked })
$('setRestEnabled').onchange = (e) => {
  const cur = (snap && snap.settings && snap.settings.restReminder) || { intervalMinutes: 60 }
  put({ restReminder: { enabled: e.target.checked, intervalMinutes: Number(cur.intervalMinutes) || 60 } })
}
$('setRestMinutes').onchange = (e) => {
  const mins = Math.min(480, Math.max(5, Math.round(Number(e.target.value) || 60)))
  e.target.value = mins
  syncRestPresets(mins)
  const cur = (snap && snap.settings && snap.settings.restReminder) || {}
  put({ restReminder: { enabled: cur.enabled !== false, intervalMinutes: mins } })
}
// 久坐间隔预设：点一下即生效（仍是 5–480 的合法值）
function syncRestPresets(mins) {
  for (const b of document.querySelectorAll('#restPresets button')) {
    b.classList.toggle('active', Number(b.dataset.min) === Number(mins))
  }
}
for (const b of document.querySelectorAll('#restPresets button')) {
  b.onclick = () => {
    const mins = Number(b.dataset.min) || 60
    $('setRestMinutes').value = mins
    syncRestPresets(mins)
    const cur = (snap && snap.settings && snap.settings.restReminder) || {}
    put({ restReminder: { enabled: cur.enabled !== false, intervalMinutes: mins } })
  }
}
for (const b of document.querySelectorAll('#currencySeg button')) {
  b.onclick = () => {
    document.querySelectorAll('#currencySeg button').forEach((x) => x.classList.toggle('active', x === b))
    // 货币切换会改变官方价折算，PUT 落库后重拉价格状态。
    void put({ currency: b.dataset.cur }).then(() => loadOfficialPricing())
  }
}
for (const id of ['setTaskTokens', 'setTaskCost', 'setDailyTokens', 'setDailyCost']) {
  $(id).onchange = () => {
    put({
      budget: {
        taskMaxTokens: Number($('setTaskTokens').value) || null,
        taskMaxCost: Number($('setTaskCost').value) || null,
        dailyMaxTokens: Number($('setDailyTokens').value) || null,
        dailyMaxCost: Number($('setDailyCost').value) || null,
      },
    }).then(() => { loadSettings().then(renderBudgetUsage) })
  }
}

$('btnPauseToggle').onclick = async () => {
  await fetch('/api/pause', { method: 'POST' })
  await loadSettings()
}
$('mockStart').onclick = () => {
  fetch('/api/mock/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario: $('mockScenario').value }) })
}
$('btnExportCsv').onclick = () => { window.location = '/api/export/sessions?format=csv' }
$('btnExportJson').onclick = () => { window.location = '/api/export/sessions?format=json' }
$('btnExportToolsCsv').onclick = () => { window.location = '/api/export/tools?format=csv' }

// ---- 会话管理：清单 + 批量彻底删除（node 端 SessionDeleter 逐会话闸门复用） ----
let smSessions = []
let smSelected = new Set()
let smVisible = [] // 当前搜索/排序后的可见清单（全选作用域）
let smLastTotal = 0
let smError = false

function fmtSize(n) {
  if (n == null) return '—'
  if (n < 1024) return n + ' B'
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1048576).toFixed(1) + ' MB'
}
// 空会话 = 消息数为 0/未知（中断的空壳、没聊过的新会话）
function smIsEmpty(s) { return !s.messageCount }

async function loadSessions(force) {
  $('smSummary').textContent = '加载中…'
  if (!smLoaded) skLater('sessions', paintSessionsSkeleton)
  try {
    let data = null
    try { data = await fetchJSON('/api/dsh-sessions', force) } catch (err) { data = null }
    if (!data || data.ok !== true) {
      smSessions = []
      smLastTotal = 0
      smError = true
      $('smSummary').textContent = (data && data.message) || '连不上伴侣服务，无法读取会话清单'
      renderSessions()
      return
    }
    smError = false
    smSessions = data.sessions || []
    smLastTotal = data.totalSizeBytes || 0
    // 清掉已不在清单里的选中 id（刚被删掉/宿主侧变化）
    const alive = new Set(smSessions.map((s) => s.sessionId))
    for (const id of [...smSelected]) { if (!alive.has(id)) smSelected.delete(id) }
    renderSessions()
  } finally {
    skCancel('sessions')
    smLoaded = true
  }
}

function renderSessions() {
  // 搜索 + 排序在客户端做（清单本来就在内存里）：搜索命中标题/工作区/会话 ID。
  const q = ($('smQ') && $('smQ').value || '').trim().toLowerCase()
  const sortBy = ($('smSort') && $('smSort').value) || 'time'
  let list = smSessions.slice()
  if (q) {
    list = list.filter((s) =>
      (s.title || '').toLowerCase().includes(q) ||
      (s.workspaceTitle || '').toLowerCase().includes(q) ||
      (s.sessionId || '').toLowerCase().includes(q))
  }
  if (sortBy === 'size') list.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0))
  else if (sortBy === 'msg') list.sort((a, b) => (b.messageCount || 0) - (a.messageCount || 0))
  else list.sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0))
  // 隐私模式覆盖会话清单（用户明确要求）：标题/工作区跟历史页一样走 mask()。
  const rows = list.map((s) => {
    const title = s.title ? esc(mask(s.title)) : '（无标题）'
    const wsName = s.workspaceTitle ? esc(mask(s.workspaceTitle)) : '—'
    const tags = (s.archived ? '<span class="tag arch">归档</span> ' : '') + (s.pinned ? '<span class="tag pin">置顶</span>' : '')
    const msg = s.messageCount == null ? '—' : String(s.messageCount)
    const when = fmtAgo(s.lastActivityAt) || '—'
    return '<tr data-sid="' + esc(s.sessionId) + '"' + (smIsEmpty(s) ? ' class="sm-empty"' : '') + '>' +
      '<td><input type="checkbox"' + (smSelected.has(s.sessionId) ? ' checked' : '') + '></td>' +
      '<td><span class="sm-title">' + title + '<small>' + esc(s.sessionId) + '</small></span></td>' +
      '<td class="muted">' + wsName + '</td>' +
      '<td>' + (tags || '<span class="muted">—</span>') + '</td>' +
      '<td class="sm-num">' + msg + '</td>' +
      '<td class="sm-num">' + fmtSize(s.sizeBytes) + '</td>' +
      '<td class="muted">' + when + '</td></tr>'
  })
  $('smBody').innerHTML = rows.join('') ||
    (smError ? '' : '<tr><td colspan="7" class="empty-cell">' + emptyHTML(
      q ? '没有匹配的会话' : '没有会话',
      q ? '换个关键词，或清空搜索框' : '宿主注册表为空——先在 DSH 里开一个对话吧') + '</td></tr>')
  smVisible = list // 「全选」只作用于当前过滤后的清单，跟表头勾选框的状态一致
  let selSize = 0
  for (const s of smSessions) { if (smSelected.has(s.sessionId) && s.sizeBytes) selSize += s.sizeBytes }
  const n = smSelected.size
  $('smSummary').textContent = (q ? '匹配 ' + list.length + ' / ' : '共 ') + smSessions.length + ' 个会话 · 磁盘占用 ' + fmtSize(smLastTotal)
  $('bulkCount').textContent = String(n)
  $('bulkSize').textContent = fmtSize(selSize)
  $('bulkBar').hidden = n === 0 || $('smConfirm').style.display === 'flex'
  const del = $('smDelete')
  del.disabled = n === 0
  del.textContent = n > 0 ? '删除所选（' + n + '）' : '删除所选'
  $('smSelAll').checked = list.length > 0 && list.every((s) => smSelected.has(s.sessionId))
}
// 搜索/排序纯前端：清单已在内存，打字即时过滤，不再打网络。
$('smQ').oninput = () => { if (smQTimer) clearTimeout(smQTimer); smQTimer = setTimeout(renderSessions, 120) }
$('smSort').onchange = () => renderSessions()
let smQTimer = null

function smSelectWhere(pred) {
  for (const s of smSessions) { if (pred(s)) smSelected.add(s.sessionId) }
  renderSessions()
}

// 「更多」菜单里的动作点完自动收起（原生 details 不会自己关）
for (const id of ['smSelArchived', 'smSelEmpty', 'smSelNone', 'smRefresh']) {
  const el = $(id)
  if (el) el.addEventListener('click', () => {
    const d = document.querySelector('details.more')
    if (d && d.open) d.open = false
  })
}

$('smBody').onclick = (e) => {
  const tr = e.target.closest('tr[data-sid]')
  if (!tr) return
  const sid = tr.dataset.sid
  const cb = tr.querySelector('input[type=checkbox]')
  if (e.target === cb) {
    if (cb.checked) smSelected.add(sid)
    else smSelected.delete(sid)
  } else {
    if (smSelected.has(sid)) smSelected.delete(sid)
    else smSelected.add(sid)
    if (cb) cb.checked = smSelected.has(sid)
  }
  renderSessions()
}
$('smSelAll').onchange = (e) => {
  // 有搜索词时「全选」= 选中过滤后的可见行（否则表头勾了却只选了一半，很反直觉）
  const scope = smVisible.length ? smVisible : smSessions
  if (e.target.checked) { for (const s of scope) smSelected.add(s.sessionId) }
  else smSelected.clear()
  renderSessions()
}
$('smSelArchived').onclick = () => smSelectWhere((s) => s.archived)
$('smSelEmpty').onclick = () => smSelectWhere(smIsEmpty)
$('smSelNone').onclick = () => { smSelected.clear(); renderSessions() }
$('smRefresh').onclick = () => { loadSessions(true) }
$('smDelete').onclick = () => {
  if (smSelected.size === 0) return
  let size = 0
  for (const s of smSessions) { if (smSelected.has(s.sessionId) && s.sizeBytes) size += s.sizeBytes }
  $('smConfirmText').textContent = '将彻底删除 ' + smSelected.size + ' 个会话（' + fmtSize(size) + '），不可恢复；运行中的会话会被逐个跳过。'
  $('smConfirm').style.display = 'flex'
  $('bulkBar').hidden = true
}
$('smCancelSel').onclick = () => { smSelected.clear(); renderSessions() }
$('smConfirmNo').onclick = () => { $('smConfirm').style.display = 'none'; renderSessions() }
$('smConfirmYes').onclick = async (e) => {
  const btn = e.currentTarget
  btn.disabled = true
  $('smConfirmNo').disabled = true
  let data = null
  try {
    data = await (await fetch('/api/dsh-sessions/delete-many', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionIds: [...smSelected] }),
    })).json()
  } catch (err) { data = null }
  btn.disabled = false
  $('smConfirmNo').disabled = false
  $('smConfirm').style.display = 'none'
  if (!data || data.ok !== true) {
    showToast('⚠ 批量删除失败：' + ((data && data.message) || '网络错误'), false)
    return
  }
  if (data.failedCount > 0) {
    const fails = (data.results || []).filter((r) => !r.ok)
    const first = fails[0] || {}
    showToast('⚠ 已删 ' + data.deletedCount + ' 个，失败 ' + data.failedCount + ' 个（' +
      (first.message || first.error || '未知') + (fails.length > 1 ? ' 等' : '') + '）', false)
  } else {
    showToast('✓ 已删除 ' + data.deletedCount + ' 个会话', true)
  }
  smSelected.clear()
  await loadSessions(true)
}

loadSettings()
loadHistory()
</script>
</body>
</html>`;
}
