/**
 * dsh-companion — DSH 真实事件适配层。
 *
 * 监听（通道名均来自各包类型声明，非猜测）：
 * - `session/event`（@deepseek-ai/dsh-session）：turn/step 边界、assistant/message
 *   的 TokenUsage、tool/call + tool/result、request/header 的 provider/model。
 * - `agent/assistant-stream`（@deepseek-ai/dsh-agent）：流式 chunk → 高速运转。
 * - `agent/status`（@deepseek-ai/dsh-agent）：running ⇄ idle 兜底信号。
 *
 * 全部 ctx.on 注册即 effect（卸载自动退订）；本层无自持资源。
 * 事件翻译成 PetEvent 后交给 PetEventBus，核心逻辑不感知 DSH 类型。
 */
import { PetEventBus } from './types.js';
/** turn/end 的 reason.kind → TaskOutcome。 */
const TURN_END_OUTCOME = {
    completed: 'success',
    aborted: 'interrupted',
    error: 'failed',
    blocked: 'blocked',
    'max-tokens': 'max-tokens',
    interrupted: 'interrupted',
    forked: 'interrupted',
};
export class DshAdapter {
    ctx;
    kind = 'dsh';
    bus = new PetEventBus();
    /** sessionId → 会话元信息（workspace / project / subagent）。 */
    sessions = new Map();
    /** sessionId → 最近一个打开的 turn（流式事件归属）。 */
    openTurns = new Map();
    /**
     * sessionId → 最近一次已知的模型路由。
     * DSH 只在请求配置变化时才发 request/header——有的整轮 turn 零 header
     * （会话日志实证：38 个 header 对 390 条 assistant/message），不缓存的话
     * 这些轮次任务就永远缺模型名。turn/start 时用缓存主动补发一次 model-route。
     */
    lastRoute = new Map();
    disposers = [];
    constructor(ctx, options = {}) {
        this.ctx = ctx;
        const log = options.logEvents === true;
        const sessionInfoOf = (session) => {
            let info = this.sessions.get(String(session.id));
            if (!info) {
                const workspace = session.header.cwd ?? '';
                info = {
                    workspace,
                    project: workspace ? workspace.split(/[\\/]/).filter(Boolean).pop() ?? '' : '',
                    subagent: (session.header.delegationDepth ?? 0) > 0 ||
                        session.header.origin === 'subagent',
                };
                this.sessions.set(String(session.id), info);
            }
            return info;
        };
        const taskRefOf = (session, turn) => {
            const info = sessionInfoOf(session);
            return {
                sessionId: String(session.id),
                turn,
                project: info.project || String(session.id),
                workspace: info.workspace,
                subagent: info.subagent,
            };
        };
        // ① 会话事件 → 任务生命周期 / token / 工具（durable，记账以此为准）。
        this.disposers.push(ctx.on('session/event', (session, event) => {
            if (log) {
                console.log(`[dsh-companion] session/event type=${event.type} session=${String(session.id)}`);
            }
            this.translateSessionEvent(session, event, taskRefOf);
        }));
        // ② 流式输出 → stream-activity（高速运转；不看内容，只取时间）。
        this.disposers.push(ctx.on('agent/assistant-stream', (payload) => {
            if (payload.frame.type !== 'chunk')
                return;
            const sessionId = String(payload.agent.session.id);
            const turn = this.openTurns.get(sessionId);
            if (turn === undefined)
                return;
            const info = sessionInfoOf(payload.agent.session);
            this.bus.emit({
                kind: 'stream-activity',
                task: {
                    sessionId,
                    turn,
                    project: info.project || sessionId,
                    workspace: info.workspace,
                    subagent: info.subagent,
                },
                time: Date.now(),
            });
        }));
        // ③ agent 状态兜底：running 期间无任何 turn 事件（例如纯等待）不至于卡死。
        this.disposers.push(ctx.on('agent/status', (payload) => {
            if (log) {
                console.log(`[dsh-companion] agent/status ${payload.status} agent=${String(payload.agent.id)}`);
            }
        }));
    }
    onEvent(listener) {
        return this.bus.on(listener);
    }
    async dispose() {
        for (const dispose of this.disposers.splice(0))
            dispose();
        this.openTurns.clear();
        this.lastRoute.clear();
        this.sessions.clear();
        this.bus.dispose();
    }
    translateSessionEvent(session, event, taskRefOf) {
        const sessionId = String(session.id);
        const time = event.time;
        // 宿主类型联合还没收录 model/selection（事件日志里确实存在：用户切换模型
        // 时发，带 provider/model），单独前置摘出；下面 switch 保持按官方类型窄化。
        if (event.type === 'model/selection') {
            const data = event.data ?? {};
            if (data.model) {
                this.lastRoute.set(sessionId, { provider: data.provider ?? '', model: data.model });
                const turn = this.openTurns.get(sessionId);
                if (turn !== undefined) {
                    this.bus.emit({
                        kind: 'model-route',
                        task: taskRefOf(session, turn),
                        provider: data.provider ?? '',
                        model: data.model,
                        time,
                    });
                }
            }
            return;
        }
        switch (event.type) {
            case 'turn/start': {
                const data = event.data;
                this.openTurns.set(sessionId, data.turn);
                this.bus.emit({ kind: 'task-start', task: taskRefOf(session, data.turn), time });
                // 整轮可能一个 request/header 都没有（header 只在配置变化时发）：
                // 开轮即把会话最近已知路由补给新任务，后续真 header 到了照常覆盖。
                const route = this.lastRoute.get(sessionId);
                if (route) {
                    this.bus.emit({
                        kind: 'model-route',
                        task: taskRefOf(session, data.turn),
                        provider: route.provider,
                        model: route.model,
                        time,
                    });
                }
                break;
            }
            case 'turn/end': {
                const data = event.data;
                if (this.openTurns.get(sessionId) === data.turn)
                    this.openTurns.delete(sessionId);
                const reasonKind = data.reason?.kind ?? 'completed';
                this.bus.emit({
                    kind: 'task-end',
                    task: taskRefOf(session, data.turn),
                    status: TURN_END_OUTCOME[reasonKind] ?? 'success',
                    reason: reasonKind,
                    time,
                });
                break;
            }
            case 'step/start': {
                const data = event.data;
                this.openTurns.set(sessionId, data.turn);
                this.bus.emit({
                    kind: 'model-start',
                    task: taskRefOf(session, data.turn),
                    step: data.step,
                    time,
                });
                break;
            }
            case 'assistant/message': {
                const data = event.data;
                const usage = data.usage;
                this.bus.emit({
                    kind: 'model-end',
                    task: taskRefOf(session, data.turn),
                    step: data.step,
                    usage: usage
                        ? {
                            inputTokens: usage.inputTokens ?? 0,
                            outputTokens: usage.outputTokens ?? 0,
                            totalTokens: usage.totalTokens ?? 0,
                            cachedTokens: (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
                            reasoningTokens: usage.reasoningTokens ?? 0,
                        }
                        : null,
                    time,
                });
                break;
            }
            case 'request/header': {
                const data = event.data;
                const provider = data.header.config?.provider ?? '';
                const model = data.header.config?.model ?? '';
                if (model)
                    this.lastRoute.set(sessionId, { provider, model });
                this.bus.emit({
                    kind: 'model-route',
                    task: taskRefOf(session, this.openTurns.get(sessionId) ?? 0),
                    provider,
                    model,
                    time,
                });
                break;
            }
            case 'request/context': {
                // 路由元信息（仅在 header 缺席时兜底）。
                const data = event.data;
                if (!data.model)
                    break;
                this.lastRoute.set(sessionId, { provider: data.provider ?? '', model: data.model });
                this.bus.emit({
                    kind: 'model-route',
                    task: taskRefOf(session, this.openTurns.get(sessionId) ?? 0),
                    provider: data.provider ?? '',
                    model: data.model,
                    time,
                });
                break;
            }
            case 'tool/call': {
                const data = event.data;
                this.bus.emit({
                    kind: 'tool-start',
                    task: taskRefOf(session, data.turn),
                    callId: String(data.callId),
                    name: data.name,
                    time,
                });
                break;
            }
            case 'tool/result': {
                const data = event.data;
                this.bus.emit({
                    kind: 'tool-end',
                    task: taskRefOf(session, data.turn),
                    callId: String(data.message.toolCallId),
                    name: '',
                    ok: data.message.isError !== true,
                    time,
                });
                break;
            }
            default:
                break;
        }
    }
}
