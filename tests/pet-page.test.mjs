/**
 * 桌宠交互契约（dist/ui/pages.js petPageHTML + electron 壳 IPC 面）。
 *
 * 交互全部是 CSS transform 动画 + DOM 粒子（不加皮肤素材）：
 * 抚摸挤压、连点晕头彩蛋、拖拽落地摇晃、空闲随机小动作；
 * Electron 模式宠物本体 no-drag，拖窗走 petShell.moveBy IPC；
 * 命中区域 = 宠物本体（周边透明区智能穿透，set-mouse-ignore IPC）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { petPageHTML, panelPageHTML } from '../dist/ui/pages.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('桌宠页：交互动画、粒子与台词包齐全（台词跟皮肤走）', () => {
  const html = petPageHTML()
  for (const kf of ['pet-squish', 'pet-wobble', 'pet-look', 'pet-stretch', 'pet-doze', 'pet-walk', 'pet-float']) {
    assert.ok(html.includes('@keyframes ' + kf), '缺少动画 ' + kf)
  }
  assert.ok(html.includes('pet-particle'), '粒子元素样式')
  for (const fn of ['function petReact', 'function landingReact', 'function sayLine', 'function spawnParticles', 'function playAnim', 'function skinLines', 'function roamStart', 'function stopRoam', 'function roamMoveTo']) {
    assert.ok(html.includes(fn), '缺少 ' + fn)
  }
  // 自由活动：闲时自己逛——整个屏幕随机跑，被打断立刻回原位（不回就会越飘越远）。
  assert.ok(html.includes('function roamEnabled'), '缺自由活动开关')
  assert.ok(html.includes('function goHome'), '缺回原位实现')
  assert.ok(html.includes('goHome(450)'), '打断时必须立刻回原位')
  assert.ok(html.includes('function roamPick'), '缺屏幕内随机取点')
  assert.ok(html.includes('ROAM_SPEED'), '走速必须可调（慢慢跑，不是瞬移）')
  assert.ok(html.includes('workArea'), '取点应基于屏幕工作区')
  // 右键菜单整体移除（用户 2026-10-21：「右击他会出选项，不要这个」）；
  // 原来只存在于菜单里的「自由活动」搬到面板设置页。
  assert.ok(!html.includes('MENU_ITEMS'), '右键菜单应已删除')
  assert.ok(!html.includes('contextmenu'), '不应再拦右键事件')
  assert.ok(!html.includes('id="menu"'), '菜单 DOM 应已删除')
  const panelForRoam = panelPageHTML()
  assert.ok(panelForRoam.includes('id="setRoam"'), '自由活动开关应在面板设置（伴侣组）')
  assert.ok(panelForRoam.includes("localStorage.setItem('pet.roam'"), '面板改的是同一个 pet.roam 偏好')
  assert.ok(html.includes("localStorage.getItem('pet.roam')"), '悬浮页仍从 pet.roam 读开关')
  assert.ok(html.includes('if (busyRoam || !roamEnabled()) return'), '调度器应避开进行中/已关闭')
  // 台词跟皮肤走：五套服装各挂一包（JK→学院、OL→总裁、女警/旗袍→御姐、
  // 中华娘→古风），未列皮肤（自制）退回 default；每类台词都有货。
  assert.ok(html.includes('const LINE_PACKS'), '缺少台词包')
  assert.ok(html.includes('const SKIN_LINES'), '缺少皮肤→台词包映射')
  for (const skin of ['whale', 'whale-ol', 'whale-police', 'whale-hanfu', 'whale-qipao']) {
    assert.ok(html.includes("'" + skin + "':"), 'SKIN_LINES 缺皮肤 ' + skin)
  }
  for (const pack of ['default', 'yujie', 'ceo', 'academy', 'gufeng']) {
    assert.ok(new RegExp(pack + ':\\s*\\{').test(html), 'LINE_PACKS 缺台词包 ' + pack)
  }
  for (const cat of ['idle:', 'work:', 'dizzy:', 'land:', 'doze:', 'rest:', 'roam:']) {
    const count = html.split(cat).length - 1
    assert.ok(count >= 5, '台词类别 ' + cat + ' 覆盖不全（' + count + '/5）')
  }
  assert.ok(!html.includes('loli'), '萝莉包（无服装可挂）应已删除')
  // 纯宠物模式：台词必须让路（sayLine 里检查 purePetMode）
  assert.ok(html.includes('purePetMode) return'), 'sayLine 必须在纯宠物模式下静默')
  assert.ok(!html.includes('${'), '嵌入 JS 只能字符串拼接')
})

test('台词风格系统已退役：换装即换口吻，无独立切换入口', () => {
  const panel = panelPageHTML()
  assert.ok(!panel.includes('setPersona'), '面板不应再有台词风格下拉')
  assert.ok(!panel.includes('petPersona'), '面板不应再引用 petPersona')
  const pet = petPageHTML()
  assert.ok(!pet.includes('切换台词风格'), '右键菜单不应再有循环切换项')
  assert.ok(!pet.includes('petPersona'), '悬浮页不应再引用 petPersona')
  assert.ok(!pet.includes('PERSONA_ORDER'), '人格循环常量应已删除')
})

test('桌宠页：互动反应帧接线（点有反应、拖有脾气）', () => {
  const html = petPageHTML()
  for (const fn of ['function showReaction', 'function clearReaction', 'function loadSkinReactions']) {
    assert.ok(html.includes(fn), '缺少 ' + fn)
  }
  // 四个互动点都接了反应帧：抚摸 1.5s / 晕头 3s（撑满冷静期）/ 拖拽常驻 / 落地生气 2s
  assert.ok(html.includes("showReaction('pat', 1500)"), '抚摸未接 pat 帧')
  assert.ok(html.includes("showReaction('dizzy', 3000)"), '连点彩蛋未接 dizzy 帧')
  assert.ok(html.includes("showReaction('drag', 0)"), '拖拽未接 drag 帧（ms=0 常驻到落地）')
  assert.ok(html.includes("showReaction('angry', 2000)"), '拖拽落地未接 angry 帧')
  // 无反应帧的皮肤（自制皮肤）退回纯 CSS 动画：可用性判定必须存在
  assert.ok(html.includes('reactions.indexOf(name) < 0'), '缺反应帧可用性判定（向后兼容回退）')
  // 状态帧优先：applySkin 切状态时必须顶掉反应帧并清计时
  assert.ok(html.includes('if (reactionTimer) { clearTimeout(reactionTimer); reactionTimer = null }'), 'applySkin 应撤销在途反应帧')
})

test('桌宠页：久坐提醒（健康提醒）接线', () => {
  const html = petPageHTML()
  for (const marker of ['function restCheck', 'function restRemind', 'restBaseTs']) {
    assert.ok(html.includes(marker), '缺少 ' + marker)
  }
  // 墙钟计时：不看任务在不在跑（读代码时 DSH 空闲也要算坐着）
  assert.ok(!/if \(snap\.task\) \{[^}]*rest/.test(html), '计时不应依赖任务运行')
  // 真实系统空闲：Electron IPC + 离开 ≥3 分钟归零
  assert.ok(html.includes('systemIdle'), '未接系统空闲 IPC')
  assert.ok(html.includes('restIdleSec >= IDLE_RESET_SEC'), '离开 3 分钟应归零')
  // 两个出口：起来走走 / 稍后 10 分钟；按钮浮在气泡里需收回鼠标交互
  assert.ok(html.includes('id="restWalk"'), '缺「起来走走」按钮')
  assert.ok(html.includes('id="restLater"'), '缺「稍后」按钮')
  assert.ok(html.includes("el.closest('#restActions')"), '气泡按钮需要收回鼠标交互')
  assert.ok(html.includes('restPromptUntil'), '缺提醒提示态')
  assert.ok(html.includes("skinLines('rest')"), '到点应说 rest 台词')
  const panel = panelPageHTML()
  assert.ok(panel.includes('id="setRestMinutes"'), '面板缺提醒间隔输入')
  assert.ok(panel.includes('id="setRestEnabled"'), '面板缺启用开关')
  assert.ok(panel.includes('久坐提醒'), '面板卡片文案')
  assert.ok(panel.includes('put({ restReminder:'), '面板改动应即时 PUT')
  // 右键菜单已删除：面板文案里不能再出现「右键菜单」这种指向已删入口的说明，
  // 久坐重置口径写成「起来走走 / 离开电脑自动重算」。
  assert.ok(!panel.includes('右键菜单'), '面板文案不应再提右键菜单')
  assert.ok(panel.includes('起来走走或离开电脑会自动重算'), '久坐提醒说明应写清自动重算口径')
  // 壳侧：系统空闲走 powerMonitor（GetLastInputInfo 语义）
  const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')
  const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8')
  assert.ok(main.includes('powerMonitor.getSystemIdleTime'), '主进程需暴露系统空闲')
  assert.ok(main.includes("'pet-shell:idle'"), '主进程缺 idle IPC')
  assert.ok(preload.includes('systemIdle'), 'preload 缺 systemIdle 桥')
})

test('桌宠页：Electron 模式宠物 no-drag + 主进程跟手拖窗', () => {
  const html = petPageHTML()
  assert.ok(html.includes('body.electron #pet'), '宠物本体需 no-drag 才能收点击')
  assert.ok(html.includes('-webkit-app-region: no-drag'), 'no-drag 声明')
  // 位移全权交给主进程：页面只发 dragStart/dragEnd，不再用 screenX 算位移
  // （175% 缩放等非整数 DPR 下渲染进程坐标会放大位移 → 长按宠物自己跑走）。
  assert.ok(html.includes('window.petShell.dragStart'), '越过阈值应通知主进程开始跟手')
  assert.ok(html.includes('window.petShell.dragEnd'), '松手/丢捕获应通知主进程停止跟手')
  assert.ok(html.includes('if (pd.moved) return'), '开拖后页面不再插手位移')
  assert.ok(html.includes('DRAG_PX'), '拖拽阈值应集中成一个常量')
  // 防滑走兜底：按键已松开 / 丢失指针捕获都要收尾，别留着残缺的拖拽状态
  assert.ok(html.includes('e.buttons === 0'), '按键松开必须收尾')
  assert.ok(html.includes('lostpointercapture'), '丢失指针捕获也要收尾')
  // 点击与长按都触发抚摸，拖拽落地摇晃
  assert.ok(html.includes('petReact()'), '点击触发抚摸')
  assert.ok(html.includes('landingReact()'), '拖拽落地触发摇晃')
})

test('Electron 壳：拖拽跟手 IPC 面完整', async () => {
  const preload = await readFile(join(ROOT, 'electron', 'preload.cjs'), 'utf8')
  const main = await readFile(join(ROOT, 'electron', 'main.cjs'), 'utf8')
  assert.ok(preload.includes("ipcRenderer.send('pet-shell:drag-start'"), 'preload 暴露 dragStart')
  assert.ok(preload.includes("ipcRenderer.send('pet-shell:drag-end'"), 'preload 暴露 dragEnd')
  assert.ok(main.includes("ipcMain.on('pet-shell:drag-start'"), 'main 处理 drag-start')
  assert.ok(main.includes("ipcMain.on('pet-shell:drag-end'"), 'main 处理 drag-end')
  // 跟手真值 = 系统光标（不是渲染进程 screenX），且必须过屏幕夹子
  assert.ok(main.includes('screen.getCursorScreenPoint()'), '跟手必须读系统光标')
  const dragBody = main.slice(main.indexOf("ipcMain.on('pet-shell:drag-start'")).slice(0, 900)
  assert.ok(dragBody.includes('clampBounds'), '跟手挪窗必须夹回屏幕')
  assert.ok(dragBody.includes('safeSetPosition'), '跟手挪窗必须走 safeSetPosition（非法坐标不许喂原生层）')
  // 壳自我重启：壳文件（main/preload）比进程新就 relaunch 一次，
  // 否则 DSH 快速重启时壳存活，会继续跑旧 preload（「改了没用」的经典陷阱）。
  assert.ok(main.includes('function relaunchIfStale'), '缺壳自我重启')
  assert.ok(main.includes('app.relaunch()'), '壳过期应 relaunch')
  assert.ok(main.includes('relaunchIfStale()'), '看门狗应检查壳是否过期')
  // 自由活动：主进程做平滑补间并夹进目标屏幕工作区，且位置写盘要节流
  assert.ok(preload.includes("ipcRenderer.send('pet-shell:roam-to'"), 'preload 暴露 roamTo')
  assert.ok(preload.includes("ipcRenderer.send('pet-shell:roam-stop'"), 'preload 暴露 roamStop')
  assert.ok(preload.includes("ipcRenderer.invoke('pet-shell:work-area'"), 'preload 暴露 workArea')
  assert.ok(main.includes("ipcMain.handle('pet-shell:work-area'"), 'main 提供屏幕工作区')
  const roamBody = main.slice(main.indexOf("ipcMain.on('pet-shell:roam-to'")).slice(0, 2500)
  assert.ok(roamBody.includes('getDisplayNearestPoint'), '自由活动应夹进目标屏幕工作区')
  assert.ok(roamBody.includes('safeSetPosition'), '自由活动补间必须走 safeSetPosition')
  assert.ok(main.includes("ipcMain.on('pet-shell:roam-stop'"), 'main 处理 roam-stop')
  assert.ok(main.includes('function scheduleSaveBounds'), '位置写盘必须节流（补间每秒几十次 moved）')
  // 主进程异常兜底（真实事故：自由活动时 setPosition 收到非法坐标，补间里每 16ms 抛一次
  // → Electron 每抛一次弹一个「A JavaScript error occurred in the main process」模态框，
  // 用户看到的就是「偶尔多次弹窗」）。坐标必须校验，异常只记日志不弹框。
  assert.ok(main.includes("process.on('uncaughtException'"), '主进程需兜底未捕获异常（不弹模态框）')
  assert.ok(main.includes('function safeSetPosition'), '缺安全的 setPosition 包装')
  assert.ok(main.includes('function safeSetBounds'), '缺安全的 setBounds 包装')
  assert.ok(main.includes('Number.isFinite(nx)'), 'setPosition 包装必须校验坐标')
  assert.ok(!/win\.setPosition\(/.test(main), '不应再有裸 win.setPosition 调用')
  assert.ok(!/win\.setBounds\(/.test(main), '不应再有裸 win.setBounds 调用')
  // 旧 IPC 保留兼容
  assert.ok(preload.includes("ipcRenderer.send('pet-shell:move-by'"), 'preload 仍暴露 moveBy')
  assert.ok(main.includes("ipcMain.on('pet-shell:move-by'"), 'main 仍处理挪窗')
  assert.ok(main.includes('safeSetPosition(win, c.x, c.y)'), '旧 moveBy 挪窗也要走包装')
  assert.ok(main.includes("ipcMain.handle('pet-shell:bounds'"), 'main 提供窗口位置')
  // 屏幕夹子：启动恢复/显示/moveBy 三条路径都必须过 clampBounds
  // （真实事故：窗口被拖到 y=-561 屏幕外，重启后桌宠"失踪"）。
  assert.ok(main.includes('function clampBounds'), '缺屏幕夹子 clampBounds')
  assert.ok(main.includes('clampBounds({ ...defaultBounds(), ...loadBounds() })'), '启动恢复必须夹回屏幕')
  assert.ok(main.includes('伴侣回到屏幕'), '托盘缺救援菜单项')
  const moveByBody = main.slice(main.indexOf("ipcMain.on('pet-shell:move-by'"))
  assert.ok(moveByBody.includes('clampBounds'), 'moveBy 挪窗必须夹回屏幕')
  // 系统通知：长任务完成/失败、预算触顶（短任务不打扰，页面侧节流）
  assert.ok(preload.includes("ipcRenderer.send('pet-shell:notify'"), 'preload 暴露 notify')
  assert.ok(main.includes("ipcMain.on('pet-shell:notify'"), 'main 处理 notify')
  assert.ok(main.includes('new Notification('), 'main 应投递系统通知')
  assert.ok(main.includes('setAppUserModelId'), 'Windows 需 AppUserModelId 才显示 toast')
  const page = petPageHTML()
  assert.ok(page.includes('function canNotify'), '缺通知开关判定')
  assert.ok(page.includes('snap.settings.notify !== false'), '通知应受 settings.notify 门控')
  assert.ok(page.includes('notifyFinished') && page.includes('notifyAlert'), '完成/预算两类通知')
  assert.ok(page.includes('dur < 60000'), '短任务不弹系统通知（避免刷屏）')
  assert.ok(page.includes('msg.alert.time !== prevAlertTime'), '预算告警只在新增时通知')
})

test('命中区域 = 宠物本体：周边透明区不再可拖/可点（智能穿透）', async () => {
  const html = petPageHTML()
  // Electron 舞台不再是原生拖拽区（旧版整窗 drag——周边透明区也能拖走窗口，
  // 用户明确吐槽范围太广）。把 no-drag 先剔掉再断言，避免子串误判。
  assert.ok(!html.replace(/no-drag/g, '').includes('-webkit-app-region: drag'), '舞台必须不再是原生拖拽区')
  // 智能穿透：elementFromPoint 命中判定 + setMouseIgnore IPC
  assert.ok(html.includes('document.elementFromPoint'), '缺悬停命中判定')
  assert.ok(html.includes('setMouseIgnore'), '页面缺 setMouseIgnore 调用')
  // 右键菜单已整体移除（用户要求），页面不再拦右键事件
  assert.ok(!html.includes('addEventListener(\'contextmenu\''), '不应再监听右键')
  // 两种模式的拖拽都绑在宠物本体上（不再有 stage.addEventListener('pointerdown')）
  assert.ok(!html.includes("stage.addEventListener('pointerdown'"), '浏览器模式拖拽必须绑宠物本体')
  assert.ok(html.includes("petEl.addEventListener('pointerdown'"), '拖拽必须绑宠物本体')
  // 气泡纯展示，不吃鼠标
  assert.ok(/#bubble \{[^}]*pointer-events: none/.test(html), '气泡应 pointer-events:none')
  // 壳侧 IPC 面
  const preload = await readFile(join(ROOT, 'electron', 'preload.cjs'), 'utf8')
  const main = await readFile(join(ROOT, 'electron', 'main.cjs'), 'utf8')
  assert.ok(preload.includes("ipcRenderer.send('pet-shell:set-mouse-ignore'"), 'preload 暴露 setMouseIgnore')
  assert.ok(main.includes("ipcMain.on('pet-shell:set-mouse-ignore'"), 'main 处理智能穿透')
  assert.ok(main.includes('if (clickThrough) return'), '全穿透模式必须拒绝页面收回交互')
  assert.ok(main.includes('setIgnoreMouseEvents(true, { forward: true })'), '窗口常态必须是穿透基线')
})

test('悬浮页：滚轮缩放必须按住 Ctrl（点击穿透下滚轮会转发进来，裸滚轮=误触）', () => {
  const page = petPageHTML()
  const at = page.indexOf("addEventListener('wheel'")
  assert.ok(at > 0, '缺 wheel 监听')
  const body = page.slice(at, at + 700)
  assert.ok(body.includes('e.ctrlKey'), '滚轮缩放必须要求 ctrlKey')
  assert.ok(body.includes('e.preventDefault()'), '命中时 preventDefault，否则浏览器模式会连带缩放整页')
  assert.ok(body.includes('passive: false'), 'preventDefault 要求非 passive 监听')
  // 护栏：先判断修饰键再改 scale，别让裸滚轮走到 setScale 分支
  const ctrlAt = body.indexOf('e.ctrlKey')
  const nextAt = body.indexOf('snap.settings.scale +')
  assert.ok(ctrlAt > 0 && nextAt > ctrlAt, '修饰键判断必须在改 scale 之前')
})