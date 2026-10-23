/**
 * dsh-companion — 余额台账聚合。
 *
 * 钱包余额是**存量**：消耗 = 相邻快照的下降量；余额上升按「疑似充值」单列，
 * 不计入消耗（充值/退款/赠金到期都会让差值失真，宁可分开记也不硬算）。
 * 币种变化视为不可归因的跳变（unknown），跳过该段差值。
 *
 * 日/月口径：以区间起点前最近一条快照为基线，算到区间内最后一条快照——
 * 这样跨天/跨月不会把边界外的变化算进来。
 */
export function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}
export function startOfMonth(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    return d.getTime();
}
export function balancePeriodRange(period, now = Date.now()) {
    return {
        from: period === 'month' ? startOfMonth(now) : startOfDay(now),
        to: now + 1,
    };
}
export function summarizeBalance(input) {
    const now = input.now ?? Date.now();
    const { from, to } = balancePeriodRange(input.period, now);
    const points = input.snapshots
        .filter((s) => s.ts >= from && s.ts < to)
        .slice()
        .sort((a, b) => a.ts - b.ts);
    const result = {
        period: input.period,
        currency: points.length > 0 ? points[points.length - 1].currency : (input.baseline?.currency ?? 'CNY'),
        spent: 0,
        topups: 0,
        unknown: 0,
        start: null,
        end: null,
        samples: points.length,
    };
    if (points.length === 0)
        return result;
    let prev = input.baseline ?? null;
    if (prev && prev.ts >= from)
        prev = null; // 基线必须在区间外
    if (!prev) {
        prev = points[0];
        result.start = prev.normal;
    }
    else {
        result.start = prev.normal;
    }
    for (const cur of points) {
        if (cur === prev)
            continue;
        if (cur.currency !== prev.currency) {
            result.unknown += 1;
            prev = cur;
            continue;
        }
        const delta = prev.normal - cur.normal;
        if (delta > 0)
            result.spent += delta;
        else if (delta < 0)
            result.topups += -delta;
        prev = cur;
    }
    result.end = points[points.length - 1].normal;
    if (result.start === null)
        result.start = result.end;
    return result;
}
