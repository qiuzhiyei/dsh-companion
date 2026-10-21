/**
 * dsh-companion — 费用估算。
 *
 * 按模型价格表（每百万 Token 单价）把用量换算成 config.currency 计价金额。
 * 缓存命中 token 有 cacheInputPerMillion 时按其计价，否则按 input 价。
 * 计费按 provider 门控：只有 DeepSeek 官方 API 的任务计费（见 isPricedProvider）。
 */
/** 单价缺省时的兜底（避免无价格模型算出 NaN）。 */
const FALLBACK_PRICE = { inputPerMillion: 0, outputPerMillion: 0 };
/**
 * 计费门控（用户明确口径）：只统计用 DeepSeek 账号跑的任务 ——
 * `deepseek-account`（账号登录）与 `deepseek-official`（API key）都直连
 * api.deepseek.com，价格即官方定价页。自定义/第三方渠道（如 aliyun-bailian
 * 的 qwen/glm/deepseek 别名）一律不计费：Token 照记，费用恒 0，
 * 不管模型名与官方多相似。
 */
export const PRICED_PROVIDERS = [
    'deepseek-account',
    'deepseek-official',
];
export function isPricedProvider(provider) {
    return PRICED_PROVIDERS.includes(provider);
}
/** 查某模型价格：先精确匹配，再试"provider/model" 前缀宽松匹配。 */
export function priceFor(model, prices) {
    if (!model)
        return FALLBACK_PRICE;
    const exact = prices[model];
    if (exact)
        return exact;
    const tail = model.includes('/') ? model.split('/').pop() ?? model : model;
    return prices[tail] ?? FALLBACK_PRICE;
}
/**
 * DeepSeek 闲时（OFF-PEAK）折扣时段：**UTC 16:30–00:30**（北京时间 00:30–08:30），
 * 官网定价为高峰价的 5 折。之前统一按 PEAK 价保守估算，夜间跑量会明显高估，
 * 所以计价按「任务开始时间落在哪个时段」选价（同一任务全程取开始时刻，不跨档拆价）。
 */
export const OFF_PEAK_START_MIN = 16 * 60 + 30;
export const OFF_PEAK_END_MIN = 30;
export function isOffPeak(atMs) {
    const d = new Date(atMs);
    const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
    return minutes >= OFF_PEAK_START_MIN || minutes < OFF_PEAK_END_MIN;
}
/** 解析某模型在给定时刻适用的单价三件套（闲时缺价自动回退高峰价）。 */
export function ratesFor(model, prices, atMs) {
    const price = priceFor(model, prices);
    const off = atMs !== undefined && Number.isFinite(atMs) && isOffPeak(atMs);
    const input = off ? price.inputOffPeakPerMillion ?? price.inputPerMillion : price.inputPerMillion;
    const output = off ? price.outputOffPeakPerMillion ?? price.outputPerMillion : price.outputPerMillion;
    const cache = off
        ? price.cacheInputOffPeakPerMillion ?? price.cacheInputPerMillion ?? input
        : price.cacheInputPerMillion ?? input;
    return { input, output, cache, offPeak: off };
}
/** 计费输入 = 未命中输入按 input 价 + 缓存 token 按 cache 价（DISJOINT 口径相加）。 */
export function computeCost(promptTokens, completionTokens, cachedTokens, model, prices, 
/** 计费时刻（一般传任务开始时间）；缺省按高峰价。 */
atMs) {
    const rates = ratesFor(model, prices, atMs);
    if (rates.input === 0 && rates.output === 0 && rates.cache === 0) {
        return 0;
    }
    const uncachedInput = Math.max(0, promptTokens - cachedTokens);
    const inputCost = (uncachedInput / 1_000_000) * rates.input +
        (cachedTokens / 1_000_000) * rates.cache;
    const outputCost = (completionTokens / 1_000_000) * rates.output;
    return round4(inputCost + outputCost);
}
export function round4(value) {
    return Math.round(value * 10_000) / 10_000;
}
/** 金额格式化（面板/快照展示用）。 */
export function formatCost(cost, currency) {
    if (cost === 0)
        return `0 ${symbolOf(currency)}`;
    const text = cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2);
    return `${text} ${symbolOf(currency)}`;
}
function symbolOf(currency) {
    switch (currency) {
        case 'CNY':
        case '¥':
            return '¥';
        case 'USD':
        case '$':
            return '$';
        default:
            return currency;
    }
}
