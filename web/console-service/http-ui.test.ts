// Unit tests for the HTTP status page: it must reflect the real hub
// state, follow the shared design tokens (no purple, no emojis, no
// em-dash) and escape every dynamic value.

import { describe, expect, test } from 'bun:test'
import { buildStatusData, esc, renderNotFound, renderStatusPage, type StatusContext } from './http-ui'
import { HubState } from './hub-state'

const ctx: StatusContext = {
  version: '0.0.0-test',
  host: '127.0.0.1',
  port: 3003,
  socketPath: '/',
  corsOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://lab.example:3000'],
}

function upState(): HubState {
  const st = new HubState({
    ANALYST_BASE_URL: 'http://127.0.0.1:1234/v1',
    ANALYST_API_KEY: 'sk-xyz',
    ANALYST_MODEL: 'model-x',
  })
  st.setUp('http://127.0.0.1:7778')
  st.setStats({
    events_total: 4321,
    alerts_total: 7,
    by_severity: { critical: 2, high: 3, medium: 1, low: 1 },
    events_per_min: 210,
    uptime_s: 5400,
    interval_ms: 0,
    mode: 'engine',
    webhook_sent: 0,
    webhook_failed: 0,
    webhook_dropped: 0,
    suppressions_active: 0,
    correlator_states: 0,
    correlator_sequences: 0,
    correlator_cap: 0,
  })
  st.setRules([
    { id: 'r1', name: 'lsass-access', description: '', severity: 'critical', event_type: 'process.access', mitre: 'T1003.001', tactic: 'Credential Access', tags: [], conditions: [] },
    { id: 'r2', name: 'certutil-download', description: '', severity: 'high', event_type: 'process.create', mitre: 'T1105', tactic: 'Command and Control', tags: [], conditions: [] },
  ])
  st.incClients()
  return st
}

describe('renderStatusPage', () => {
  test('reflects a connected engine with its real numbers', () => {
    const html = renderStatusPage(buildStatusData(upState(), ctx))
    expect(html).toContain('console-service')
    expect(html).toContain('Motor conectado')
    expect(html).toContain('http://127.0.0.1:7778')
    expect(html).toContain('4321') // events_total straight from the engine
    expect(html).toContain('210') // events_per_min
    expect(html).toContain('model-x') // real analyst model
    expect(html).toContain('lsass-access')
    expect(html).toContain('Credential Access')
    expect(html).toContain('http://lab.example:3000') // extra CORS origin
  })

  test('is honest about a disconnected engine (empty state, no fake data)', () => {
    const st = new HubState({})
    const html = renderStatusPage(buildStatusData(st, ctx))
    expect(html).toContain('Motor sin conexion')
    expect(html).toContain('no hay datos simulados')
    expect(html).toContain('Sin reglas todavia')
    expect(html).toContain('Sin configurar')
    expect(html).toContain('ANALYST_BASE_URL')
    // the initial pill is the down variant, not the ok one
    expect(html).toContain('id="pill" class="pill down"')
    expect(html).not.toContain('id="pill" class="pill ok"')
  })

  test('follows the shared design tokens', () => {
    const html = renderStatusPage(buildStatusData(upState(), ctx))
    expect(html).toContain('#09090b') // zinc-950 background
    expect(html).toContain('#18181b') // zinc-900 surface
    // The status page uses rgba() forms of the shared accent: check the
    // emerald-500 channel triplet, not a hex literal that never appears.
    expect(html).toContain('16,185,129') // emerald-500 accent
    expect(html).toContain('#ef4444') // critical red-500
    expect(html).toContain('#f97316') // high orange-500
    expect(html).toContain('#fbbf24') // medium amber-400
    expect(html).toContain('#38bdf8') // low/info sky-400
    expect(html).toContain('Geist Mono')
    expect(html).not.toContain('purple')
    expect(html).not.toContain('\u2014') // no em-dash anywhere
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u) // no emojis
  })

  test('escapes rule names and endpoints', () => {
    const st = upState()
    st.setRules([
      {
        id: 'rx',
        name: '<script>alert(1)</script>',
        description: '',
        severity: 'low',
        event_type: 't',
        mitre: '',
        tactic: '',
        tags: [],
        conditions: [],
      },
    ])
    const html = renderStatusPage(buildStatusData(st, ctx))
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>alert(1)</script>')
  })
})

describe('renderNotFound', () => {
  test('links back to the panel and health, and escapes the path', () => {
    const html = renderNotFound('/<x>')
    expect(html).toContain('404')
    expect(html).toContain('/health')
    expect(html).toContain('&lt;x&gt;')
  })
})

describe('esc', () => {
  test('escapes the dangerous five', () => {
    expect(esc(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f')
    expect(esc(null)).toBe('')
  })
})
