import { describe, expect, test } from 'bun:test'
import type { SocReport } from '@/lib/soc-report'
import {
  compareToday,
  deltaPct,
  exportHref,
  fillDays,
  filterLibrary,
  fleetRows,
  meanOrNull,
  ranking,
  reportsTabFromParam,
  severityShares,
  sourceOf,
  tacticBars,
  triageShares,
  unusualRules,
  v2ReportLink,
  v2WriteUpLink,
} from './reports-model'

const W7 = { preset: '7d', from: '2026-11-10T10:00:00Z', until: '2026-11-17T10:00:00Z' }

describe('where the numbers come from', () => {
  test('the evidence database covers the window; memory only when its oldest record is older; a cut scan never', () => {
    expect(sourceOf({ source: 'store', truncated: false, window: W7 })).toEqual({ from: 'store', complete: true })
    expect(sourceOf({ source: 'ring', truncated: false, oldest_record: '2026-11-09T00:00:00Z', window: W7 }).complete).toBe(true)
    expect(sourceOf({ source: 'ring', truncated: false, oldest_record: '2026-11-15T00:00:00Z', window: W7 })).toEqual({ from: 'ring', complete: false, oldest: '2026-11-15T00:00:00Z' })
    expect(sourceOf({ source: 'store', truncated: true, window: W7 }).complete).toBe(false)
  })
})

describe('executive summary and SOC activity', () => {
  test('severity in fixed order with shares, triage states and tactics by the console slug', () => {
    expect(severityShares({ high: 33, critical: 17 })).toEqual([
      { key: 'critical', count: 17, share: 0.34 },
      { key: 'high', count: 33, share: 0.66 },
    ])
    expect(triageShares({ acknowledged: 20, new: 30 }).map((s) => [s.key, s.count])).toEqual([['new', 30], ['acknowledged', 20], ['closed', 0]])
    expect(tacticBars({ 'Credential Access': 8, 'Defense Evasion': 19, Impact: 0 })).toEqual([
      { slug: 'defense-evasion', name: 'Defense Evasion', count: 19 },
      { slug: 'credential-access', name: 'Credential Access', count: 8 },
    ])
  })

  test('every day of the window, the empty ones as zero; no mean over nothing; ranking', () => {
    const days = fillDays({ window: W7, days: [{ day: '2026-11-16', created: 0, acknowledged: 5, closed: 0 }, { day: '2026-11-17', created: 50, acknowledged: 20, closed: 0 }] }, 7)
    expect(days.length).toBe(8)
    expect(days[0]).toEqual({ day: '2026-11-10', created: 0, acknowledged: 0, closed: 0 })
    expect(days[7]).toMatchObject({ day: '2026-11-17', created: 50 })
    expect(meanOrNull(0, 0)).toBeNull()
    expect(meanOrNull(4196, 25)).toBe(4196)
    expect(ranking({ consola: 25, ana: 30, nadie: 0 })).toEqual([{ key: 'ana', count: 30 }, { key: 'consola', count: 25 }])
  })

  test('fleet: hosts with nothing in the window first, then by status', () => {
    const rows = fleetRows([
      { host: 'WS-014', status: 'online', first_seen: '', last_seen: '', events: 9, events_in_window: 4 },
      { host: 'SRV-FILE02', status: 'silent', first_seen: '', last_seen: '', events: 1, events_in_window: 0 },
      { host: 'LAB-WKS-01', status: 'idle', first_seen: '', last_seen: '', events: 3, events_in_window: 3 },
    ])
    expect(rows.map((r) => [r.host, r.quiet])).toEqual([['SRV-FILE02', true], ['LAB-WKS-01', false], ['WS-014', false]])
  })
})

describe('today against the week', () => {
  const exec = (alerts: number, critical: number, high: number, hosts: number, rules: [string, number][] = []) => ({
    alerts_total: alerts,
    by_severity: { critical, high },
    hosts_affected: hosts,
    top_rules: rules.map(([id, count]) => ({ rule_id: id, rule_name: id, count })),
  })
  const soc = (mtta: number, acked: number, mttc: number, closed: number) => ({
    mean_time_to_ack_seconds: mtta,
    mean_time_to_close_seconds: mttc,
    backlog: { new: 0, acknowledged: acked, closed },
    days: [{ day: '2026-11-17', created: 1, acknowledged: acked, closed }],
  })

  test('counts against their daily averages, times as they are, hosts without an average', () => {
    const rows = compareToday(exec(20, 4, 10, 5), exec(70, 7, 35, 9), exec(300, 30, 150, 12), soc(300, 10, 0, 0), soc(600, 50, 7200, 4), null)
    const by = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(by.alerts).toMatchObject({ today: 20, avg7: 10, avg30: 10, delta7: 100, delta30: 100 })
    expect(by.critical).toMatchObject({ today: 4, avg7: 1, delta7: 300 })
    expect(by.mtta).toMatchObject({ today: 300, avg7: 600, delta7: -50, avg30: null, delta30: null })
    expect(by.mttc).toMatchObject({ today: null, avg7: 7200, delta7: null })
    expect(by.hosts).toMatchObject({ today: 5, avg7: null, delta7: null })
    expect(deltaPct(3, 0)).toBeNull()
  })

  test('a rule is unusual today at twice its weekly daily average', () => {
    expect(unusualRules(exec(0, 0, 0, 0, [['ps', 6], ['vss', 3], ['rare', 4]]), exec(0, 0, 0, 0, [['ps', 7], ['vss', 21]])).map((r) => [r.rule_id, r.today, r.avg7])).toEqual([
      ['ps', 6, 1],
      ['rare', 4, 0],
    ])
  })
})

describe('exports, library and links', () => {
  test('the engine export links carry only the filters it reads', () => {
    expect(exportHref('alerts', { format: 'csv', since: '7d', severity: ['critical', 'high'], host: ' WS-014 ' })).toBe(
      '/api/engine/api/alerts/export?format=csv&since=168h&severity=critical%2Chigh&host=WS-014',
    )
    expect(exportHref('events', { format: 'jsonl', since: '', severity: ['critical'], host: '' })).toBe('/api/engine/api/events/export?format=jsonl')
  })

  test('write-ups filtered by decision and text, newest first', () => {
    const r = (id: string, decision: SocReport['fields']['decision'], title: string, updated: string) =>
      ({ alert_id: id, updated_at: updated, fields: { title, analyst: 'ana', decision, findings: '', actions: '', recommendations: '', references: '' }, alert: { rule_name: 'PowerShell', host: 'WS-014' } }) as unknown as SocReport
    const list = [r('a', 'false_positive', 'Copia nocturna', '2026-11-16T10:00:00.000Z'), r('b', 'confirmed_incident', 'Intrusión', '2026-11-17T10:00:00.000Z')]
    expect(filterLibrary(list, '', 'all').map((x) => x.alert_id)).toEqual(['b', 'a'])
    expect(filterLibrary(list, 'copia', 'all').map((x) => x.alert_id)).toEqual(['a'])
    expect(filterLibrary(list, '', 'confirmed_incident').map((x) => x.alert_id)).toEqual(['b'])
  })

  test('tabs and links', () => {
    expect(reportsTabFromParam('hoy')).toBe('hoy')
    expect(reportsTabFromParam('x')).toBe('catalogo')
    expect(v2ReportLink('ejecutivo', { ventana: '30d' })).toBe('/v2/informes?vista=ejecutivo&ventana=30d')
    expect(v2WriteUpLink('a1b2')).toBe('/v2/informes?vista=analista&alerta=a1b2')
  })
})
