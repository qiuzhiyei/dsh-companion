/**
 * dsh-companion — 余额台账聚合。
 *
 * 钱包余额是**存量**：消耗 = 相邻快照的下降量；余额上升按「疑似充值」单列，
 * 不计入消耗（充值/退款/赠金到期都会让差值失真，宁可分开记也不硬算）。
 * 币种变化视为不可归因的跳变（unknown），跳过该段差值。
 *
 * ⚠ 口径 = normal + bonus（**总可用**），不是只认 normal：
 * DeepSeek 先扣赠金再扣充值余额，实测一个下午 normal 恒定 17.77、bonus 从 6.00
 * 掉到 5.51，只看 normal 会让「今日消耗」永远是 0。故 delta 用两者之和算，
 * start/end/bonus 仍分别给 normal 与赠金，供 UI 分开显示。
 *
 * 日/月口径：以区间起点前最近一条快照为基线，算到区间内最后一条快照——
 * 这样跨天/跨月不会把边界外的变化算进来。
 */

import type { BalancePoint, BalanceSeries, BalanceSnapshot, BalanceSummary } from '../types.js'

/** 总可用余额 = 充值余额 + 赠金（老快照可能没有 bonus 字段，按 0 处理）。 */
function totalOf(snapshot: BalanceSnapshot): number {
  return Number(snapshot.normal || 0) + Number(snapshot.bonus || 0)
}

export function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function startOfMonth(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  d.setDate(1)
  return d.getTime()
}

export function balancePeriodRange(period: 'today' | 'month', now = Date.now()): { from: number; to: number } {
  return {
    from: period === 'month' ? startOfMonth(now) : startOfDay(now),
    to: now + 1,
  }
}

export interface SummarizeInput {
  period: 'today' | 'month'
  /** 区间内快照（ts 升序；多余的会被过滤）。 */
  snapshots: readonly BalanceSnapshot[]
  /** 区间起点之前最近的一条快照（基线；没有则用区间内第一条当基线）。 */
  baseline?: BalanceSnapshot | null
  now?: number
}

export function summarizeBalance(input: SummarizeInput): BalanceSummary {
  const now = input.now ?? Date.now()
  const { from, to } = balancePeriodRange(input.period, now)
  const points = input.snapshots
    .filter((s) => s.ts >= from && s.ts < to)
    .slice()
    .sort((a, b) => a.ts - b.ts)
  const result: BalanceSummary = {
    period: input.period,
    currency: points.length > 0 ? points[points.length - 1].currency : (input.baseline?.currency ?? 'CNY'),
    spent: 0,
    topups: 0,
    unknown: 0,
    start: null,
    end: null,
    at: null,
    bonus: null,
    samples: points.length,
  }
  if (points.length === 0) return result

  let prev: BalanceSnapshot | null = input.baseline ?? null
  if (prev && prev.ts >= from) prev = null // 基线必须在区间外
  if (!prev) {
    prev = points[0]
    result.start = prev.normal
  } else {
    result.start = prev.normal
  }

  for (const cur of points) {
    if (cur === prev) continue
    if (cur.currency !== prev.currency) {
      result.unknown += 1
      prev = cur
      continue
    }
    const delta = totalOf(prev) - totalOf(cur)
    if (delta > 0) result.spent += delta
    else if (delta < 0) result.topups += -delta
    prev = cur
  }
  result.end = points[points.length - 1].normal
  // 条带上的「更新 14:48」「赠金 ¥6.00」都取期间最后一条快照。
  result.at = points[points.length - 1].ts
  result.bonus = points[points.length - 1].bonus
  if (result.start === null) result.start = result.end
  return result
}

/**
 * 余额趋势（面板余额卡的 30 天 sparkline）：按本地日取当天最后一个快照。
 *
 * 为什么按日而不是保留原始点：一天多次采样会让折线抖成锯齿，30 天窗口下
 * 根本看不出趋势；「当天收盘余额」是用户读得懂的口径。返回升序，空数组表示
 * 还没有任何采样（页面显示引导，不画假线）。
 */
export function collectBalanceSeries(
  snapshots: readonly BalanceSnapshot[],
  days: number,
  currency: string,
  now = Date.now(),
): BalanceSeries {
  const spanDays = Math.max(1, Math.min(365, Math.round(Number(days)) || 1))
  const cutoff = now - spanDays * 86_400_000
  const byDay = new Map<string, BalancePoint>()
  for (const snapshot of snapshots) {
    if (!Number.isFinite(snapshot.ts) || snapshot.ts < cutoff) continue
    const d = new Date(snapshot.ts)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const prev = byDay.get(key)
    if (prev && prev.ts >= snapshot.ts) continue
    byDay.set(key, {
      ts: snapshot.ts,
      normal: round2(Number(snapshot.normal) || 0),
      bonus: round2(Number(snapshot.bonus) || 0),
      total: round2(totalOf(snapshot)),
    })
  }
  return {
    days: spanDays,
    currency,
    points: [...byDay.values()].sort((a, b) => a.ts - b.ts),
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}