/**
 * 插件独立的“历史对话搜索”。
 *
 * 不依赖 DSH 的 sessionQuery 全文索引（部署可把它配成 openAt:never），
 * 用 sessionQuery.filterEvents 的字面文本扫描做消息命中。
 *
 * 面向“偶尔忘记才搜一次”的用法：
 * - 不做页面预热、不做常驻语料缓存；
 * - 只有实际输入时才扫会话，按 PAGE_SESSIONS 分批返回；
 * - 每批 2 并发，客户端边收边显示，直到扫完全部会话，不设总结果上限；
 * - 标题由客户端本地匹配，turn 只在点击消息时解析。
 */
/** 每批读多少个会话：太大会卡一下，太小请求次数多；8 是渐进和开销的折中。 */
const PAGE_SESSIONS = 8;
const WORKERS = 2;
const CACHE_TTL_MS = 60_000;
const turnCache = new Map();
function normalize(raw) {
    return raw.replace(/\s+/g, ' ').trim().slice(0, 200);
}
function snippetOf(text, query) {
    const flat = text.replace(/\s+/g, ' ').trim();
    const at = flat.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
    if (at < 0)
        return flat.length > 180 ? `${flat.slice(0, 180)}…` : flat;
    const start = Math.max(0, at - 54);
    const end = Math.min(flat.length, at + query.length + 120);
    return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}
async function turnAt(service, sessionId, seq) {
    if (typeof service.readSession !== 'function')
        return undefined;
    const cached = turnCache.get(sessionId);
    let turns = cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS ? cached.turns : undefined;
    if (turns === undefined) {
        try {
            const session = await service.readSession(sessionId);
            const next = [];
            for (const event of session.events) {
                if (event.type === 'turn/start' && typeof event.data?.turn === 'number') {
                    next.push({ seq: event.seq, turn: event.data.turn });
                }
            }
            turns = next;
            turnCache.set(sessionId, { at: Date.now(), turns });
            if (turnCache.size > 20) {
                const oldest = [...turnCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
                if (oldest !== undefined)
                    turnCache.delete(oldest[0]);
            }
        }
        catch {
            return undefined;
        }
    }
    let found;
    for (const entry of turns) {
        if (entry.seq > seq)
            break;
        found = entry.turn;
    }
    return found;
}
function serviceOf(ctx) {
    try {
        return (typeof ctx.get === 'function' ? ctx.get('sessionQuery') : undefined);
    }
    catch {
        return undefined;
    }
}
/** 点击消息时才解析轮次，避免搜索阶段为每条命中读整份会话。 */
export async function resolveHistoryTurn(ctx, sessionId, seq) {
    const service = serviceOf(ctx);
    if (service === undefined || !Number.isSafeInteger(seq) || seq < 0)
        return undefined;
    return turnAt(service, sessionId, seq);
}
/** 按游标分批搜消息；标题由客户端本地匹配。不设总结果上限。 */
export async function searchHistory(ctx, rawQuery, rawCursor = 0) {
    const query = normalize(rawQuery);
    if (query === '')
        return { messages: [], nextCursor: 0, done: true };
    const service = serviceOf(ctx);
    if (service === undefined || typeof service.listSessions !== 'function' || typeof service.filterEvents !== 'function') {
        return { messages: [], nextCursor: 0, done: true, error: '历史搜索不可用：宿主未提供 sessionQuery 服务。' };
    }
    let records;
    try {
        records = await service.listSessions();
    }
    catch (error) {
        return {
            messages: [],
            nextCursor: 0,
            done: true,
            error: `读取会话列表失败：${error instanceof Error ? error.message : String(error)}`,
        };
    }
    const visible = records.filter((record) => record.header.cwd !== undefined);
    const start = Number.isSafeInteger(rawCursor) && rawCursor > 0 ? Math.min(rawCursor, visible.length) : 0;
    const end = Math.min(start + PAGE_SESSIONS, visible.length);
    const page = visible.slice(start, end);
    const filters = [
        { kind: 'surface', values: ['current'] },
        { kind: 'type', values: ['user/message', 'assistant/message'] },
        { kind: 'text', text: query },
    ];
    const messages = [];
    let cursor = 0;
    const worker = async () => {
        while (true) {
            const index = cursor;
            cursor += 1;
            const record = page[index];
            if (record === undefined)
                return;
            try {
                const documents = await service.filterEvents(record.header.id, filters);
                for (const doc of documents) {
                    messages.push({
                        sessionId: record.header.id,
                        snippet: snippetOf(doc.text, query),
                        time: doc.time,
                        type: doc.type,
                        seq: doc.seq,
                    });
                }
            }
            catch {
                /* 单个损坏/不可读会话不应中断整次搜索 */
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(WORKERS, page.length) }, () => worker()));
    return {
        messages,
        nextCursor: end,
        done: end >= visible.length,
    };
}
