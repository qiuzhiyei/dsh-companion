/**
 * dsh-companion — 托盘控制器。
 *
 * 宿主（dsh-desktop-host，Node 模式进程）不向插件暴露 Electron 托盘 API
 * （托盘归 Electron 主进程私有），因此第一版托盘有两级实现：
 * 1. console 后端（默认）：没有原生托盘，动作只能从 /panel 面板与设置页端点触发，
 *    状态与告警打日志（宠物身上的右键菜单已于 2026-10-21 移除，别再指望它）；
 * 2. electron 后端（可选）：spawn Electron 壳进程（electron/main.cjs），
 *    由壳进程提供真正的托盘 + 透明置顶悬浮窗（同一 Web 页面）。
 *
 * 预算告警的 Windows Toast 也是这里 best-effort 触发（无需 Electron）。
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export interface TrayControllerOptions {
  serverUrl: string
  /** 预算告警是否尝试 Windows Toast。 */
  toast: boolean
  /** 'auto'：尝试拉起 Electron 壳；'off'：只用 console 后端。 */
  shell: 'off' | 'auto'
}

/** 托盘菜单（Electron 壳托盘提供；无壳时退化为日志）。 */
export interface TrayMenu {
  showHide: () => void
  togglePause: () => void
  history: () => void
  stats: () => void
  settings: () => void
  switchSkin: () => void
  exportData: () => void
  quit: () => void
}

export class TrayController {
  private shellProcess: ReturnType<typeof spawn> | null = null
  private toastCount = 0

  constructor(private readonly options: TrayControllerOptions) {}

  get backend(): 'electron' | 'console' {
    return this.shellProcess && this.shellProcess.exitCode === null ? 'electron' : 'console'
  }

  /** 尝试拉起 Electron 壳（shell: auto 且本机可解析 electron 时）。 */
  async start(menu: TrayMenu): Promise<void> {
    void menu // 菜单动作实际由 Web 页 / Electron 壳菜单触发，这里仅保形
    if (this.options.shell === 'auto') {
      await this.spawnElectronShell()
    }
    if (this.backend === 'console') {
      console.log(
        `[dsh-companion] tray(console): 伴侣面板 ${this.options.serverUrl} | 面板菜单提供：显示/隐藏、暂停统计、历史任务、统计面板、设置、切换皮肤、导出数据、退出`,
      )
    }
  }

  /**
   * 解析 Electron 可执行文件并启动壳进程（桌面悬浮窗 + 托盘）。
   *
   * 注意：不能复用 DSH 宿主的 Electron exe——打包过的应用（app.asar）
   * 永远只运行自己的主程序，脚本参数只会撞单实例锁后退出。必须用
   * “发行版 electron”（默认应用，可跑任意脚本），来源只有 npm 包
   * electron（用户 devDependency 自装，绝不自动安装）。
   * 找不到 → 浏览器页面模式（打印面板地址）。
   */
  private async spawnElectronShell(): Promise<void> {
    const electronDir = dirname(fileURLToPath(new URL('../../electron/main.cjs', import.meta.url)))
    const shellScript = join(electronDir, 'main.cjs')
    let electronBin: string | null = null
    try {
      const require = createRequire(import.meta.url)
      electronBin = require('electron') as unknown as string
    } catch {
      electronBin = null
    }
    if (!electronBin) {
      console.warn(
        '[dsh-companion] electron 未安装，伴侣以浏览器页面模式运行：' + this.options.serverUrl,
      )
      return
    }

    try {
      // 去掉 ELECTRON_RUN_AS_NODE，否则子进程仍是 node 模式（无窗口无托盘）。
      const childEnv: NodeJS.ProcessEnv = { ...process.env, PET_URL: this.options.serverUrl }
      delete childEnv.ELECTRON_RUN_AS_NODE
      const child = spawn(electronBin, [shellScript], {
        cwd: electronDir,
        env: childEnv,
        stdio: 'ignore',
        detached: true,
      })
      child.once('error', (error) => {
        console.warn(`[dsh-companion] electron 壳启动失败: ${String(error)}`)
        this.shellProcess = null
      })
      child.once('exit', (code) => {
        console.log(`[dsh-companion] electron 壳退出 (code=${code})`)
        this.shellProcess = null
      })
      child.unref()
      this.shellProcess = child
      console.log(`[dsh-companion] electron 伴侣壳已启动 → ${this.options.serverUrl}`)
    } catch (error) {
      console.warn(`[dsh-companion] spawn electron 失败: ${String(error)}`)
    }
  }

  /** 预算告警通知：日志 + Windows Toast（best-effort）。 */
  async notify(message: string): Promise<void> {
    console.warn(`[dsh-companion] ⚠ ${message}`)
    if (this.options.toast && this.toastCount < 8) {
      this.toastCount += 1
      await this.windowsToast(message)
    }
  }

  stop(): void {
    if (this.shellProcess && this.shellProcess.exitCode === null) {
      // 壳进程有自己的托盘退出入口；这里只解除引用（避免误杀用户窗口）。
      this.shellProcess.unref()
    }
    this.shellProcess = null
  }

  /** Windows Toast（PowerShell + WinRT，失败静默）。 */
  private async windowsToast(message: string): Promise<void> {
    if (process.platform !== 'win32') return
    const safe = message.replaceAll("'", '’').replaceAll('"', '”').replaceAll('\n', ' ')
    const script = [
      `$ErrorActionPreference='Stop'`,
      `try {`,
      `  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null`,
      `  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime] | Out-Null`,
      `  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument`,
      `  $xml.LoadXml('<toast><visual><binding template="ToastText02"><text id="1">DSH 伴侣</text><text id="2">${safe}</text></binding></visual></toast>')`,
      `  $toast = New-Object Windows.UI.Notifications.ToastNotification $xml`,
      `  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($toast)`,
      `} catch { exit 0 }`,
    ].join('\n')
    try {
      await new Promise<void>((resolvePromise) => {
        const child = spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
          { stdio: 'ignore', windowsHide: true },
        )
        const done = (): void => resolvePromise()
        child.once('error', done)
        child.once('exit', done)
        setTimeout(done, 4_000).unref()
      })
    } catch {
      // Toast 彻底不可用时静默：日志已兜底。
    }
  }
}
