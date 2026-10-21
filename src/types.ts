/**
 * dsh-companion — public types and cordis event-channel declarations.
 *
 * 类型总入口：数据模型 + 自定义事件通道（declaration merging 进
 * `@deepseek-ai/cordis` 的 Events 接口，获得 ctx.on/ctx.emit 的类型安全；
 * 未在此声明的自定义事件名一律不得 emit —— 见 README 工程约定 #6）。
 */

import type { Context } from '@deepseek-ai/cordis'

// ---------------------------------------------------------------------------
// 状态机
// ---------------------------------------------------------------------------

/** 伴侣动画状态（皮肤目录按同名文件提供动画资源）。 */
export type PetState =
  | 'idle' // 未工作：待机休眠
  | 'casting' // 任务开始：唤醒启动
  | 'waiting' // 等待模型/工具：思考中
  | 'hooked' // Token 快速增长或工具调用中：高速运转
  | 'reeling' // 任务收尾：收尾整理
  | 'done' // 任务成功：完成庆祝
  | 'error' // 任务失败/异常：报警
  | 'interrupted' // 任务中断：晕眩（缺皮肤资源时回退 error）

export const PET_STATES: readonly PetState[] = [
  'idle',
  'casting',
  'waiting',
  'hooked',
  'reeling',
  'done',
  'error',
  'interrupted',
] as const

/** 皮肤缺失某状态资源时的回退规则。 */
export const PET_STATE_FALLBACK: Readonly<Record<PetState, PetState>> = {
  idle: 'idle',
  casting: 'idle',
  waiting: 'idle',
  hooked: 'waiting',
  reeling: 'waiting',
  done: 'idle',
  error: 'idle',
  interrupted: 'error',
}

/** 任务终态（TaskSession.status 的取值）。 */
export type TaskOutcome =
  | 'running'
  | 'success' // 完成
  | 'failed' // 失败
  | 'interrupted' // 中断
  | 'blocked' // 等待用户输入而停
  | 'max-tokens' // 触发输出上限

export const TASK_OUTCOMES: readonly TaskOutcome[] = [
  'running',
  'success',
  'failed',
  'interrupted',
  'blocked',
  'max-tokens',
] as const

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

/** Token 用量（口径见 dsh-llm TokenUsage：inputTokens 为未命中缓存的输入）。 */
export interface UsageSnapshot {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedTokens: number
  reasoningTokens: number
}

export const EMPTY_USAGE: UsageSnapshot = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedTokens: 0,
  reasoningTokens: 0,
}

/** 一次任务（DSH 中的一个 turn）的完整记录。 */
export interface TaskSession {
  /** 主键：`<sessionId>:<turn>`。 */
  id: string
  sessionId: string
  turn: number
  /** 项目名（workspace 目录名）。 */
  project: string
  /** 工作区绝对路径。 */
  workspace: string
  provider: string
  model: string
  startTime: number
  endTime: number | null
  status: TaskOutcome
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedTokens: number
  reasoningTokens: number
  /** 按当前模型价格表估算的费用（config.currency 计价）。 */
  cost: number
  toolCalls: number
  toolSuccess: number
  toolFail: number
  steps: number
  tags: string[]
  note: string
}

/** 单次工具调用记录。 */
export interface ToolCallRecord {
  /** 主键：`<taskKey>:<callId>`。 */
  id: string
  taskKey: string
  callId: string
  name: string
  startTime: number
  endTime: number | null
  status: 'running' | 'ok' | 'fail'
}

/** 伴侣可持久化设置（面板可改，存储层落盘；Config 提供默认值）。 */
export interface PetSettings {
  skin: string
  /** 一次性默认皮肤迁移标记 v2（fisherman 移除 / monitor → whale）。 */
  whaleMigrated?: boolean
  /** 一次性皮肤退役迁移标记 v3（monitor 移除 → whale）。 */
  monitorRemoved?: boolean
  /** 久坐提醒（健康提醒）：坐够 intervalMinutes 就提醒；intervalMinutes 夹在 5..480。 */
  restReminder: { enabled: boolean; intervalMinutes: number }
  position: { x: number; y: number } | null
  opacity: number
  scale: number
  clickThrough: boolean
  privacyMode: boolean
  /** 桌面悬浮伴侣是否显示（Electron 壳据此显示/隐藏窗口，默认开）。 */
  showPet: boolean
  /** 纯宠物模式：伴侣页隐藏全部文字（HUD/气泡），只留动画。 */
  purePetMode: boolean
  /**
   * 系统通知（Electron 壳）：长任务（≥60s）完成/失败、预算触顶时发一条系统通知，
   * 窗口被挡或最小化也不错过。默认开；短任务不打扰（气泡够用）。
   */
  notify?: boolean
  paused: boolean
  autoStart: boolean
  currency: string
  /** 用户自定义价格行（覆盖项）。解析顺序：自定义 > 官方抓取 > 内置兜底 > 0。 */
  modelPrices: ModelPriceTable
  budget: {
    taskMaxTokens: number | null
    taskMaxCost: number | null
    dailyMaxTokens: number | null
    dailyMaxCost: number | null
  }
}

/**
 * 内置兜底价格表（官方价格抓取失败/未同步时使用）。
 * 来源：https://api-docs.deepseek.com/quick_start/pricing（2026-10-19 抓取），
 * PEAK（高峰）价、USD 按 DEFAULT_USD_CNY_RATE 折算 CNY；正常运行时被
 * 自动抓取的官方价覆盖（src/pricing/official.ts），此表仅兜底。
 */
export const DEFAULT_USD_CNY_RATE = 7.2

export const DEFAULT_MODEL_PRICES: ModelPriceTable = {
  // deepseek-flash：$0.3 输入(未命中缓存) / $0.006 输入(缓存命中) / $1.2 输出，每 1M tokens（PEAK）
  // 闲时（OFF-PEAK）为高峰价 5 折。
  'deepseek-flash': {
    inputPerMillion: 2.16,
    cacheInputPerMillion: 0.043,
    outputPerMillion: 8.64,
    inputOffPeakPerMillion: 1.08,
    cacheInputOffPeakPerMillion: 0.0215,
    outputOffPeakPerMillion: 4.32,
  },
  // deepseek-v4-pro：$1.32 / $0.044 / $3.96，每 1M tokens（PEAK）
  'deepseek-v4-pro': {
    inputPerMillion: 9.5,
    cacheInputPerMillion: 0.317,
    outputPerMillion: 28.51,
    inputOffPeakPerMillion: 4.75,
    cacheInputOffPeakPerMillion: 0.1585,
    outputOffPeakPerMillion: 14.255,
  },
}

/** 旧内置默认表（已退役模型名）。仅用于一次性迁移：清掉设置库里原样残留的行。 */
export const LEGACY_DEFAULT_MODEL_PRICES: ModelPriceTable = {
  'deepseek-chat': { inputPerMillion: 2, outputPerMillion: 8 },
  'deepseek-reasoner': { inputPerMillion: 4, outputPerMillion: 16 },
}

export const DEFAULT_SETTINGS: PetSettings = {
  skin: 'whale',
  /** 一次性默认皮肤迁移标记 v2（monitor/fisherman → whale），见 index.ts ②。 */
  whaleMigrated: true,
  /** 一次性皮肤退役迁移标记 v3（monitor 移除），见 index.ts ②。 */
  monitorRemoved: true,
  position: null,
  opacity: 1,
  scale: 1,
  clickThrough: false,
  privacyMode: false,
  showPet: true,
  purePetMode: false,
  notify: true,
  restReminder: { enabled: true, intervalMinutes: 60 },
  paused: false,
  autoStart: true,
  currency: 'CNY',
  modelPrices: {},
  budget: {
    taskMaxTokens: null,
    taskMaxCost: null,
    dailyMaxTokens: null,
    dailyMaxCost: null,
  },
}

// ---------------------------------------------------------------------------
// 快照（SSE / API 输出）
// ---------------------------------------------------------------------------

/** 正在进行的任务（实时视图）。 */
export interface ActiveTaskView {
  id: string
  sessionId: string
  turn: number
  project: string
  workspace: string
  provider: string
  model: string
  startTime: number
  tokens: UsageSnapshot
  cost: number
  toolCalls: number
  toolSuccess: number
  toolFail: number
  steps: number
  subagent: boolean
}

/** 刚结束的任务摘要（终态快照）。 */
export interface FinishedTaskView {
  id: string
  project: string
  model: string
  startTime: number
  endTime: number
  durationMs: number
  tokens: UsageSnapshot
  cost: number
  status: TaskOutcome
  toolCalls: number
  toolSuccess: number
  toolFail: number
}

/** 预算告警。 */
export interface BudgetAlert {
  kind:
    | 'task-tokens'
    | 'task-cost'
    | 'daily-tokens'
    | 'daily-cost'
  taskKey: string | null
  limit: number
  actual: number
  message: string
  time: number
}

/** 面板/伴侣页收到的完整实时快照。 */
export interface PetSnapshot {
  plugin: 'dsh-companion'
  time: number
  state: PetState
  /** 状态的人读标签（中文）。 */
  label: string
  adapter: 'dsh' | 'mock'
  paused: boolean
  task: ActiveTaskView | null
  lastResult: FinishedTaskView | null
  alert: BudgetAlert | null
  settings: PetSettings
  currency: string
  serverUrl: string
}

// ---------------------------------------------------------------------------
// 统计
// ---------------------------------------------------------------------------

export interface PeriodStats {
  period: 'today' | 'week' | 'month' | 'all'
  tasks: number
  success: number
  failed: number
  interrupted: number
  other: number
  successRate: number
  totalDurationMs: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedTokens: number
  cost: number
  toolCalls: number
  toolSuccess: number
  toolFail: number
  /**
   * 上一周期（与当前已过时长等长）的同口径统计，用于 KPI 环比；
   * 「全部」没有上一周期，为 null；库里没有更早数据时可能全 0。
   */
  previous?: PeriodStats | null
}

/** 成本排行的一行（模型 / 项目）。 */
export interface RankingRow {
  /** 模型 ID 或项目名。 */
  key: string
  tasks: number
  tokens: number
  cost: number
  durationMs: number
  /** 占本周期总费用的比例（0~1）。 */
  share: number
}

export interface RankingResult {
  period: PeriodStats['period']
  models: RankingRow[]
  projects: RankingRow[]
}

export type ExportFormat = 'csv' | 'json'

/** 统计图表的一个时间桶（/api/stats/series）。 */
export interface SeriesBucket {
  key: string
  label: string
  tokens: number
  tasks: number
  cost: number
  durationMs: number
}

/** 周期时间序列：today 按小时、week/month 按天、all 按月（最多 24 桶）。 */
export interface StatsSeries {
  period: 'today' | 'week' | 'month' | 'all'
  buckets: SeriesBucket[]
}

// ---------------------------------------------------------------------------
// 模型价格
// ---------------------------------------------------------------------------

/** 单模型价格（每百万 Token 的单价，currency 计价）。 */
export interface ModelPrice {
  inputPerMillion: number
  outputPerMillion: number
  /** 缓存命中输入单价；缺省按 inputPerMillion 计（DeepSeek 缓存命中约为未命中的 1/50，不拆分会严重高估）。 */
  cacheInputPerMillion?: number
  /** 闲时（OFF-PEAK，UTC 16:30–00:30）单价；缺省按高峰价计（没有闲时折扣的模型）。 */
  inputOffPeakPerMillion?: number
  cacheInputOffPeakPerMillion?: number
  outputOffPeakPerMillion?: number
}

export type ModelPriceTable = Record<string, ModelPrice>

// ---------------------------------------------------------------------------
// 官方价格自动获取（src/pricing/official.ts）
// ---------------------------------------------------------------------------

/** 单模型官方价（USD、每百万 Token；PEAK=高峰价，OFF-PEAK 半价）。 */
export interface OfficialModelPricing {
  inputPeakUsd: number
  inputOffPeakUsd: number
  cacheHitInputPeakUsd: number
  cacheHitInputOffPeakUsd: number
  outputPeakUsd: number
  outputOffPeakUsd: number
  /** 官网 MODEL VERSION 行原文（如 DeepSeek-V4.1-Flash-1017），面板展示用。 */
  version?: string
}

/** 官方价格抓取结果，也是磁盘缓存文件（dataDir/pricing-official.json）。 */
export interface OfficialPricingFile {
  version: 1
  url: string
  /** 最近一次成功抓取时间；从未成功为 null。 */
  fetchedAt: number | null
  /** 当前是否持有可用的官方价格（缓存或新抓取）。 */
  ok: boolean
  /** 最近一次失败原因（成功时为 null）。 */
  error: string | null
  models: Record<string, OfficialModelPricing>
}

/** 面板设置页展示的官方价格状态（含换算后的价格表）。 */
export interface OfficialPricingStatus {
  url: string
  ok: boolean
  fetchedAt: number | null
  error: string | null
  currency: string
  /** USD→设置货币的折算率（USD 时为 1）。 */
  rate: number
  /** 换算后的价格表（仅官方模型 ID 键）。 */
  models: ModelPriceTable
  /** 官方模型 ID → 官网 MODEL VERSION 行原文（如 deepseek-flash → DeepSeek-V4.1-Flash-1017）。 */
  versions: Record<string, string>
}

// ---------------------------------------------------------------------------
// cordis 事件通道（declaration merging —— 只允许 emit 这里声明的名字）
// ---------------------------------------------------------------------------

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** 伴侣动画状态切换。 */
    'companion/state-change'(payload: {
      from: PetState
      to: PetState
      snapshot: PetSnapshot
    }): void
    /** 一次任务结束（已落盘）。 */
    'companion/task-finished'(payload: { task: TaskSession }): void
    /** 预算告警。 */
    'companion/budget-alert'(payload: { alert: BudgetAlert }): void
  }
}

/** 事件通道名常量（避免裸字符串）。 */
export const EVENTS = {
  stateChange: 'companion/state-change',
  taskFinished: 'companion/task-finished',
  budgetAlert: 'companion/budget-alert',
} as const

export type StatusPetContext = Context
