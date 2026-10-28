/**
 * Electron 壳的窗口几何契约（多屏「桌宠失踪」修复）。
 *
 * 测的是 **main.cjs 里的真实代码**：把纯逻辑区段（尺寸常量 + isSaneSize +
 * loadBounds/saveBounds + defaultBounds/clampBounds）按行切出来，注入 stub
 * （screen / fs / win）后 eval。这样测的是真实逻辑而不是复制品——
 * 改了 main.cjs 的算法，这里会立刻失败。
 *
 * 事故背景：外接屏 DPI 与内屏不一致时窗口被撑到 2857×4558 并写进
 * pet-window.json；桌宠在窗口内居中，于是被顶到屏幕下方 2000+px「失踪」。
 * 旧 clampBounds 只夹坐标不夹尺寸，托盘「回到屏幕」也救不回来
 * （窗口左上角可见 ≠ 居中的宠物可见）。单屏不触发，所以只有多屏才复现。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const MAIN = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')

/** 真实用户数据（pet-window.json 里存过的畸形尺寸）。 */
const REAL_BROKEN = { x: 1, y: -1, width: 2857, height: 4558 }

// 单屏 1080p（100% 缩放）工作区。
const MONO = { x: 0, y: 0, width: 1920, height: 1040 }
// 双屏：内屏 1080p + 右侧 4K 外接屏（150% 缩放 → workArea 只有 2560×1440）。
const DUAL = [MONO, { x: 1920, y: 0, width: 2560, height: 1440 }]

/**
 * 构建被测环境。displays = 可用显示器工作区列表；
 * getDisplayMatching 按「与给定 bounds 相交面积最大」选屏（Electron 同语义）。
 */
function makeEnv(displays, { fileContent = null } = {}) {
  // 统一成 Electron 的 Display 形状（{ workArea }）：调用方可以只传裸工作区，
  // 避免 stub 内部两种约定混用（曾因直接读 d.workArea 而 undefined）。
  const normalized = displays.map((d) => (d && d.workArea ? d : { workArea: d }))
  const writes = []
  const screen = {
    getPrimaryDisplay: () => normalized[0],
    getDisplayMatching: (bounds) => {
      let best = null
      let bestArea = -1
      for (const d of normalized) {
        const a = d.workArea
        const ox = Math.max(0, Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x))
        const oy = Math.max(0, Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y))
        const area = ox * oy
        if (area > bestArea) { bestArea = area; best = d }
      }
      return best
    },
    getDisplayNearestPoint: (p) => {
      let best = null
      let bestD = Infinity
      for (const d of normalized) {
        const a = d.workArea
        const cx = a.x + a.width / 2
        const cy = a.y + a.height / 2
        const dist = (cx - p.x) ** 2 + (cy - p.y) ** 2
        if (dist < bestD) { bestD = dist; best = d }
      }
      return best
    },
  }
  const win = {
    _bounds: null,
    isDestroyed: () => false,
    getBounds() { return this._bounds },
    setBounds(b) { this._bounds = b },
  }
  const ctx = {
    win,
    screen,
    BOUNDS_FILE: 'stub.json',
    fs: {
      readFileSync: () => {
        if (fileContent === null) throw new Error('ENOENT')
        return fileContent
      },
      writeFileSync: (_p, data) => { writes.push(JSON.parse(data)) },
    },
    setTimeout: (...a) => globalThis.setTimeout(...a),
    clearTimeout: (...a) => globalThis.clearTimeout(...a),
    Math, Number, JSON, Object, Array, console,
  }
  // 注意：DEFAULT_W / MIN_W / isSaneSize 等由被测代码自己声明，**不能**放进 ctx
  // 当参数（参数名与函数体内的 const 重名会直接 SyntaxError）。

  // 提取真实代码：从尺寸常量块到 clampBounds 结束（onDisplaysChanged 之前）。
  const start = MAIN.indexOf('const DEFAULT_W')
  assert.ok(start > 0, 'main.cjs 缺 DEFAULT_W 常量块')
  const endMarker = MAIN.indexOf('function onDisplaysChanged')
  assert.ok(endMarker > start, 'main.cjs 缺 onDisplaysChanged 作为区段结束标记')
  const code = MAIN.slice(start, endMarker)

  const fn = new Function(...Object.keys(ctx), `"use strict";\n${code}\nreturn { loadBounds, saveBounds, clampBounds, defaultBounds, isSaneSize, MIN_W, MAX_W, MIN_H, MAX_H, DEFAULT_W, DEFAULT_H };`)
  const api = fn(...Object.values(ctx))
  // screen 也暴露：测试需要用它判定「夹回后落在哪块屏」。
  return { ...api, win, writes, screen, setBounds: (b) => { win._bounds = b } }
}

test('clampBounds: 真实事故数据（2857×4558）必须被夹回屏幕内', () => {
  const env = makeEnv([MONO])
  const c = env.clampBounds(REAL_BROKEN)
  assert.ok(c.width <= env.MAX_W, `宽度应夹进合理区间，实际 ${c.width}`)
  assert.ok(c.height <= env.MAX_H, `高度应夹进合理区间，实际 ${c.height}`)
  assert.ok(c.width <= MONO.width && c.height <= MONO.height, '不得大于所在屏工作区')
  // 桌宠在窗口内居中 → 宠物中心必须落在屏幕内（这才是「看得见」的判据）。
  const cx = c.x + c.width / 2
  const cy = c.y + c.height / 2
  assert.ok(cx >= MONO.x && cx <= MONO.x + MONO.width, `宠物中心 x=${cx} 应在屏内`)
  assert.ok(cy >= MONO.y && cy <= MONO.y + MONO.height, `宠物中心 y=${cy} 应在屏内（旧实现这里会跑到 2280）`)
  assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y), '坐标必须是有限数')
})

test('clampBounds: 双屏下畸形尺寸夹回所在屏，不越界到另一屏', () => {
  const env = makeEnv(DUAL)
  // 窗口在副屏（4K）上被撑大。
  const c = env.clampBounds({ x: 2500, y: 400, width: 2857, height: 4558 })
  assert.ok(c.width <= env.MAX_W && c.height <= env.MAX_H, '尺寸应夹回合理区间')
  const area = env.screen.getDisplayMatching(c).workArea
  assert.ok(c.x >= area.x && c.x + c.width <= area.x + area.width, '应完整落在夹后所在屏内')
  assert.ok(c.y >= area.y && c.y + c.height <= area.y + area.height, '纵向也应完整落在屏内')
  // 宠物中心可见。
  const cy = c.y + c.height / 2
  assert.ok(cy >= area.y && cy <= area.y + area.height, '宠物中心应在屏内')
})

test('clampBounds: 坐标跑飞（拔屏后残留）仍夹回屏内，老 y=-561 事故不复现', () => {
  const env = makeEnv([MONO])
  const c = env.clampBounds({ x: 500, y: -561, width: 300, height: 340 })
  assert.ok(c.y >= MONO.y - (340 - 60), '至多保留 60px 在屏内（老口径）')
  assert.ok(c.y <= MONO.y + MONO.height - 60, '不得掉出屏幕底部')
  assert.ok(c.x >= MONO.x - (300 - 80) && c.x <= MONO.x + MONO.width - 80, '横向至少 80px 可见')
})

test('clampBounds: 非法坐标（NaN/null）回落默认位，绝不把 NaN 传给原生层', () => {
  const env = makeEnv([MONO])
  for (const bad of [{ x: NaN, y: 100, width: 300, height: 340 }, { x: null, y: undefined, width: 300, height: 340 }]) {
    const c = env.clampBounds(bad)
    assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y), `坐标必须有限，输入 ${JSON.stringify(bad)}`)
    assert.ok(Number.isFinite(c.width) && Number.isFinite(c.height))
    assert.ok(c.x >= MONO.x - c.width && c.x <= MONO.x + MONO.width, '应落在屏内')
  }
})

test('clampBounds: 合法尺寸原样保留（不能把正常窗口也改了）', () => {
  const env = makeEnv(DUAL)
  const ok = { x: 1850, y: 660, width: 300, height: 340 }
  const c = env.clampBounds(ok)
  assert.equal(c.width, 300)
  assert.equal(c.height, 340)
  assert.equal(c.x, ok.x, '屏内合法位置不该被挪')
  assert.equal(c.y, ok.y)
})

test('loadBounds: 畸形尺寸整份丢弃（否则失踪状态会复制到下次启动）', () => {
  const env = makeEnv([MONO], { fileContent: JSON.stringify(REAL_BROKEN) })
  assert.equal(env.loadBounds(), null, '真实事故数据必须判为无效并回落默认')
})

test('loadBounds: 各类脏数据都不许放行', () => {
  const cases = [
    ['null 字面量', 'null'],
    ['数组', '[1,2,3]'],
    ['缺字段', JSON.stringify({ x: 10, y: 20 })],
    ['尺寸为 0', JSON.stringify({ x: 10, y: 20, width: 0, height: 0 })],
    ['负尺寸', JSON.stringify({ x: 10, y: 20, width: -300, height: -340 })],
    ['超上限宽', JSON.stringify({ x: 10, y: 20, width: 5000, height: 340 })],
    ['超上限高', JSON.stringify({ x: 10, y: 20, width: 300, height: 5000 })],
    ['NaN 坐标', '{"x":NaN,"y":20,"width":300,"height":340}'],
    ['字符串尺寸', JSON.stringify({ x: 10, y: 20, width: '300', height: '340' })],
    ['坏 JSON', '{oops'],
  ]
  for (const [name, content] of cases) {
    const env = makeEnv([MONO], { fileContent: content })
    assert.equal(env.loadBounds(), null, `${name} 应判为无效`)
  }
})

test('loadBounds: 合法数据照常读回', () => {
  const good = { x: 1600, y: 660, width: 300, height: 340 }
  const env = makeEnv([MONO], { fileContent: JSON.stringify(good) })
  assert.deepEqual(env.loadBounds(), good)
})

test('saveBounds: 畸形尺寸拒绝落盘，合法尺寸正常写', () => {
  const env = makeEnv([MONO])
  env.setBounds(REAL_BROKEN)
  env.saveBounds()
  assert.equal(env.writes.length, 0, '畸形尺寸绝不能写进位置记忆文件')

  env.setBounds({ x: 1600, y: 660, width: 300, height: 340 })
  env.saveBounds()
  assert.equal(env.writes.length, 1)
  assert.deepEqual(env.writes[0], { x: 1600, y: 660, width: 300, height: 340 })
})

test('源码契约: 窗口禁止用户拉伸/最大化/全屏（尺寸只能由 scale 决定）', () => {
  // 尺寸畸形是失踪根因，必须从源头堵住：手动拉伸过的窗口再也算不回来，
  // 还会让居中的宠物偏离视觉中心。
  assert.ok(MAIN.includes('resizable: false'), '必须禁用拖拽调整尺寸')
  assert.ok(MAIN.includes('maximizable: false'), '必须禁用最大化（会撑满整屏）')
  assert.ok(MAIN.includes('fullscreenable: false'), '必须禁用全屏')
  assert.ok(!/resizable:\s*true/.test(MAIN), '不得残留 resizable: true')
})

test('源码契约: 显示器变化必须重新夹回（拔插外接屏是多屏失踪的直接触发点）', () => {
  assert.ok(MAIN.includes('function onDisplaysChanged'), '缺显示器变化处理函数')
  for (const ev of ['display-removed', 'display-added', 'display-metrics-changed']) {
    assert.ok(MAIN.includes(`screen.on('${ev}'`), `缺 ${ev} 监听（改分辨率/DPI/拔屏后宠物会滞留旧坐标）`)
  }
  const body = MAIN.slice(MAIN.indexOf('function onDisplaysChanged'))
    .slice(0, 400)
  assert.ok(body.includes('clampBounds'), '显示器变化后必须重新夹回屏幕')
})

test('源码契约: 所有 setBounds 调用都必须过 clampBounds 或 safeSetBounds', () => {
  // 裸 win.setBounds 会绕过尺寸校验（正是旧实现让 2857×4558 溜进去的原因）。
  assert.ok(!/win\.setBounds\(/.test(MAIN), '不应有裸 win.setBounds 调用')
  // scale 改尺寸那条路径也要过夹子（多屏下直接 setBounds 可能落在屏外）。
  const at = MAIN.indexOf('Math.abs(b.width - w) > 4')
  assert.ok(at > 0, '缺看门狗 scale 尺寸同步逻辑')
  const seg = MAIN.slice(at, at + 400)
  assert.ok(seg.includes('clampBounds({ x: b.x, y: b.y, width: w, height: h })'),
    'scale 改尺寸必须过 clampBounds')
})

test('源码契约: 「伴侣回到屏幕」必须传送到右上角锚点（旧 clamp 对屏内角落无效）', () => {
  // 真实反馈（2026-10-28）：宠物在屏幕角落时点救援毫无反应——旧实现只做
  // clampBounds，屏内坐标夹取 = 无操作。现制一点 = 传送到固定可预期位置。
  assert.ok(MAIN.includes('function homeAnchorBounds'), '缺右上角锚点计算')
  assert.ok(MAIN.includes('HOME_MARGIN'), '锚点应留边距（别贴边压住圆角/摄像头区）')
  // 锚点取「最近屏幕」而非主屏：宠物在副屏角落时回副屏右上角。
  assert.ok(
    MAIN.slice(MAIN.indexOf('function homeAnchorBounds')).slice(0, 900)
      .includes('getDisplayNearestPoint'),
    '锚点应基于窗口所在（最近）屏幕',
  )
  // 救援 = 锚点 + 夹取 + 显示 + 持久化（救回的位置别重启又丢）。
  const at = MAIN.indexOf('function bringBackToScreen')
  assert.ok(at > 0, '缺救援函数')
  const body = MAIN.slice(at, at + 400)
  assert.ok(body.includes('homeAnchorBounds()'), '救援必须用锚点，不能只 clamp 当前 bounds')
  assert.ok(body.includes('clampBounds('), '锚点也要过夹子兜底')
  assert.ok(body.includes('win.show()'), '救援应显示窗口')
  assert.ok(body.includes('scheduleSaveBounds()'), '救回的位置应持久化')
  // 旧实现（只 clamp 当前 bounds）不得残留为救援主体。
  assert.ok(!/function bringBackToScreen[\s\S]{0,200}clampBounds\(win\.getBounds\(\)\)/.test(MAIN),
    '救援不得退回「只夹当前坐标」（屏内角落点了没反应）')
})

test('源码契约: 尺寸校验有单一事实来源（isSaneSize + 共用常量）', () => {
  assert.ok(MAIN.includes('function isSaneSize'), '缺统一的尺寸合法性判定')
  // 旧的宽松上限 8000 必须清掉，否则畸形尺寸又能溜过去。
  assert.ok(!MAIN.includes('> 8000'), '不应残留旧的宽松上限 8000')
  for (const name of ['MIN_W', 'MIN_H', 'MAX_W', 'MAX_H', 'DEFAULT_W', 'DEFAULT_H']) {
    assert.ok(new RegExp(`const ${name} =`).test(MAIN), `缺常量 ${name}`)
  }
  // loadBounds / saveBounds / safeSetBounds / clampBounds 都要用同一个判定。
  const users = ['loadBounds', 'saveBounds', 'safeSetBounds', 'clampBounds']
  for (const fn of users) {
    const at = MAIN.indexOf(`function ${fn}(`)
    assert.ok(at > 0, `缺 ${fn}`)
    const body = MAIN.slice(at, at + 900)
    assert.ok(body.includes('isSaneSize') || body.includes('MIN_W'),
      `${fn} 必须用统一的尺寸校验，不能各写一套`)
  }
})
