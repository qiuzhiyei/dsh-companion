/**
 * dsh-companion — 告警记录（面板「告警记录」卡的数据源）。
 *
 * 气泡/Toast 是瞬时呈现，用户没盯着屏幕就错过了；这里把四类告警落到
 * `<dataDir>/alerts.json` 的环形日志（默认 50 条），页面随时可回查。
 *
 * 取舍：
 * - 独立小文件而不是动 SQLite schema——告警是低频旁路数据，坏了丢了不影响统计，
 *   也不值得为它加迁移；
 * - 写入串行化（队列）避免并发写互相截断；失败只 warn，不影响任务落库；
 * - 读取时逐条校验，坏行丢弃（老文件/手改文件都不至于把面板带崩）。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
const TYPES = ['budget', 'balance', 'failed', 'interrupted'];
const LEVELS = ['warn', 'error', 'info'];
const MAX_TEXT = 240;
function isEntry(value) {
    if (value === null || typeof value !== 'object')
        return false;
    const row = value;
    return (typeof row.id === 'string' &&
        Number.isFinite(row.time) &&
        TYPES.includes(row.type) &&
        LEVELS.includes(row.level) &&
        typeof row.text === 'string' &&
        row.text.length > 0);
}
export class AlertLog {
    file;
    max;
    entries = [];
    loaded = false;
    /** 写入队列：并发 record 不互相截断文件。 */
    queue = Promise.resolve();
    constructor(file, max = 50) {
        this.file = file;
        this.max = max;
    }
    /** 启动时读一次；文件缺失/损坏都从空日志开始（告警不是关键数据）。 */
    async load() {
        this.loaded = true;
        try {
            const raw = JSON.parse(await readFile(this.file, 'utf8'));
            if (!Array.isArray(raw))
                return;
            this.entries = raw.filter(isEntry).slice(0, this.max);
        }
        catch {
            this.entries = [];
        }
    }
    /** 追加一条（最新的在前）。校验失败返回 null，不写盘。 */
    async record(input) {
        if (!this.loaded)
            await this.load();
        const text = String(input.text ?? '').trim().slice(0, MAX_TEXT);
        if (!TYPES.includes(input.type) || !LEVELS.includes(input.level) || !text)
            return null;
        const time = Number.isFinite(input.time) ? Number(input.time) : Date.now();
        const entry = {
            id: randomUUID(),
            time,
            type: input.type,
            level: input.level,
            text,
        };
        this.entries.unshift(entry);
        if (this.entries.length > this.max)
            this.entries.length = this.max;
        await this.persist();
        return entry;
    }
    /** 最近 limit 条（新的在前）。 */
    list(limit = 5) {
        const n = Math.max(1, Math.min(50, Math.round(limit) || 5));
        return this.entries.slice(0, n);
    }
    persist() {
        const snapshot = JSON.stringify(this.entries, null, 2);
        this.queue = this.queue
            .then(async () => {
            await mkdir(dirname(this.file), { recursive: true });
            await writeFile(this.file, snapshot, 'utf8');
        })
            .catch((error) => {
            console.warn('[dsh-companion] 告警记录写入失败:', error.message);
        });
        return this.queue;
    }
}
