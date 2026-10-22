// SQL console client over the engine's evidence database (C-4 on top of
// M-4): POST /api/db/query. The engine owns every hard limit (one
// read-only statement, max_rows clamped to 5000, timeout_ms to 30000,
// audit row per attempt); the client adds none of its own and only makes
// sure its fetch outlives the engine's time budget.

import { engineCall, type EngineResult } from './engine-writes'

export type DbQueryRequest = {
  sql: string
  max_rows?: number
  timeout_ms?: number
}

export type DbQueryReply = {
  columns: string[]
  rows: unknown[][]
  row_count: number
  truncated: boolean
  duration_ms: number
}

/** The engine clamps max_rows here and timeout_ms at 30000 ms; defaults
 * (500 rows, 10 s) stay server-side. */
export const DB_QUERY_MAX_ROWS = 5000
export const DB_QUERY_MAX_TIMEOUT_MS = 30000

/** Client fetch budget: the engine may legitimately run 30 s before its
 * own 408, so the console waits longer than that before giving up. The
 * engine's default budget is 10 s when timeout_ms is absent. */
export const DB_QUERY_DEFAULT_TIMEOUT_MS = 10000

export function dbQueryFetchTimeoutMs(timeoutMs: number): number {
  return Math.min(DB_QUERY_MAX_TIMEOUT_MS, Math.max(1, timeoutMs)) + 10000
}

export function dbQuery(req: DbQueryRequest): Promise<EngineResult<DbQueryReply>> {
  return engineCall<DbQueryReply>('POST', '/api/db/query', req, {}, dbQueryFetchTimeoutMs(req.timeout_ms ?? DB_QUERY_DEFAULT_TIMEOUT_MS))
}
