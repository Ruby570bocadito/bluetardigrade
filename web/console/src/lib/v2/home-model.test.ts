import { describe, expect, test } from 'bun:test'
import type { EngineStats, SfAlert } from '@/lib/console-types'
import { attackMatrix, chartCeiling, homeKpis, homeStatus, latestAlerts, parentTechniques, riskLevel, sparkPath, telemetrySeries } from './home-model'

function alert(over: Partial<SfAlert>): SfAlert {
  return {
    id: over.id ?? Math.random().toString(16).slice(2),
    timestamp: '2026-11-16T10:00:00Z',
    rule_id: 'r1',
    rule_name: 'Regla',
    severity: 'low',
    host: 'PC-01',
    event_id: 'e1',
    summary: '',
    tags: [],
    ...over,
  } as SfAlert
}

describe('homeStatus', () => {
  test('the engine state wins over the alerts', () => {
    expect(homeStatus('connecting', [alert({ severity: 'critical' })])).toEqual({ kind: 'connecting' })
    expect(homeStatus('down', [alert({ severity: 'critical' })])).toEqual({ kind: 'offline' })
  })

  test('unreviewed critical alerts come first, then high ones', () => {
    const alerts = [
      alert({ severity: 'high' }),
      alert({ severity: 'critical' }),
      alert({ severity: 'critical', status: 'new' }),
      alert({ severity: 'critical', status: 'acknowledged' }),
    ]
    expect(homeStatus('live', alerts)).toEqual({ kind: 'alert', severity: 'critical', count: 2 })
    expect(homeStatus('live', [alert({ severity: 'high' }), alert({ severity: 'medium' })])).toEqual({
      kind: 'alert', severity: 'high', count: 1,
    })
  })

  test('calm counts what is still open but already looked at', () => {
    const alerts = [
      alert({ severity: 'critical', status: 'acknowledged' }),
      alert({ severity: 'high', status: 'closed' }),
      alert({ severity: 'low' }),
    ]
    expect(homeStatus('live', alerts)).toEqual({ kind: 'calm', open: 2 })
  })

  test('a running engine that has not received any event yet is waiting, not calm', () => {
    expect(homeStatus('live', [], 0)).toEqual({ kind: 'waiting' })
    expect(homeStatus('live', [], 12)).toEqual({ kind: 'calm', open: 0 })
    expect(homeStatus('live', [], null)).toEqual({ kind: 'calm', open: 0 })
    // alerts kept from before (a store) still speak first
    expect(homeStatus('live', [alert({ severity: 'critical' })], 0).kind).toBe('alert')
  })
})

describe('homeKpis', () => {
  const stats = {
    events_per_min: 120,
    events_total: 5000,
    rules_count: 125,
    hot_hosts: [{ host: 'SRV-DB', score: 27.5, alerts: 4, last_seen: '' }],
  } as unknown as EngineStats

  test('reads the live numbers and leaves unknowns as null', () => {
    const k = homeKpis(stats, [alert({ severity: 'high' }), alert({ status: 'closed' })], null, [])
    expect(k.eventsPerMin).toBe(120)
    expect(k.open).toBe(1)
    expect(k.openBySeverity.high).toBe(1)
    expect(k.hostsOnline).toBeNull()
    expect(k.topRisk).toEqual({ host: 'SRV-DB', score: 27.5, level: 'critical' })
    expect(k.rules).toBe(125)
  })

  test('without stats nothing is invented', () => {
    const k = homeKpis(null, [], null, [])
    expect(k.eventsPerMin).toBeNull()
    expect(k.topRisk).toBeNull()
    expect(k.eventsTotal).toBeNull()
  })

  test('fleet numbers only when the fleet surface is enabled', () => {
    const fleet = { enabled: true, hosts: [{}, {}, {}], online: 2, silent: 1, idle: 0 } as never
    const k = homeKpis(stats, [], fleet, [])
    expect([k.hostsOnline, k.hostsTotal, k.hostsSilent]).toEqual([2, 3, 1])
  })
})

describe('attackMatrix', () => {
  const rules = [
    { tactic: 'Credential Access', tags: ['attack.t1003.001'], mitre: 'T1003.001' },
    { tactic: '', tags: ['attack.credential-access', 'attack.t1003'], mitre: '' },
    { tactic: 'execution', tags: ['attack.t1059.001', 'pack:core'], mitre: '' },
    { tactic: 'execution', tags: ['attack.t1047'], mitre: 'T1047' },
    { tactic: 'nonsense', tags: ['attack.t1000'], mitre: '' },
  ]

  test('lays the 14 tactics in kill-chain order with the techniques their rules cover', () => {
    const m = attackMatrix(rules, [])
    expect(m.columns).toHaveLength(14)
    expect(m.columns[0].slug).toBe('reconnaissance')
    const cred = m.columns.find((c) => c.slug === 'credential-access')!
    // sub-techniques fold into their parent: two rules on T1003
    expect(cred.cells).toEqual([{ id: 'T1003', rules: 2, alerts: 0 }])
    const exec = m.columns.find((c) => c.slug === 'execution')!
    expect(exec.cells.map((c) => c.id)).toEqual(['T1047', 'T1059'])
    // a rule without a known tactic stays out
    expect(m.techniques).toBe(3)
    expect(m.rows).toBe(2)
    expect(m.max).toBe(0)
  })

  test('counts each alert on its tactic and technique, and the ones without a tactic apart', () => {
    const m = attackMatrix(rules, [
      alert({ tags: ['attack.credential-access', 'attack.t1003.001'] }),
      alert({ tags: ['attack.credential_access', 'attack.t1003'] }),
      alert({ tags: ['attack.execution'] }),
      alert({ tags: ['attack.discovery', 'attack.t1082'] }),
      alert({ tags: [] }),
    ])
    const cred = m.columns.find((c) => c.slug === 'credential-access')!
    expect(cred.cells[0]).toEqual({ id: 'T1003', rules: 2, alerts: 2 })
    expect(cred.alerts).toBe(2)
    // an alert on a technique no rule lists still shows up
    expect(m.columns.find((c) => c.slug === 'discovery')!.cells).toEqual([{ id: 'T1082', rules: 0, alerts: 1 }])
    expect(m.columns.find((c) => c.slug === 'execution')!.alerts).toBe(1)
    expect(m.max).toBe(2)
    expect(m.untagged).toBe(1)
  })

  test('parentTechniques reads tags and the rule mitre field, nothing else', () => {
    expect(parentTechniques(['attack.t1059.001', 'attack.execution', 'pack:x'], 't1047')).toEqual(['T1059', 'T1047'])
    expect(parentTechniques(undefined, 'TA0002')).toEqual([])
  })
})

describe('helpers', () => {
  test('riskLevel uses the classic bands', () => {
    expect([riskLevel(25), riskLevel(5), riskLevel(4.9)]).toEqual(['critical', 'elevated', 'low'])
  })

  test('latestAlerts sorts newest first and caps', () => {
    const list = latestAlerts([
      alert({ id: 'a', timestamp: '2026-11-16T10:00:00Z' }),
      alert({ id: 'b', timestamp: '2026-11-16T10:05:00Z' }),
      alert({ id: 'c', timestamp: '2026-11-16T09:00:00Z' }),
    ], 2)
    expect(list.map((a) => a.id)).toEqual(['b', 'a'])
  })

  test('sparkPath draws inside its box and needs two points', () => {
    expect(sparkPath([5], 100, 20)).toBe('')
    const d = sparkPath([0, 10, 5], 100, 20)
    expect(d.startsWith('M2.0 18.0')).toBe(true)
    expect(d).toContain('L50.0 2.0')
    // from zero: a flat 5, 5 sits at the top, not in the middle
    expect(sparkPath([5, 5], 100, 20, 2, true)).toBe('M2.0 2.0 L98.0 2.0')
    // with a ceiling: 5 of 10 sits halfway
    expect(sparkPath([5, 5], 100, 20, 2, true, 10)).toBe('M2.0 10.0 L98.0 10.0')
  })

  test('chartCeiling rounds the top of the axis', () => {
    expect([0, 3, 4.5, 9, 11, 180, 1284].map(chartCeiling)).toEqual([4, 4, 5, 10, 20, 200, 2000])
  })

  test('telemetrySeries reads the samples and the minutes they cover', () => {
    const sample = (t: number, eventsPerMin: number) => ({ t, eventsPerMin }) as never
    expect(telemetrySeries([sample(0, 10), sample(60_000, 12), sample(120_000, 9)])).toEqual({ values: [10, 12, 9], minutes: 2 })
    expect(telemetrySeries([]).minutes).toBe(1)
  })
})
