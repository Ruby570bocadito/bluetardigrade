import { describe, expect, test } from 'bun:test'
import {
  alertTactic,
  counterDelta,
  formatAgo,
  formatCompact,
  niceTicks,
  pushSample,
  sampleOf,
  severityBuckets,
  severityCounts,
  tacticCoverage,
  tacticSlug,
  topCounts,
  type StatsSample,
} from './soc-metrics'
import type { EngineStats, Severity } from './console-types'

const at = (now: number, agoMs: number) => new Date(now - agoMs).toISOString()

describe('ATT&CK tactics', () => {
  test('normalizes the engine label and the raw tag to one slug', () => {
    expect(tacticSlug('Command And Control')).toBe('command-and-control')
    expect(tacticSlug('attack.defense-evasion')).toBe('defense-evasion')
    expect(tacticSlug('attack.t1105')).toBeNull()
    expect(tacticSlug('')).toBeNull()
  })

  test('skips technique tags and reads the first tactic of an alert', () => {
    expect(alertTactic({ tags: ['attack.t1105', 'attack.command-and-control', 'attack.execution'] })).toBe('command-and-control')
    expect(alertTactic({ tags: ['windows'] })).toBeNull()
    expect(alertTactic({})).toBeNull()
  })

  test('coverage keeps kill-chain order and counts rules and alerts separately', () => {
    const cells = tacticCoverage(
      [{ tactic: 'Execution', tags: [] }, { tactic: '', tags: ['attack.execution'] }, { tactic: 'Impact', tags: [] }],
      [{ tags: ['attack.execution'] }, { tags: ['attack.t1003'] }],
    )
    expect(cells).toHaveLength(14)
    expect(cells[0].slug).toBe('reconnaissance')
    expect(cells.find((c) => c.slug === 'execution')).toMatchObject({ rules: 2, alerts: 1 })
    expect(cells.find((c) => c.slug === 'impact')).toMatchObject({ rules: 1, alerts: 0 })
  })
})

describe('severity aggregation', () => {
  test('counts every known severity', () => {
    const counts = severityCounts([{ severity: 'critical' }, { severity: 'critical' }, { severity: 'low' }])
    expect(counts).toEqual({ critical: 2, high: 0, medium: 0, low: 1, info: 0 })
  })

  test('buckets the half-open window and drops future, stale and invalid alerts', () => {
    const now = Date.parse('2026-10-03T12:00:00Z')
    const alerts: { severity: Severity; timestamp: string }[] = [
      { severity: 'critical', timestamp: at(now, 0) },
      { severity: 'high', timestamp: at(now, 59_999) },
      { severity: 'medium', timestamp: at(now, 60_000) },
      { severity: 'low', timestamp: at(now, 179_999) },
      { severity: 'info', timestamp: at(now, 180_000) },
      { severity: 'critical', timestamp: at(now, -1000) },
      { severity: 'critical', timestamp: 'not a date' },
    ]
    const buckets = severityBuckets(alerts, now, 180_000, 60_000)
    expect(buckets.map((b) => b.total)).toEqual([1, 1, 2])
    expect(buckets[2].counts).toMatchObject({ critical: 1, high: 1 })
    expect(buckets[1].counts.medium).toBe(1)
    expect(buckets[0].counts.low).toBe(1)
    expect(buckets[2].end).toBe(now)
    expect(buckets[0].start).toBe(now - 180_000)
  })
})

describe('ranking', () => {
  test('orders by count then key and folds the remainder', () => {
    const items = ['b', 'a', 'a', 'c', 'c', 'd', null]
    const ranked = topCounts(items, (x) => x, 2)
    expect(ranked.top).toEqual([{ key: 'a', count: 2 }, { key: 'c', count: 2 }])
    expect(ranked.rest).toBe(2)
    expect(ranked.distinct).toBe(4)
  })
})

describe('stats history', () => {
  const stats = (over: Partial<EngineStats>): EngineStats => ({
    uptime_s: 10, events_total: 100, dropped: 1, ingest_rejected: 2, events_per_min: 50, alerts_total: 4,
    by_severity: {}, rules_count: 75, rules_types: [], events_buffered: 0, webhook_sent: 0, webhook_failed: 0,
    webhook_dropped: 0, suppressions_active: 0, correlator_states: 0, correlator_sequences: 0, correlator_cap: 0, ...over,
  })

  test('samples the counters the tiles chart', () => {
    expect(sampleOf(stats({ risk_hosts_tracked: 3 }), 5)).toMatchObject({ t: 5, rejected: 3, riskHosts: 3, rules: 75 })
    expect(sampleOf(stats({}), 5).riskHosts).toBe(0)
  })

  test('caps the history and restarts it when the engine restarts', () => {
    let history: StatsSample[] = []
    for (let i = 0; i < 5; i++) history = pushSample(history, sampleOf(stats({ uptime_s: 10 + i, alerts_total: i }), i), 3)
    expect(history.map((s) => s.alertsTotal)).toEqual([2, 3, 4])
    expect(counterDelta(history, (s) => s.alertsTotal)).toBe(2)
    history = pushSample(history, sampleOf(stats({ uptime_s: 1 }), 9), 3)
    expect(history).toHaveLength(1)
    expect(counterDelta(history, (s) => s.alertsTotal)).toBeNull()
  })
})

describe('formatting', () => {
  test('ticks are clean 1/2/5 steps that cover the maximum', () => {
    expect(niceTicks(7, 3)).toEqual([0, 5, 10])
    expect(niceTicks(120, 3)).toEqual([0, 50, 100, 150])
    expect(niceTicks(0)).toEqual([0, 1])
    expect(niceTicks(1, 3)).toEqual([0, 0.5, 1])
  })

  test('compacts large figures and keeps small ones exact', () => {
    expect(formatCompact(1284)).toBe('1284')
    expect(formatCompact(12940)).toBe('12,9 k')
    expect(formatCompact(4_200_000)).toBe('4,2 M')
  })

  test('relative times read naturally', () => {
    expect(formatAgo(200)).toBe('ahora')
    expect(formatAgo(35_000)).toBe('hace 35 s')
    expect(formatAgo(240_000)).toBe('hace 4 min')
    expect(formatAgo(7_200_000)).toBe('hace 2 h')
  })
})
