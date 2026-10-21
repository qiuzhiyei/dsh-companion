/**
 * dsh-companion — 内嵌 UI 服务器（127.0.0.1，HTTP + SSE）。
 *
 * 宿主（DSH desktop-host）不向插件暴露托盘/窗口 API，因此第一版以
 * 本地 Web 服务承载伴侣与面板；真正的桌面级悬浮窗由可选 Electron 壳
 * （electron/）加载同一 URL 实现，见 README“伴侣壳”。
 *
 * 安全边界：仅绑定 loopback；路由白名单；JSON body ≤ 1MB；
 * 皮肤名/状态名白名单字符，杜绝目录穿越。
 */
import { createServer } from 'node:http';
import { panelPageHTML, petPageHTML } from './pages.js';
const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_BODY = 1_000_000;
export class PetServer {
    deps;
    server = null;
    clients = new Set();
    heartbeat = null;
    actualPort = 0;
    actualHost = '';
    constructor(deps) {
        this.deps = deps;
    }
    get url() {
        return `http://${this.actualHost}:${this.actualPort}`;
    }
    get port() {
        return this.actualPort;
    }
    /** 启动（端口被占时自动 +1 重试，最多 10 次）。 */
    async start(host, port) {
        for (let attempt = 0; attempt <= 10; attempt += 1) {
            const candidate = port + attempt;
            const ok = await this.tryListen(host, candidate);
            if (ok) {
                this.actualHost = host;
                this.actualPort = candidate;
                this.startHeartbeat();
                return this.url;
            }
        }
        throw new Error(`dsh-companion: no free port in ${port}-${port + 10} on ${host}`);
    }
    async stop() {
        if (this.heartbeat !== null) {
            clearInterval(this.heartbeat);
            this.heartbeat = null;
        }
        // 先广播 bye：伴侣壳（Electron）收到后立即退出，浏览器页忽略。
        // 这让“伴侣生死 = DSH 生死”在优雅卸载路径上即时成立。
        const bye = `data: ${JSON.stringify({ plugin: 'dsh-companion', bye: true })}\n\n`;
        for (const client of [...this.clients]) {
            try {
                client.res.write(bye);
            }
            catch {
                /* already closed */
            }
        }
        for (const client of this.clients) {
            try {
                client.res.end();
            }
            catch {
                /* already closed */
            }
        }
        this.clients.clear();
        await new Promise((resolvePromise) => {
            if (!this.server)
                return resolvePromise();
            this.server.close(() => resolvePromise());
            // close() 只等优雅关闭；挂起的 keep-alive 连接由 destroy 收尾。
            setTimeout(() => {
                this.server?.closeAllConnections?.();
                resolvePromise();
            }, 500).unref?.();
        });
        this.server = null;
    }
    /** 广播实时快照（状态变化 / 告警 / 设置变化时由编排层调用）。 */
    broadcast(snapshot) {
        const payload = `data: ${JSON.stringify(snapshot)}\n\n`;
        for (const client of [...this.clients]) {
            try {
                client.res.write(payload);
            }
            catch {
                this.clients.delete(client);
            }
        }
    }
    get clientCount() {
        return this.clients.size;
    }
    tryListen(host, port) {
        return new Promise((resolvePromise) => {
            const server = createServer((req, res) => {
                this.route(req, res).catch((error) => {
                    console.error('[dsh-companion] ui server error:', error);
                    // /api/* 的未捕获异常也回 JSON 带 message——否则客户端 res.json()
                    // 解析失败，用户只能看到裸 HTTP 状态码，无从诊断。
                    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
                    const isApi = (req.url ?? '').startsWith('/api/');
                    if (res.headersSent) {
                        res.end();
                        return;
                    }
                    res.writeHead(500, {
                        'content-type': isApi ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
                    });
                    res.end(isApi ? JSON.stringify({ ok: false, error: 'internal', message: text }) : text);
                });
            });
            server.once('error', () => resolvePromise(false));
            server.listen(port, host, () => {
                this.server = server;
                resolvePromise(true);
            });
        });
    }
    startHeartbeat() {
        this.heartbeat = setInterval(() => {
            for (const client of [...this.clients]) {
                try {
                    client.res.write(': ping\n\n');
                }
                catch {
                    this.clients.delete(client);
                }
            }
        }, 15_000);
        this.heartbeat.unref?.();
    }
    async route(req, res) {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        const path = url.pathname;
        const method = (req.method ?? 'GET').toUpperCase();
        // CORS：DSH Web GUI 页面（不同源）的左下角角标要跨域读本服务。
        // 仅回环绑定 + 只读 JSON，风险面极小；预检直接放行。
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'content-type');
        if (method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        // 静态页
        if (path === '/' && method === 'GET')
            return html(res, petPageHTML());
        if (path === '/panel' && method === 'GET')
            return html(res, panelPageHTML());
        // 皮肤资源：/skins/<skin>/<state>(.ext)
        if (path.startsWith('/skins/') && method === 'GET') {
            return this.serveSkin(path, res);
        }
        // API
        if (path === '/api/events' && method === 'GET')
            return this.sse(req, res);
        if (path === '/api/state' && method === 'GET')
            return json(res, this.deps.snapshot());
        if (path === '/api/skins' && method === 'GET') {
            return json(res, await this.deps.skins.list());
        }
        if (path === '/api/history' && method === 'GET') {
            const limit = clampInt(url.searchParams.get('limit'), 1, 200, 20);
            const offset = clampInt(url.searchParams.get('offset'), 0, 1_000_000, 0);
            const model = (url.searchParams.get('model') ?? '').trim();
            const statusRaw = (url.searchParams.get('status') ?? '').trim();
            const status = statusRaw === 'success' || statusRaw === 'failed' || statusRaw === 'interrupted'
                ? statusRaw
                : undefined;
            const fromMs = clampInt(url.searchParams.get('from'), 0, 8_640_000_000_000_000, 0);
            const toMs = clampInt(url.searchParams.get('to'), 0, 8_640_000_000_000_000, 0);
            const q = (url.searchParams.get('q') ?? '').trim().slice(0, 120);
            const filter = model || status || fromMs || toMs || q ? { model, status, fromMs, toMs, q } : undefined;
            return json(res, await this.deps.history(limit, offset, filter));
        }
        if (path === '/api/models' && method === 'GET') {
            return json(res, { models: await this.deps.models() });
        }
        if (path === '/api/pricing' && method === 'GET') {
            return json(res, this.deps.pricing());
        }
        if (path === '/api/pricing/refresh' && method === 'POST') {
            return json(res, await this.deps.refreshPricing());
        }
        if (path === '/api/stats' && method === 'GET') {
            const periodRaw = url.searchParams.get('period') ?? 'today';
            const period = ['today', 'week', 'month', 'all'].includes(periodRaw)
                ? periodRaw
                : 'today';
            return json(res, await this.deps.stats(period));
        }
        if (path === '/api/ranking' && method === 'GET') {
            const periodRaw = url.searchParams.get('period') ?? 'week';
            const period = ['today', 'week', 'month', 'all'].includes(periodRaw)
                ? periodRaw
                : 'week';
            return json(res, await this.deps.ranking(period));
        }
        if (path === '/api/stats/series' && method === 'GET') {
            const periodRaw = url.searchParams.get('period') ?? 'today';
            const period = ['today', 'week', 'month', 'all'].includes(periodRaw)
                ? periodRaw
                : 'today';
            return json(res, await this.deps.statsSeries(period));
        }
        if (path === '/api/settings' && method === 'PUT') {
            const body = await readJson(req);
            const settings = await this.deps.updateSettings(body);
            return json(res, settings);
        }
        if (path === '/api/position' && method === 'POST') {
            const body = await readJson(req);
            await this.deps.updateSettings({
                position: {
                    x: Number(body?.x) || 0,
                    y: Number(body?.y) || 0,
                },
            });
            return json(res, { ok: true });
        }
        if (path === '/api/scale' && method === 'POST') {
            const body = await readJson(req);
            const scale = Math.max(0.2, Math.min(5, Number(body?.scale) || 1));
            await this.deps.updateSettings({ scale });
            return json(res, { ok: true });
        }
        if (path === '/api/pause' && method === 'POST') {
            return json(res, await this.deps.togglePause());
        }
        // ---- UI 增强：DSH 会话管理（删除 = registry 除名 + 文件彻底删除）----
        if (path === '/api/dsh-sessions/delete' && method === 'POST') {
            const body = await readJson(req);
            const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
            const result = await this.deps.deleteDshSession(sessionId);
            const status = result.ok
                ? 200
                : result.error === 'bad-request'
                    ? 400
                    : result.error === 'session-not-found'
                        ? 404
                        : result.error === 'session-active'
                            ? 409
                            : result.error === 'registry-unavailable'
                                ? 503
                                : 500;
            return json(res, result, status);
        }
        if (path === '/api/dsh-sessions' && method === 'GET') {
            const result = await this.deps.listDshSessions();
            const status = result.ok ? 200 : result.error === 'registry-unavailable' ? 503 : 500;
            return json(res, result, status);
        }
        if (path === '/api/dsh-sessions/delete-many' && method === 'POST') {
            const body = await readJson(req);
            const result = await this.deps.deleteDshSessions(Array.isArray(body?.sessionIds) ? body.sessionIds : null);
            return json(res, result, result.ok ? 200 : 400);
        }
        if (path === '/api/mock/start' && method === 'POST') {
            const body = await readJson(req);
            const scenarioRaw = String(body?.scenario ?? 'success');
            const scenario = ['success', 'error', 'interrupted', 'long'].includes(scenarioRaw)
                ? scenarioRaw
                : 'success';
            return json(res, await this.deps.mockStart(scenario));
        }
        if (path === '/api/quit' && method === 'POST') {
            res.writeHead(204);
            res.end();
            await this.deps.quit();
            return;
        }
        if (path.startsWith('/api/export/') && method === 'GET') {
            const formatRaw = url.searchParams.get('format') === 'json' ? 'json' : 'csv';
            const format = formatRaw;
            // 导出吃历史页的筛选：model/status/from/to/q 与 /api/history 同口径。
            const statusRaw = (url.searchParams.get('status') ?? '').trim();
            const status = statusRaw === 'success' || statusRaw === 'failed' || statusRaw === 'interrupted'
                ? statusRaw
                : undefined;
            const filter = {
                model: (url.searchParams.get('model') ?? '').trim(),
                status,
                fromMs: clampInt(url.searchParams.get('from'), 0, 8_640_000_000_000_000, 0),
                toMs: clampInt(url.searchParams.get('to'), 0, 8_640_000_000_000_000, 0),
                q: (url.searchParams.get('q') ?? '').trim().slice(0, 120),
            };
            const result = path.startsWith('/api/export/tools')
                ? await this.deps.exportTools(format)
                : await this.deps.exportSessions(format, filter);
            res.writeHead(200, {
                'content-type': result.contentType,
                'content-disposition': `attachment; filename="${result.filename}"`,
            });
            res.end(result.body);
            return;
        }
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
    }
    async serveSkin(path, res) {
        const parts = path.split('/').filter(Boolean); // ["skins", skin, file]
        if (parts.length !== 3)
            return notFound(res);
        const skin = parts[1];
        let file = parts[2];
        if (!NAME_PATTERN.test(skin))
            return notFound(res);
        // URL 形如 /skins/whale/hooked.png（状态帧）或 /skins/whale/pat.png（反应帧）
        // → 名字去掉扩展名；先按工作状态查，查不到再按互动反应帧查。
        const state = file.includes('.') ? file.slice(0, file.lastIndexOf('.')) : file;
        if (!NAME_PATTERN.test(state))
            return notFound(res);
        const asset = (await this.deps.skins.readStateAsset(skin, state)) ??
            (await this.deps.skins.readReactionAsset(skin, state));
        if (!asset)
            return notFound(res);
        res.writeHead(200, {
            'content-type': asset.contentType,
            'cache-control': 'no-cache',
        });
        res.end(asset.body);
    }
    sse(req, res) {
        res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
        });
        res.write(`retry: 3000\n\n`);
        res.write(`data: ${JSON.stringify(this.deps.snapshot())}\n\n`);
        const client = { res };
        this.clients.add(client);
        req.once('close', () => this.clients.delete(client));
    }
}
function html(res, body) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
}
function json(res, body, status = 200) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
}
function notFound(res) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
}
async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY)
            throw new Error('request body too large');
        chunks.push(chunk);
    }
    if (chunks.length === 0)
        return {};
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    catch {
        return {};
    }
}
function clampInt(raw, min, max, fallback) {
    const value = Number.parseInt(raw ?? '', 10);
    if (!Number.isFinite(value))
        return fallback;
    return Math.max(min, Math.min(max, value));
}
