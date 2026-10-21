/**
 * dsh-companion — 任务追踪器。
 *
 * 把 PetEvent 聚合成 TaskSession（一个 DSH turn 一次任务）与 ToolCallRecord。
 * 任务结束时计算费用、交由回调持久化，并保留“最近一次快照”供伴侣展示。
 *
 * 口径说明（对齐 dsh-llm TokenUsage 的 DISJOINT 计数）：
 * - promptTokens    = inputTokens + cachedTokens（计费口径的输入）
 * - completionTokens = outputTokens
 * - cachedTokens    = cacheRead + cacheWrite
 * - totalTokens     = usage.totalTokens（缺失时用 prompt + completion）
 */

import type { PetEvent, TaskRef } from '../adapter/types.js'
import { taskKey } from '../state-machine/pet-state-machine.js'
import type {
  ActiveTaskView,
  FinishedTaskView,
  ModelPriceTable,
  TaskOutcome,
  TaskSession,
  ToolCallRecord,
  UsageSnapshot,
} from '../types.js'
import { computeCost, isPricedProvider, priceFor } from './cost.js'

interface RunningTask {
  session: TaskSession
  tools: Map<string, ToolCallRecord>
  subagent: boolean
}

export interface TaskTrackerOptions {
  modelPrices: ModelPriceTable
  /** 任务完成回调（持久化 + 发事件由上层接线）。 */
  onFinish?: (task: TaskSession, tools: ToolCallRecord[]) => void | Promise<void>
}

export class TaskTracker {
  private readonly running = new Map<string, RunningTask>()
  private lastResult: FinishedTaskView | null = null
  private readonly modelPrices: ModelPriceTable
  private readonly onFinish?: (task: TaskSession, tools: ToolCallRecord[]) => void | Promise<void>

  constructor(options: TaskTrackerOptions) {
    this.modelPrices = options.modelPrices ?? {}
    this.onFinish = options.onFinish
  }

  updatePrices(prices: ModelPriceTable): void {
    Object.assign(this.modelPrices, prices)
  }

  /** 整表替换生效价格（自定义行 > 官方抓取 > 内置兜底 的合并结果；合并来源变化后调用）。 */
  setPrices(prices: ModelPriceTable): void {
    for (const key of Object.keys(this.modelPrices)) delete this.modelPrices[key]
    Object.assign(this.modelPrices, prices)
  }

  /** 当前展示中的任务（优先主会话，其次 subagent）。 */
  activeView(): ActiveTaskView | null {
    const tasks = [...this.running.values()]
    const primary = tasks.find((entry) => !entry.subagent) ?? tasks[tasks.length - 1]
    if (!primary) return null
    return toActiveView(primary)
  }

  lastFinishedView(): FinishedTaskView | null {
    return this.lastResult
  }

  /** 启动补种：从库里恢复最近一次已结束任务（重启后伴侣气泡也有“上次任务”）。 */
  seedLastResult(view: FinishedTaskView): void {
    if (this.lastResult === null) this.lastResult = view
  }

  handle(event: PetEvent): void {
    switch (event.kind) {
      case 'task-start':
        this.startTask(event.task, event.time)
        break
      case 'task-end':
        void this.endTask(event.task, event.status, event.time)
        break
      case 'model-route': {
        const task = this.running.get(taskKey(event.task))
        if (task) {
          if (event.provider) task.session.provider = event.provider
          if (event.model) task.session.model = event.model
        }
        break
      }
      case 'model-end': {
        const task = this.running.get(taskKey(event.task))
        if (!task || !event.usage) break
        const usage = event.usage
        const prompt = usage.inputTokens + usage.cachedTokens
        task.session.promptTokens += prompt
        task.session.completionTokens += usage.outputTokens
        task.session.cachedTokens += usage.cachedTokens
        task.session.reasoningTokens += usage.reasoningTokens
        task.session.totalTokens +=
          usage.totalTokens || prompt + usage.outputTokens
        task.session.steps = Math.max(task.session.steps, event.step)
        // 计费门控：只有 DeepSeek 账号/官方 API 的任务计费；自定义渠道恒 0。
        task.session.cost = isPricedProvider(task.session.provider)
          ? computeCost(
              task.session.promptTokens,
              task.session.completionTokens,
              task.session.cachedTokens,
              task.session.model,
              this.modelPrices,
              task.session.startTime, // 峰谷按任务开始时刻取价（闲时半价）
            )
          : 0
        break
      }
      case 'tool-start': {
        const task = this.running.get(taskKey(event.task))
        if (!task) break
        const record: ToolCallRecord = {
          id: `${task.session.id}:${event.callId}`,
          taskKey: task.session.id,
          callId: event.callId,
          name: event.name,
          startTime: event.time,
          endTime: null,
          status: 'running',
        }
        if (!task.tools.has(event.callId)) {
          task.tools.set(event.callId, record)
          task.session.toolCalls += 1
        }
        break
      }
      case 'tool-end': {
        const task = this.running.get(taskKey(event.task))
        if (!task) break
        const record = task.tools.get(event.callId)
        if (!record) break
        record.endTime = event.time
        record.status = event.ok ? 'ok' : 'fail'
        if (event.ok) task.session.toolSuccess += 1
        else task.session.toolFail += 1
        if (record.name === '' && event.name) record.name = event.name
        break
      }
      default:
        break
    }
  }

  /** 悬空任务兜底：进程关闭时把仍在跑的任务按 interrupted 结算。 */
  async flushInterrupted(now = Date.now()): Promise<void> {
    for (const [key, entry] of [...this.running.entries()]) {
      await this.finalize(entry, 'interrupted', now, 'plugin unload')
      this.running.delete(key)
    }
  }

  private startTask(task: TaskRef, time: number): void {
    const key = taskKey(task)
    if (this.running.has(key)) return
    const id = `${task.sessionId}:${task.turn}`
    this.running.set(key, {
      subagent: task.subagent,
      tools: new Map(),
      session: {
        id,
        sessionId: task.sessionId,
        turn: task.turn,
        project: task.project,
        workspace: task.workspace,
        provider: '',
        model: '',
        startTime: time,
        endTime: null,
        status: 'running',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        cost: 0,
        toolCalls: 0,
        toolSuccess: 0,
        toolFail: 0,
        steps: 0,
        tags: task.subagent ? ['subagent'] : [],
        note: '',
      },
    })
  }

  private async endTask(task: TaskRef, status: TaskOutcome, time: number): Promise<void> {
    const key = taskKey(task)
    const entry = this.running.get(key)
    if (!entry) return
    this.running.delete(key)
    await this.finalize(entry, status, time, '')
  }

  private async finalize(
    entry: RunningTask,
    status: TaskOutcome,
    time: number,
    note: string,
  ): Promise<void> {
    const session = entry.session
    session.endTime = time
    session.status = status
    session.note = note
    // 计费门控（终算）：只有 DeepSeek 账号/官方 API 的任务计费；自定义渠道恒 0。
    session.cost = isPricedProvider(session.provider)
      ? computeCost(
          session.promptTokens,
          session.completionTokens,
          session.cachedTokens,
          session.model,
          this.modelPrices,
          session.startTime, // 终算同样按开始时刻的峰谷价，避免中途跨档跳变
        )
      : 0
    if (!entry.subagent || this.lastResult === null) {
      this.lastResult = toFinishedView(session)
    }
    try {
      await this.onFinish?.(session, [...entry.tools.values()])
    } catch (error) {
      console.error('[dsh-companion] persist finished task failed:', error)
    }
  }
}

function toActiveView(entry: RunningTask): ActiveTaskView {
  const s = entry.session
  return {
    id: s.id,
    sessionId: s.sessionId,
    turn: s.turn,
    project: s.project,
    workspace: s.workspace,
    provider: s.provider,
    model: s.model,
    startTime: s.startTime,
    tokens: {
      inputTokens: s.promptTokens,
      outputTokens: s.completionTokens,
      totalTokens: s.totalTokens,
      cachedTokens: s.cachedTokens,
      reasoningTokens: s.reasoningTokens,
    },
    cost: s.cost,
    toolCalls: s.toolCalls,
    toolSuccess: s.toolSuccess,
    toolFail: s.toolFail,
    steps: s.steps,
    subagent: entry.subagent,
  }
}

function toFinishedView(session: TaskSession): FinishedTaskView {
  const durationMs = Math.max(0, (session.endTime ?? session.startTime) - session.startTime)
  return {
    id: session.id,
    project: session.project,
    model: session.model,
    startTime: session.startTime,
    endTime: session.endTime ?? session.startTime,
    durationMs,
    tokens: {
      inputTokens: session.promptTokens,
      outputTokens: session.completionTokens,
      totalTokens: session.totalTokens,
      cachedTokens: session.cachedTokens,
      reasoningTokens: session.reasoningTokens,
    },
    cost: session.cost,
    status: session.status,
    toolCalls: session.toolCalls,
    toolSuccess: session.toolSuccess,
    toolFail: session.toolFail,
  }
}

/** 库里的 TaskSession → 终态视图（启动补种用）。 */
export function finishedViewFromSession(session: TaskSession): FinishedTaskView {
  return toFinishedView(session)
}

export { computeCost, priceFor }
