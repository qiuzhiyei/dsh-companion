/**
 * dsh-companion — public types and cordis event-channel declarations.
 *
 * 类型总入口：数据模型 + 自定义事件通道（declaration merging 进
 * `@deepseek-ai/cordis` 的 Events 接口，获得 ctx.on/ctx.emit 的类型安全；
 * 未在此声明的自定义事件名一律不得 emit —— 见 README 工程约定 #6）。
 */
export const PET_STATES = [
    'idle',
    'casting',
    'waiting',
    'hooked',
    'reeling',
    'done',
    'error',
    'interrupted',
];
/** 皮肤缺失某状态资源时的回退规则。 */
export const PET_STATE_FALLBACK = {
    idle: 'idle',
    casting: 'idle',
    waiting: 'idle',
    hooked: 'waiting',
    reeling: 'waiting',
    done: 'idle',
    error: 'idle',
    interrupted: 'error',
};
export const TASK_OUTCOMES = [
    'running',
    'success',
    'failed',
    'interrupted',
    'blocked',
    'max-tokens',
];
export const EMPTY_USAGE = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
};
/**
 * 内置兜底价格表（官方价格抓取失败/未同步时使用）。
 * 来源：https://api-docs.deepseek.com/quick_start/pricing（2026-10-19 抓取），
 * PEAK（高峰）价、USD 按 DEFAULT_USD_CNY_RATE 折算 CNY；正常运行时被
 * 自动抓取的官方价覆盖（src/pricing/official.ts），此表仅兜底。
 */
export const DEFAULT_USD_CNY_RATE = 7.2;
export const DEFAULT_MODEL_PRICES = {
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
};
/** 旧内置默认表（已退役模型名）。仅用于一次性迁移：清掉设置库里原样残留的行。 */
export const LEGACY_DEFAULT_MODEL_PRICES = {
    'deepseek-chat': { inputPerMillion: 2, outputPerMillion: 8 },
    'deepseek-reasoner': { inputPerMillion: 4, outputPerMillion: 16 },
};
export const DEFAULT_SETTINGS = {
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
};
/** 事件通道名常量（避免裸字符串）。 */
export const EVENTS = {
    stateChange: 'companion/state-change',
    taskFinished: 'companion/task-finished',
    budgetAlert: 'companion/budget-alert',
};
