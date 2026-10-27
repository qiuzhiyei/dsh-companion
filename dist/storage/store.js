/**
 * dsh-companion — 持久化层。
 *
 * 首选 Node 内置 node:sqlite（Node ≥ 22.5，宿主 24.x，无原生依赖）；
 * 不可用时降级为 JSON 文件（原子写）。两种实现共享 PetStore 接口，
 * 上层（统计/导出/UI）完全不感知后端差异。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DEFAULT_MODEL_PRICES, DEFAULT_SETTINGS } from '../types.js';
export const EMPTY_AGGREGATE = {
    tasks: 0,
    success: 0,
    failed: 0,
    interrupted: 0,
    other: 0,
    totalDurationMs: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    cost: 0,
    toolCalls: 0,
    toolSuccess: 0,
    toolFail: 0,
};
// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------
function parseTags(text) {
    try {
        const value = JSON.parse(text);
        return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
    }
    catch {
        return [];
    }
}
function durationOf(task) {
    if (task.endTime === null)
        return 0;
    return Math.max(0, task.endTime - task.startTime);
}
function toAggregate(tasks) {
    const stats = { ...EMPTY_AGGREGATE };
    for (const task of tasks) {
        stats.tasks += 1;
        if (task.status === 'success' || task.status === 'max-tokens')
            stats.success += 1;
        else if (task.status === 'failed')
            stats.failed += 1;
        else if (task.status === 'interrupted')
            stats.interrupted += 1;
        else
            stats.other += 1;
        stats.totalDurationMs += durationOf(task);
        stats.promptTokens += task.promptTokens;
        stats.completionTokens += task.completionTokens;
        stats.totalTokens += task.totalTokens;
        stats.cachedTokens += task.cachedTokens;
        stats.cost += task.cost;
        stats.toolCalls += task.toolCalls;
        stats.toolSuccess += task.toolSuccess;
        stats.toolFail += task.toolFail;
    }
    return stats;
}
const SETTINGS_KEY = 'settings';
/** 摸鱼提醒间隔：整数分钟，夹在 5..480；非法值回默认 60。 */
function clampRestMinutes(v) {
    const n = Number(v);
    if (!Number.isFinite(n))
        return DEFAULT_SETTINGS.restReminder.intervalMinutes;
    return Math.min(480, Math.max(5, Math.round(n)));
}
/** 余额采样间隔：整数分钟，夹在 5..1440；非法值回默认 30。 */
export function clampBalanceMinutes(v) {
    const n = Number(v);
    if (!Number.isFinite(n))
        return DEFAULT_SETTINGS.balance.intervalMinutes;
    return Math.min(1440, Math.max(5, Math.round(n)));
}
function mergeSettings(value) {
    if (typeof value !== 'object' || value === null)
        return { ...DEFAULT_SETTINGS };
    const raw = value;
    const prices = {};
    if (raw.modelPrices && typeof raw.modelPrices === 'object') {
        for (const [model, price] of Object.entries(raw.modelPrices)) {
            if (price &&
                typeof price.inputPerMillion === 'number' &&
                typeof price.outputPerMillion === 'number') {
                prices[model] = {
                    inputPerMillion: price.inputPerMillion,
                    outputPerMillion: price.outputPerMillion,
                };
                // 缓存命中单价可选保留（缺省时 computeCost 退回 input 价）。
                const cachePrice = price.cacheInputPerMillion;
                if (typeof cachePrice === 'number')
                    prices[model].cacheInputPerMillion = cachePrice;
            }
        }
    }
    return {
        skin: typeof raw.skin === 'string' ? raw.skin : DEFAULT_SETTINGS.skin,
        // 迁移标记必须如实持久化，否则每次启动都会重跑迁移、覆盖用户后来的显式选择。
        whaleMigrated: raw.whaleMigrated === true,
        monitorRemoved: raw.monitorRemoved === true,
        restReminder: {
            enabled: raw.restReminder?.enabled !== false,
            intervalMinutes: clampRestMinutes(raw.restReminder?.intervalMinutes),
        },
        position: raw.position && typeof raw.position.x === 'number' && typeof raw.position.y === 'number'
            ? { x: raw.position.x, y: raw.position.y }
            : null,
        opacity: typeof raw.opacity === 'number' ? raw.opacity : DEFAULT_SETTINGS.opacity,
        scale: typeof raw.scale === 'number' ? raw.scale : DEFAULT_SETTINGS.scale,
        clickThrough: raw.clickThrough === true,
        privacyMode: raw.privacyMode === true,
        showPet: raw.showPet !== false,
        purePetMode: raw.purePetMode === true,
        notify: raw.notify !== false,
        paused: raw.paused === true,
        autoStart: raw.autoStart !== false,
        currency: typeof raw.currency === 'string' ? raw.currency : DEFAULT_SETTINGS.currency,
        modelPrices: Object.keys(prices).length > 0 ? prices : { ...DEFAULT_SETTINGS.modelPrices },
        budget: {
            taskMaxTokens: raw.budget?.taskMaxTokens ?? null,
            taskMaxCost: raw.budget?.taskMaxCost ?? null,
            dailyMaxTokens: raw.budget?.dailyMaxTokens ?? null,
            dailyMaxCost: raw.budget?.dailyMaxCost ?? null,
        },
        balance: {
            enabled: raw.balance?.enabled === true,
            intervalMinutes: clampBalanceMinutes(raw.balance?.intervalMinutes),
        },
    };
}
const TASK_COLUMNS = `id TEXT PRIMARY KEY, sessionId TEXT NOT NULL, turn INTEGER NOT NULL,
  project TEXT NOT NULL DEFAULT '', workspace TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
  startTime INTEGER NOT NULL, endTime INTEGER, status TEXT NOT NULL,
  promptTokens INTEGER NOT NULL DEFAULT 0, completionTokens INTEGER NOT NULL DEFAULT 0,
  totalTokens INTEGER NOT NULL DEFAULT 0, cachedTokens INTEGER NOT NULL DEFAULT 0,
  reasoningTokens INTEGER NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0,
  toolCalls INTEGER NOT NULL DEFAULT 0, toolSuccess INTEGER NOT NULL DEFAULT 0,
  toolFail INTEGER NOT NULL DEFAULT 0, steps INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '[]', note TEXT NOT NULL DEFAULT ''`;
export class SqlitePetStore {
    dbPath;
    backend = 'sqlite';
    db = null;
    constructor(dbPath) {
        this.dbPath = dbPath;
    }
    async init() {
        // 动态 import：环境不支持 node:sqlite 时抛错，由 openPetStore 降级。
        const { DatabaseSync } = (await import('node:sqlite'));
        await mkdir(dirname(this.dbPath), { recursive: true });
        this.db = new DatabaseSync(this.dbPath);
        this.db.exec('PRAGMA journal_mode = WAL');
        this.db.exec(`CREATE TABLE IF NOT EXISTS task_sessions (${TASK_COLUMNS})`);
        // 注：早期版本加过 finalContextTokens 列，现已弃用；旧库残留该列不影响读写。
        // tool_calls 明细表已退役（无消费方，仅导出 CSV 一条死路）：老库直接删表回收空间。
        this.db.exec('DROP TABLE IF EXISTS tool_calls');
        this.db.exec(`CREATE TABLE IF NOT EXISTS pet_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
        this.db.exec(`CREATE TABLE IF NOT EXISTS balance_snapshots (
      ts INTEGER PRIMARY KEY, currency TEXT NOT NULL, normal REAL NOT NULL DEFAULT 0,
      bonus REAL NOT NULL DEFAULT 0, totalCosts REAL, source TEXT NOT NULL DEFAULT '')`);
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_start ON task_sessions(startTime)');
    }
    async close() {
        this.db?.close();
        this.db = null;
    }
    async loadSettings() {
        const row = this.must().prepare('SELECT value FROM pet_settings WHERE key = ?').get(SETTINGS_KEY);
        if (!row)
            return { ...DEFAULT_SETTINGS };
        try {
            return mergeSettings(JSON.parse(row.value));
        }
        catch {
            return { ...DEFAULT_SETTINGS };
        }
    }
    async saveSettings(settings) {
        this.must()
            .prepare('INSERT INTO pet_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
            .run(SETTINGS_KEY, JSON.stringify(settings));
    }
    async saveTask(task) {
        this.must()
            .prepare(`INSERT INTO task_sessions (id, sessionId, turn, project, workspace, provider, model,
          startTime, endTime, status, promptTokens, completionTokens, totalTokens, cachedTokens,
          reasoningTokens, cost, toolCalls, toolSuccess, toolFail, steps, tags, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          endTime = excluded.endTime, status = excluded.status,
          promptTokens = excluded.promptTokens, completionTokens = excluded.completionTokens,
          totalTokens = excluded.totalTokens, cachedTokens = excluded.cachedTokens,
          reasoningTokens = excluded.reasoningTokens, cost = excluded.cost,
          toolCalls = excluded.toolCalls, toolSuccess = excluded.toolSuccess,
          toolFail = excluded.toolFail, steps = excluded.steps,
          tags = excluded.tags, note = excluded.note`)
            .run(task.id, task.sessionId, task.turn, task.project, task.workspace, task.provider, task.model, task.startTime, task.endTime, task.status, task.promptTokens, task.completionTokens, task.totalTokens, task.cachedTokens, task.reasoningTokens, task.cost, task.toolCalls, task.toolSuccess, task.toolFail, task.steps, JSON.stringify(task.tags), task.note);
    }
    async listTasks(limit, offset = 0) {
        const rows = this.must()
            .prepare(`SELECT * FROM task_sessions ORDER BY startTime DESC, id DESC LIMIT ? OFFSET ?`)
            .all(Math.max(1, limit), offset);
        return rows.map(rowToTask);
    }
    async listTasksBetween(fromMs, toMs) {
        const rows = this.must()
            .prepare(`SELECT * FROM task_sessions WHERE startTime >= ? AND startTime < ? ORDER BY startTime ASC, id ASC`)
            .all(fromMs, toMs);
        return rows.map(rowToTask);
    }
    async queryTasks(query) {
        const where = [];
        const args = [];
        if (query.model) {
            where.push('model = ?');
            args.push(query.model);
        }
        if (query.status) {
            where.push('status = ?');
            args.push(query.status);
        }
        if (query.fromMs) {
            where.push('startTime >= ?');
            args.push(query.fromMs);
        }
        if (query.toMs) {
            where.push('startTime < ?');
            args.push(query.toMs);
        }
        if (query.q) {
            where.push("project LIKE ? ESCAPE '\\'");
            args.push('%' + query.q.replace(/[%_\\]/g, (m) => '\\' + m) + '%');
        }
        const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
        const db = this.must();
        const totalRow = db.prepare('SELECT COUNT(*) AS n FROM task_sessions' + whereSql).get(...args);
        const rows = db
            .prepare('SELECT * FROM task_sessions' + whereSql + ' ORDER BY startTime DESC, id DESC LIMIT ? OFFSET ?')
            .all(...args, Math.max(1, query.limit), query.offset ?? 0);
        return { tasks: rows.map(rowToTask), total: Number(totalRow.n) || 0 };
    }
    async countTasks() {
        const row = this.must().prepare('SELECT COUNT(*) AS n FROM task_sessions').get();
        return Number(row.n) || 0;
    }
    async listModels() {
        const rows = this.must()
            .prepare(`SELECT DISTINCT model FROM task_sessions WHERE model IS NOT NULL AND model <> '' ORDER BY model`)
            .all();
        return rows.map((row) => row.model);
    }
    async lastKnownRoute(sessionId) {
        const row = this.must()
            .prepare(`SELECT provider, model FROM task_sessions
          WHERE sessionId = ? AND model IS NOT NULL AND model <> ''
          ORDER BY startTime DESC LIMIT 1`)
            .get(sessionId);
        return row ? { provider: row.provider ?? '', model: row.model } : null;
    }
    async backfillMissingModels() {
        const db = this.must();
        const missing = db
            .prepare(`SELECT id, sessionId, startTime FROM task_sessions WHERE model IS NULL OR model = ''`)
            .all();
        if (missing.length === 0)
            return 0;
        const nearestStmt = db.prepare(`SELECT provider, model FROM task_sessions
        WHERE sessionId = ? AND model IS NOT NULL AND model <> ''
        ORDER BY ABS(startTime - ?) ASC LIMIT 1`);
        const updateStmt = db.prepare(`UPDATE task_sessions SET provider = ?, model = ? WHERE id = ?`);
        let fixed = 0;
        for (const row of missing) {
            const nearest = nearestStmt.get(row.sessionId, row.startTime);
            if (!nearest)
                continue;
            updateStmt.run(nearest.provider ?? '', nearest.model, row.id);
            fixed++;
        }
        return fixed;
    }
    async statsBetween(fromMs, toMs) {
        const rows = this.must()
            .prepare(`SELECT status, startTime, endTime, promptTokens, completionTokens, totalTokens,
          cachedTokens, cost, toolCalls, toolSuccess, toolFail FROM task_sessions
         WHERE startTime >= ? AND startTime < ?`)
            .all(fromMs, toMs);
        return toAggregate(rows.map(rowToTask));
    }
    async saveBalanceSnapshot(snapshot) {
        this.must()
            .prepare(`INSERT INTO balance_snapshots (ts, currency, normal, bonus, totalCosts, source)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(ts) DO UPDATE SET
          currency = excluded.currency, normal = excluded.normal, bonus = excluded.bonus,
          totalCosts = excluded.totalCosts, source = excluded.source`)
            .run(Math.round(snapshot.ts), snapshot.currency, snapshot.normal, snapshot.bonus, snapshot.totalCosts, snapshot.source);
    }
    async listBalanceSnapshots(fromMs, toMs) {
        const rows = this.must()
            .prepare(`SELECT * FROM balance_snapshots WHERE ts >= ? AND ts < ? ORDER BY ts ASC`)
            .all(fromMs, toMs);
        return rows.map(rowToBalance);
    }
    async latestBalanceSnapshot(beforeMs) {
        const row = typeof beforeMs === 'number'
            ? this.must()
                .prepare(`SELECT * FROM balance_snapshots WHERE ts < ? ORDER BY ts DESC LIMIT 1`)
                .get(beforeMs)
            : this.must()
                .prepare(`SELECT * FROM balance_snapshots ORDER BY ts DESC LIMIT 1`)
                .get();
        return row ? rowToBalance(row) : null;
    }
    async pruneBalanceSnapshots(cutoffMs) {
        const result = this.must()
            .prepare(`DELETE FROM balance_snapshots WHERE ts < ?`)
            .run(cutoffMs);
        return Number(result?.changes) || 0;
    }
    must() {
        if (!this.db)
            throw new Error('sqlite store not initialized');
        return this.db;
    }
}
export class JsonPetStore {
    jsonPath;
    backend = 'json';
    data = { schemaVersion: 1, tasks: [], settings: null, balances: [] };
    constructor(jsonPath) {
        this.jsonPath = jsonPath;
    }
    async init() {
        await mkdir(dirname(this.jsonPath), { recursive: true });
        try {
            const text = await readFile(this.jsonPath, 'utf8');
            const parsed = JSON.parse(text);
            this.data = {
                schemaVersion: 1,
                tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
                settings: parsed.settings ?? null,
                balances: Array.isArray(parsed.balances) ? parsed.balances : [],
            };
        }
        catch {
            // 首次运行：文件不存在。
        }
    }
    async close() {
        await this.flush();
    }
    async loadSettings() {
        return mergeSettings(this.data.settings);
    }
    async saveSettings(settings) {
        this.data.settings = settings;
        await this.flush();
    }
    async saveTask(task) {
        const index = this.data.tasks.findIndex((item) => item.id === task.id);
        if (index >= 0)
            this.data.tasks[index] = task;
        else
            this.data.tasks.push(task);
        // 防 JSON 无限膨胀：只保留最近 5000 条。
        if (this.data.tasks.length > 5_000) {
            this.data.tasks.sort((a, b) => a.startTime - b.startTime);
            this.data.tasks = this.data.tasks.slice(-5_000);
        }
        await this.flush();
    }
    async listTasks(limit, offset = 0) {
        const sorted = [...this.data.tasks].sort((a, b) => b.startTime - a.startTime);
        return sorted.slice(offset, offset + Math.max(1, limit));
    }
    async queryTasks(query) {
        const needle = (query.q || '').toLowerCase();
        const matched = this.data.tasks.filter((task) => {
            if (query.model && task.model !== query.model)
                return false;
            if (query.status && task.status !== query.status)
                return false;
            if (query.fromMs && task.startTime < query.fromMs)
                return false;
            if (query.toMs && task.startTime >= query.toMs)
                return false;
            if (needle && !(task.project || '').toLowerCase().includes(needle))
                return false;
            return true;
        });
        matched.sort((a, b) => b.startTime - a.startTime);
        const offset = query.offset ?? 0;
        return { tasks: matched.slice(offset, offset + Math.max(1, query.limit)), total: matched.length };
    }
    async listTasksBetween(fromMs, toMs) {
        return this.data.tasks
            .filter((task) => task.startTime >= fromMs && task.startTime < toMs)
            .sort((a, b) => a.startTime - b.startTime);
    }
    async countTasks() {
        return this.data.tasks.length;
    }
    async listModels() {
        return [...new Set(this.data.tasks.map((task) => task.model).filter(Boolean))].sort();
    }
    async lastKnownRoute(sessionId) {
        let best = null;
        for (const task of this.data.tasks) {
            if (task.sessionId !== sessionId || !task.model)
                continue;
            if (!best || task.startTime > best.startTime)
                best = task;
        }
        return best ? { provider: best.provider, model: best.model } : null;
    }
    async backfillMissingModels() {
        const known = this.data.tasks.filter((task) => Boolean(task.model));
        let fixed = 0;
        for (const task of this.data.tasks) {
            if (task.model)
                continue;
            let best = null;
            for (const cand of known) {
                if (cand.sessionId !== task.sessionId)
                    continue;
                if (!best || Math.abs(cand.startTime - task.startTime) < Math.abs(best.startTime - task.startTime)) {
                    best = cand;
                }
            }
            if (!best)
                continue;
            task.provider = best.provider;
            task.model = best.model;
            fixed++;
        }
        if (fixed > 0)
            await this.flush();
        return fixed;
    }
    async statsBetween(fromMs, toMs) {
        const tasks = this.data.tasks.filter((task) => task.startTime >= fromMs && task.startTime < toMs);
        return toAggregate(tasks);
    }
    async saveBalanceSnapshot(snapshot) {
        const ts = Math.round(snapshot.ts);
        const index = this.data.balances.findIndex((item) => item.ts === ts);
        const record = { ...snapshot, ts };
        if (index >= 0)
            this.data.balances[index] = record;
        else
            this.data.balances.push(record);
        this.data.balances.sort((a, b) => a.ts - b.ts);
        // 防 JSON 无限膨胀：只保留最近 4000 条（30 分钟采样约 83 天）。
        if (this.data.balances.length > 4_000)
            this.data.balances = this.data.balances.slice(-4_000);
        await this.flush();
    }
    async listBalanceSnapshots(fromMs, toMs) {
        return this.data.balances.filter((item) => item.ts >= fromMs && item.ts < toMs);
    }
    async latestBalanceSnapshot(beforeMs) {
        for (let i = this.data.balances.length - 1; i >= 0; i -= 1) {
            const item = this.data.balances[i];
            if (typeof beforeMs !== 'number' || item.ts < beforeMs)
                return item;
        }
        return null;
    }
    async pruneBalanceSnapshots(cutoffMs) {
        const before = this.data.balances.length;
        this.data.balances = this.data.balances.filter((item) => item.ts >= cutoffMs);
        const removed = before - this.data.balances.length;
        if (removed > 0)
            await this.flush();
        return removed;
    }
    async flush() {
        const tempPath = `${this.jsonPath}.tmp-${process.pid}`;
        await writeFile(tempPath, JSON.stringify(this.data), 'utf8');
        await rename(tempPath, this.jsonPath);
    }
}
// ---------------------------------------------------------------------------
// 行映射
// ---------------------------------------------------------------------------
function rowToTask(row) {
    return {
        id: String(row.id),
        sessionId: String(row.sessionId ?? ''),
        turn: Number(row.turn ?? 0),
        project: String(row.project ?? ''),
        workspace: String(row.workspace ?? ''),
        provider: String(row.provider ?? ''),
        model: String(row.model ?? ''),
        startTime: Number(row.startTime ?? 0),
        endTime: row.endTime === null || row.endTime === undefined ? null : Number(row.endTime),
        status: (row.status ?? 'success'),
        promptTokens: Number(row.promptTokens ?? 0),
        completionTokens: Number(row.completionTokens ?? 0),
        totalTokens: Number(row.totalTokens ?? 0),
        cachedTokens: Number(row.cachedTokens ?? 0),
        reasoningTokens: Number(row.reasoningTokens ?? 0),
        cost: Number(row.cost ?? 0),
        toolCalls: Number(row.toolCalls ?? 0),
        toolSuccess: Number(row.toolSuccess ?? 0),
        toolFail: Number(row.toolFail ?? 0),
        steps: Number(row.steps ?? 0),
        tags: parseTags(String(row.tags ?? '[]')),
        note: String(row.note ?? ''),
    };
}
function rowToBalance(row) {
    return {
        ts: Number(row.ts ?? 0),
        currency: String(row.currency ?? 'CNY'),
        normal: Number(row.normal ?? 0),
        bonus: Number(row.bonus ?? 0),
        totalCosts: row.totalCosts === null || row.totalCosts === undefined ? null : Number(row.totalCosts),
        source: (row.source ?? 'manual'),
    };
}
export async function openPetStore(dataDir, mode = 'auto') {
    const sqlite = new SqlitePetStore(join(dataDir, 'pet.sqlite'));
    if (mode !== 'json') {
        try {
            await sqlite.init();
            return { store: sqlite, backend: 'sqlite', degraded: false };
        }
        catch (error) {
            if (mode === 'sqlite') {
                throw new Error(`storage mode is sqlite but node:sqlite is unavailable: ${String(error)}`);
            }
            console.warn(`[dsh-companion] node:sqlite unavailable (${String(error)}); falling back to JSON store`);
        }
    }
    const json = new JsonPetStore(join(dataDir, 'pet-data.json'));
    await json.init();
    return { store: json, backend: 'json', degraded: mode !== 'json' };
}
export { toAggregate };
