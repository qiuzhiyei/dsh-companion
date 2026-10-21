/**
 * dsh-companion — 今日 / 本周 / 本月 / 全部 统计。
 *
 * 周从周一开始，全部按宿主本地时区（用户时区）计算边界。
 */
/** 计算周期的本地时间 [from, to) 毫秒边界。 */
export function periodRange(period, now = new Date()) {
    const from = new Date(now);
    const to = new Date(now);
    from.setHours(0, 0, 0, 0);
    to.setHours(0, 0, 0, 0);
    switch (period) {
        case 'today':
            to.setDate(to.getDate() + 1);
            break;
        case 'week': {
            // 周一为一周开始（getDay: 0=周日 … 6=周六）。
            const day = (from.getDay() + 6) % 7;
            from.setDate(from.getDate() - day);
            to.setTime(from.getTime());
            to.setDate(to.getDate() + 7);
            break;
        }
        case 'month':
            from.setDate(1);
            to.setTime(from.getTime());
            to.setMonth(to.getMonth() + 1);
            break;
        case 'all':
            return { from: 0, to: Number.MAX_SAFE_INTEGER };
        default:
            throw new Error(`unknown stats period: ${String(period)}`);
    }
    return { from: from.getTime(), to: to.getTime() };
}
export async function computePeriodStats(store, period, now = new Date(), 
/** 是否附带上一周期（环比）；默认带。 */
withPrevious = true) {
    const { from, to } = periodRange(period, now);
    const agg = await store.statsBetween(from, to);
    const stats = {
        period,
        tasks: agg.tasks,
        success: agg.success,
        failed: agg.failed,
        interrupted: agg.interrupted,
        other: agg.other,
        successRate: agg.tasks === 0 ? 0 : Math.round((agg.success / agg.tasks) * 1000) / 10,
        totalDurationMs: agg.totalDurationMs,
        promptTokens: agg.promptTokens,
        completionTokens: agg.completionTokens,
        totalTokens: agg.totalTokens,
        cachedTokens: agg.cachedTokens,
        cost: Math.round(agg.cost * 10_000) / 10_000,
        toolCalls: agg.toolCalls,
        toolSuccess: agg.toolSuccess,
        toolFail: agg.toolFail,
    };
    if (!withPrevious)
        return stats;
    if (period === 'all') {
        stats.previous = null;
        return stats;
    }
    // 环比口径：和「当前已过时长」等长的上一段比——今天 = 昨日同刻、本周 = 上周同期、
    // 本月 = 上月同期。这样月初/周一早上不会因为「半天 对 整月」显示成暴跌。
    const span = Math.max(0, Math.min(now.getTime(), to) - from);
    if (span <= 0) {
        stats.previous = null;
        return stats;
    }
    const prevAgg = await store.statsBetween(from - span, from);
    stats.previous = {
        ...stats,
        tasks: prevAgg.tasks,
        success: prevAgg.success,
        failed: prevAgg.failed,
        interrupted: prevAgg.interrupted,
        other: prevAgg.other,
        successRate: prevAgg.tasks === 0 ? 0 : Math.round((prevAgg.success / prevAgg.tasks) * 1000) / 10,
        totalDurationMs: prevAgg.totalDurationMs,
        promptTokens: prevAgg.promptTokens,
        completionTokens: prevAgg.completionTokens,
        totalTokens: prevAgg.totalTokens,
        cachedTokens: prevAgg.cachedTokens,
        cost: Math.round(prevAgg.cost * 10_000) / 10_000,
        toolCalls: prevAgg.toolCalls,
        toolSuccess: prevAgg.toolSuccess,
        toolFail: prevAgg.toolFail,
        previous: null,
    };
    return stats;
}
/**
 * 成本排行：本周期内按模型 / 项目聚合，按费用降序（费用全 0 时按 Token 降序），
 * 取前 top 项。数据量 = 本周期任务数，走 listTasksBetween 一次读，够用。
 */
export async function computeRanking(store, period, now = new Date(), top = 5) {
    const { from, to } = periodRange(period, now);
    const tasks = await store.listTasksBetween(period === 'all' ? 0 : from, period === 'all' ? Number.MAX_SAFE_INTEGER : to);
    const useCost = tasks.some((t) => t.cost > 0);
    const build = (keyOf) => {
        const map = new Map();
        let totalCost = 0;
        let totalTokens = 0;
        for (const t of tasks) {
            const key = keyOf(t);
            if (!key)
                continue;
            const row = map.get(key) ?? {
                key,
                tasks: 0,
                tokens: 0,
                cost: 0,
                durationMs: 0,
                share: 0,
            };
            row.tasks += 1;
            row.tokens += t.totalTokens;
            row.cost += t.cost;
            row.durationMs += t.endTime === null ? 0 : Math.max(0, t.endTime - t.startTime);
            totalCost += t.cost;
            totalTokens += t.totalTokens;
            map.set(key, row);
        }
        const rows = [...map.values()];
        for (const row of rows) {
            row.cost = Math.round(row.cost * 10_000) / 10_000;
            const base = useCost ? totalCost : totalTokens;
            row.share = base > 0 ? Math.round(((useCost ? row.cost : row.tokens) / base) * 1000) / 1000 : 0;
        }
        rows.sort((a, b) => (useCost ? b.cost - a.cost : b.tokens - a.tokens));
        return rows.slice(0, Math.max(1, top));
    };
    return {
        period,
        models: build((t) => t.model || '未知模型'),
        projects: build((t) => t.project || '（未命名项目）'),
    };
}
/** 时长格式化（面板展示）。 */
export function formatDuration(ms) {
    if (ms < 1_000)
        return `${ms}ms`;
    const totalSeconds = Math.floor(ms / 1_000);
    const hours = Math.floor(totalSeconds / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0)
        return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0)
        return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}
// ---------------------------------------------------------------------------
// 时间序列（柱状图数据）：today 按小时、week/month 按天、all 按月（≤24 桶）
// ---------------------------------------------------------------------------
const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
/** “全部”视图最多保留的月桶数（更早的只进汇总，不进图）。 */
const MAX_MONTH_BUCKETS = 24;
export async function computeSeries(store, period, now = new Date()) {
    const { from, to } = periodRange(period, now);
    const tasks = await store.listTasksBetween(period === 'all' ? 0 : from, period === 'all' ? Number.MAX_SAFE_INTEGER : to);
    /** 任务 startTime → 桶 key（today=小时、week/month=天、all=月）。 */
    const bucketKeyOf = (t) => {
        if (period === 'today')
            return `h${new Date(t).getHours()}`;
        if (period === 'all') {
            const d = new Date(t);
            return `m${d.getFullYear()}-${d.getMonth()}`;
        }
        const d = new Date(t);
        d.setHours(0, 0, 0, 0);
        return `d${d.getTime()}`;
    };
    const buckets = [];
    const index = new Map();
    const add = (key, label) => {
        const bucket = { key, label, tokens: 0, tasks: 0, cost: 0, durationMs: 0 };
        buckets.push(bucket);
        index.set(key, bucket);
    };
    const put = (task) => {
        const bucket = index.get(bucketKeyOf(task.startTime));
        if (!bucket)
            return;
        bucket.tokens += task.totalTokens;
        bucket.tasks += 1;
        bucket.cost += task.cost;
        bucket.durationMs +=
            task.endTime === null ? 0 : Math.max(0, task.endTime - task.startTime);
    };
    if (period === 'today') {
        for (let h = 0; h < 24; h += 1)
            add(`h${h}`, `${h}时`);
        for (const task of tasks)
            put(task);
    }
    else if (period === 'week' || period === 'month') {
        for (let d = new Date(from); d.getTime() < to; d.setDate(d.getDate() + 1)) {
            add(`d${d.getTime()}`, period === 'week' ? WEEKDAY_NAMES[d.getDay()] : String(d.getDate()));
        }
        for (const task of tasks)
            put(task);
    }
    else {
        // 起点取数据最早月（无数据则当月）；终点取当月；最多保留最近 24 桶。
        let first = now.getTime();
        for (const task of tasks) {
            if (task.startTime < first)
                first = task.startTime;
        }
        const start = new Date(first);
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        const end = new Date(now.getFullYear(), now.getMonth(), 1);
        const keys = [];
        for (let d = new Date(start); d.getTime() <= end.getTime(); d.setMonth(d.getMonth() + 1)) {
            keys.push(`m${d.getFullYear()}-${d.getMonth()}`);
        }
        for (const key of keys.slice(-MAX_MONTH_BUCKETS)) {
            const match = /m(\d+)-(\d+)/.exec(key);
            const label = match !== null
                ? `${Number(match[1])}.${String(Number(match[2]) + 1).padStart(2, '0')}`
                : key;
            add(key, label);
        }
        for (const task of tasks)
            put(task);
    }
    return { period, buckets };
}
