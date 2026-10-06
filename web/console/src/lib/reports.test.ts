import { afterEach, describe, expect, test } from 'bun:test'
import { downloadStamp, fetchReport, fetchReportCatalog, reportPath, reportWindowPreset, type ExecutiveReport, type ReportCatalog } from './reports'

const realFetch = globalThis.fetch
let sent: { url: string; init: RequestInit }[] = []

afterEach(() => {
  globalThis.fetch = realFetch
})

function respond(status: number, body: string) {
  sent = []
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} })
    return new Response(body, { status })
  }) as typeof fetch
}

const CATALOG: ReportCatalog = {
  reports: [
    { kind: 'executive', title: 'Executive summary', description: 'd', params: { window: '24h | 7d | 30d (default 7d)', format: 'json | csv (default json)' }, formats: ['json', 'csv'] },
    { kind: 'incident', title: 'Incident report', description: 'd', params: { id: 'incident id (16 hex, required)', format: 'json | csv (default json)' }, formats: ['json', 'csv'] },
  ],
}

describe('report client (REP-1)', () => {
  test('the catalog comes straight from the engine and the picker never hardcodes kinds', async () => {
    respond(200, JSON.stringify(CATALOG))
    const res = await fetchReportCatalog()
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.reports.map((r) => r.kind)).toEqual(['executive', 'incident'])
    expect(sent[0].url).toBe('/api/engine/api/reports')
  })

  test('report paths carry the window, the incident id and the requested format', () => {
    expect(reportPath({ kind: 'executive', window: '7d' })).toBe('/api/reports/executive?window=7d')
    expect(reportPath({ kind: 'executive', window: '30d' }, 'csv')).toBe('/api/reports/executive?window=30d&format=csv')
    expect(reportPath({ kind: 'incident', id: '0123abcdef012345' })).toBe('/api/reports/incident?id=0123abcdef012345')
    expect(reportPath({ kind: 'soc', window: '24h' })).toBe('/api/reports/soc?window=24h')
  })

  test('the report fetch is a plain engine GET and errors travel as results', async () => {
    respond(400, '{"error":"unknown window for the kind"}')
    const bad = await fetchReport({ kind: 'executive', window: '99d' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toBe('unknown window for the kind')
    const executive: ExecutiveReport = {
      kind: 'executive', generated_at: '2026-10-05T10:00:00Z',
      window: { preset: '7d', from: 'a', until: 'b' }, source: 'store', truncated: false,
      alerts_total: 3, by_severity: { high: 2, low: 1 }, by_status: { new: 3 }, by_tactic: { 'Credential Access': 2 },
      hosts_affected: 2, top_rules: [], incidents: { opened_in_window: 1, closed_in_window: 0, open: 1, persistent: true },
      fleet: { enabled: true, total: 5, online: 4, silent: 1, idle: 0 },
    }
    respond(200, JSON.stringify(executive))
    const ok = await fetchReport({ kind: 'executive', window: '7d' })
    expect(ok.ok).toBe(true)
  })

  test('download filenames stamp the kind with a Windows-safe UTC stamp', () => {
    const stamp = downloadStamp(new Date('2026-10-05T10:20:30.456Z'))
    expect(stamp).toBe('2026-10-05T10-20-30')
    expect(stamp).not.toContain(':')
  })
})

describe('window presets', () => {
  test('only the documented presets pass, anything else falls back to the 7d default', () => {
    expect(reportWindowPreset('24h')).toBe('24h')
    expect(reportWindowPreset('30d')).toBe('30d')
    expect(reportWindowPreset('7d')).toBe('7d')
    expect(reportWindowPreset('99d')).toBe('7d')
    expect(reportWindowPreset(null)).toBe('7d')
  })
})
