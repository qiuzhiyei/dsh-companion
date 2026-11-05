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
  /** 伴侣悬浮窗缩放（0.4..3，只影响宠物与气泡，不改窗口字号）。 */
  scale: number
  /**
   * 面板界面字号倍率（0.9..1.1，默认 1 = 设计稿基准）。
   * 只缩放面板文字；不改伴侣/HUD 大小，也不改窗口布局尺寸。
   */
  uiScale: number
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
  /**
   * 自由活动（闲时自己在屏幕上逛）开关。默认开。
   *
   * ⚠ 必须存后端 settings，不能用 localStorage：面板和桌宠悬浮窗在 Electron 里
   * 是**不同存储分区**（从 DSH 界面开的面板 vs 壳窗口），localStorage 互不可见——
   * 用户在面板关了自由活动，桌宠那边读不到，照样跑（真实报障 2026-10-28）。
   * settings 经 /api/state 下发，所有窗口共用同一份真相。
   */
  roam?: boolean
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
  /**
   * 余额台账（可选）：只对**登录的 DeepSeek 账号**采样，第三方渠道一律不查。
   * 开启后按 intervalMinutes 采样，存快照进本地库；双击桌宠可临时查一次。
   */
  balance: {
    enabled: boolean
    /** 采样间隔（分钟），夹在 5..1440。 */
    intervalMinutes: number
    /**
     * 余额低告警阈值（余额币种计价；null/≤0 = 关）。采样到
     * normal+bonus 低于阈值时告警一次（Toast + 气泡 + 面板横幅）；
     * 回升到阈值以上重新武装，再跌破会再报。
     */
    lowBalance: number | null
  }
  /**
   * 数据保留：任务记录只保留最近 retentionMonths 个月，更早的自动清理。
   * null = 永久保留（默认，与历史行为一致）。夹在 1..120。
   *
   * 为什么要有：JSON 后端有 5000 条上限、余额快照有 90 天清理，唯独 SQLite
   * 任务表两者皆无 —— 长期用会一直涨。清理是不可逆的，所以面板侧要先预览
   * 条数 + 二次确认（与会话删除同款谨慎标准）。
   */
  retention: { months: number | null }
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
  uiScale: 1,
  clickThrough: false,
  privacyMode: false,
  showPet: true,
  purePetMode: false,
  notify: true,
  roam: true,
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
  balance: {
    enabled: false,
    intervalMinutes: 30,
    lowBalance: null,
  },
  retention: { months: null },
}

// ---------------------------------------------------------------------------
// 快照（SSE / API 输出）
// ---------------------------------------------------------------------------

/** 运行中任务的阶段（每个任务独立，不混用全局状态机）。 */
export type ActiveTaskPhase = 'waiting' | 'streaming' | 'tool'

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
  phase: ActiveTaskPhase
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

/** 预算告警。kind='balance-low' 为余额低告警（复用同一呈现通道）。 */
export interface BudgetAlert {
  kind:
    | 'task-tokens'
    | 'task-cost'
    | 'daily-tokens'
    | 'daily-cost'
    | 'balance-low'
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
  /** 所有运行中任务（含 subagent）；task 仍是主任务，兼容旧消费方。 */
  tasks: ActiveTaskView[]
  lastResult: FinishedTaskView | null
  alert: BudgetAlert | null
  settings: PetSettings
  currency: string
  /** 当前生效的中国法定节假日（北京时间 YYYY-MM-DD）；面板/角标用于峰谷判断。 */
  holidays: string[]
  serverUrl: string
}

// ---------------------------------------------------------------------------
// 余额台账（仅登录的 DeepSeek 账号；第三方渠道不读取）
// ---------------------------------------------------------------------------

/** 采样来源：启动 / 定时 / 任务结束 / 手动（双击或面板刷新）。 */
export type BalanceSource = 'startup' | 'timer' | 'task' | 'manual'

/** 一次余额快照（钱包余额是存量；消耗 = 相邻快照的下降量）。 */
export interface BalanceSnapshot {
  ts: number
  currency: string
  /** 充值余额（normal_wallets）。 */
  normal: number
  /** 赠送余额（bonus_wallets；单独存，避免混进消耗口径）。 */
  bonus: number
  /** 平台累计消耗（total_costs，若接口给出）。 */
  totalCosts: number | null
  source: BalanceSource
}

/** /api/balance 的当前视图（双击举牌与面板共用）。 */
export interface BalanceView {
  ok: boolean
  /** 设置里的余额台账开关。 */
  enabled: boolean
  /** 是否读到 DeepSeek 账号凭证（未登录 = false）。 */
  signedIn: boolean
  at: number | null
  currency: string
  normal: number
  bonus: number
  totalCosts: number | null
  /** 失败原因（ok=false 时有值）；不写日志、不上报。 */
  error: string | null
  /** 命中缓存（未真正发请求）。 */
  cached: boolean
}

/** 日/月余额聚合（/api/balance/summary）。 */
export interface BalanceSummary {
  period: 'today' | 'month'
  currency: string
  /** 期间净消耗 = 首末快照下降量（充值上升部分单列）。 */
  spent: number
  /** 期间疑似充值（相邻快照上升量）。 */
  topups: number
  /** 无法归因的跳变（币种变化/赠金到期等）。 */
  unknown: number
  /** 期间起点/终点余额（无快照时为 null）。 */
  start: number | null
  end: number | null
  /** 期间最后一条快照的时间（面板显示「更新 14:48」）。 */
  at: number | null
  /** 最后一条快照的赠金（单独口径，不进消耗）。 */
  bonus: number | null
  samples: number
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

/**
 * 数据保留视图（GET /api/retention）：清理前先看会删多少条。
 * months=null（永久保留）时 cutoff 与 candidates 都是 null/0，面板禁用清理按钮。
 */
export interface RetentionView {
  /** 当前保留期（月）；null = 永久保留。 */
  months: number | null
  /** 清理截止时间戳（早于此的会被删）；months=null 时为 null。 */
  cutoff: number | null
  /** 早于 cutoff 的任务条数（= 立即清理会删掉的量）。 */
  candidates: number
  /** 库内任务总数。 */
  total: number
}

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
// 告警记录 / 余额趋势（面板统计页）
// ---------------------------------------------------------------------------

/** 告警类别：预算 / 余额不足 / 任务失败 / 任务中断。 */
export type AlertType = 'budget' | 'balance' | 'failed' | 'interrupted'
export type AlertLevel = 'warn' | 'error' | 'info'

/**
 * 告警记录（GET /api/alerts）。气泡消失后仍可回查：BudgetGuard 的告警与
 * 失败/中断任务都会落到 <dataDir>/alerts.json 的环形日志（最多 50 条）。
 */
export interface AlertEntry {
  id: string
  time: number
  type: AlertType
  level: AlertLevel
  text: string
}

/** 余额趋势的一个采样点（按本地日取当天最后一个快照）。 */
export interface BalancePoint {
  ts: number
  normal: number
  bonus: number
  /** normal + bonus（与低余额告警同口径）。 */
  total: number
}

/** 30 天余额趋势（GET /api/balance/series）：没有快照时 points 为空。 */
export interface BalanceSeries {
  days: number
  currency: string
  points: BalancePoint[]
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
  /** 闲时（OFF-PEAK，北京时间工作日 9–12 / 14–18 以外、周末与法定节假日）单价；缺省按高峰价计（没有闲时折扣的模型）。 */
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
