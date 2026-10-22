/**
 * dsh-companion — DSH 伴侣插件入口。
 *
 * 核心定位：DSH 工作状态监测伴侣 —— 表现 DSH 任务的
 * 开始 / 等待 / 输出 / 收尾 / 成功 / 失败 / 中断，并统计时长、Token、
 * 费用与工具调用。默认皮肤是 whale（Q版鲸鱼娘，DeepSeek 品牌形象拟人化），
 * 5 套服装（JK/OL/女警/中华娘/旗袍）随下拉切换，皮肤即人格——画面、表情帧、
 * 台词口吻整套随服装走（早期的 fisherman 钓鱼佬与 monitor 状态监测员
 * 均已按用户要求移除）。
 *
 * 事件接入：真实通道（session/event、agent/status、agent/assistant-stream，
 * 见 src/adapter/dsh-adapter.ts）+ mock 事件模拟器（独立运行/测试）。
 * UI：内嵌 HTTP+SSE（伴侣页 /panel 面板）+ 可选 Electron 壳（真托盘、
 * 透明置顶悬浮窗）。存储：node:sqlite 优先，JSON 降级。
 *
 * 工程约定（继承自脚手架，见 README）：
 * - 相对导入带 .js 后缀；@deepseek-ai/dsh-* 仅 import type；
 * - schemastery 从 dependencies 解析（profile node_modules）；
 * - 自有资源（server/adapter/托盘）包进 ctx.effect，卸载可逆；
 * - 自定义事件只在 src/types.ts 声明合并过的通道上 emit。
 */
import Schema from '@deepseek-ai/schemastery';
import { PetEventBus } from './adapter/types.js';
import { DshAdapter } from './adapter/dsh-adapter.js';
import { MockDshAdapter } from './adapter/mock-adapter.js';
import { PetStateMachine } from './state-machine/pet-state-machine.js';
import { TaskTracker, finishedViewFromSession } from './state-machine/task-tracker.js';
import { BudgetGuard } from './state-machine/budget.js';
import { computePeriodStats, computeRanking, computeSeries } from './storage/stats.js';
import { exportSessions, exportToolCalls } from './storage/export.js';
import { openPetStore } from './storage/store.js';
import { OfficialPricingSource } from './pricing/official.js';
import { SkinRegistry } from './ui/skins.js';
import { PetServer } from './ui/server.js';
import { TrayController } from './ui/tray.js';
import { SessionDeleter } from './ui-enhance/session-manager.js';
import { DEFAULT_MODEL_PRICES, DEFAULT_SETTINGS, DEFAULT_USD_CNY_RATE, EVENTS, LEGACY_DEFAULT_MODEL_PRICES, } from './types.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
// ---------------------------------------------------------------------------
// Config（schemastery；无效配置在加载期响亮失败 —— ValidationError）
// ---------------------------------------------------------------------------
export const Config = Schema.object({
    adapter: Schema.union(['auto', 'mock'])
        .default('auto')
        .description("事件来源：'auto' 接 DSH 真实事件，'mock' 用内置事件模拟器独立演示"),
    dataDir: Schema.string()
        .default('')
        .description('数据目录（SQLite/JSON/设置）。空 = $DSH_HOME/dsh-companion，无 DSH_HOME 时 ~/.dsh/dsh-companion'),
    storage: Schema.union(['auto', 'sqlite', 'json'])
        .default('auto')
        .description("存储后端：'auto' 首选 node:sqlite、失败降级 JSON；'sqlite' 强制（不可用则报错）；'json' 强制"),
    currency: Schema.union(['CNY', 'USD']).default('CNY').description('费用计价货币'),
    usdCnyRate: Schema.number()
        .default(DEFAULT_USD_CNY_RATE)
        .description('官方价格 USD→CNY 折算率（currency=CNY 时生效；DeepSeek 官方定价以美元计）'),
    settleMs: Schema.natural()
        .default(8_000)
        .description('任务终态（完成/出错/中断）画面停留毫秒数，超时回到 idle'),
    logEvents: Schema.boolean().default(false).description('调试：打印收到的宿主事件'),
    server: Schema.object({
        enabled: Schema.boolean().default(true).description('是否启动伴侣/面板 HTTP 服务'),
        host: Schema.string().default('127.0.0.1').description('绑定地址（仅本机访问）'),
        port: Schema.natural().default(17_573).description('起始端口；被占时自动 +1 重试 10 次'),
        shell: Schema.union(['auto', 'off'])
            .default('auto')
            .description("'auto'：检测到 electron 时拉起伴侣壳（真托盘+透明悬浮窗）"),
        toast: Schema.boolean().default(true).description('预算告警尝试 Windows Toast 通知'),
    }).default({ enabled: true, host: '127.0.0.1', port: 17_573, shell: 'auto', toast: true }),
    mock: Schema.object({
        auto: Schema.boolean().default(false).description('mock 模式下周期性自动跑模拟任务'),
        intervalMs: Schema.natural().default(45_000).description('自动模拟任务间隔（毫秒）'),
        speed: Schema.number().default(1).description('模拟事件时间压缩倍数（演示用）'),
    }).default({ auto: false, intervalMs: 45_000, speed: 1 }),
});
// ---------------------------------------------------------------------------
// 插件入口
// ---------------------------------------------------------------------------
export const name = 'dsh-companion';
export const inject = [];
export function apply(ctx, config = Config({})) {
    const log = ctx.logger('dsh-companion');
    // 全部异步初始化与清理都收进一个 effect：可逆卸载是插件契约。
    ctx.effect(async () => {
        // ---- ① 数据目录与存储 ----
        const dataDir = config.dataDir || defaultDataDir();
        let store;
        let storageBackend = 'json';
        try {
            const opened = await openPetStore(dataDir, config.storage);
            store = opened.store;
            storageBackend = opened.backend;
            if (opened.degraded)
                log.warn('node:sqlite 不可用，已降级 JSON 存储');
        }
        catch (error) {
            log.warn(`存储初始化失败（${String(error)}），使用内存模式，重启后数据不保留`);
            const opened = await openPetStore(join(dataDir, 'fallback'), 'json');
            store = opened.store;
            storageBackend = 'in-memory-json';
        }
        // ---- ② 设置（存储值 ← Config 默认值合并） ----
        const settings = await store.loadSettings();
        settings.currency = settings.currency || config.currency;
        // 设置行 = 纯用户覆盖；内置/官方价在计算期合并（effectivePrices），
        // 避免旧默认值被持久化后永久压住自动抓取的新官方价。
        const stripped = stripLegacyDefaults(settings.modelPrices);
        if (Object.keys(stripped).length !== Object.keys(settings.modelPrices).length) {
            log.info('已清理退役的默认模型价格行（deepseek-chat/deepseek-reasoner）');
        }
        settings.modelPrices = stripped;
        // 一次性迁移 v2：fisherman 皮肤已整体移除，默认皮肤改为 whale（Q版鲸鱼娘）；
        // 旧默认 monitor 一并迁移，用户显式选择的其他皮肤不动。
        if (!settings.whaleMigrated) {
            if (settings.skin === 'fisherman' || settings.skin === 'monitor') {
                log.info('默认皮肤迁移：' + settings.skin + ' → whale（Q版鲸鱼娘；钓鱼佬已移除）');
                settings.skin = 'whale';
            }
            settings.whaleMigrated = true;
        }
        // 一次性迁移 v3：monitor（状态监测员）皮肤也已整体移除——曾显式选择它的
        // 用户搬回 whale。v1（fisherman→monitor）随两个皮肤先后退场已整体删除，
        // skinMigrated 字段一并移除（老库残值被 mergeSettings 静默忽略）。
        if (!settings.monitorRemoved) {
            if (settings.skin === 'monitor') {
                log.info('皮肤退役迁移：monitor → whale（状态监测员已移除）');
                settings.skin = 'whale';
            }
            settings.monitorRemoved = true;
        }
        await store.saveSettings(settings);
        let currentSettings = settings;
        // ---- ②a 官方价格源（DeepSeek 定价页自动同步 + 本地缓存）----
        const officialPricing = new OfficialPricingSource({
            dataDir,
            currency: () => currentSettings.currency,
            usdCnyRate: () => Number.isFinite(config.usdCnyRate) && config.usdCnyRate > 0
                ? config.usdCnyRate
                : DEFAULT_USD_CNY_RATE,
            logger: { info: (m) => log.info(m), warn: (m) => log.warn(m) },
            onChanged: () => {
                tracker.setPrices(effectivePrices());
                pushSnapshot();
            },
        });
        await officialPricing.init();
        /** 生效价格表：自定义行 > 官方抓取 > 内置兜底（都没有的模型按 0 计）。 */
        const effectivePrices = () => ({
            ...DEFAULT_MODEL_PRICES,
            ...officialPricing.table(),
            ...currentSettings.modelPrices,
        });
        // ---- ③ 事件总线 / 状态机 / 任务追踪 / 预算 ----
        const bus = new PetEventBus();
        const machine = new PetStateMachine({
            settleMs: config.settleMs,
            onStateChange: (from, to, cause) => {
                log.info(`state ${from} → ${to} (${cause})`);
                ctx.emit(EVENTS.stateChange, { from, to, snapshot: buildSnapshot() });
                pushSnapshot();
            },
        });
        let lastAlert = null;
        let alertClearTimer = null;
        const guard = new BudgetGuard(() => currentSettings.budget, () => effectivePrices());
        const tracker = new TaskTracker({
            modelPrices: effectivePrices(),
            onFinish: async (task, tools) => {
                if (currentSettings.paused)
                    return;
                await persistTask(task, tools);
                const today = await computePeriodStats(store, 'today');
                const dailyAlert = guard.checkDaily({
                    totalTokens: today.totalTokens,
                    cost: today.cost,
                });
                if (dailyAlert)
                    await raiseAlert(dailyAlert);
            },
        });
        // 重启补种：伴侣气泡待机时也要有“上次任务”，从库里恢复最近一条。
        try {
            const recent = await store.listTasks(1, 0);
            const last = recent[0];
            if (last && last.status !== 'running') {
                tracker.seedLastResult(finishedViewFromSession(last));
            }
        }
        catch (error) {
            log.warn('恢复上次任务快照失败:', error.message);
        }
        // 历史存量：把以前落下的无模型名任务按同会话时间最近的已知路由回填一次。
        try {
            const fixed = await store.backfillMissingModels();
            if (fixed > 0)
                log.info(`回填缺模型名的历史任务 ${fixed} 条`);
        }
        catch (error) {
            log.warn('回填模型名失败:', error.message);
        }
        async function persistTask(task, tools) {
            // DSH 的 request/header 只在请求配置变化时才发——整轮零 header 的任务
            // 模型名为空（会话日志实证），落库前继承同会话最近一次已知路由。
            if (!task.model) {
                try {
                    const route = await store.lastKnownRoute(task.sessionId);
                    if (route) {
                        task.provider = route.provider;
                        task.model = route.model;
                    }
                }
                catch {
                    // 继承失败不拦持久化，宁可空着。
                }
            }
            await store.saveTask(task);
            await store.saveToolCalls(tools);
            ctx.emit(EVENTS.taskFinished, { task });
            log.info(`task ${task.id} ${task.status}: ${(task.totalTokens / 1000).toFixed(1)}k tok, ` +
                `${task.cost.toFixed(4)} ${currentSettings.currency}, tools ${task.toolCalls}(${task.toolFail} fail)`);
        }
        async function raiseAlert(alert) {
            lastAlert = alert;
            ctx.emit(EVENTS.budgetAlert, { alert });
            await tray.notify(alert.message);
            pushSnapshot();
            if (alertClearTimer !== null)
                clearTimeout(alertClearTimer);
            // 告警横幅停留 60 秒。
            alertClearTimer = setTimeout(() => {
                alertClearTimer = null;
                lastAlert = null;
                pushSnapshot();
            }, 60_000);
            alertClearTimer.unref?.();
        }
        // ---- ④ 皮肤 / UI 服务 / 托盘 ----
        const skins = new SkinRegistry();
        // 皮肤人设文案：manifest.labels 覆盖状态机默认的中性文案。
        const bootSkin = await skins.load(currentSettings.skin);
        machine.setLabels(bootSkin?.manifest.labels ?? {});
        // ---- ④a UI 增强：DSH 会话删除（会话管理）----
        // 宿主 registry 只有归档/置顶、没有删除；SessionDeleter 负责除名 +
        // 文件彻底删除 + 占用补删（细节见 src/ui-enhance/session-manager.ts 头注）。
        const sessionDeleter = new SessionDeleter({
            // cordis 的 ctx 是 Proxy：未声明 inject 就直读服务属性会同步抛
            // （cannot get property "workspaceRegistry" without inject）。ctx.get()
            // 是官方"无 inject 要求读取"通道：未提供/未激活返回 undefined，不抛。
            getRegistry: () => {
                const getter = ctx.get;
                if (typeof getter !== 'function')
                    return null;
                try {
                    return getter.call(ctx, 'workspaceRegistry') ?? null;
                }
                catch {
                    return null;
                }
            },
            queryActivity: async (sessionId) => {
                // 与宿主 archiveSession 同源的只读活动探测（不动归档集合、零副作用）。
                const waterfall = ctx.waterfall;
                if (typeof waterfall !== 'function')
                    return [];
                try {
                    const activity = await waterfall.call(ctx, 'workspace/session-activity', { sessionId }, () => Promise.resolve([]));
                    return Array.isArray(activity) ? activity : [];
                }
                catch {
                    return [];
                }
            },
            dshHome: process.env.DSH_HOME || join(homedir(), '.dsh'),
            pendingFile: join(dataDir, 'delete-pending.json'),
            isTrackedRunning: (sessionId) => tracker.activeView()?.sessionId === sessionId,
        });
        sessionDeleter.start();
        const petServer = new PetServer({
            snapshot: buildSnapshot,
            skins,
            history: async (limit, offset, filter) => filter
                ? store.queryTasks({ limit, offset, ...filter })
                : { tasks: await store.listTasks(limit, offset), total: await store.countTasks() },
            models: async () => {
                const seen = new Set(await store.listModels());
                const active = tracker.activeView();
                if (active && active.model)
                    seen.add(active.model);
                return [...seen].sort();
            },
            pricing: () => officialPricing.status(),
            refreshPricing: async () => {
                const result = await officialPricing.refresh();
                tracker.setPrices(effectivePrices());
                pushSnapshot();
                return { ok: result.ok, error: result.error };
            },
            stats: (period) => computePeriodStats(store, period),
            statsSeries: (period) => computeSeries(store, period),
            ranking: (period) => computeRanking(store, period),
            updateSettings,
            togglePause: async () => {
                currentSettings.paused = !currentSettings.paused;
                if (!currentSettings.paused)
                    guard.resetTaskArming();
                await store.saveSettings(currentSettings);
                pushSnapshot();
                log.info(currentSettings.paused ? '统计已暂停' : '统计已恢复');
                return buildSnapshot();
            },
            mockStart: async (scenario) => {
                if (adapter instanceof MockDshAdapter) {
                    const ok = adapter.start(scenario);
                    return {
                        ok,
                        message: ok ? `模拟任务已启动: ${scenario}` : '模拟任务已在进行中',
                    };
                }
                return { ok: false, message: '当前适配层是 dsh（真实事件），无法模拟' };
            },
            exportSessions: (format, filter) => exportSessions(store, format, 5_000, filter),
            exportTools: (format) => exportToolCalls(store, format),
            deleteDshSession: (sessionId) => sessionDeleter.delete(sessionId),
            listDshSessions: () => sessionDeleter.listSessions(),
            deleteDshSessions: (sessionIds) => sessionDeleter.deleteMany(sessionIds),
            quit: async () => {
                log.info('收到退出请求，卸载插件');
                void ctx.fiber.dispose();
            },
        });
        let serverUrl = '';
        if (config.server.enabled) {
            try {
                serverUrl = await petServer.start(config.server.host, config.server.port);
                log.info(`伴侣面板: ${serverUrl} （存储: ${storageBackend}）`);
            }
            catch (error) {
                log.warn(`UI 服务启动失败（${String(error)}），继续以纯日志模式运行`);
            }
        }
        const tray = new TrayController({
            serverUrl,
            toast: config.server.toast,
            dataDir,
            // autoStart=false（设置里关掉“随 DSH 启动伴侣”）→ 下次 DSH 启动不拉壳。
            shell: config.server.shell === 'auto' && currentSettings.autoStart ? 'auto' : 'off',
        });
        await tray.start({
            showHide: () => pushSnapshot(),
            togglePause: () => pushSnapshot(),
            history: () => pushSnapshot(),
            stats: () => pushSnapshot(),
            settings: () => pushSnapshot(),
            switchSkin: () => pushSnapshot(),
            exportData: () => void exportSessions(store, 'csv'),
            quit: () => void ctx.fiber.dispose(),
        });
        // ---- ⑤ 适配层（真实 / mock）----
        const adapter = config.adapter === 'mock'
            ? new MockDshAdapter({
                auto: config.mock.auto,
                intervalMs: config.mock.intervalMs,
                speed: config.mock.speed,
            })
            : new DshAdapter(ctx, { logEvents: config.logEvents });
        // 适配层事件 → 编排总线（真实与 mock 同一条链路）。
        const offAdapter = adapter.onEvent((event) => bus.emit(event));
        bus.on((event) => {
            if (currentSettings.paused)
                return;
            machine.handle(event);
            tracker.handle(event);
            if (event.kind === 'model-end') {
                const view = tracker.activeView();
                if (view) {
                    const alert = guard.checkTask(view.id, view.tokens.inputTokens, view.tokens.outputTokens, view.tokens.cachedTokens, view.model, view.provider);
                    if (alert)
                        void raiseAlert(alert);
                }
                pushSnapshot();
            }
            if (event.kind === 'task-start') {
                guard.resetTaskArming();
                lastAlert = null;
                pushSnapshot();
            }
            if (event.kind === 'stream-activity' ||
                event.kind === 'tool-start' ||
                event.kind === 'tool-end' ||
                event.kind === 'model-start' ||
                event.kind === 'model-route') {
                pushSnapshot();
            }
        });
        // ---- ⑥ 快照与设置更新 ----
        function buildSnapshot() {
            return {
                plugin: 'dsh-companion',
                time: Date.now(),
                state: machine.current,
                label: machine.label,
                adapter: adapter.kind,
                paused: currentSettings.paused,
                task: tracker.activeView(),
                lastResult: tracker.lastFinishedView(),
                alert: lastAlert,
                settings: {
                    ...currentSettings,
                    modelPrices: { ...currentSettings.modelPrices },
                },
                currency: currentSettings.currency,
                serverUrl,
            };
        }
        function pushSnapshot() {
            if (serverUrl)
                petServer.broadcast(buildSnapshot());
        }
        async function updateSettings(patch) {
            const next = { ...currentSettings };
            if (typeof patch.skin === 'string' && /^[A-Za-z0-9_-]+$/.test(patch.skin)) {
                const skin = await skins.load(patch.skin);
                if (skin) {
                    next.skin = patch.skin;
                    machine.setLabels(skin.manifest.labels ?? {});
                }
            }
            if (typeof patch.opacity === 'number' && patch.opacity >= 0.1 && patch.opacity <= 1) {
                next.opacity = patch.opacity;
            }
            if (typeof patch.scale === 'number' && patch.scale >= 0.2 && patch.scale <= 5) {
                next.scale = patch.scale;
            }
            if (typeof patch.clickThrough === 'boolean')
                next.clickThrough = patch.clickThrough;
            if (typeof patch.privacyMode === 'boolean')
                next.privacyMode = patch.privacyMode;
            if (typeof patch.showPet === 'boolean')
                next.showPet = patch.showPet;
            if (typeof patch.purePetMode === 'boolean')
                next.purePetMode = patch.purePetMode;
            if (typeof patch.notify === 'boolean')
                next.notify = patch.notify;
            if (typeof patch.autoStart === 'boolean')
                next.autoStart = patch.autoStart;
            if (patch.restReminder && typeof patch.restReminder === 'object') {
                const rr = patch.restReminder;
                const interval = Number(rr.intervalMinutes);
                next.restReminder = {
                    enabled: typeof rr.enabled === 'boolean' ? rr.enabled : next.restReminder.enabled,
                    intervalMinutes: Number.isFinite(interval)
                        ? Math.min(480, Math.max(5, Math.round(interval)))
                        : next.restReminder.intervalMinutes,
                };
            }
            if (patch.currency === 'CNY' || patch.currency === 'USD')
                next.currency = patch.currency;
            if (patch.position && typeof patch.position === 'object') {
                const pos = patch.position;
                const x = Number(pos.x);
                const y = Number(pos.y);
                if (Number.isFinite(x) && Number.isFinite(y))
                    next.position = { x, y };
            }
            if (patch.budget && typeof patch.budget === 'object') {
                const budget = patch.budget;
                next.budget = {
                    taskMaxTokens: positiveOrNull(budget.taskMaxTokens),
                    taskMaxCost: positiveOrNull(budget.taskMaxCost),
                    dailyMaxTokens: positiveOrNull(budget.dailyMaxTokens),
                    dailyMaxCost: positiveOrNull(budget.dailyMaxCost),
                };
            }
            if (patch.modelPrices && typeof patch.modelPrices === 'object') {
                const parsed = parsePriceTable(patch.modelPrices);
                if (parsed)
                    next.modelPrices = parsed;
            }
            currentSettings = next;
            // 自定义行与货币都可能变，重算生效价格表（自定义 > 官方 > 内置）。
            tracker.setPrices(effectivePrices());
            await store.saveSettings(currentSettings);
            pushSnapshot();
            return { ...currentSettings, modelPrices: { ...currentSettings.modelPrices } };
        }
        // ---- ⑦ 启动完成 ----
        officialPricing.start();
        log.info(`就绪: adapter=${adapter.kind} storage=${storageBackend} ui=${serverUrl || 'off'} skin=${currentSettings.skin}`);
        pushSnapshot();
        // ---- 卸载（可逆清理；顺序与初始化相反） ----
        return async () => {
            officialPricing.stop();
            if (alertClearTimer !== null)
                clearTimeout(alertClearTimer);
            await tracker.flushInterrupted();
            offAdapter();
            await adapter.dispose();
            bus.dispose();
            machine.dispose();
            tray.stop();
            sessionDeleter.stop();
            await petServer.stop();
            await store.close();
            log.info('已卸载：监听、服务、存储全部清理完毕');
        };
    });
}
// ---------------------------------------------------------------------------
// 帮助函数
// ---------------------------------------------------------------------------
function defaultDataDir() {
    const dshHome = process.env.DSH_HOME;
    if (dshHome)
        return join(dshHome, 'dsh-companion');
    return join(homedir(), '.dsh', 'dsh-companion');
}
function positiveOrNull(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0)
        return null;
    return num;
}
function parsePriceTable(value) {
    if (typeof value !== 'object' || value === null)
        return null;
    const table = {};
    for (const [model, price] of Object.entries(value)) {
        if (typeof price !== 'object' || price === null)
            continue;
        const input = Number(price.inputPerMillion);
        const output = Number(price.outputPerMillion);
        if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) {
            continue;
        }
        const cacheInput = Number(price.cacheInputPerMillion);
        table[model] = {
            inputPerMillion: input,
            outputPerMillion: output,
            ...(Number.isFinite(cacheInput) && cacheInput >= 0
                ? { cacheInputPerMillion: cacheInput }
                : {}),
        };
    }
    return table;
}
/** 一次性迁移：删掉与旧内置默认值原样一致的已退役模型行，用户真正自定义过的行保留。 */
function stripLegacyDefaults(table) {
    const next = {};
    for (const [model, price] of Object.entries(table)) {
        const legacy = LEGACY_DEFAULT_MODEL_PRICES[model];
        if (legacy &&
            price.inputPerMillion === legacy.inputPerMillion &&
            price.outputPerMillion === legacy.outputPerMillion &&
            price.cacheInputPerMillion === undefined) {
            continue;
        }
        next[model] = price;
    }
    return next;
}
