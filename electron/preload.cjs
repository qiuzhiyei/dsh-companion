/**
 * dsh-companion — Electron 壳 preload。
 *
 * 只暴露最小 IPC 面：页面检测 window.petShell 判断壳环境、
 * 切换点击穿透、退出。contextIsolation 开启，无 nodeIntegration。
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('petShell', {
  isElectron: true,
  toggleClickThrough: () => ipcRenderer.invoke('pet-shell:toggle-click-through'),
  quit: () => ipcRenderer.invoke('pet-shell:quit'),
  onClickThroughChange: (listener) => {
    ipcRenderer.on('pet-shell:click-through', (_event, enabled) => listener(enabled))
  },
  // 拖窗（主进程跟手）：页面只发开始/结束，位移由主进程读系统光标算——
  // 渲染进程坐标在 175% 缩放等场景下不可信（曾导致「长按宠物自己跑走」）。
  dragStart: () => ipcRenderer.send('pet-shell:drag-start'),
  dragEnd: () => ipcRenderer.send('pet-shell:drag-end'),
  // 自由活动：页面给目标坐标 + 补间时长，主进程平滑挪窗并夹进屏幕工作区；
  // workArea 用来让页面在「整个屏幕」范围内随机挑点。
  roamTo: (x, y, ms) => ipcRenderer.send('pet-shell:roam-to', x, y, ms),
  roamStop: () => ipcRenderer.send('pet-shell:roam-stop'),
  workArea: () => ipcRenderer.invoke('pet-shell:work-area'),
  // 旧路径（仅兼容旧壳）：绝对锚定 moveTo + 读窗口位置 bounds，moveBy 为更早的增量版。
  bounds: () => ipcRenderer.invoke('pet-shell:bounds'),
  moveTo: (x, y) => ipcRenderer.send('pet-shell:move-to', x, y),
  moveBy: (dx, dy) => ipcRenderer.send('pet-shell:move-by', dx, dy),
  // 智能穿透：页面检测鼠标是否悬在宠物本体上，true = 放行周边（窗口忽略
  // 鼠标但转发 mousemove），false = 收回交互。全穿透模式下主进程会拒绝。
  setMouseIgnore: (ignore) => ipcRenderer.send('pet-shell:set-mouse-ignore', ignore),
  // 久坐提醒：系统级空闲秒数（键盘/鼠标多久没动了），判断人是否离开电脑。
  systemIdle: () => ipcRenderer.invoke('pet-shell:idle'),
  // 系统通知：长任务完成/失败、预算触顶。页面侧负责节流与开关（settings.notify）。
  notify: (title, body) => ipcRenderer.send('pet-shell:notify', title, body),
})
