/**
 * dsh-companion — 伴侣悬浮页（/）。
 *
 * 视觉系统：01-设计稿「深海终端」（低照度 + 荧光青 + 硬边界）。
 * 伴侣区 220×200；气泡最宽 320、最多两行；余额举牌在宠物上方。
 *
 * 交互（全部 CSS transform + DOM 粒子，所有皮肤通用）：抚摸 / 连点晕头 /
 * 拖拽落地脾气 / 空闲小动作 / 自由活动 / 久坐提醒 / 双击余额举牌。
 * Electron 壳里是透明置顶窗：宠物本体 no-drag，拖窗由主进程跟手（见 electron/main.cjs），
 * 周边透明区智能穿透（elementFromPoint + setMouseIgnore）。
 */

export function petPageHTML(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>DSH 伴侣</title>
<style>
  :root{
    --font-cjk:"PingFang SC","HarmonyOS Sans SC","Microsoft YaHei UI","Microsoft YaHei",system-ui,sans-serif;
    --font-mono:"JetBrains Mono","Cascadia Mono",Consolas,ui-monospace,monospace;
    --cyan:#46e5c3;
    --cyan-wash:rgba(70,229,195,.10);
    --amber:#f0b64a;
    --red:#ff7a7a;
    --bubble-bg:rgba(9,23,31,.94);
    --bubble-line:rgba(70,229,195,.30);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; user-select: none; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; font-family: var(--font-cjk); }
  body.browser { background:
    radial-gradient(560px 360px at 78% 18%,rgba(78,110,150,.34),transparent 70%),
    radial-gradient(420px 320px at 14% 82%,rgba(30,60,80,.55),transparent 70%),
    linear-gradient(150deg,#0c1420 0%,#101b28 42%,#080f18 100%); }
  #stage { position: fixed; display: flex; flex-direction: column; align-items: center; }
  body.electron #stage { left: 0; top: 0; width: 100vw; height: 100vh; justify-content: flex-start; padding-top: 70px;
    transition: padding-top .22s cubic-bezier(.2,.7,.3,1); }
  /* 小缩放时窗口只有 ~250–350 高：上边距让位给气泡，别再顶到 70。 */
  @media (max-height: 360px) { body.electron #stage { padding-top: 16px; } }
  /* 举牌打开时把宠物整体下移，给牌子让出头顶空间（否则 340×390 窗口里牌子会压住头部）。
     牌子高约 84 + 间距 10，100px 足够让牌子顶边落在 6px 左右；此时气泡暂时收起。 */
  body.electron.board-open #stage { padding-top: 100px; }
  body.browser #stage { right: 24px; bottom: 24px; }
  body.embed #stage { left: 0; top: 0; right: auto; bottom: auto; width: 100vw; height: 100vh; justify-content: center; -webkit-app-region: no-drag; }
  #petWrap { position: relative; display: flex; flex-direction: column; align-items: center; }
  #pet { width: 220px; height: 200px; filter: drop-shadow(0 14px 22px rgba(0,0,0,.42));
    position: relative; transform-origin: 50% 92%; cursor: pointer; }
  /* 图片层包一层，只给这一层做很轻的 3D 跟手倾斜；宠物本体和气泡不跟着转。 */
  #petTilt { position: absolute; inset: 0; transform-style: preserve-3d; will-change: transform;
    transition: transform .18s ease-out; }
  /* 地面软阴影：让裁切图有“站在桌面”的重量，不再像悬空贴纸。 */
  #pet::after { content: ""; position: absolute; left: 50%; bottom: -5px; width: 58%; height: 15px;
    transform: translateX(-50%); border-radius: 50%; pointer-events: none; z-index: 0;
    background: radial-gradient(ellipse at center, rgba(0,0,0,.42), rgba(0,0,0,0) 72%);
    filter: blur(4px); animation: pet-shadow 3.2s ease-in-out infinite; }
  /* object-fit: contain——皮肤图不强制 11:10（AI 生成的方形 PNG 原样完整显示，不拉伸） */
  #pet img { width: 100%; height: 100%; object-fit: contain; pointer-events: none; transform-origin: 50% 92%;
    position: relative; z-index: 1; }
  /* 待机呼吸；带一点极轻的摆动，避免整张图完全静止。 */
  #pet img { animation: pet-breathe 3.2s ease-in-out infinite; }
  #pet.is-working img { animation-duration: 1.4s; }
  @keyframes pet-breathe { 0%,100% { transform: translateY(0) scaleY(1) rotate(0) } 50% { transform: translateY(-2px) scaleY(1.012) rotate(-.45deg) } }
  @keyframes pet-shadow { 0%,100% { transform: translateX(-50%) scaleX(1); opacity: .9 } 50% { transform: translateX(-50%) scaleX(.94); opacity: .72 } }
  /* 图片没加载 / 加载失败时不要露出 broken-image 方框：隐藏 img，显示同尺寸的鲸鱼占位。
     注意这段不能挡住鼠标——命中判定会直接忽略未加载的图片。 */
  #petFallback { display: none; position: absolute; inset: 0; align-items: center; justify-content: center;
    pointer-events: none; z-index: 2; }
  #petFallback svg { width: 136px; height: 114px; filter: drop-shadow(0 8px 14px rgba(0,0,0,.35)); opacity: .9; }
  #pet.is-broken { filter: none; }
  #pet.is-broken #petImg { visibility: hidden; }
  #pet.is-broken #petFallback { display: flex; }
  /* Electron：整窗不设原生拖拽区（命中区域收窄到宠物本体：周边透明区域经
     智能穿透直接放行，见 setIgnoreMouseEvents + set-mouse-ignore IPC）。
     拖窗走页面指针捕获 + 主进程跟手；no-drag 声明保留兜底。 */
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
  /* ---- 气泡：深底 + 荧光边 + 硬投影（不依赖壁纸） ---- */
  #bubble { position: absolute; top: calc(100% + 12px); left: 50%; transform: translateX(-50%); z-index: 4;
    width: min(320px, calc(100vw - 20px)); display: flex; gap: 10px; align-items: flex-start;
    padding: 12px 14px; border-radius: 7px; background: var(--bubble-bg);
    border: 1px solid var(--bubble-line); color: #eef8fa; font-size: 12px; line-height: 1.5;
    box-shadow: 0 10px 26px rgba(0,0,0,.55), 0 0 0 1px rgba(3,10,14,.9), inset 0 1px 0 rgba(255,255,255,.06);
    pointer-events: none; text-align: center; justify-content: center; }
  /* 浏览器模式 / iframe 卡片：气泡回到文档流，舞台按「宠物+气泡」整体贴边，
     否则绝对定位的气泡会挂到视口外（真实踩到：窗口下沿只剩气泡的一条边）。
     选择器必须压过上面的 #bubble（ID 选择器），否则不生效。 */
  body.browser #stage #bubble, body.embed #stage #bubble {
    position: relative; top: auto; left: auto; transform: none; margin-top: 12px; }
  body.browser #stage #bubble::before, body.embed #stage #bubble::before { display: none; }
  #bubble[hidden] { display: none !important; }
  #bubble::before { content: ""; position: absolute; top: -5px; left: 50%; margin-left: -4px; width: 8px; height: 8px;
    background: var(--bubble-bg); border-left: 1px solid var(--bubble-line); border-top: 1px solid var(--bubble-line);
    transform: rotate(45deg); }
  #bubble.is-alert { border-color: rgba(240,182,74,.5); background: rgba(28,22,10,.95); }
  #bubble.is-alert::before { background: rgba(28,22,10,.95); border-color: rgba(240,182,74,.5); }
  #bubble.is-ok { border-color: rgba(70,229,195,.45); }
  #bubble.is-fail { border-color: rgba(255,122,122,.5); background: rgba(34,16,18,.95); }
  #bubble.is-fail::before { background: rgba(34,16,18,.95); border-color: rgba(255,122,122,.5); }
  .bubble-mark { width: 18px; height: 18px; flex: none; display: grid; place-items: center; margin-top: 1px; color: var(--cyan); }
  #bubble.is-alert .bubble-mark { color: var(--amber); }
  #bubble.is-fail .bubble-mark { color: var(--red); }
  .bubble-mark svg { width: 16px; height: 16px; display: block; }
  .bubble-body { display: grid; gap: 3px; min-width: 0; justify-items: center; }
  .bubble-body strong { font-size: 12.5px; font-weight: 600; color: #f2fbfd; letter-spacing: .01em; }
  .bubble-body > span { font-size: 11px; color: #b7ccd3; font-family: var(--font-mono);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
  .bubble-actions { display: flex; gap: 6px; margin-top: 8px; align-items: center; justify-content: center;
    pointer-events: auto; flex-wrap: wrap; }
  .bubble-actions[hidden], .rest-actions[hidden] { display: none !important; }
  .rest-actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
  .bubble-btn { height: 26px; padding: 0 10px; border-radius: 7px; font: inherit; font-size: 11px; font-weight: 600;
    background: var(--cyan); color: #04141a; border: 1px solid transparent; cursor: pointer; -webkit-app-region: no-drag; }
  .bubble-btn:hover { background: #5ff0d0; }
  .bubble-btn.ghost { background: transparent; border-color: rgba(255,255,255,.22); color: #dcecef; font-weight: 500; }
  .bubble-btn.ghost:hover { border-color: rgba(255,255,255,.42); }
  /* ---- 余额举牌：深色玻璃 + 荧光青描边，举在宠物上方 ---- */
  #placard { position: absolute; bottom: calc(100% + 10px); left: 50%; width: 210px; padding: 12px 13px 11px;
    border-radius: 8px; z-index: 6; text-align: left; background: #0c1a20;
    border: 1px solid rgba(70,229,195,.34);
    box-shadow: 0 14px 30px rgba(0,0,0,.6), inset 0 0 24px rgba(70,229,195,.06);
    pointer-events: none; transform: translateX(-50%); }
  #placard[hidden] { display: none !important; }
  #placard::after { content: ''; position: absolute; bottom: -6px; left: 50%; width: 9px; height: 9px;
    margin-left: -4.5px; background: #0c1a20; border-right: 1px solid rgba(70,229,195,.34);
    border-bottom: 1px solid rgba(70,229,195,.34); transform: rotate(45deg); }
  #placard.show { animation: placard-pop .22s cubic-bezier(.2,1.4,.4,1); }
  @keyframes placard-pop { 0% { opacity: 0; transform: translateX(-50%) translateY(8px) scale(.94) } 100% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1) } }
  #placard .p-label { font-family: var(--font-mono); font-size: 8.5px; letter-spacing: .14em;
    color: rgba(70,229,195,.75); text-transform: uppercase; }
  #placard .p-amount { display: flex; align-items: baseline; gap: 3px; margin-top: 2px; }
  #placard .p-amt { font-family: var(--font-mono); font-size: 28px; line-height: 1.1; font-weight: 500;
    color: #eafff9; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
  #placard .p-cur { font-family: var(--font-mono); font-size: 11px; color: rgba(70,229,195,.8); }
  #placard .p-sub { display: flex; justify-content: space-between; gap: 8px; font-family: var(--font-mono);
    font-size: 9px; color: #8faeb6; margin-top: 5px; padding-top: 5px; border-top: 1px solid rgba(70,229,195,.16); }
  /* 查询中/未登录/未开启：金额改中性色，别用荧光青误导 */
  #placard[data-state="muted"] .p-amt { color: #c9d8e7; font-size: 19px; font-weight: 600; }
  /* 余额低于告警阈值：金额转警示红 */
  #placard[data-state="warn"] .p-amt { color: #ff9c85; }
  #placard[data-state="warn"] { border-color: rgba(255,122,122,.42); }
  .hidden { display: none !important; }
  /* 减少动态效果：尊重系统设置，别让桌宠在「减少动画」模式下继续抖 */
  @media (prefers-reduced-motion: reduce) {
    #pet.anim-squish, #pet.anim-wobble, #pet.anim-look, #pet.anim-stretch, #pet.anim-doze, #pet.anim-walk,
    #pet img, #pet::after { animation: none !important; }
    #petTilt { transform: none !important; }
    .pet-particle { animation: none !important; }
    #placard.show { animation: none !important; }
  }
</style>
</head>
<body class="browser">
  <div id="stage">
    <div id="petWrap">
      <div id="placard" hidden data-state="muted">
        <div class="p-label">余额 / Balance</div>
        <div class="p-amount"><b class="p-amt" id="placardAmt">—</b><span class="p-cur" id="placardCur">CNY</span></div>
        <div class="p-sub"><span id="placardSub">DeepSeek 账号</span><span id="placardToday"></span></div>
      </div>
      <div id="pet">
        <div id="petTilt">
          <img id="petImg" alt="" draggable="false">
          <div id="petFallback" aria-hidden="true">
            <svg viewBox="0 0 120 100" fill="none">
              <path d="M22 56c0-18 14-30 34-30 17 0 29 8 36 21 4-6 9-8 14-7-3 4-4 8-3 12 1 4 3 7 6 9-6 1-11-1-15-5-5 11-18 18-34 18-22 0-38-8-38-18Z" fill="rgba(70,229,195,.16)" stroke="#46e5c3" stroke-width="2"/>
              <circle cx="47" cy="50" r="2.2" fill="#dffef8"/><circle cx="69" cy="50" r="2.2" fill="#dffef8"/>
              <path d="M55 60c4 3 8 3 12 0" stroke="#dffef8" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </div>
        </div>
      </div>
      <div id="bubble" hidden>
        <span class="bubble-mark" id="bubbleMark" aria-hidden="true"></span>
        <div class="bubble-body">
          <strong id="bubbleTitle">连接中…</strong>
          <span id="bubbleMeta"></span>
          <div class="bubble-actions" id="bubbleActions" hidden>
            <div class="rest-actions" id="restActions" hidden>
              <button id="restWalk" class="bubble-btn" type="button">起来走走 ✓</button>
              <button id="restLater" class="bubble-btn ghost" type="button">稍后 10 分钟</button>
            </div>
            <button id="bubbleDismiss" class="bubble-btn ghost" type="button" hidden>知道了</button>
          </div>
        </div>
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
// 余额举牌打开时：宠物整体下移让出头顶，气泡暂时收起（否则牌子会压住头部）。
let boardOpen = false
// 显示伴侣的即时同步：上次下发的 showPet 值（null = 还没同步过）。
let lastShowPet = null

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
function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  const p = (n) => String(n).padStart(2, '0')
  return h > 0 ? h + ':' + p(m) + ':' + p(s % 60) : p(m) + ':' + p(s % 60)
}
function fmtHM(t) {
  const d = new Date(t || Date.now())
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

// 皮肤帧 URL 的版本戳：**页面会话级常量**（不是每次切帧都变的 Date.now()）。
// 旧写法每次状态切换都生成全新 URL，叠加服务端 no-cache → 每帧都强制重新下载
// +重新解码（鲸鱼娘单帧可达 150KB，一个任务 5~6 次状态切换就是 5~6 次全量重载），
// 还可能闪白。改成会话常量后同一帧在页面生命周期内 URL 恒定，可命中缓存/内存；
// 改图 + Ctrl+R（重新加载页面 = 新常量）依旧能立刻看到新素材，开发工作流不变。
const ASSET_V = String(Date.now())
let petRetryCount = 0
let petRetryTimer = null
let petImageBroken = false
function frameURL(skin, name, ext) {
  return '/skins/' + encodeURIComponent(skin) + '/' + encodeURIComponent(name) + ext +
    '?v=' + ASSET_V + (petRetryCount ? '&r=' + petRetryCount : '')
}

function applySkin(skin, state) {
  const key = skin + '/' + state
  if (stateShown === key) return
  stateShown = key
  // 状态切换优先于反应帧：新状态直接顶掉反应图并撤销在途计时。
  if (reactionTimer) { clearTimeout(reactionTimer); reactionTimer = null }
  reactionName = null
  $('petImg').src = frameURL(skin, state, '.svg')
}

/** 图片真的解码出来才算可命中；src 为空 / 404 / 解码失败都不能算。 */
function petImageReady() {
  const img = $('petImg')
  return !!(img && !petImageBroken && img.complete && img.naturalWidth > 0)
}
function markPetBroken(broken) {
  if (petImageBroken === broken) return
  petImageBroken = broken
  const pet = $('pet')
  if (pet) pet.classList.toggle('is-broken', broken)
  const tilt = $('petTilt')
  if (tilt) tilt.style.transform = ''
  evalHover(lastMouse.x, lastMouse.y)
}
const petImageEl = $('petImg')
petImageEl.addEventListener('load', () => {
  petRetryCount = 0
  markPetBroken(false)
})
petImageEl.addEventListener('error', () => {
  markPetBroken(true)
  if (petRetryCount >= 2) return
  petRetryCount += 1
  if (petRetryTimer) clearTimeout(petRetryTimer)
  petRetryTimer = setTimeout(() => {
    if (!snap) return
    stateShown = null
    applySkin(snap.settings.skin, snap.state)
  }, 800 * petRetryCount)
})

// ---- 反应帧（manifest reactions 段）：抚摸/拖拽/连点时整图临时替换，
//      让桌宠「点有反应、拖有脾气」。没有反应帧的皮肤自动退回纯 CSS 动画，
//      行为与旧版一致。状态帧优先级更高（SSE 一来就顶掉）。----
let skinReactions = {} // 皮肤名 → 可用反应名（/api/skins 加载一次）
let skinStates = {} // 皮肤名 → 可用状态名（预加载清单）
let reactions = [] // 当前皮肤的反应名
let reactionName = null // 正在显示的反应帧（null = 状态帧）
let reactionTimer = null
/** 已预加载过的皮肤名（每套只拉一次）。 */
const preloadedSkins = {}
/** 持有 Image 引用防被 GC 回收（回收了就得重新解码，预加载白做）。 */
const frameHolders = []
/**
 * 预加载一套皮肤的全部帧。帧是有限集（8 状态 + 4 反应），一次拉完常驻内存，
 * 之后每次状态/反应切换都不再有网络与解码开销。URL 必须与 applySkin /
 * showReaction 用的**逐字一致**（状态帧 .svg、反应帧 .png），否则命中不了缓存。
 */
function preloadSkin(skin) {
  if (!skin || preloadedSkins[skin]) return
  // /api/skins 还没回来时清单是空的：此时**不能**标记已预加载，否则等清单到了
  // 会因标记而永远跳过（首帧 render 常早于 /api/skins 响应）。
  if (!skinStates[skin]) return
  preloadedSkins[skin] = true
  const warm = (name, ext) => {
    const img = new Image()
    img.src = frameURL(skin, name, ext) // 不挂 DOM，只为取回并解码
    frameHolders.push(img) // 持有引用，防 GC 回收后又得重新解码
  }
  for (const s of skinStates[skin]) warm(s, '.svg')
  for (const r of skinReactions[skin] || []) warm(r, '.png')
}
function refreshReactions() {
  const skin = snap && snap.settings ? snap.settings.skin : null
  reactions = (skin && skinReactions[skin]) || []
  if (skin) preloadSkin(skin)
}
function loadSkinReactions() {
  fetch('/api/skins').then((r) => r.json()).then((list) => {
    for (const s of list) {
      skinReactions[s.name] = s.reactions || []
      skinStates[s.name] = s.states || []
    }
    refreshReactions()
  }).catch(() => {})
}
function showReaction(name, ms) {
  if (!snap || !snap.settings || reactions.indexOf(name) < 0) return false
  reactionName = name
  $('petImg').src = frameURL(snap.settings.skin, name, '.png')
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

// ---- HUD 状态机（设计稿 03「伴侣 HUD」）：待机不占桌面；开始 2s；完成 5s；
//      失败常驻（可点掉）；预算告警跟随快照；久坐提醒带两个出口。
//      任务过程中的实时读数在宿主侧栏角标，HUD 不常驻信息条。 ----
let today = null // GET /api/stats?period=today（举牌副标题：今日消耗）
let flashUntil = 0 // 完成气泡的过期时间戳
let flashResult = null
let flashPersist = false // 失败气泡常驻，直到用户点掉
let startUntil = 0 // 任务启动气泡的过期时间戳
let startTask = null
let dismissedAlertTime = 0 // 用户点掉的那条告警时间（同一快照重复推不重复打扰）
let bubbleKind = '' // 当前气泡类别：alert / fail / rest / info / start / running / done

const ICONS = {
  info: '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.3"/><path d="M8 7.2v3.6M8 5.1v.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  alert: '<svg viewBox="0 0 16 16" fill="none"><path d="M8 2.6 14 13H2L8 2.6Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 6.4v3.1M8 11.4v.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  ok: '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.3"/><path d="m5.2 8.2 2 2 3.6-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fail: '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.3"/><path d="m5.8 5.8 4.4 4.4M10.2 5.8l-4.4 4.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  remind: '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.3"/><path d="M8 5v3.4l2 1.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
}

/** 显示/更新气泡。variant: info / alert / ok / fail；actions: none / rest / dismiss。 */
function setBubble(variant, kind, title, meta, actions) {
  const el = $('bubble')
  if (!variant) { el.hidden = true; bubbleKind = ''; return }
  bubbleKind = kind || variant
  el.hidden = false
  el.className = 'bubble' + (variant && variant !== 'info' ? ' is-' + variant : '')
  $('bubbleMark').innerHTML = ICONS[variant || 'info']
  $('bubbleTitle').textContent = title || ''
  $('bubbleMeta').textContent = meta || ''
  const act = actions || 'none'
  $('bubbleActions').hidden = act === 'none'
  $('restActions').hidden = act !== 'rest'
  $('bubbleDismiss').hidden = act !== 'dismiss'
}

function loadToday() {
  fetch('/api/stats?period=today').then((r) => r.json())
    .then((d) => { today = d })
    .catch(() => {})
}

/** 隐私模式：气泡只留状态词，不出现任务名 / 金额 / 模型名（设计稿实现约束）。 */
function privateMode() { return !!(snap && snap.settings && snap.settings.privacyMode) }

function renderHud() {
  if (!snap) return
  const pet = $('pet')
  pet.classList.toggle('is-working', !!snap.task)
  if (snap.settings && snap.settings.purePetMode) { setBubble(null); return }
  // 举牌期间收起气泡，把舞台整体下移给牌子让位（见 .board-open）。
  if (boardOpen) { setBubble(null); return }
  // 久坐提醒优先：到点后亮出两个出口（起来走走 / 稍后），60s 后自动收起。
  if (restPromptUntil > 0 && Date.now() < restPromptUntil) {
    const mins = Math.max(5, Math.min(480, Number(snap.settings.restReminder && snap.settings.restReminder.intervalMinutes) || 60))
    setBubble('remind', 'rest', restLine, '已连续 ' + mins + ' 分钟 · 建议 5 分钟', 'rest')
    return
  }
  // 抚摸/漫游台词优先展示，到期由 tick 清掉并还原 HUD。
  if (lineText && Date.now() < lineUntil) {
    setBubble('info', 'info', lineText, '', 'none')
    return
  }
  // 预算 / 余额告警：跟随快照（服务端 60s 后清空），点掉后同一条不再弹。
  if (snap.alert && snap.alert.time !== dismissedAlertTime) {
    const title = snap.alert.kind === 'balance-low' ? '余额不足' : '预算告警'
    const meta = privateMode() ? '详情见统计面板' : (snap.alert.message || '')
    setBubble('alert', 'alert', title, meta, 'dismiss')
    return
  }
  if (snap.task) {
    // 任务启动：显示任务名 2 秒（设计稿 START）。
    if (startTask && Date.now() < startUntil) {
      const title = privateMode() ? '任务开始' : ('开始 · ' + (startTask.project || '未命名任务'))
      const meta = privateMode() ? '任务进行中' : ([startTask.model, fmtHM(startTask.startTime)].filter(Boolean).join(' · '))
      setBubble('info', 'start', title, meta, 'none')
      return
    }
    // 运行中常驻状态气泡：用户反馈「跑任务时伴侣不说明状态」。
    // 设计稿 think/run 原本不弹气泡；这里保留设计的气泡皮肤，只补状态文案 +
    // 实时计时/Token，由 tick 每秒刷新。隐私模式只留状态词。
    const task = snap.task
    if (privateMode()) {
      setBubble('info', 'running', '任务进行中', '', 'none')
      return
    }
    const elapsed = fmtClock(Date.now() - task.startTime)
    const tokens = task.tokens && task.tokens.totalTokens ? fmtTokens(task.tokens.totalTokens) + ' token' : ''
    setBubble('info', 'running', snap.label || '任务进行中', [elapsed, tokens].filter(Boolean).join(' · '), 'none')
    return
  }
  // 完成 / 失败：完成停留 5 秒；失败常驻直到点掉（设计稿：错误不自动消失）。
  if (flashResult && (flashPersist || Date.now() < flashUntil)) {
    const r = flashResult
    const ok = r.status === 'success'
    const word = ok ? '完成' : (r.status === 'interrupted' ? '已中断' : (r.status === 'blocked' ? '等待输入' : (r.status === 'max-tokens' ? '触顶结束' : '失败')))
    let title
    let meta
    if (privateMode()) {
      title = ok ? '已完成' : '任务' + word
      meta = '任务结束'
    } else {
      title = ok ? ('完成 · ' + fmtDuration(r.durationMs)) : ('任务' + word + (r.project ? ' · ' + r.project : ''))
      const bits = []
      const tot = r.tokens && r.tokens.totalTokens
      if (tot) bits.push(fmtTokens(tot) + ' token')
      if (r.cost > 0) bits.push(currencySymbol(snap.currency) + r.cost.toFixed(2))
      meta = ok ? bits.join(' · ') : (fmtHM(r.endTime || Date.now()) + (bits.length ? ' · ' + bits.join(' · ') : ''))
    }
    setBubble(ok ? 'ok' : (r.status === 'interrupted' || r.status === 'blocked' || r.status === 'max-tokens' ? 'alert' : 'fail'),
      ok ? 'done' : 'fail', title, meta, ok ? 'none' : 'dismiss')
    return
  }
  // 待机：气泡收起，不占桌面注意力。
  setBubble(null)
}

// ---- 可见性门控：桌宠 24/7 常驻，窗口藏着/被完全遮挡时不该继续空转耗电 ----
// Electron 壳 showPet=false 走 win.hide()，Chromium 随即把页面标记为 hidden；
// 浏览器模式最小化/切后台同理。隐藏期间停掉全部轮询与动画调度。
// **SSE 与系统通知不门控**——窗口藏着也要收到任务完成通知与告警（那正是
// 「被挡住了也不错过」的场景）。
function petHidden() { return document.visibilityState === 'hidden' }

function tick() {
  if (!snap || petHidden()) return
  // 久坐提醒提示到期：收起按钮、回落正常 HUD。
  if (restPromptUntil > 0 && Date.now() >= restPromptUntil) {
    restPromptUntil = 0
    renderHud()
  }
  restCheck()
  // 台词/启动气泡/完成气泡到期：清掉并还原 HUD。
  if (lineUntil > 0 && Date.now() >= lineUntil) {
    lineUntil = 0
    lineText = ''
    renderHud()
    return
  }
  if (startUntil > 0 && Date.now() >= startUntil) {
    startUntil = 0
    startTask = null
    renderHud()
  }
  if (!flashPersist && flashUntil > 0 && Date.now() >= flashUntil) {
    flashUntil = 0
    flashResult = null
    renderHud()
  }
  // 运行态气泡的计时/Token 每秒走一格；不依赖 SSE 恰好有 token 事件。
  if (snap.task) renderHud()
}

function render() {
  if (!snap) return
  syncShowPet()
  refreshReactions()
  applySkin(snap.settings.skin, snap.state)
  applyLook()
  renderHud()
}

/**
 * 显示伴侣即时生效：面板 PUT settings.showPet 后，node 立刻经 SSE 广播快照；
 * 悬浮页收到后直接走 IPC 让主进程 show/hide，不用等 5s 看门狗轮询。
 * 窗口隐藏时 SSE 仍会送达（可见性门控刻意不挡 SSE），所以「开」也能立刻亮出来。
 * 旧壳没有 setVisible 时静默退回看门狗路径。
 */
function syncShowPet() {
  if (!inElectron || !snap || !snap.settings) return
  const want = snap.settings.showPet !== false
  if (lastShowPet === want) return
  lastShowPet = want
  if (window.petShell && typeof window.petShell.setVisible === 'function') window.petShell.setVisible(want)
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
  const label = r.status === 'success'
    ? '任务完成'
    : r.status === 'interrupted'
      ? '任务中断'
      : r.status === 'blocked'
        ? '任务等待输入'
        : r.status === 'max-tokens'
          ? '任务触顶'
          : '任务失败'
  if (privateMode()) {
    window.petShell.notify(label, '任务已结束')
    return
  }
  const detail = [fmtDuration(dur)]
  const tot = r.tokens && r.tokens.totalTokens
  if (tot) detail.push(fmtTokens(tot) + ' tok')
  if (r.cost > 0) detail.push(currencySymbol(snap.currency) + r.cost.toFixed(2))
  window.petShell.notify(label, (r.project ? r.project + '\\n' : '') + detail.join(' · '))
}
function notifyAlert(a) {
  if (!canNotify() || !a) return
  if (privateMode()) {
    window.petShell.notify(a.kind === 'balance-low' ? '余额不足' : '预算告警', '请打开 DSH 伴侣面板查看')
    return
  }
  window.petShell.notify(a.kind === 'balance-low' ? '余额不足' : '预算告警', a.message || '')
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
    // 任务刚启动 → 显示任务名 2 秒（设计稿「START」状态）。
    if (!hadTask && msg.task) {
      startTask = msg.task
      startUntil = Date.now() + 2000
      flashResult = null
      flashPersist = false
      flashUntil = 0
    }
    // 任务刚结束 → 完成气泡停留 5 秒；失败/中断常驻可点掉，并刷新今日累计。
    if (hadTask && !msg.task && msg.lastResult) {
      flashResult = msg.lastResult
      startTask = null
      startUntil = 0
      if (msg.lastResult.status === 'success') {
        flashUntil = Date.now() + 5000
        flashPersist = false
      } else {
        flashUntil = 0
        flashPersist = true
      }
      loadToday()
      notifyFinished(msg.lastResult)
    }
    // 预算告警只在「新的一条」弹出，避免快照每 5s 重复推同一条时反复通知。
    if (msg.alert && msg.alert.time !== prevAlertTime) {
      dismissedAlertTime = 0
      notifyAlert(msg.alert)
    }
    render()
  } catch (err) { /* ignore */ }
}
setInterval(tick, 1000)
loadToday()
setInterval(() => { if (!petHidden()) loadToday() }, 60000)

// 重新可见：久坐计时在隐藏期间停摆（restBaseTs 已陈旧），不重置就会立刻
// 误报「你坐了很久」——而隐藏期间到底有没有离开电脑我们并不知道（systemIdle
// 采样同样停了），所以保守地把计时重新开始。同时补一次状态刷新，避免 HUD
// 停在隐藏前的旧画面上（SSE 期间仍在更新 snap，这里只是重新渲染一遍）。
document.addEventListener('visibilitychange', () => {
  // 隐藏：漫游进行中要收手——busyRoam 不清的话，那个 async 循环睡醒后会继续
  // 发 roamTo 把窗口挪出去（主进程虽已停补间，页面却会重新驱动它）。
  if (petHidden()) { stopRoam(); return }
  restBaseTs = Date.now()
  restSnoozeUntil = 0
  lastNudge = Date.now() // 漫游计时同样重新开始，别一露头就跑出去
  if (snap) { render(); tick() }
  loadToday()
})

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
  renderHud()
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
// 失败/告警气泡的「知道了」：本地收起，不打断状态机。
$('bubbleDismiss').onclick = (e) => {
  e.stopPropagation()
  if (bubbleKind === 'alert' && snap && snap.alert) dismissedAlertTime = snap.alert.time
  flashPersist = false
  flashUntil = 0
  flashResult = null
  renderHud()
}

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
// 双击（320ms 内两下）= 举牌看余额；不延迟单击，抚摸照常先发生。
let lastPatAt = 0
let placardTimer = null
function hidePlacard() {
  if (placardTimer) { clearTimeout(placardTimer); placardTimer = null }
  const box = $('placard')
  if (box) box.hidden = true
  boardOpen = false
  document.body.classList.remove('board-open')
  if (snap) renderHud()
}
function showBalance() {
  if (!snap || (snap.settings && snap.settings.purePetMode)) return
  const box = $('placard')
  if (!box) return
  // 举牌期间把宠物整体下移（.board-open），牌子不再压住头顶；气泡暂时收起。
  boardOpen = true
  document.body.classList.add('board-open')
  renderHud()
  // 窗口很矮时牌子仍可能顶出窗口上沿：量一下实际位置，越界就整体下移，
  // 宁可压住一点头顶也不让字被切（正常 340×390 下不会触发）。
  const fitPlacard = () => {
    box.style.bottom = ''
    const rect = box.getBoundingClientRect()
    const overflow = Math.ceil(6 - rect.top)
    if (overflow > 0) box.style.bottom = 'calc(100% + ' + (10 - overflow) + 'px)'
  }
  const setState = (state, amt, cur, sub, todayText) => {
    box.dataset.state = state
    $('placardAmt').textContent = amt
    $('placardCur').textContent = cur
    $('placardSub').textContent = sub
    $('placardToday').textContent = todayText || ''
    fitPlacard()
  }
  box.hidden = false
  box.classList.remove('show'); void box.offsetWidth; box.classList.add('show')
  setState('muted', '查询中…', '', 'DeepSeek 账号', '')
  Promise.all([
    fetch('/api/balance?refresh=1').then((r) => r.json()).catch(() => null),
    fetch('/api/balance/summary?period=today').then((r) => r.json()).catch(() => null),
  ]).then((res) => {
    const b = res[0]
    const t = res[1]
    const sym = b && b.currency === 'USD' ? '$' : currencySymbol(snap.currency)
    const cur = b && b.currency ? b.currency : (snap.currency || 'CNY')
    // 余额台账没采到今天的快照时，退回任务费用估算（同一货币口径），别留空。
    const spent = t && t.samples > 0 && t.spent > 0 ? t.spent : (today && today.cost > 0 ? today.cost : 0)
    const todayText = spent > 0 ? '今日 −' + sym + Number(spent).toFixed(2) : ''
    if (!b || b.enabled === false) {
      setState('muted', '未开启', '', '设置 → 计费 → 余额台账', todayText)
      return
    }
    if (!b.ok) {
      setState('muted', '—', '', b.signedIn ? '暂时查不到余额' : '未登录 DeepSeek 账号', todayText)
      return
    }
    const bits = []
    if (Number(b.bonus) > 0) bits.push('赠金 ' + sym + Number(b.bonus).toFixed(2))
    bits.push(new Date(b.at || Date.now()).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
    // 低于告警阈值 → 警示态 + 副标题提示充值（阈值口径与 node 侧一致：normal+bonus）。
    const thr = snap && snap.settings && snap.settings.balance ? snap.settings.balance.lowBalance : null
    const total = Number(b.normal || 0) + Number(b.bonus || 0)
    if (thr > 0 && total <= thr) {
      bits.push('低于阈值 ' + sym + Number(thr).toFixed(2))
      setState('warn', Number(b.normal || 0).toFixed(2), cur, bits.join(' · '), todayText)
      return
    }
    setState('ok', Number(b.normal || 0).toFixed(2), cur, bits.join(' · '), todayText)
  }).catch(() => {
    setState('muted', '—', '', '伴侣服务未连接', '')
  })
  if (placardTimer) clearTimeout(placardTimer)
  placardTimer = setTimeout(hidePlacard, 5000)
}
function petReact() {
  const now = Date.now()
  if (now < dizzyUntil) return
  const doublePat = now - lastPatAt < 320
  lastPatAt = doublePat ? 0 : now
  if (doublePat) showBalance()
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
  const onPet = petImageReady() && !!(el && (el === pet || pet.contains(el)))
  // 气泡里的按钮浮在宠物本体之外，不收回交互就点不到。
  const onRest = !!(el && el.closest && el.closest('#restActions'))
  const onBubble = !!(el && el.closest && el.closest('#bubbleActions'))
  setInteractive(onPet || onRest || onBubble)
}
document.addEventListener('mousemove', (e) => {
  lastMouse.x = e.clientX; lastMouse.y = e.clientY
  // 鼠标在宠物身上打转也算「有人陪」——别在用户眼皮底下自己溜达。
  if (petImageReady() && e.target && e.target.closest && e.target.closest('#pet')) noteNudge()
  evalHover(e.clientX, e.clientY)
})

// 很轻的 3D 跟手：只在宠物图片正常时生效；拖拽/减少动画模式直接跳过。
const petRoot = $('pet')
const petTiltEl = $('petTilt')
function resetPetTilt() {
  if (petTiltEl) petTiltEl.style.transform = ''
}
function updatePetTilt(e) {
  if (!petTiltEl || !petImageReady() || busyDrag) return
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const r = petRoot.getBoundingClientRect()
  if (!r.width || !r.height) return
  const nx = Math.max(-1, Math.min(1, (e.clientX - r.left - r.width / 2) / (r.width / 2)))
  const ny = Math.max(-1, Math.min(1, (e.clientY - r.top - r.height / 2) / (r.height / 2)))
  petTiltEl.style.transform = 'perspective(560px) rotateX(' + (-ny * 1.6).toFixed(2) +
    'deg) rotateY(' + (nx * 2.4).toFixed(2) + 'deg)'
}
petRoot.addEventListener('pointermove', updatePetTilt)
petRoot.addEventListener('pointerleave', resetPetTilt)

// 空闲随机小动作：14 秒一拍、45% 概率——张望 / 伸懒腰 / 打瞌睡（带 💤 和梦话）。
setInterval(() => {
  if (!snap || snap.task || petHidden()) return
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
  // 读后端 settings（经 /api/state 下发）：面板与悬浮窗在 Electron 里是不同存储
  // 分区，localStorage 互不可见——旧实现存 localStorage 导致「面板关了还照样跑」。
  // snap 未就绪时按开处理（与默认值一致），SSE 首帧到了立刻纠正。
  if (!snap || !snap.settings) return true
  return snap.settings.roam !== false
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
    // 逛到一半被关掉也要立刻收手回原位（stopRoam 会 goHome），别把这一轮走完。
    if (!roamEnabled()) { stopRoam(); return }
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
  if (busyRoam || !roamEnabled() || petHidden()) return
  if (!snap || snap.task) return
  if (busyDrag) return
  if (restPromptUntil > 0) return
  if (snap.settings && snap.settings.showPet === false) return
  if (Date.now() - lastNudge < ROAM_IDLE_MS) return
  roamStart()
}, 5000)

// ---- 右键菜单已整体移除（用户 2026-10-21：「右击他会出选项，不要这个」）----
// 菜单里的入口都有更自然的位置：面板页签（任务/统计/会话/设置）、设置页开关
// （纯宠物模式 / 久坐提醒 / 点击穿透 / 自由活动）、托盘（显示隐藏/退出/回屏幕）。
// 宠物本体只响应左键抚摸与拖拽；右键什么都不弹（浏览器默认菜单也不拦）。
function loadState() {
  fetch('/api/state').then((r) => r.json()).then((data) => { snap = data; render() }).catch(() => {})
  loadSkinReactions()
}
loadState()
</script>
</body>
</html>`
}
