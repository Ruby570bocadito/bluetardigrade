// Unit tests for the SET-3 platform-status model (platform-status.ts):
// section assembly from the engine's /api/stats snapshot, honest
// absence for metrics the API does not publish, capacity meters only
// where the engine publishes a real cap, and the delivery triples of
// the external sinks.

//   bun test            (from web/console/)

import { describe, expect, test } from 'bun:test'
import { MAX_CHANNEL_ROWS, platformStatus, topHostLine } from './platform-status'
import type { EngineStats } from './console-types'

function baseStats(overrides: Partial<EngineStats> = {}): EngineStats {
  return {
    uptime_s: 3661,
    events_total: 231,
    dropped: 0,
    ingest_rejected: 0,
    events_per_min: 42,
    alerts_total: 4,
    by_severity: {},
    rules_count: 12,
    rules_types: ['sigma', 'threshold'],
    events_buffered: 7,
    webhook_sent: 0,
    webhook_failed: 0,
    webhook_dropped: 0,
    suppressions_active: 2,
    correlator_states: 0,
    correlator_sequences: 0,
    correlator_cap: 0,
    mode: 'engine',
    ...overrides,
  }
}

const section = (report: NonNullable<ReturnType<typeof platformStatus>>, key: string) => {
  const found = report.sections.find((s) => s.key === key)
  expect(found).toBeDefined()
  return found!
}

const row = (report: NonNullable<ReturnType<typeof platformStatus>>, key: string) => {
  const found = report.sections.flatMap((s) => s.rows).find((r) => r.key === key)
  expect(found).toBeDefined()
  return found!
}

describe('platformStatus', () => {
  test('null stats stay null so the view keeps its empty state', () => {
    expect(platformStatus(null)).toBeNull()
  })

  test('the six TODO sections are always present in order', () => {
    const report = platformStatus(baseStats())!
    expect(report.sections.map((s) => s.key)).toEqual([
      'motor', 'ingesta', 'colas', 'almacen', 'entrega', 'deteccion',
    ])
  })

  test('healthy report: no bad rows on a clean snapshot', () => {
    const report = platformStatus(baseStats())!
    expect(report.healthy).toBe(true)
    expect(report.sections.flatMap((s) => s.rows).filter((r) => r.tone === 'bad')).toHaveLength(0)
  })

  test('uptime and rules render with the shared helpers, mode names the source', () => {
    const report = platformStatus(baseStats())!
    expect(row(report, 'uptime').display).toBe('1h 01m')
    expect(row(report, 'rules').display).toBe('12')
    expect(row(report, 'mode').display).toBe('conectado al motor')
  })

  test('attention counters flip tone only when positive', () => {
    const clean = platformStatus(baseStats())!
    expect(row(clean, 'dropped').tone).toBe('neutral')
    expect(row(clean, 'dropped').display).toBe('0')

    const dropped = platformStatus(baseStats({ dropped: 5 }))!
    expect(row(dropped, 'dropped').tone).toBe('warn')
    expect(dropped.healthy).toBe(true) // warn keeps the page healthy
  })

  test('identity violations are bad, not warn', () => {
    const report = platformStatus(baseStats({ ingest_identity_violations: 1 }))!
    expect(row(report, 'violations').tone).toBe('bad')
    expect(report.healthy).toBe(false)
  })

  test('optional metrics the engine does not publish render as absent, never 0', () => {
    const report = platformStatus(baseStats())!
    const absent = row(report, 'identities')
    expect(absent.absent).toBe(true)
    expect(absent.display).toBe('no publicado')
    expect(absent.tone).toBe('neutral')
  })

  test('optional metrics present on newer engines render their value', () => {
    const report = platformStatus(baseStats({ ingest_identities: 3, risk_hosts_tracked: 9, hot_hosts: [{ host: 'lab-win11', score: 22, alerts: 4, last_seen: '' }] }))!
    expect(row(report, 'identities').display).toBe('3')
    expect(row(report, 'risk').display).toBe('9')
    expect(row(report, 'hot').display).toBe('1')
    expect(topHostLine([{ host: 'lab-win11', score: 22, alerts: 4, last_seen: '' }])).toBe('lab-win11 · riesgo 22')
    expect(topHostLine(undefined)).toBeUndefined()
  })

  test('the correlator meter only appears when the engine publishes a cap', () => {
    const off = platformStatus(baseStats())!
    const offRow = row(off, 'chains')
    expect(offRow.fill).toBeUndefined()
    expect(offRow.display).toContain('0 de 0')
    expect(offRow.hint).toContain('correlador')

    const live = platformStatus(baseStats({ correlator_states: 5, correlator_sequences: 2, correlator_cap: 10 }))!
    const liveRow = row(live, 'chains')
    expect(liveRow.fill).toEqual({ value: 5, max: 10, color: 'var(--series-1)' })
    expect(liveRow.display).toBe('5 de 10 plazas')
  })

  test('the correlator meter turns amber at 80% of the cap', () => {
    const report = platformStatus(baseStats({ correlator_states: 8, correlator_cap: 10 }))!
    expect(row(report, 'chains').fill!.color).toBe('var(--sev-medium)')
  })

  test('a saturated beacon tracker warns but stays honest about the cap', () => {
    const report = platformStatus(baseStats({ beacons_tracked: 64, beacons_cap: 64, beacons_fired: 1 }))!
    const beacons = row(report, 'beacons')
    expect(beacons.tone).toBe('warn')
    expect(beacons.fill).toEqual({ value: 64, max: 64, color: 'var(--sev-medium)' })
    expect(row(report, 'beacons-fired').tone).toBe('warn')
  })

  test('store rows follow the optional trio contract of the engine', () => {
    const withoutStore = platformStatus(baseStats({ store_enabled: false, store_write_failures: 0 }))!
    expect(row(withoutStore, 'store').display).toBe('sin persistencia')
    expect(row(withoutStore, 'store-failures').display).toBe('0')
    expect(row(withoutStore, 'store-failures').tone).toBe('neutral')

    // an older engine that omits the counters keeps them absent: missing
    // data is never equated with zero failures
    const oldEngine = platformStatus(baseStats({ store_enabled: undefined }))!
    expect(row(oldEngine, 'store').absent).toBe(true)
    expect(row(oldEngine, 'store-failures').absent).toBe(true)
  })

  test('a failed store write is the one thing that flips the page red', () => {
    const report = platformStatus(baseStats({ store_enabled: true, store_events: 100, store_alerts: 5, store_write_failures: 2 }))!
    expect(row(report, 'store-events').display).toBe('100')
    expect(row(report, 'store-failures').tone).toBe('bad')
    expect(report.healthy).toBe(false)
  })

  test('webhook triple: idle stays neutral, failures go bad', () => {
    const idle = platformStatus(baseStats())!
    expect(row(idle, 'webhook').display).toBe('sin actividad')
    expect(row(idle, 'webhook').tone).toBe('neutral')

    const broken = platformStatus(baseStats({ webhook_sent: 10, webhook_failed: 2, webhook_dropped: 1 }))!
    expect(row(broken, 'webhook').display).toBe('10 enviados · 2 fallidos · 1 descartados')
    expect(row(broken, 'webhook').tone).toBe('bad')
    expect(broken.healthy).toBe(false)
  })

  test('elastic and splunk sinks are absent until the hub forwards them', () => {
    const withoutSinks = platformStatus(baseStats())!
    expect(row(withoutSinks, 'elastic').absent).toBe(true)
    expect(row(withoutSinks, 'splunk').absent).toBe(true)

    const withSinks = platformStatus(baseStats({
      elastic_sent: 90, elastic_failed: 0, elastic_dropped: 0,
      splunk_sent: 80, splunk_failed: 3, splunk_dropped: 0,
    }))!
    expect(row(withSinks, 'elastic').display).toBe('90 enviados · 0 fallidos · 0 descartados')
    expect(row(withSinks, 'splunk').tone).toBe('bad')
  })

  test('notify channels render per channel and fold the overflow honestly', () => {
    const channels = Array.from({ length: MAX_CHANNEL_ROWS + 2 }, (_, i) => ({
      name: `canal-${i}`, type: 'slack', sent: i, failed: 0, dropped: 0, filtered: 0,
    }))
    const report = platformStatus(baseStats({ notify_channels: channels }))!
    const entrega = section(report, 'entrega')
    const channelRows = entrega.rows.filter((r) => r.key.startsWith('notify-'))
    expect(channelRows).toHaveLength(MAX_CHANNEL_ROWS)
    expect(channelRows[1].label).toContain('canal-1')
  })

  test('missing notify channels are declared, not silently dropped', () => {
    const report = platformStatus(baseStats())!
    const notify = row(report, 'notify')
    expect(notify.absent).toBe(true)
    expect(notify.display).toBe('no publicado')
  })

  test('the footnote always carries the metrics the TODO asks for', () => {
    const report = platformStatus(baseStats())!
    expect(report.unavailable).toContain('latencias de ingesta y consulta')
    expect(report.unavailable).toContain('tamaño del almacén en bytes')
    expect(report.unavailable).toContain('versión del motor')
    expect(report.unavailable).toContain('certificados por caducar')
    expect(report.unavailable).toContain('último informe programado')
  })

  test('sin-motor mode names the local view instead of the engine', () => {
    const report = platformStatus(baseStats({ mode: 'sin-motor' }))!
    expect(row(report, 'mode').display).toBe('sin motor (vista local)')
  })
})
