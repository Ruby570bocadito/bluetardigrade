import { afterEach, describe, expect, test } from 'bun:test'
import { dbQuery, dbQueryFetchTimeoutMs } from './db-query'

const realFetch = globalThis.fetch
let sent: { url: string; init: RequestInit }[] = []

function respond(status: number, body: string) {
  sent = []
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} })
    return new Response(body, { status })
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('db query client', () => {
  test('the statement and limits travel as the engine expects them', async () => {
    respond(200, '{"columns":["host"],"rows":[["LAB-01"]],"row_count":1,"truncated":false,"duration_ms":3}')
    const res = await dbQuery({ sql: 'SELECT host FROM events LIMIT 1', max_rows: 100, timeout_ms: 1000 })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.columns).toEqual(['host'])
      expect(res.data.rows).toEqual([['LAB-01']])
      expect(res.data.row_count).toBe(1)
      expect(res.data.truncated).toBe(false)
    }
    expect(sent[0].url).toBe('/api/engine/api/db/query')
    expect(sent[0].init.method).toBe('POST')
    expect(JSON.parse(String(sent[0].init.body))).toEqual({ sql: 'SELECT host FROM events LIMIT 1', max_rows: 100, timeout_ms: 1000 })
  })

  test('engine refusals surface their sentence, including the disabled surface', async () => {
    respond(403, '{"error":"the SQL query surface is disabled: restart the engine with -api-db-query"}')
    const off = await dbQuery({ sql: 'SELECT 1' })
    expect(off).toEqual({ ok: false, status: 403, error: 'the SQL query surface is disabled: restart the engine with -api-db-query' })

    respond(400, '{"error":"only SELECT/WITH/VALUES statements are allowed"}')
    const rejected = await dbQuery({ sql: 'DELETE FROM events' })
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.error).toContain('only SELECT')

    respond(408, '{"error":"query exceeded its time budget"}')
    const slow = await dbQuery({ sql: 'SELECT 1' })
    expect(slow.ok).toBe(false)
    if (!slow.ok) expect(slow.error).toContain('time budget')
  })

  test('the fetch budget always outlives the engine time budget', () => {
    expect(dbQueryFetchTimeoutMs(1000)).toBe(11000)
    expect(dbQueryFetchTimeoutMs(10000)).toBe(20000)
    expect(dbQueryFetchTimeoutMs(30000)).toBe(40000)
    expect(dbQueryFetchTimeoutMs(60000)).toBe(40000)
  })
})
