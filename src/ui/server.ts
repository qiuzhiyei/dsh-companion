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

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { panelPageHTML, petPageHTML } from './pages.js'
import type { SkinRegistry } from './skins.js'
import type {
  ExportFormat,
  OfficialPricingStatus,
  PeriodStats,
  PetSettings,
  PetSnapshot,
  PetState,
  RankingResult,
  StatsSeries,
  TaskSession,
} from '../types.js'
import type { ExportFilter, ExportResult } from '../storage/export.js'
import type { TaskQuery } from '../storage/store.js'
import type { MockScenario } from '../adapter/mock-adapter.js'
import type {
  DeleteManyOutcome,
  DeleteOutcome,
  ListSessionsOutcome,
} from '../ui-enhance/session-manager.js'

export interface PetServerDeps {
  snapshot(): PetSnapshot
  skins: SkinRegistry
  /** 历史任务分页；filter 为模型/状态/日期/项目关键词筛选（缺省 = 全部）。 */
  history(
    limit: number,
    offset: number,
    filter?: Omit<TaskQuery, 'limit' | 'offset'>,
  ): Promise<{ tasks: TaskSession[]; total: number }>
  /** 用过的模型清单（价格设置“添加模型”候选）。 */
  models(): Promise<string[]>
  /** 官方价格状态（已换算为设置货币；设置页展示 + 添加模型候选）。 */
  pricing(): OfficialPricingStatus
  /** 手动触发一次官方价格同步。 */
  refreshPricing(): Promise<{ ok: boolean; error: string | null }>
  stats(period: 'today' | 'week' | 'month' | 'all'): Promise<PeriodStats>
  /** 柱状图时间序列（today=小时 / week,month=天 / all=月）。 */
  statsSeries(period: 'today' | 'week' | 'month' | 'all'): Promise<StatsSeries>
  /** 成本排行（模型 / 项目，按费用降序）。 */
  ranking(period: 'today' | 'week' | 'month' | 'all'): Promise<RankingResult>
  updateSettings(patch: Record<string, unknown>): Promise<PetSettings>
  togglePause(): Promise<PetSnapshot>
  mockStart(scenario: MockScenario): Promise<{ ok: boolean; message: string }>
  exportSessions(format: ExportFormat, filter?: ExportFilter): Promise<ExportResult>
  exportTools(format: ExportFormat): Promise<ExportResult>
  /** 删除 DSH 会话（registry 除名 + 文件彻底删除；UI 增强模块 session-manager）。 */
  deleteDshSession(sessionId: string): Promise<DeleteOutcome>
  /** 会话清单（面板「会话管理」卡：标题/工作区/磁盘占用/归档态）。 */
  listDshSessions(): Promise<ListSessionsOutcome>
  /** 批量彻底删除（逐会话复用单删闸门，聚合结果）。 */
  deleteDshSessions(sessionIds: unknown): Promise<DeleteManyOutcome>
  quit(): Promise<void>
}

interface SseClient {
  res: ServerResponse
}

const NAME_PATTERN = /^[A-Za-z0-9_-]+$/
const MAX_BODY = 1_000_000

export class PetServer {
  private server: Server | null = null
  private clients = new Set<SseClient>()
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private actualPort = 0
  private actualHost = ''

  constructor(private readonly deps: PetServerDeps) {}

  get url(): string {
    return `http://${this.actualHost}:${this.actualPort}`
  }

  get port(): number {
    return this.actualPort
  }

  /** 启动（端口被占时自动 +1 重试，最多 10 次）。 */
  async start(host: string, port: number): Promise<string> {
    for (let attempt = 0; attempt <= 10; attempt += 1) {
      const candidate = port + attempt
      const ok = await this.tryListen(host, candidate)
      if (ok) {
        this.actualHost = host
        this.actualPort = candidate
        this.startHeartbeat()
        return this.url
      }
    }
    throw new Error(`dsh-companion: no free port in ${port}-${port + 10} on ${host}`)
  }

  async stop(): Promise<void> {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat)
      this.heartbeat = null
    }
    // 先广播 bye：伴侣壳（Electron）收到后立即退出，浏览器页忽略。
    // 这让“伴侣生死 = DSH 生死”在优雅卸载路径上即时成立。
    const bye = `data: ${JSON.stringify({ plugin: 'dsh-companion', bye: true })}\n\n`
    for (const client of [...this.clients]) {
      try {
        client.res.write(bye)
      } catch {
        /* already closed */
      }
    }
    for (const client of this.clients) {
      try {
        client.res.end()
      } catch {
        /* already closed */
      }
    }
    this.clients.clear()
    await new Promise<void>((resolvePromise) => {
      if (!this.server) return resolvePromise()
      this.server.close(() => resolvePromise())
      // close() 只等优雅关闭；挂起的 keep-alive 连接由 destroy 收尾。
      setTimeout(() => {
        this.server?.closeAllConnections?.()
        resolvePromise()
      }, 500).unref?.()
    })
    this.server = null
  }

  /** 广播实时快照（状态变化 / 告警 / 设置变化时由编排层调用）。 */
  broadcast(snapshot: PetSnapshot): void {
    const payload = `data: ${JSON.stringify(snapshot)}\n\n`
    for (const client of [...this.clients]) {
      try {
        client.res.write(payload)
      } catch {
        this.clients.delete(client)
      }
    }
  }

  get clientCount(): number {
    return this.clients.size
  }

  private tryListen(host: string, port: number): Promise<boolean> {
    return new Promise((resolvePromise) => {
      const server = createServer((req, res) => {
        this.route(req, res).catch((error) => {
          console.error('[dsh-companion] ui server error:', error)
          // /api/* 的未捕获异常也回 JSON 带 message——否则客户端 res.json()
          // 解析失败，用户只能看到裸 HTTP 状态码，无从诊断。
          const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
          const isApi = (req.url ?? '').startsWith('/api/')
          if (res.headersSent) {
            res.end()
            return
          }
          res.writeHead(500, {
            'content-type': isApi ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
          })
          res.end(isApi ? JSON.stringify({ ok: false, error: 'internal', message: text }) : text)
        })
      })
      server.once('error', () => resolvePromise(false))
      server.listen(port, host, () => {
        this.server = server
        resolvePromise(true)
      })
    })
  }

  private startHeartbeat(): void {
    this.heartbeat = setInterval(() => {
      for (const client of [...this.clients]) {
        try {
          client.res.write(': ping\n\n')
        } catch {
          this.clients.delete(client)
        }
      }
    }, 15_000)
    this.heartbeat.unref?.()
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const path = url.pathname
    const method = (req.method ?? 'GET').toUpperCase()

    // CORS：DSH Web GUI 页面（不同源）的左下角角标要跨域读本服务。
    // 仅回环绑定 + 只读 JSON，风险面极小；预检直接放行。
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'content-type')
    if (method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // 静态页
    if (path === '/' && method === 'GET') return html(res, petPageHTML())
    if (path === '/panel' && method === 'GET') return html(res, panelPageHTML())

    // 皮肤资源：/skins/<skin>/<state>(.ext)
    if (path.startsWith('/skins/') && method === 'GET') {
      return this.serveSkin(path, res)
    }

    // API
    if (path === '/api/events' && method === 'GET') return this.sse(req, res)
    if (path === '/api/state' && method === 'GET') return json(res, this.deps.snapshot())
    if (path === '/api/skins' && method === 'GET') {
      return json(res, await this.deps.skins.list())
    }
    if (path === '/api/history' && method === 'GET') {
      const limit = clampInt(url.searchParams.get('limit'), 1, 200, 20)
      const offset = clampInt(url.searchParams.get('offset'), 0, 1_000_000, 0)
      const model = (url.searchParams.get('model') ?? '').trim()
      const statusRaw = (url.searchParams.get('status') ?? '').trim()
      const status: TaskQuery['status'] | undefined =
        statusRaw === 'success' || statusRaw === 'failed' || statusRaw === 'interrupted'
          ? statusRaw
          : undefined
      const fromMs = clampInt(url.searchParams.get('from'), 0, 8_640_000_000_000_000, 0)
      const toMs = clampInt(url.searchParams.get('to'), 0, 8_640_000_000_000_000, 0)
      const q = (url.searchParams.get('q') ?? '').trim().slice(0, 120)
      const filter = model || status || fromMs || toMs || q ? { model, status, fromMs, toMs, q } : undefined
      return json(res, await this.deps.history(limit, offset, filter))
    }
    if (path === '/api/models' && method === 'GET') {
      return json(res, { models: await this.deps.models() })
    }
    if (path === '/api/pricing' && method === 'GET') {
      return json(res, this.deps.pricing())
    }
    if (path === '/api/pricing/refresh' && method === 'POST') {
      return json(res, await this.deps.refreshPricing())
    }
    if (path === '/api/stats' && method === 'GET') {
      const periodRaw = url.searchParams.get('period') ?? 'today'
      const period = (['today', 'week', 'month', 'all'] as const).includes(
        periodRaw as 'today',
      )
        ? (periodRaw as 'today' | 'week' | 'month' | 'all')
        : 'today'
      return json(res, await this.deps.stats(period))
    }
    if (path === '/api/ranking' && method === 'GET') {
      const periodRaw = url.searchParams.get('period') ?? 'week'
      const period = (['today', 'week', 'month', 'all'] as const).includes(
        periodRaw as 'today' | 'week' | 'month' | 'all',
      )
        ? (periodRaw as 'today' | 'week' | 'month' | 'all')
        : 'week'
      return json(res, await this.deps.ranking(period))
    }
    if (path === '/api/stats/series' && method === 'GET') {
      const periodRaw = url.searchParams.get('period') ?? 'today'
      const period = (['today', 'week', 'month', 'all'] as const).includes(
        periodRaw as 'today',
      )
        ? (periodRaw as 'today' | 'week' | 'month' | 'all')
        : 'today'
      return json(res, await this.deps.statsSeries(period))
    }
    if (path === '/api/settings' && method === 'PUT') {
      const body = await readJson(req)
      const settings = await this.deps.updateSettings(body)
      return json(res, settings)
    }
    if (path === '/api/position' && method === 'POST') {
      const body = await readJson(req)
      await this.deps.updateSettings({
        position: {
          x: Number(body?.x) || 0,
          y: Number(body?.y) || 0,
        },
      })
      return json(res, { ok: true })
    }
    if (path === '/api/scale' && method === 'POST') {
      const body = await readJson(req)
      const scale = Math.max(0.2, Math.min(5, Number(body?.scale) || 1))
      await this.deps.updateSettings({ scale })
      return json(res, { ok: true })
    }
    if (path === '/api/pause' && method === 'POST') {
      return json(res, await this.deps.togglePause())
    }
    // ---- UI 增强：DSH 会话管理（删除 = registry 除名 + 文件彻底删除）----
    if (path === '/api/dsh-sessions/delete' && method === 'POST') {
      const body = await readJson(req)
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
      const result = await this.deps.deleteDshSession(sessionId)
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
                : 500
      return json(res, result, status)
    }
    if (path === '/api/dsh-sessions' && method === 'GET') {
      const result = await this.deps.listDshSessions()
      const status = result.ok ? 200 : result.error === 'registry-unavailable' ? 503 : 500
      return json(res, result, status)
    }
    if (path === '/api/dsh-sessions/delete-many' && method === 'POST') {
      const body = await readJson(req)
      const result = await this.deps.deleteDshSessions(
        Array.isArray(body?.sessionIds) ? body.sessionIds : null,
      )
      return json(res, result, result.ok ? 200 : 400)
    }
    if (path === '/api/mock/start' && method === 'POST') {
      const body = await readJson(req)
      const scenarioRaw = String(body?.scenario ?? 'success')
      const scenario = (['success', 'error', 'interrupted', 'long'] as const).includes(
        scenarioRaw as 'success',
      )
        ? (scenarioRaw as MockScenario)
        : 'success'
      return json(res, await this.deps.mockStart(scenario))
    }
    if (path === '/api/quit' && method === 'POST') {
      res.writeHead(204)
      res.end()
      await this.deps.quit()
      return
    }
    if (path.startsWith('/api/export/') && method === 'GET') {
      const formatRaw = url.searchParams.get('format') === 'json' ? 'json' : 'csv'
      const format = formatRaw as ExportFormat
      // 导出吃历史页的筛选：model/status/from/to/q 与 /api/history 同口径。
      const statusRaw = (url.searchParams.get('status') ?? '').trim()
      const status: ExportFilter['status'] =
        statusRaw === 'success' || statusRaw === 'failed' || statusRaw === 'interrupted'
          ? statusRaw
          : undefined
      const filter: ExportFilter = {
        model: (url.searchParams.get('model') ?? '').trim(),
        status,
        fromMs: clampInt(url.searchParams.get('from'), 0, 8_640_000_000_000_000, 0),
        toMs: clampInt(url.searchParams.get('to'), 0, 8_640_000_000_000_000, 0),
        q: (url.searchParams.get('q') ?? '').trim().slice(0, 120),
      }
      const result = path.startsWith('/api/export/tools')
        ? await this.deps.exportTools(format)
        : await this.deps.exportSessions(format, filter)
      res.writeHead(200, {
        'content-type': result.contentType,
        'content-disposition': `attachment; filename="${result.filename}"`,
      })
      res.end(result.body)
      return
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
  }

  private async serveSkin(path: string, res: ServerResponse): Promise<void> {
    const parts = path.split('/').filter(Boolean) // ["skins", skin, file]
    if (parts.length !== 3) return notFound(res)
    const skin = parts[1]
    let file = parts[2]
    if (!NAME_PATTERN.test(skin)) return notFound(res)
    // URL 形如 /skins/whale/hooked.png（状态帧）或 /skins/whale/pat.png（反应帧）
    // → 名字去掉扩展名；先按工作状态查，查不到再按互动反应帧查。
    const state = file.includes('.') ? (file.slice(0, file.lastIndexOf('.')) as PetState) : (file as PetState)
    if (!NAME_PATTERN.test(state)) return notFound(res)
    const asset =
      (await this.deps.skins.readStateAsset(skin, state)) ??
      (await this.deps.skins.readReactionAsset(skin, state))
    if (!asset) return notFound(res)
    res.writeHead(200, {
      'content-type': asset.contentType,
      'cache-control': 'no-cache',
    })
    res.end(asset.body)
  }

  private sse(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    res.write(`retry: 3000\n\n`)
    res.write(`data: ${JSON.stringify(this.deps.snapshot())}\n\n`)
    const client: SseClient = { res }
    this.clients.add(client)
    req.once('close', () => this.clients.delete(client))
  }
}

function html(res: ServerResponse, body: string): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(body)
}

function json(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('not found')
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new Error('request body too large')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  const value = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}
