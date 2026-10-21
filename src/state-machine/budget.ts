/**
 * dsh-companion — 预算告警。
 *
 * 两条线：单任务（Token / 费用）与每日累计（Token / 费用）。
 * 越限即刻产出 BudgetAlert（去重：单任务每档只报一次，每日每档每天一次）。
 * 告警的呈现（托盘通知 + 伴侣动画 + 面板横幅）由上层接线。
 */

import type { BudgetAlert, ModelPriceTable, PetSettings } from '../types.js'
import { computeCost, isPricedProvider } from './cost.js'

export type BudgetLimits = PetSettings['budget']

function dayKeyOf(time: number): string {
  const date = new Date(time)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

export interface DailyUsageSnapshot {
  totalTokens: number
  cost: number
}

export class BudgetGuard {
  private readonly armedTask = new Set<string>()
  private readonly armedDaily = new Set<string>()
  private armedDay = ''

  constructor(
    private readonly limits: () => BudgetLimits,
    private readonly prices: () => ModelPriceTable,
  ) {}

  /** 任务内实时检查（每次 model-end 后调用）。费用线只对 DeepSeek 官方 API 任务生效。 */
  checkTask(
    taskKey: string,
    promptTokens: number,
    completionTokens: number,
    cachedTokens: number,
    model: string,
    provider = '',
    now = Date.now(),
  ): BudgetAlert | null {
    const limits = this.limits()
    const total = promptTokens + completionTokens
    if (
      limits.taskMaxTokens !== null &&
      limits.taskMaxTokens > 0 &&
      total > limits.taskMaxTokens
    ) {
      const key = `task-tokens:${taskKey}`
      if (!this.armedTask.has(key)) {
        this.armedTask.add(key)
        return {
          kind: 'task-tokens',
          taskKey,
          limit: limits.taskMaxTokens,
          actual: total,
          message: `单任务 Token 超预算：${total.toLocaleString()} / ${limits.taskMaxTokens.toLocaleString()}`,
          time: now,
        }
      }
    }
    if (limits.taskMaxCost !== null && limits.taskMaxCost > 0) {
      // 自定义渠道不计费 → 费用告警天然不触发（Token 线不受影响）。
      const cost = isPricedProvider(provider)
        ? computeCost(promptTokens, completionTokens, cachedTokens, model, this.prices(), now)
        : 0
      if (cost > limits.taskMaxCost) {
        const key = `task-cost:${taskKey}`
        if (!this.armedTask.has(key)) {
          this.armedTask.add(key)
          return {
            kind: 'task-cost',
            taskKey,
            limit: limits.taskMaxCost,
            actual: cost,
            message: `单任务费用超预算：${cost.toFixed(2)} / ${limits.taskMaxCost}`,
            time: now,
          }
        }
      }
    }
    return null
  }

  /** 任务结束后检查每日累计。 */
  checkDaily(daily: DailyUsageSnapshot, now = Date.now()): BudgetAlert | null {
    const dayKey = dayKeyOf(now)
    if (dayKey !== this.armedDay) {
      this.armedDay = dayKey
      this.armedDaily.clear()
    }
    const limits = this.limits()
    if (
      limits.dailyMaxTokens !== null &&
      limits.dailyMaxTokens > 0 &&
      daily.totalTokens > limits.dailyMaxTokens
    ) {
      const key = 'daily-tokens'
      if (!this.armedDaily.has(key)) {
        this.armedDaily.add(key)
        return {
          kind: 'daily-tokens',
          taskKey: null,
          limit: limits.dailyMaxTokens,
          actual: daily.totalTokens,
          message: `今日 Token 超预算：${daily.totalTokens.toLocaleString()} / ${limits.dailyMaxTokens.toLocaleString()}`,
          time: now,
        }
      }
    }
    if (limits.dailyMaxCost !== null && limits.dailyMaxCost > 0 && daily.cost > limits.dailyMaxCost) {
      const key = 'daily-cost'
      if (!this.armedDaily.has(key)) {
        this.armedDaily.add(key)
        return {
          kind: 'daily-cost',
          taskKey: null,
          limit: limits.dailyMaxCost,
          actual: daily.cost,
          message: `今日费用超预算：${daily.cost.toFixed(2)} / ${limits.dailyMaxCost}`,
          time: now,
        }
      }
    }
    return null
  }

  /** 任务换新后清掉旧任务的去重标记。 */
  resetTaskArming(): void {
    this.armedTask.clear()
  }
}
