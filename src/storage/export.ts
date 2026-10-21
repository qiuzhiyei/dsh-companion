/**
 * dsh-companion — 数据导出（CSV / JSON）。
 *
 * CSV 遵循 RFC 4180 风格转义（BOM 头保证 Excel 中文不乱码）；
 * JSON 输出完整带 schemaVersion 的结构。
 */

import type { PetStore } from './store.js'
import type { TaskSession, ToolCallRecord } from '../types.js'

/** 导出筛选（与历史页共用口径；缺省 = 全部）。 */
export interface ExportFilter {
  model?: string
  status?: TaskSession['status']
  fromMs?: number
  toMs?: number
  q?: string
}

const TASK_CSV_FIELDS: ReadonlyArray<keyof TaskSession> = [
  'id',
  'sessionId',
  'turn',
  'project',
  'workspace',
  'provider',
  'model',
  'startTime',
  'endTime',
  'status',
  'promptTokens',
  'completionTokens',
  'totalTokens',
  'cachedTokens',
  'reasoningTokens',
  'cost',
  'toolCalls',
  'toolSuccess',
  'toolFail',
  'steps',
  'tags',
  'note',
]

const TOOL_CSV_FIELDS: ReadonlyArray<keyof ToolCallRecord> = [
  'id',
  'taskKey',
  'callId',
  'name',
  'startTime',
  'endTime',
  'status',
]

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (typeof value === 'object') text = JSON.stringify(value)
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`
  }
  return text
}

function rowsToCsv(fields: readonly string[], rows: readonly Record<string, unknown>[]): string {
  const lines = [fields.join(',')]
  for (const row of rows) {
    lines.push(fields.map((field) => csvEscape(row[field])).join(','))
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

export interface ExportResult {
  filename: string
  contentType: string
  body: string
}

export async function exportSessions(
  store: PetStore,
  format: 'csv' | 'json',
  limit = 5_000,
  filter?: ExportFilter,
): Promise<ExportResult> {
  // 带筛选时走 queryTasks（与历史页同一套 WHERE），否则全量 dump。
  const filtered = filter && hasFilter(filter)
  const tasks = filtered
    ? (await store.queryTasks({ ...filter, limit, offset: 0 })).tasks
    : await store.listTasks(limit)
  if (format === 'csv') {
    return {
      filename: `dsh-companion-sessions-${stamp()}.csv`,
      contentType: 'text/csv; charset=utf-8',
      body: rowsToCsv(TASK_CSV_FIELDS, tasks as unknown as Record<string, unknown>[]),
    }
  }
  return {
    filename: `dsh-companion-sessions-${stamp()}.json`,
    contentType: 'application/json; charset=utf-8',
    body: `${JSON.stringify({ schemaVersion: 1, exportedAt: Date.now(), tasks }, null, 2)}\n`,
  }
}

export async function exportToolCalls(
  store: PetStore,
  format: 'csv' | 'json',
  limit = 20_000,
): Promise<ExportResult> {
  const tools = await store.listToolCalls(limit)
  if (format === 'csv') {
    return {
      filename: `dsh-companion-tool-calls-${stamp()}.csv`,
      contentType: 'text/csv; charset=utf-8',
      body: rowsToCsv(TOOL_CSV_FIELDS, tools as unknown as Record<string, unknown>[]),
    }
  }
  return {
    filename: `dsh-companion-tool-calls-${stamp()}.json`,
    contentType: 'application/json; charset=utf-8',
    body: `${JSON.stringify({ schemaVersion: 1, exportedAt: Date.now(), toolCalls: tools }, null, 2)}\n`,
  }
}

function hasFilter(filter: ExportFilter): boolean {
  return Boolean(
    (filter.model && filter.model.length > 0) ||
      filter.status ||
      (filter.fromMs && filter.fromMs > 0) ||
      (filter.toMs && filter.toMs > 0) ||
      (filter.q && filter.q.length > 0),
  )
}

function stamp(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
}
