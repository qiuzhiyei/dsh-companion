/**
 * dsh-companion — 数据导出（CSV / JSON）。
 *
 * CSV 遵循 RFC 4180 风格转义（BOM 头保证 Excel 中文不乱码）；
 * JSON 输出完整带 schemaVersion 的结构。
 */
const TASK_CSV_FIELDS = [
    'id',
    'sessionId',
    'turn',
    'project',
    'workspace',
    'provider',
    'model',
    'startTime',
    'endTime',
    'status',
    'promptTokens',
    'completionTokens',
    'totalTokens',
    'cachedTokens',
    'reasoningTokens',
    'cost',
    'toolCalls',
    'toolSuccess',
    'toolFail',
    'steps',
    'tags',
    'note',
];
const TOOL_CSV_FIELDS = [
    'id',
    'taskKey',
    'callId',
    'name',
    'startTime',
    'endTime',
    'status',
];
function csvEscape(value) {
    if (value === null || value === undefined)
        return '';
    let text = String(value);
    if (typeof value === 'object')
        text = JSON.stringify(value);
    if (/[",\r\n]/.test(text)) {
        return `"${text.replaceAll('"', '""')}"`;
    }
    return text;
}
function rowsToCsv(fields, rows) {
    const lines = [fields.join(',')];
    for (const row of rows) {
        lines.push(fields.map((field) => csvEscape(row[field])).join(','));
    }
    return `\uFEFF${lines.join('\r\n')}\r\n`;
}
export async function exportSessions(store, format, limit = 5_000, filter) {
    // 带筛选时走 queryTasks（与历史页同一套 WHERE），否则全量 dump。
    const filtered = filter && hasFilter(filter);
    const tasks = filtered
        ? (await store.queryTasks({ ...filter, limit, offset: 0 })).tasks
        : await store.listTasks(limit);
    if (format === 'csv') {
        return {
            filename: `dsh-companion-sessions-${stamp()}.csv`,
            contentType: 'text/csv; charset=utf-8',
            body: rowsToCsv(TASK_CSV_FIELDS, tasks),
        };
    }
    return {
        filename: `dsh-companion-sessions-${stamp()}.json`,
        contentType: 'application/json; charset=utf-8',
        body: `${JSON.stringify({ schemaVersion: 1, exportedAt: Date.now(), tasks }, null, 2)}\n`,
    };
}
export async function exportToolCalls(store, format, limit = 20_000) {
    const tools = await store.listToolCalls(limit);
    if (format === 'csv') {
        return {
            filename: `dsh-companion-tool-calls-${stamp()}.csv`,
            contentType: 'text/csv; charset=utf-8',
            body: rowsToCsv(TOOL_CSV_FIELDS, tools),
        };
    }
    return {
        filename: `dsh-companion-tool-calls-${stamp()}.json`,
        contentType: 'application/json; charset=utf-8',
        body: `${JSON.stringify({ schemaVersion: 1, exportedAt: Date.now(), toolCalls: tools }, null, 2)}\n`,
    };
}
function hasFilter(filter) {
    return Boolean((filter.model && filter.model.length > 0) ||
        filter.status ||
        (filter.fromMs && filter.fromMs > 0) ||
        (filter.toMs && filter.toMs > 0) ||
        (filter.q && filter.q.length > 0));
}
function stamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}
