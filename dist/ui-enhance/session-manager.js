/**
 * dsh-companion — DSH 会话删除（UI 增强模块：会话管理）。
 *
 * 宿主的 workspace registry（@deepseek-ai/dsh-workspace）只有归档/置顶，
 * 没有「删除会话」；本模块补上这一能力，全部变更走宿主 API，绝不绕过它
 * 直接改写 storages/workspace.json：
 *
 * 1. **registry 除名**：`ctx.get('workspaceRegistry')`（懒取，见 AGENTS 契约 9）
 *    找到会话所在 workspace → `workspace.detachSession()`。宿主的持久化写链
 *    落盘并广播 remove mutation 帧，GUI 侧栏行实时消失（client 的
 *    handleSessionRemoved 协议宿主自带，无需我们碰 DOM 状态）。
 * 2. **全局集合清理**：`unarchiveSession` / `unpinSession`（宿主文档承诺幂等，
 *    防止已删除的 id 残留在 global.archivedSessionIds / pinnedSessionIds）。
 * 3. **彻底删除（用户明确口径：删除就是删除，不留回收站）**：会话目录
 *    `~/.dsh/sessions/<workspace 编码>/session-<id>` 与投影缓存行
 *    `~/.dsh/storages/session_projcache/sessions/session-<id>.json` 直接
 *    `rm -rf`，**不可恢复**（确认弹窗里已明示）。首版做的是软删回收站，
 *    被用户否掉——别走回头路。
 * 4. **Windows 文件锁**：GUI 打开中的会话持有写锁/句柄，删除可能失败
 *    （EBUSY/EPERM）——除名不受影响（列表已干净），删不掉的路径记入
 *    pending 清单（`<dataDir>/delete-pending.json`），默认每 5 分钟补删，
 *    直到真删掉为止。
 *
 * 安全闸门（删除前拒绝，返回 session-active）：
 * - 宿主 `workspace/session-activity` waterfall 只读探测（archiveSession 的
 *   活动检查同源，零副作用——不动归档集合、不发通知）；
 * - companion 自己的 tracker 正在跟踪该会话的运行中任务。
 *
 * 依赖全部可注入（registry / activity / remove / 时钟），可脱离宿主测试。
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
/** 单次批量删除上限（防误传巨数组拖死宿主写队列）。 */
const MAX_BATCH = 500;
/** 会话 id 白名单形状（它是目录名的一段，必须杜绝路径穿越）。 */
const SESSION_ID_PATTERN = /^session-[0-9a-fA-F][0-9a-fA-F-]{6,64}$/;
const RETRY_DEFAULT_MS = 5 * 60_000;
async function pathExists(target) {
    try {
        await stat(target);
        return true;
    }
    catch {
        return false;
    }
}
/** 递归求目录磁盘占用；单个文件 stat 失败跳过（占用中的文件不致命）。 */
async function dirSize(dir) {
    let total = 0;
    const stack = [dir];
    while (stack.length > 0) {
        const current = stack.pop();
        let entries;
        try {
            entries = await readdir(current, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            const full = join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
            }
            else if (entry.isFile()) {
                try {
                    total += (await stat(full)).size;
                }
                catch {
                    /* 跳过 */
                }
            }
        }
    }
    return total;
}
async function defaultRemove(target) {
    // force：路径已不存在不算错（pending 重试会重复删）；maxRetries 缓解
    // Windows 杀软/索引器的瞬时句柄占用。
    await rm(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 120 });
}
/** pending 条目里真正待删的路径（兼容旧版 sourceDir 字段名）。 */
function pendingTargets(entry) {
    const dir = entry.sessionDir ?? entry.sourceDir ?? null;
    const targets = [];
    if (typeof dir === 'string' && dir !== '')
        targets.push(dir);
    if (typeof entry.projcacheFile === 'string' && entry.projcacheFile !== '') {
        targets.push(entry.projcacheFile);
    }
    return targets;
}
export class SessionDeleter {
    deps;
    timer = null;
    retryBusy = false;
    constructor(deps) {
        this.deps = deps;
    }
    /** 启动 pending 补删定时器（effect 内调用；unref 不阻塞进程退出）。 */
    start() {
        if (this.timer !== null)
            return;
        void this.retryPending();
        const every = this.deps.retryIntervalMs ?? RETRY_DEFAULT_MS;
        this.timer = setInterval(() => void this.retryPending(), every);
        this.timer.unref?.();
    }
    stop() {
        if (this.timer !== null)
            clearInterval(this.timer);
        this.timer = null;
    }
    /** 删除一个 DSH 会话：registry 除名 + 全局集合清理 + 文件彻底删除。 */
    async delete(sessionId) {
        if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
            return { ok: false, error: 'bad-request', message: '无效的 sessionId' };
        }
        // getRegistry/isTrackedRunning 都是宿主侧回调，任何异常都不得穿透
        // delete()（否则 HTTP 层只剩 text 500，客户端看不到原因）。
        let registry;
        try {
            registry = this.deps.getRegistry();
        }
        catch {
            registry = null;
        }
        if (!registry) {
            return { ok: false, error: 'registry-unavailable', message: '宿主工作区注册表不可用' };
        }
        let workspace;
        try {
            workspace = registry.list().find((w) => w.sessionIds.includes(sessionId));
        }
        catch (error) {
            return { ok: false, error: 'internal', message: `读取注册表失败: ${error.message}` };
        }
        if (!workspace) {
            // 宿主承诺「归档从不触碰 workspace 槽位」，正常会话必有归属；兜底
            // 放行只存在于全局归档/置顶集合的无归属 id（同样可删）。
            const inGlobal = this.readIdSet(registry, 'archivedSessionIds').has(sessionId) ||
                this.readIdSet(registry, 'pinnedSessionIds').has(sessionId);
            if (!inGlobal) {
                return { ok: false, error: 'session-not-found', message: `会话 ${sessionId} 不在任何工作区中` };
            }
        }
        // 安全闸门 ①：companion 自己跟踪的运行中任务（探测异常按未运行处理，
        // 宿主活动探测仍是主闸门）。
        let trackedRunning = false;
        try {
            trackedRunning = this.deps.isTrackedRunning(sessionId);
        }
        catch {
            trackedRunning = false;
        }
        if (trackedRunning) {
            return { ok: false, error: 'session-active', message: '该会话有运行中的任务，无法删除' };
        }
        // 安全闸门 ②：宿主活动探测（只读；探测失败不阻塞——删不掉的文件有 pending 兜底）。
        try {
            const activity = await this.deps.queryActivity(sessionId);
            if (activity.length > 0) {
                return {
                    ok: false,
                    error: 'session-active',
                    message: `会话正在活动（${activity.map((a) => a.kind).join('、')}），无法删除`,
                };
            }
        }
        catch {
            /* 探测不可用视为不活跃 */
        }
        // ① registry 除名（GUI 列表实时消失）；无归属 id 跳过。
        if (workspace) {
            try {
                await workspace.detachSession(sessionId);
            }
            catch (error) {
                return { ok: false, error: 'internal', message: `会话除名失败: ${error.message}` };
            }
        }
        // ② 全局归档/置顶集合清理（幂等；失败不影响删除结果）。
        await registry.unarchiveSession(sessionId).catch(() => { });
        await registry.unpinSession(sessionId).catch(() => { });
        // ③ 文件彻底删除。
        const deletedAt = (this.deps.now ?? Date.now)();
        const sessionDir = await this.findSessionDir(sessionId);
        const projcacheFile = await this.findProjcache(sessionId);
        if (sessionDir === null && projcacheFile === null) {
            // 冷会话从未落盘：没有文件可删，除名即完成。
            return { ok: true, sessionId, workspaceId: workspace?.id ?? null, deleted: false, pending: false };
        }
        const remove = this.deps.remove ?? defaultRemove;
        let lastError = null;
        for (const target of [sessionDir, projcacheFile]) {
            if (target === null)
                continue;
            try {
                await remove(target);
            }
            catch (error) {
                // 被占用（GUI 打开中的会话在 Windows 上持有句柄）：记 pending 补删。
                lastError = error.message;
            }
        }
        if (lastError === null) {
            return { ok: true, sessionId, workspaceId: workspace?.id ?? null, deleted: true, pending: false };
        }
        await this.appendPending({
            sessionId,
            sessionDir,
            projcacheFile,
            deletedAt,
            lastError,
        }).catch(() => { });
        return { ok: true, sessionId, workspaceId: workspace?.id ?? null, deleted: false, pending: true };
    }
    /**
     * 列出 registry 里的全部会话（含归档/置顶），附标题、磁盘占用、最后活动。
     * 标题/消息数取自 projcache 投影行（rows.title.val / rows.titleInput.val.count）；
     * 归档会话保留 workspace 槽位（宿主承诺），无归属的边角 id 兜底并入。
     */
    async listSessions() {
        let registry;
        try {
            registry = this.deps.getRegistry();
        }
        catch {
            registry = null;
        }
        if (!registry) {
            return { ok: false, error: 'registry-unavailable', message: '宿主工作区注册表不可用' };
        }
        let workspaces;
        try {
            workspaces = registry.list();
        }
        catch (error) {
            return { ok: false, error: 'internal', message: `读取注册表失败: ${error.message}` };
        }
        const archived = this.readIdSet(registry, 'archivedSessionIds');
        const pinned = this.readIdSet(registry, 'pinnedSessionIds');
        // 归属映射（首个命中的 workspace 生效）+ 稳定顺序；全局集合里无归属的 id 并入尾部。
        const owner = new Map();
        const order = [];
        for (const ws of workspaces) {
            let ids = [];
            try {
                ids = ws.sessionIds;
            }
            catch {
                ids = [];
            }
            for (const id of ids) {
                if (!owner.has(id)) {
                    owner.set(id, ws);
                    order.push(id);
                }
            }
        }
        for (const id of [...archived, ...pinned]) {
            if (!owner.has(id))
                order.push(id);
        }
        const sessions = [];
        let totalSizeBytes = 0;
        for (const id of order) {
            // 只收录会话形状的 id（registry 理论上不会混入别的，防御一手）。
            if (!SESSION_ID_PATTERN.test(id))
                continue;
            const ws = owner.get(id) ?? null;
            const dir = await this.findSessionDir(id);
            let sizeBytes = null;
            let lastActivityAt = null;
            if (dir !== null) {
                sizeBytes = await dirSize(dir);
                totalSizeBytes += sizeBytes;
                const dirStat = await this.statOrNull(dir);
                if (dirStat !== null)
                    lastActivityAt = dirStat.mtimeMs;
            }
            const pcPath = join(this.deps.dshHome, 'storages', 'session_projcache', 'sessions', `${id}.json`);
            let title = null;
            let messageCount = null;
            const pcStat = await this.statOrNull(pcPath);
            if (pcStat !== null) {
                try {
                    const data = JSON.parse(await readFile(pcPath, 'utf8'));
                    const rows = data?.record?.rows;
                    if (typeof rows?.title?.val === 'string')
                        title = rows.title.val;
                    const count = rows?.titleInput?.val?.count;
                    if (typeof count === 'number')
                        messageCount = count;
                }
                catch {
                    /* 缓存行损坏只影响标题/消息数展示 */
                }
                if (lastActivityAt === null || pcStat.mtimeMs > lastActivityAt)
                    lastActivityAt = pcStat.mtimeMs;
            }
            sessions.push({
                sessionId: id,
                title,
                workspaceId: ws?.id ?? null,
                workspacePath: ws?.path ?? null,
                workspaceTitle: ws?.title ?? null,
                archived: archived.has(id),
                pinned: pinned.has(id),
                messageCount,
                sizeBytes,
                hasFiles: dir !== null || pcStat !== null,
                lastActivityAt,
            });
        }
        // 最近活动在前；未知时间垫底。
        sessions.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
        return { ok: true, sessions, totalSizeBytes };
    }
    /** 批量彻底删除：逐个走单删全闸门，聚合结果（单个失败不中断整批）。 */
    async deleteMany(sessionIds) {
        if (!Array.isArray(sessionIds) || sessionIds.length === 0 || sessionIds.length > MAX_BATCH) {
            return { ok: false, error: 'bad-request', message: `sessionIds 必须是 1..${MAX_BATCH} 项的数组` };
        }
        const results = [];
        let deletedCount = 0;
        let failedCount = 0;
        for (const raw of sessionIds) {
            const id = typeof raw === 'string' ? raw : '';
            const outcome = await this.delete(id);
            if (outcome.ok) {
                deletedCount += 1;
                results.push({ sessionId: id, ok: true, deleted: outcome.deleted, pending: outcome.pending });
            }
            else {
                failedCount += 1;
                results.push({ sessionId: id, ok: false, error: outcome.error, message: outcome.message });
            }
        }
        return { ok: true, results, deletedCount, failedCount };
    }
    /** 补删所有 pending 的文件（定时器与 start 调用；串行防重入）。 */
    async retryPending() {
        if (this.retryBusy)
            return;
        this.retryBusy = true;
        try {
            const entries = await this.readPending();
            if (entries.length === 0)
                return;
            const remove = this.deps.remove ?? defaultRemove;
            const remaining = [];
            for (const entry of entries) {
                let lastError = null;
                for (const target of pendingTargets(entry)) {
                    try {
                        await remove(target);
                    }
                    catch (error) {
                        lastError = error.message;
                    }
                }
                if (lastError !== null)
                    remaining.push({ ...entry, lastError });
            }
            await this.writePending(remaining);
        }
        finally {
            this.retryBusy = false;
        }
    }
    // -------------------------------------------------------------------------
    /** 防御性读 registry 全局 id 集合（getter 未就绪会抛；异常按空集处理）。 */
    readIdSet(registry, key) {
        try {
            const ids = registry[key];
            return Array.isArray(ids) ? new Set(ids) : new Set();
        }
        catch {
            return new Set();
        }
    }
    async statOrNull(target) {
        try {
            const s = await stat(target);
            return { mtimeMs: s.mtimeMs, size: s.size };
        }
        catch {
            return null;
        }
    }
    /** 扫描 ~/.dsh/sessions/<workspace 编码>/ 找到会话目录（不依赖编码规则）。 */
    async findSessionDir(sessionId) {
        const root = join(this.deps.dshHome, 'sessions');
        let encoded;
        try {
            const entries = await readdir(root, { withFileTypes: true });
            encoded = entries.filter((e) => e.isDirectory()).map((e) => e.name);
        }
        catch {
            return null;
        }
        for (const name of encoded) {
            const candidate = join(root, name, sessionId);
            try {
                if ((await stat(candidate)).isDirectory())
                    return candidate;
            }
            catch {
                /* 下一个编码目录 */
            }
        }
        return null;
    }
    async findProjcache(sessionId) {
        const candidate = join(this.deps.dshHome, 'storages', 'session_projcache', 'sessions', `${sessionId}.json`);
        return (await pathExists(candidate)) ? candidate : null;
    }
    async readPending() {
        try {
            const raw = await readFile(this.deps.pendingFile, 'utf8');
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed)
                ? parsed.filter((e) => e && typeof e.sessionId === 'string')
                : [];
        }
        catch {
            return [];
        }
    }
    async writePending(entries) {
        await mkdir(dirname(this.deps.pendingFile), { recursive: true });
        await writeFile(this.deps.pendingFile, JSON.stringify(entries, null, 2), 'utf8');
    }
    async appendPending(entry) {
        const entries = await this.readPending();
        entries.push(entry);
        await this.writePending(entries);
    }
}
