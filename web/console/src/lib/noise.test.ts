import { afterEach, describe, expect, test } from 'bun:test'
import { fetchNoise, noiseLimit, noiseWindowPreset, type NoiseReport } from './noise'

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

const REPORT: NoiseReport = {
  kind: 'noise',
  generated_at: '2026-10-05T10:00:00Z',
  window: { preset: '24h', from: 'a', until: 'b' },
  host: '',
  source: 'ring',
  scanned: { events: 1200, alerts: 40, truncated: false },
  processes: [{ image: 'c:\\windows\\vantage.exe', count: 720, distinct_hosts: 6, first_seen: 'a', last_seen: 'b', parent: 'svchost.exe', command_line: '--poll', sha256: 'ab12' }],
  domains: [{ domain: 'updates.example.com', count: 310, distinct_hosts: 5, first_seen: 'a', last_seen: 'b' }],
  rules: [{ rule_id: 'soc-ids-scan', rule_name: 'IDS scan', count: 88, by_severity: { medium: 88 }, distinct_hosts: 4, acknowledged_pct: 25, closed_pct: 0 }],
}

describe('noise client (§2.4)', () => {
  test('the report fetch carries window, host filter and limit', async () => {
    respond(200, JSON.stringify(REPORT))
    const res = await fetchNoise('24h', 'LAB-WKS-01', 25)
    expect(res.ok).toBe(true)
    expect(sent[0].url).toBe('/api/engine/api/noise?window=24h&limit=25&host=LAB-WKS-01')
    if (res.ok) {
      expect(res.data.processes[0].image).toContain('vantage')
      expect(res.data.rules[0].closed_pct).toBe(0)
    }
  })

  test('an empty host means the whole fleet and a blank one sends nothing', async () => {
    respond(200, JSON.stringify(REPORT))
    await fetchNoise('7d', '  ', 10)
    expect(sent[0].url).toBe('/api/engine/api/noise?window=7d&limit=10')
  })

  test('errors travel as results with the engine sentence', async () => {
    respond(400, '{"error":"invalid window (15m to 30d)"}')
    // the type keeps the documented presets; a hostile URL still gets the engine's sentence
    const bad = await fetchNoise('90d' as import('./noise').NoiseWindow)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toBe('invalid window (15m to 30d)')
  })
})

describe('noise lens presets', () => {
  test('windows fall back to 24h and limits to the documented cap of 10', () => {
    for (const win of ['15m', '1h', '24h', '7d', '30d'] as const) expect(noiseWindowPreset(win)).toBe(win)
    expect(noiseWindowPreset('90d')).toBe('24h')
    expect(noiseWindowPreset(null)).toBe('24h')
    expect(noiseLimit('25')).toBe(25)
    expect(noiseLimit('50')).toBe(50)
    expect(noiseLimit('999')).toBe(10)
    expect(noiseLimit(undefined)).toBe(10)
  })
})
