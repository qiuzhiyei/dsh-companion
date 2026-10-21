/**
 * dsh-companion — adapter 契约。
 *
 * 核心逻辑（状态机 / 任务聚合 / 统计）只消费 {@link PetEvent} 归一化事件，
 * 不直接触碰 DSH 事件对象。真实事件由 `dsh-adapter.ts` 翻译，
 * 独立运行与测试由 `mock-adapter.ts` 模拟。
 */
/**
 * 简单同步事件总线（核心与适配层之间的分发器，独立于 cordis）。
 * TODO: 事件量增长后换成带背压的异步分发。
 */
export class PetEventBus {
    listeners = new Set();
    disposed = false;
    on(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    emit(event) {
        if (this.disposed)
            return;
        for (const listener of [...this.listeners]) {
            try {
                listener(event);
            }
            catch (error) {
                // 单个消费者异常不阻断其它消费者（与宿主 session/event 的 contain 策略一致）。
                console.error(`[dsh-companion] event listener failed:`, error);
            }
        }
    }
    dispose() {
        this.disposed = true;
        this.listeners.clear();
    }
}
