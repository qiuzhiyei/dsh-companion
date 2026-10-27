/**
 * dsh-companion — 余额来源（仅 DeepSeek 登录账号）。
 *
 * 口径（用户明确要求）：只记录**登录的 DeepSeek 账号**，第三方渠道一律不查。
 * 实现走宿主自己的账号通道：
 *   - 凭证来自 `ctx.credentials.readRecord('deepseek-account-platform/default')`，
 *     即用户在 DSH 里登录后保存的 grant（payload.token + payload.issuer）；
 *   - 平台接口 = `GET <platformOrigin>/api/v0/users/get_user_summary`，
 *     请求头 `x-dsh-auth-token`（宿主 account.getBalance 同源实现，见
 *     dsh-deepseek-account-platform 的 README：issuer 必须与 platformOrigin 一致）；
 *   - 只投影 normal_wallets / bonus_wallets 的 currency+balance 与 total_costs，
 *     响应里的其他字段（含 token）一律丢弃，不落库、不打日志。
 *
 * 失败一律降级为 `ok:false` + 短原因，不抛出、不影响插件启动；
 * 成功结果缓存 cacheMs（默认 60s），双击/面板刷新可 force 绕过。
 */
export const BALANCE_RECORD_OWNER = 'deepseek-account-platform';
export const BALANCE_RECORD_ID = 'default';
export const DEFAULT_PLATFORM_ORIGIN = 'https://platform.deepseek.com';
/** 金额字符串 → number；只接受有限数（平台允许 0E-16 这类文法）。 */
function toAmount(value) {
    const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
    if (!text)
        return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
}
function pickWallet(list, preferred) {
    if (!Array.isArray(list))
        return null;
    const wallets = [];
    for (const raw of list) {
        const wallet = raw;
        const amount = toAmount(wallet?.balance ?? wallet?.amount);
        if (amount === null)
            continue;
        wallets.push({
            currency: typeof wallet?.currency === 'string' ? wallet.currency.toUpperCase() : 'CNY',
            amount,
        });
    }
    if (wallets.length === 0)
        return null;
    return wallets.find((w) => w.currency === preferred) ?? wallets[0];
}
/**
 * 解析平台 get_user_summary 响应。
 * 真实形状：{ code:0, data:{ biz_code:0, biz_data:{ normal_wallets:[…], bonus_wallets:[…], total_costs:[…] } } }
 */
export function parseBalancePayload(body, preferred = 'CNY') {
    if (typeof body !== 'object' || body === null)
        return null;
    const root = body;
    if (root.code !== undefined && Number(root.code) !== 0)
        return null;
    const data = root.data;
    const biz = (data && (data.biz_data ?? undefined));
    if (!biz)
        return null;
    const normal = pickWallet(biz.normal_wallets, preferred);
    if (!normal)
        return null;
    const bonus = pickWallet(biz.bonus_wallets, normal.currency);
    const cost = pickWallet(biz.total_costs, normal.currency);
    return {
        currency: normal.currency,
        normal: normal.amount,
        bonus: bonus ? bonus.amount : 0,
        totalCosts: cost ? cost.amount : null,
    };
}
export class AccountBalanceSource {
    getCredentials;
    platformOrigin;
    fetchImpl;
    timeoutMs;
    cacheMs;
    now;
    logger;
    last = null;
    inflight = null;
    constructor(options) {
        this.getCredentials = options.getCredentials;
        this.platformOrigin = (options.platformOrigin ?? DEFAULT_PLATFORM_ORIGIN).replace(/\/+$/, '');
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.timeoutMs = options.timeoutMs ?? 10_000;
        this.cacheMs = options.cacheMs ?? 60_000;
        this.now = options.now ?? Date.now;
        this.logger = options.logger;
    }
    async read(force = false) {
        const now = this.now();
        if (!force && this.last && now - this.last.at < this.cacheMs) {
            return { ...this.last.reading, cached: true };
        }
        if (this.inflight)
            return this.inflight;
        const task = this.fetchOnce().then((reading) => {
            this.last = { reading, at: this.now() };
            this.inflight = null;
            return reading;
        });
        this.inflight = task;
        return task;
    }
    failure(error, signedIn) {
        return {
            ok: false,
            signedIn,
            ts: this.now(),
            currency: 'CNY',
            normal: 0,
            bonus: 0,
            totalCosts: null,
            error,
            cached: false,
        };
    }
    async fetchOnce() {
        let record;
        try {
            const service = this.getCredentials();
            if (!service || typeof service.readRecord !== 'function') {
                return this.failure('credentials-unavailable', false);
            }
            record = (await service.readRecord(`${BALANCE_RECORD_OWNER}/${BALANCE_RECORD_ID}`));
        }
        catch {
            return this.failure('credentials-error', false);
        }
        const payload = record?.payload;
        const token = typeof payload?.token === 'string' ? payload.token : '';
        const issuer = typeof payload?.issuer === 'string' ? payload.issuer.replace(/\/+$/, '') : '';
        if (!token)
            return this.failure('not-signed-in', false);
        // 宿主同款校验：grant 的签发来源必须与 platformOrigin 一致，避免把凭证发给别的域。
        if (issuer && issuer !== this.platformOrigin)
            return this.failure('issuer-mismatch', true);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        timer.unref?.();
        try {
            const response = await this.fetchImpl(`${this.platformOrigin}/api/v0/users/get_user_summary`, {
                method: 'GET',
                headers: { 'x-dsh-auth-token': token, accept: 'application/json' },
                signal: controller.signal,
            });
            if (!response.ok)
                return this.failure(`http-${response.status}`, true);
            const body = (await response.json());
            const view = parseBalancePayload(body);
            if (!view)
                return this.failure('bad-payload', true);
            return {
                ok: true,
                signedIn: true,
                ts: this.now(),
                currency: view.currency,
                normal: view.normal,
                bonus: view.bonus,
                totalCosts: view.totalCosts,
                error: null,
                cached: false,
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.name === 'AbortError' ? 'timeout' : 'network' : 'network';
            this.logger?.warn(`余额查询失败（${message}）`);
            return this.failure(message, true);
        }
        finally {
            clearTimeout(timer);
        }
    }
}
