/**
 * dsh-companion — DeepSeek 官方价格自动获取。
 *
 * 来源：https://api-docs.deepseek.com/quick_start/pricing（公开页面，无需凭据）。
 * 模型名从页面 MODEL 表头行动态解析 —— DeepSeek 更新模型名或调价时自动跟随，
 * 不需要插件发版；抓取失败退回内置 DEFAULT_MODEL_PRICES 兜底。
 *
 * 计费门控按 provider 而非模型名（cost.ts isPricedProvider）：只有 DeepSeek
 * 账号登录/API key 走官方 API 的任务才计费；自定义渠道（如阿里云百炼）一律
 * 不计费。MODEL VERSION 行（如 DeepSeek-V4.1-Flash-1017）随价格一并解析，
 * 面板展示模型版本用。
 *
 * 口径：同时解析 PEAK（高峰）与 OFF-PEAK（闲时，UTC 16:30–00:30 = 北京
 * 00:30–08:30）两档，官方闲时为半价；计价侧按任务开始时刻落在哪一档取价
 * （cost.ts isOffPeak），不再一律按高峰价高估。USD 按 Config.usdCnyRate 随
 * settings.currency 折算。缓存命中单价写入 ModelPrice.cacheInputPerMillion。
 *
 * 为什么不用 DSH 本地数据：DSH 自身不保存任何货币价格 ——
 * `@deepseek-ai/dsh-token-meter` 的 route-pricing 是 token 计数模块（图像/文件
 * 折算），`~/.dsh/dsh-usage/usage-ledger.json` 的 cost 恒为 0；第三方/免费渠道
 * 模型（如 aliyun-bailian 的 glm/qwen）无公开价源，按 0 计，与 DSH 台账口径一致。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { round4 } from '../state-machine/cost.js'
import { DEFAULT_USD_CNY_RATE } from '../types.js'
import type {
  ModelPriceTable,
  OfficialModelPricing,
  OfficialPricingFile,
  OfficialPricingStatus,
} from '../types.js'

export const OFFICIAL_PRICING_URL =
  'https://api-docs.deepseek.com/quick_start/pricing'

/** 可注入的最小 fetch 形状（测试用假实现；运行时默认 globalThis.fetch）。 */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

function emptyFile(url: string): OfficialPricingFile {
  return {
    version: 1,
    url,
    fetchedAt: null,
    ok: false,
    error: null,
    models: {},
  }
}

/** 提取一行 <tr> 内所有单元格的纯文本。 */
function cellTexts(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((m) =>
    m[1]
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

/**
 * 解析官方定价页 HTML → 价格表。结构不符合预期（页面改版等）时返回 null，
 * 调用方退回内置兜底表，绝不把半解析的数字当真。
 *
 * 页面结构（2026-10 时点）：第一张表首行是 MODEL | 模型名…（可能带脚注 sup），
 * 之后 PRICING 区按 “1M INPUT TOKENS (CACHE HIT)/(CACHE MISS)/1M OUTPUT TOKENS”
 * 分节，每节两行 OFF-PEAK / PEAK，行内 $ 金额按模型列序排列（rowspan 使后续行
 * 省略节标签单元格）。
 */
export function parseOfficialPricing(
  html: string,
  fetchedAt: number,
  url = OFFICIAL_PRICING_URL,
): OfficialPricingFile | null {
  const table = /<table[\s\S]*?<\/table>/.exec(html)?.[0]
  if (!table) return null
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) =>
    cellTexts(m[1]),
  )
  if (rows.length === 0) return null

  // ① 模型名：首个 MODEL 表头行，剔除脚注标记 (1) 与空单元格。
  const headerIdx = rows.findIndex(
    (cells) => (cells[0] ?? '').toUpperCase().startsWith('MODEL'),
  )
  if (headerIdx < 0) return null
  const models = rows[headerIdx]
    .slice(1)
    .map((c) => c.replace(/\(\d+\)/g, '').trim())
    .filter((c) => c.length > 0)
  if (models.length === 0) return null

  // ② 价格行状态机：节（CACHE HIT / CACHE MISS / OUTPUT）× 档（PEAK / OFF-PEAK）。
  const parsed: Record<string, OfficialModelPricing> = {}
  for (const m of models) {
    parsed[m] = {
      inputPeakUsd: 0,
      inputOffPeakUsd: 0,
      cacheHitInputPeakUsd: 0,
      cacheHitInputOffPeakUsd: 0,
      outputPeakUsd: 0,
      outputOffPeakUsd: 0,
    }
  }
  let section: 'cacheHit' | 'cacheMiss' | 'output' | null = null
  for (const cells of rows.slice(headerIdx + 1)) {
    const joined = cells.join(' ').toUpperCase()
    if (joined.includes('CONCURRENCY')) break // 价格区结束（其后是并发数等杂项）
    if (joined.includes('MODEL VERSION')) {
      // 版本号行：面板展示模型版本用（也佐证模型名解析自官网）。
      const versions = cells.slice(1).map((c) => c.trim()).filter((c) => c.length > 0)
      if (versions.length === models.length) {
        models.forEach((m, i) => {
          parsed[m].version = versions[i]
        })
      }
      continue
    }
    if (joined.includes('CACHE HIT')) section = 'cacheHit'
    else if (joined.includes('CACHE MISS')) section = 'cacheMiss'
    else if (joined.includes('OUTPUT TOKENS')) section = 'output'
    if (section === null) continue
    const offPeak = /(^|\s)OFF-PEAK/.test(joined)
    const peak = offPeak
      ? false
      : cells.some((c) => c.trim().toUpperCase() === 'PEAK')
    if (!offPeak && !peak) continue
    const amounts = cells
      .map((c) => /^\$\s*([\d,]+(?:\.\d+)?)$/.exec(c.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Number(m[1].replace(/,/g, '')))
    if (amounts.length !== models.length) continue
    models.forEach((model, i) => {
      const value = amounts[i]
      if (!Number.isFinite(value) || value < 0) return
      const row = parsed[model]
      if (section === 'cacheHit') {
        if (peak) row.cacheHitInputPeakUsd = value
        else row.cacheHitInputOffPeakUsd = value
      } else if (section === 'cacheMiss') {
        if (peak) row.inputPeakUsd = value
        else row.inputOffPeakUsd = value
      } else {
        if (peak) row.outputPeakUsd = value
        else row.outputOffPeakUsd = value
      }
    })
  }

  // ③ 校验：每个模型都必须解析出输入/输出 PEAK 价，否则整次解析作废。
  for (const m of models) {
    const row = parsed[m]
    if (!(row.inputPeakUsd > 0) || !(row.outputPeakUsd > 0)) return null
  }
  return { version: 1, url, fetchedAt, ok: true, error: null, models: parsed }
}

/** 抓取一次官方定价页。任何失败都返回 ok:false（带原因），不抛异常。 */
export async function fetchOfficialPricing(
  fetchImpl?: FetchLike,
  timeoutMs = 10_000,
  url = OFFICIAL_PRICING_URL,
): Promise<OfficialPricingFile> {
  const doFetch: FetchLike =
    fetchImpl ?? ((u, init) => fetch(u, init) as ReturnType<FetchLike>)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await doFetch(url, { signal: controller.signal })
    if (!res.ok) return { ...emptyFile(url), error: `HTTP ${res.status}` }
    const html = await res.text()
    const parsed = parseOfficialPricing(html, Date.now(), url)
    if (parsed === null) {
      return { ...emptyFile(url), error: '定价页结构变化，解析失败' }
    }
    return parsed
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ...emptyFile(url), error: message }
  } finally {
    clearTimeout(timer)
  }
}

/** 官方价（USD）→ 设置货币计价的 ModelPriceTable（仅官方模型 ID 键）。 */
export function officialToPriceTable(
  file: OfficialPricingFile,
  currency: string,
  usdCnyRate = DEFAULT_USD_CNY_RATE,
): ModelPriceTable {
  const rate =
    currency === 'USD'
      ? 1
      : Number.isFinite(usdCnyRate) && usdCnyRate > 0
        ? usdCnyRate
        : DEFAULT_USD_CNY_RATE
  const table: ModelPriceTable = {}
  // 官网没给 OFF-PEAK 行时（或解析为 0）回退高峰价，计价侧照样有值可用。
  const pick = (peak: number, offPeak: number): number => (offPeak > 0 ? offPeak : peak)
  for (const [model, p] of Object.entries(file.models)) {
    table[model] = {
      inputPerMillion: round4(p.inputPeakUsd * rate),
      cacheInputPerMillion: round4(p.cacheHitInputPeakUsd * rate),
      outputPerMillion: round4(p.outputPeakUsd * rate),
      inputOffPeakPerMillion: round4(pick(p.inputPeakUsd, p.inputOffPeakUsd) * rate),
      cacheInputOffPeakPerMillion: round4(
        pick(p.cacheHitInputPeakUsd, p.cacheHitInputOffPeakUsd) * rate,
      ),
      outputOffPeakPerMillion: round4(pick(p.outputPeakUsd, p.outputOffPeakUsd) * rate),
    }
  }
  return table
}

export interface OfficialPricingSourceOptions {
  dataDir: string
  /** 当前设置货币（动态读取）。 */
  currency(): string
  /** USD→CNY 折算率（动态读取；无效值回退 DEFAULT_USD_CNY_RATE）。 */
  usdCnyRate(): number
  /** 抓取成功并落盘后回调（上层刷新生效价格表）。 */
  onChanged?: () => void
  fetchImpl?: FetchLike
  url?: string
  /** 周期刷新间隔；默认 24h。 */
  refreshMs?: number
  logger?: { info(message: string): void; warn(message: string): void }
}

/**
 * 官方价格源：启动后延迟抓一次 + 周期刷新，结果缓存在
 * dataDir/pricing-official.json（离线时沿用上次成功的价格）。
 */
export class OfficialPricingSource {
  private file: OfficialPricingFile
  private timer: ReturnType<typeof setInterval> | null = null
  private kick: ReturnType<typeof setTimeout> | null = null
  private refreshing: Promise<OfficialPricingFile> | null = null
  private readonly filePath: string

  constructor(private readonly options: OfficialPricingSourceOptions) {
    const url = options.url ?? OFFICIAL_PRICING_URL
    this.file = emptyFile(url)
    this.filePath = join(options.dataDir, 'pricing-official.json')
  }

  /** 读取上次缓存（缺失/损坏静默忽略，从空开始）。 */
  async init(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as OfficialPricingFile
      if (
        parsed &&
        typeof parsed === 'object' &&
        parsed.models &&
        typeof parsed.models === 'object'
      ) {
        this.file = { ...this.file, ...parsed, version: 1 }
      }
    } catch {
      /* 无缓存或损坏：不影响启动 */
    }
  }

  /** 启动周期刷新（3s 后首抓，之后每 refreshMs 一次；全部非阻塞、unref）。 */
  start(): void {
    if (this.timer !== null) return
    const interval = this.options.refreshMs ?? 24 * 60 * 60 * 1000
    this.kick = setTimeout(() => {
      void this.refresh()
    }, 3_000)
    this.kick.unref?.()
    this.timer = setInterval(() => {
      void this.refresh()
    }, interval)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.kick !== null) {
      clearTimeout(this.kick)
      this.kick = null
    }
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 抓取一次（并发安全：进行中时共享同一 Promise）。成功写缓存并回调 onChanged。 */
  async refresh(): Promise<OfficialPricingFile> {
    if (this.refreshing !== null) return this.refreshing
    this.refreshing = (async () => {
      const result = await fetchOfficialPricing(
        this.options.fetchImpl,
        10_000,
        this.file.url,
      )
      if (result.ok) {
        this.file = result
        try {
          await mkdir(this.options.dataDir, { recursive: true })
          await writeFile(
            this.filePath,
            `${JSON.stringify(result, null, 1)}\n`,
            'utf8',
          )
        } catch {
          /* 缓存写失败不影响本次生效 */
        }
        this.options.logger?.info(
          `官方价格已同步：${Object.keys(result.models).join(', ')}`,
        )
        this.options.onChanged?.()
      } else {
        // 记住失败原因（UI 展示），继续沿用旧缓存价格。
        this.file = { ...this.file, error: result.error }
        this.options.logger?.warn(
          `官方价格同步失败：${result.error ?? '未知原因'}${this.file.ok ? '（沿用缓存价格）' : ''}`,
        )
      }
      return this.file
    })()
    try {
      return await this.refreshing
    } finally {
      this.refreshing = null
    }
  }

  /** 换算到设置货币后的官方价格表（无缓存时为空表）。 */
  table(): ModelPriceTable {
    return officialToPriceTable(
      this.file,
      this.options.currency(),
      this.options.usdCnyRate(),
    )
  }

  /** 面板状态（GET /api/pricing）：价格表以官方模型 ID 为键，versions 供展示。 */
  status(): OfficialPricingStatus {
    const versions: Record<string, string> = {}
    for (const [model, p] of Object.entries(this.file.models)) {
      if (p.version) versions[model] = p.version
    }
    return {
      url: this.file.url,
      ok: this.file.ok,
      fetchedAt: this.file.fetchedAt,
      error: this.file.error,
      currency: this.options.currency(),
      rate: this.options.currency() === 'USD' ? 1 : this.options.usdCnyRate(),
      models: this.table(),
      versions,
    }
  }
}
