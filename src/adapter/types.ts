/**
 * dsh-companion — adapter 契约。
 *
 * 核心逻辑（状态机 / 任务聚合 / 统计）只消费 {@link PetEvent} 归一化事件，
 * 不直接触碰 DSH 事件对象。真实事件由 `dsh-adapter.ts` 翻译，
 * 独立运行与测试由 `mock-adapter.ts` 模拟。
 */

import type { TaskOutcome, UsageSnapshot } from '../types.js'

/** 任务引用：DSH 中一个 session 的一个 turn。 */
export interface TaskRef {
  sessionId: string
  turn: number
  project: string
  workspace: string
  /** 是否为 subagent 子会话（子会话驱动状态机，但不单独记账）。 */
  subagent: boolean
}

/** 归一化事件（mock 与真实适配层共用词汇表）。 */
export type PetEvent =
  | { kind: 'task-start'; task: TaskRef; time: number }
  | { kind: 'task-end'; task: TaskRef; status: TaskOutcome; reason: string; time: number }
  | { kind: 'model-start'; task: TaskRef; step: number; time: number }
  | {
      kind: 'model-end'
      task: TaskRef
      step: number
      usage: UsageSnapshot | null
      time: number
    }
  | { kind: 'stream-activity'; task: TaskRef; time: number }
  | { kind: 'model-route'; task: TaskRef; provider: string; model: string; time: number }
  | { kind: 'tool-start'; task: TaskRef; callId: string; name: string; time: number }
  | { kind: 'tool-end'; task: TaskRef; callId: string; name: string; ok: boolean; time: number }

/** 适配层公共能力。 */
export interface PetAdapter {
  /** 适配层标识（'dsh' | 'mock'）。 */
  readonly kind: 'dsh' | 'mock'
  /** 事件监听注册；返回退订函数。 */
  onEvent(listener: (event: PetEvent) => void): () => void
  /** 释放适配层资源（真实适配层退订宿主事件；mock 停掉模拟器）。 */
  dispose(): Promise<void> | void
}

/** 事件监听器类型导出。 */
export type PetEventListener = (event: PetEvent) => void

/**
 * 简单同步事件总线（核心与适配层之间的分发器，独立于 cordis）。
 * TODO: 事件量增长后换成带背压的异步分发。
 */
export class PetEventBus {
  private listeners = new Set<PetEventListener>()
  private disposed = false

  on(listener: PetEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: PetEvent): void {
    if (this.disposed) return
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch (error) {
        // 单个消费者异常不阻断其它消费者（与宿主 session/event 的 contain 策略一致）。
        console.error(`[dsh-companion] event listener failed:`, error)
      }
    }
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }
}
