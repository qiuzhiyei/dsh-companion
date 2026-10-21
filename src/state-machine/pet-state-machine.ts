/**
 * dsh-companion — 伴侣动画状态机。
 *
 * 消费 PetEvent，产出 PetState 转移；纯内存逻辑，自带收尾冷却定时器
 * （dispose() 清理）。状态含义见 types.ts / README。
 *
 * 转移表（核心，皮肤无关）：
 *   task-start   → casting   （任务启动）
 *   model-start  → waiting   （模型思考）
 *   stream/tool  → hooked    （输出/工具执行）
 *   model-end 且无工具在跑 → reeling（收尾）
 *   task-end     → done | error | interrupted（完成 / 出错 / 中断）
 *   冷却超时     → idle     （回待机）
 *
 * 状态文案：默认是中性监测文案（STATE_LABELS）；皮肤 manifest 的
 * labels 字段可按人设覆盖（皮肤自带文案），由编排层注入。
 */

import type { PetEvent, TaskRef } from '../adapter/types.js'
import type { PetState, TaskOutcome } from '../types.js'

export interface PetStateMachineOptions {
  /** 终态展示时长（毫秒），超时回 idle。 */
  settleMs?: number
  /** 状态切换回调。 */
  onStateChange?: (from: PetState, to: PetState, cause: string) => void
  /** 皮肤覆盖的状态文案（缺省回落 STATE_LABELS）。 */
  labels?: Partial<Record<PetState, string>>
}

const OUTCOME_STATE: Record<TaskOutcome, PetState> = {
  running: 'waiting',
  success: 'done',
  failed: 'error',
  interrupted: 'interrupted',
  blocked: 'done',
  'max-tokens': 'done',
}

/** 默认（中性·监测）状态文案；皮肤可用 manifest.labels 覆盖。 */
export const STATE_LABELS: Readonly<Record<PetState, string>> = {
  idle: '待机中',
  casting: '任务启动',
  waiting: '模型思考中…',
  hooked: '输出 / 工具执行中',
  reeling: '收尾中…',
  done: '任务完成',
  error: '任务出错',
  interrupted: '任务中断',
}

export class PetStateMachine {
  private state: PetState = 'idle'
  private stateCause = 'init'
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  private readonly settleMs: number
  private readonly onStateChange?: (from: PetState, to: PetState, cause: string) => void
  /** 皮肤覆盖文案（当前状态命中则优先于 STATE_LABELS）。 */
  private skinLabels: Partial<Record<PetState, string>> = {}
  /** 各任务当前在跑的工具数（sessionId:turn → count）。 */
  private readonly activeTools = new Map<string, number>()
  private disposed = false

  constructor(options: PetStateMachineOptions = {}) {
    this.settleMs = options.settleMs ?? 8_000
    this.onStateChange = options.onStateChange
    this.skinLabels = options.labels ?? {}
  }

  get current(): PetState {
    return this.state
  }

  get label(): string {
    return this.skinLabels[this.state] ?? STATE_LABELS[this.state]
  }

  /** 皮肤切换时注入新文案（未覆盖的状态回落默认）。 */
  setLabels(labels: Partial<Record<PetState, string>>): void {
    this.skinLabels = labels ?? {}
  }

  /** 任务终态在终态画面停留的时长内不再回 idle（供展示“本次快照”）。 */
  isSettling(): boolean {
    return this.settleTimer !== null
  }

  handle(event: PetEvent): void {
    if (this.disposed) return
    switch (event.kind) {
      case 'task-start':
        this.clearSettle()
        this.transition('casting', `task-start ${taskKey(event.task)}`)
        break
      case 'model-start':
        this.clearSettle()
        if (this.state !== 'hooked') this.transition('waiting', 'model-start')
        break
      case 'stream-activity':
        this.clearSettle()
        this.transition('hooked', 'stream-activity')
        break
      case 'tool-start': {
        this.clearSettle()
        const key = taskKey(event.task)
        this.activeTools.set(key, (this.activeTools.get(key) ?? 0) + 1)
        this.transition('hooked', `tool-start ${event.name}`)
        break
      }
      case 'tool-end': {
        const key = taskKey(event.task)
        const count = (this.activeTools.get(key) ?? 1) - 1
        if (count <= 0) this.activeTools.delete(key)
        else this.activeTools.set(key, count)
        if (count <= 0 && this.state === 'hooked') {
          this.transition('waiting', 'tool-end')
        }
        break
      }
      case 'model-end': {
        const key = taskKey(event.task)
        const tools = this.activeTools.get(key) ?? 0
        if (tools === 0) this.transition('reeling', 'model-end')
        break
      }
      case 'task-end': {
        const key = taskKey(event.task)
        this.activeTools.delete(key)
        const next = OUTCOME_STATE[event.status] ?? 'done'
        this.transition(next, `task-end ${event.status} (${event.reason})`)
        this.armSettle()
        break
      }
      case 'model-route':
        break
      default:
        break
    }
  }

  /** 强制回 idle（面板“隐藏伴侣”/暂停统计不动状态机，仅 UI 用）。 */
  forceIdle(cause: string): void {
    this.clearSettle()
    this.transition('idle', cause)
  }

  dispose(): void {
    this.disposed = true
    this.clearSettle()
    this.activeTools.clear()
  }

  private armSettle(): void {
    this.clearSettle()
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      if (!this.disposed && this.state !== 'idle') {
        this.transition('idle', 'settle-timeout')
      }
    }, this.settleMs)
    // 冷却定时器绝不阻止进程退出。
    ;(this.settleTimer as unknown as { unref?: () => void }).unref?.()
  }

  private clearSettle(): void {
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer)
      this.settleTimer = null
    }
  }

  private transition(to: PetState, cause: string): void {
    if (to === this.state) return
    const from = this.state
    this.state = to
    this.stateCause = cause
    this.onStateChange?.(from, to, cause)
  }
}

export function taskKey(task: TaskRef): string {
  return `${task.sessionId}:${task.turn}`
}

export function stateCauseOf(machine: PetStateMachine): string {
  return (machine as unknown as { stateCause: string }).stateCause
}
