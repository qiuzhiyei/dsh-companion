/**
 * dsh-companion — mock 适配层（事件模拟器）。
 *
 * 用途：
 * 1. 插件独立运行演示（adapter: 'mock'，或面板“模拟任务”按钮）；
 * 2. 测试驱动：tests/ 通过 bus 直接注入同样的事件序列。
 *
 * 真实适配层见 dsh-adapter.ts；两者产出完全一致的 PetEvent。
 */
import { PetEventBus } from './types.js';
const PLANS = {
    success: {
        steps: 3,
        toolsPerStep: 2,
        toolFailureRate: 0,
        tokensPerStep: [4_000, 700],
        outcome: 'success',
        reason: 'completed',
    },
    error: {
        steps: 2,
        toolsPerStep: 1,
        toolFailureRate: 0.5,
        tokensPerStep: [2_000, 300],
        outcome: 'failed',
        reason: 'llm request failed: rate limited',
    },
    interrupted: {
        steps: 2,
        toolsPerStep: 1,
        toolFailureRate: 0,
        tokensPerStep: [3_000, 400],
        outcome: 'interrupted',
        reason: 'user aborted the turn',
    },
    long: {
        steps: 8,
        toolsPerStep: 3,
        toolFailureRate: 0.2,
        tokensPerStep: [9_000, 1_600],
        outcome: 'success',
        reason: 'completed',
    },
};
let mockSessionCounter = 0;
/**
 * 模拟适配器：按时序生成 PetEvent 序列。同一时刻只跑一个模拟任务。
 */
/** 自动循环的场景池（偏 success，便于演示收竿为主）。 */
function pickAutoScenario() {
    const pool = ['success', 'success', 'success', 'long', 'error', 'interrupted'];
    return pool[Math.floor(Math.random() * pool.length)];
}
export class MockDshAdapter {
    kind = 'mock';
    bus = new PetEventBus();
    timers = new Set();
    options;
    running = false;
    autoTimer = null;
    disposed = false;
    constructor(options = {}) {
        this.options = {
            auto: options.auto ?? false,
            intervalMs: options.intervalMs ?? 45_000,
            speed: options.speed ?? 1,
        };
        // auto 模式：1.2s 后自动跑第一个场景（此前只有“结束后续跑”，首个任务
        // 永远不会自己开始任务 —— 演示时伴侣会一直 idle）。
        if (this.options.auto) {
            this.autoTimer = setTimeout(() => {
                this.autoTimer = null;
                if (!this.disposed && this.options.auto)
                    this.start(pickAutoScenario());
            }, 1_200);
            this.timers.add(this.autoTimer);
        }
    }
    onEvent(listener) {
        return this.bus.on(listener);
    }
    get isRunning() {
        return this.running;
    }
    /** 启动一次模拟任务；已在跑则返回 false。 */
    start(scenario = 'success') {
        if (this.disposed || this.running)
            return false;
        this.running = true;
        this.playScenario(scenario);
        return true;
    }
    /** 停止自动循环与进行中的模拟任务（进行中的任务立即以 interrupted 收尾）。 */
    stop() {
        this.clearAuto();
        for (const timer of this.timers)
            clearTimeout(timer);
        this.timers.clear();
        this.running = false;
    }
    async dispose() {
        this.disposed = true;
        this.stop();
        this.bus.dispose();
    }
    schedule(delayMs, fn) {
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            if (!this.disposed)
                fn();
        }, Math.max(0, delayMs / this.options.speed));
        this.timers.add(timer);
    }
    clearAuto() {
        if (this.autoTimer !== null) {
            clearTimeout(this.autoTimer);
            this.autoTimer = null;
        }
    }
    playScenario(scenario) {
        const plan = PLANS[scenario];
        const task = {
            sessionId: `mock-session-${(mockSessionCounter += 1)}`,
            turn: 1,
            project: 'demo-project',
            workspace: 'D:\\mock\\demo-project',
            subagent: false,
        };
        let clock = Date.now();
        const at = (delayMs, fn) => {
            clock += delayMs;
            const time = clock;
            this.schedule(clock - Date.now(), () => fn(time));
        };
        at(0, (time) => this.bus.emit({ kind: 'task-start', task, time }));
        at(300, (time) => this.bus.emit({
            kind: 'model-route',
            task,
            provider: 'deepseek-account',
            model: 'deepseek-flash',
            time,
        }));
        for (let step = 1; step <= plan.steps; step += 1) {
            const interruptedMidway = plan.outcome === 'interrupted' && step === plan.steps;
            if (interruptedMidway)
                break;
            at(400, (time) => this.bus.emit({ kind: 'model-start', task, step, time }));
            // 流式输出：若干次 stream-activity（高速运转）
            for (let i = 0; i < 4; i += 1) {
                at(500, (time) => this.bus.emit({ kind: 'stream-activity', task, time }));
            }
            at(900, (time) => {
                const [input, output] = plan.tokensPerStep;
                const cached = Math.floor(input * 0.6);
                this.bus.emit({
                    kind: 'model-end',
                    task,
                    step,
                    usage: {
                        inputTokens: input - cached,
                        outputTokens: output,
                        totalTokens: input + output,
                        cachedTokens: cached,
                        reasoningTokens: 0,
                    },
                    time,
                });
            });
            for (let tool = 0; tool < plan.toolsPerStep; tool += 1) {
                const callId = `mock-call-${step}-${tool}`;
                const name = ['read', 'grep', 'pwsh'][tool % 3];
                at(250, (time) => this.bus.emit({ kind: 'tool-start', task, callId, name, time }));
                const ok = Math.random() >= plan.toolFailureRate;
                at(800, (time) => this.bus.emit({ kind: 'tool-end', task, callId, name, ok, time }));
            }
        }
        at(600, (time) => {
            this.bus.emit({
                kind: 'task-end',
                task,
                status: plan.outcome,
                reason: plan.reason,
                time,
            });
            this.running = false;
            if (this.options.auto && !this.disposed) {
                this.clearAuto();
                this.autoTimer = setTimeout(() => {
                    this.autoTimer = null;
                    if (this.options.auto && !this.disposed) {
                        this.start(pickAutoScenario());
                    }
                }, this.options.intervalMs);
            }
        });
    }
}
