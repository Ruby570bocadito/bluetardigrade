import { describe, expect, test } from 'bun:test'
import type { HotHost, SfAlert, SfEvent } from '@/lib/console-types'
import type { FleetPayload } from '@/lib/fleet'
import type { HostGroupsPayload } from '@/lib/host-groups'
import type { BaselineHost } from '@/lib/intel'
import {
  activitySeries,
  alertsBySeverity,
  baselineView,
  filterRows,
  fleetSummary,
  graceSeconds,
  groupColumns,
  heartbeatBars,
  hostRows,
  hostsViewFromParam,
  hostTabFromParam,
  moveHost,
  patternMatches,
  plainGroups,
  relations,
  riskGroups,
  riskLevel,
  sensorHealth,
  statusFilterFromParam,
  v2HostLink,
} from './hosts-model'

const NOW = Date.parse('2026-11-17T10:00:00Z')
const ago = (s: number) => new Date(NOW - s * 1000).toISOString()

const sensor = (beatAgo: number, extra: Record<string, unknown> = {}) => ({
  version: '1.0.0-rc1', os: 'Windows 11 23H2', capture: 'etw', interval_s: 30, uptime_s: 3600, queue_cap: 2000, spooled: 420, dropped: 3,
  last_heartbeat: ago(beatAgo), run_mode: 'service' as const, ...extra,
})

const FLEET: FleetPayload = {
  enabled: true,
  online: 2,
  silent: 1,
  idle: 0,
  heartbeat_grace_min_s: 180,
  hosts: [
    { host: 'WS-014', status: 'online', first_seen: ago(9000), last_seen: ago(5), events: 900, events_last_5m: 40, sources: ['etw'], peers: ['10.0.4.14:51000'], groups: ['puestos'], sensor: sensor(10) },
    { host: 'SRV-DC01', status: 'online', first_seen: ago(9000), last_seen: ago(8), events: 300, events_last_5m: 12, sources: ['etw'], peers: ['10.0.1.10:50000'], groups: ['servidores'], sensor: sensor(20, { version: '0.9.4' }) },
    { host: 'SRV-FILE02', status: 'silent', first_seen: ago(9000), last_seen: ago(2220), events: 50, events_last_5m: 0, sources: ['etw'], peers: ['10.0.1.20:50001'], groups: ['servidores'], sensor: sensor(2220), silent_since: ago(2040) },
  ],
}
const HOT: HotHost[] = [
  { host: 'ws-014', score: 82, alerts: 6, last_seen: ago(5) },
  { host: 'SRV-DC01', score: 30, alerts: 2, last_seen: ago(8) },
  { host: 'LAB-WKS-01', score: 10, alerts: 1, last_seen: ago(100) },
]
const alert = (id: string, host: string, severity: SfAlert['severity'], extra: Partial<SfAlert> = {}): SfAlert => ({
  id, timestamp: ago(60), rule_id: 'r', rule_name: id, severity, host, event_id: `e-${id}`, event_type: 'process.create', summary: '', matched_on: [], ...extra,
})
const ALERTS: SfAlert[] = [
  alert('a1', 'WS-014', 'high'),
  alert('a2', 'WS-014', 'critical', { event_id: 'n2' }),
  alert('a3', 'WS-014', 'low', { status: 'closed' }),
  alert('a4', 'LAB-WKS-01', 'medium', { rule_id: 'baseline-new-process', rule_name: 'Proceso nunca visto', timestamp: ago(30) }),
]
const ev = (id: string, host: string, s: number, extra: Partial<SfEvent> = {}): SfEvent => ({ id, timestamp: ago(s), type: 'process.create', source: 'etw', host, ...extra })
const net = (id: string, host: string, ip: string, port: number, s = 50): SfEvent =>
  ev(id, host, s, { type: 'network.connect', network: { destination_ip: ip, destination_port: port } })
const EVENTS: SfEvent[] = [
  ev('p1', 'LAB-WKS-01', 120, { process: { pid: 1, name: 'powershell.exe' } }),
  ev('p2', 'LAB-WKS-01', 100, { process: { pid: 2, name: 'powershell.exe' } }),
  ev('p3', 'LAB-WKS-01', 90, { process: { pid: 3, name: 'rundll32.exe' } }),
  net('n1', 'WS-014', '10.0.1.10', 445),
  net('n2', 'WS-014', '10.0.1.10', 445, 40),
  net('n3', 'WS-014', '185.220.101.47', 443),
  net('n4', 'WS-014', '10.9.9.9', 80),
  net('n5', 'SRV-DC01', '10.0.1.10', 389),
]

const rows = () => hostRows(FLEET, HOT, ALERTS, EVENTS)

describe('rows', () => {
  test('the inventory first, then machines only seen in risk scores, alerts or events', () => {
    const r = rows()
    expect(r.map((x) => [x.host, x.status])).toEqual([
      ['SRV-FILE02', 'silent'],
      ['WS-014', 'online'],
      ['SRV-DC01', 'online'],
      ['LAB-WKS-01', 'unknown'],
    ])
    const ws = r.find((x) => x.host === 'WS-014')!
    expect(ws).toMatchObject({ risk: 82, openAlerts: 2, worst: 'critical', inFleet: true, events: 900 })
    const lab = r.find((x) => x.host === 'LAB-WKS-01')!
    expect(lab).toMatchObject({ risk: 10, openAlerts: 1, events: 3, inFleet: false })
    expect(lab.lastSeen).toBe(ago(90))
  })

  test('summary: statuses, sensors on another build than the engine, machines at risk', () => {
    expect(fleetSummary(rows(), '1.0.0-rc1')).toEqual({ total: 4, online: 2, silent: 1, idle: 0, unknown: 1, outdated: 1, atRisk: 1 })
    expect(fleetSummary(rows(), null).outdated).toBe(0)
  })

  test('filters: text, status and group (empty string = in no group)', () => {
    const r = rows()
    expect(filterRows(r, { q: 'srv', status: 'all', group: null }).map((x) => x.host)).toEqual(['SRV-FILE02', 'SRV-DC01'])
    expect(filterRows(r, { q: '', status: 'silent', group: null }).map((x) => x.host)).toEqual(['SRV-FILE02'])
    expect(filterRows(r, { q: '', status: 'all', group: 'puestos' }).map((x) => x.host)).toEqual(['WS-014'])
    expect(filterRows(r, { q: '', status: 'all', group: '' }).map((x) => x.host)).toEqual(['LAB-WKS-01'])
    expect(filterRows(r, { q: '0.9.4', status: 'all', group: null }).map((x) => x.host)).toEqual(['SRV-DC01'])
  })
})

describe('risk', () => {
  test('levels are relative to the hottest machine; almost nothing is no risk', () => {
    const r = rows()
    expect(riskLevel(82, r)).toBe('high')
    expect(riskLevel(30, r)).toBe('medium')
    expect(riskLevel(10, r)).toBe('low')
    expect(riskLevel(0.2, r)).toBe('none')
    expect(riskLevel(null, r)).toBe('none')
  })

  test('grouped by first group in the given order, the riskiest first; the ungrouped last', () => {
    const g = riskGroups(rows(), ['servidores', 'puestos'])
    expect(g.map((x) => [x.group, x.rows.map((r) => r.host)])).toEqual([
      ['servidores', ['SRV-DC01', 'SRV-FILE02']],
      ['puestos', ['WS-014']],
      [null, ['LAB-WKS-01']],
    ])
  })
})

describe('heartbeats and sensor', () => {
  test('the engine rule: three intervals, at least its minimum', () => {
    expect(graceSeconds(30, 180)).toBe(180)
    expect(graceSeconds(120, 180)).toBe(360)
  })

  test('bars for machines with a sensor, the quietest (relative to its grace) first', () => {
    const bars = heartbeatBars(rows(), NOW, 180)
    expect(bars.map((b) => [b.host, Math.round(b.ageS), b.past])).toEqual([
      ['SRV-FILE02', 2220, true],
      ['SRV-DC01', 20, false],
      ['WS-014', 10, false],
    ])
  })

  test('sensor health next to its engine', () => {
    const yara = { enabled: true, sha16: 'abc' }
    expect(sensorHealth(sensor(10, { yara_rules_sha: 'abc', yara_rules: 38 }), '1.0.0-rc1', yara, NOW)).toEqual({ versionState: 'match', queueUse: 0.21, heartbeatAgeS: 10, yara: 'match' })
    expect(sensorHealth(sensor(10, { version: '0.9', yara_rules_sha: 'zzz' }), '1.0.0-rc1', yara, NOW)).toMatchObject({ versionState: 'outdated', yara: 'stale' })
    expect(sensorHealth(sensor(10, { queue_cap: undefined }), undefined, null, NOW)).toMatchObject({ versionState: 'unknown', queueUse: null, yara: 'unavailable' })
    expect(sensorHealth(sensor(10), '1.0.0-rc1', yara, NOW).yara).toBe('no-report')
  })
})

describe('baseline', () => {
  test('learning progress, normal processes with their starts in memory, novelties from the alerts', () => {
    const b: BaselineHost = {
      enabled: true, learn_s: 7 * 86400, host: 'lab-wks-01', known: true, first_seen: ago(5 * 86400 + 60), learning: true,
      learning_until: ago(-2 * 86400 + 60), processes: ['rundll32.exe', 'powershell.exe', 'explorer.exe'], full: false,
    }
    const v = baselineView(b, 'LAB-WKS-01', EVENTS, ALERTS, NOW)
    expect(v.learning).toBe(true)
    expect(v.daysDone).toBe(5)
    expect(v.daysTotal).toBe(7)
    expect(Math.round(v.progress! * 100)).toBe(71)
    expect(v.processes).toEqual([
      { name: 'powershell.exe', starts: 2 },
      { name: 'rundll32.exe', starts: 1 },
      { name: 'explorer.exe', starts: 0 },
    ])
    expect(v.novelties.map((a) => a.id)).toEqual(['a4'])
    expect(baselineView({ ...b, learning: false }, 'LAB-WKS-01', [], [], NOW).progress).toBeNull()
  })
})

describe('relationships', () => {
  test('fleet machines are recognised by their sensor address; unknown private addresses are left out', () => {
    const { nodes, edges } = relations(rows(), EVENTS, ALERTS)
    expect(nodes.map((n) => [n.label, n.kind])).toEqual([
      ['SRV-DC01', 'host'],
      ['WS-014', 'host'],
      ['185.220.101.47', 'external'],
    ])
    const lateral = edges.find((e) => e.from === 'host:ws-014' && e.to === 'host:srv-dc01')!
    expect(lateral).toEqual({ from: 'host:ws-014', to: 'host:srv-dc01', connections: 2, ports: [445], alerted: true })
    expect(edges.find((e) => e.to === 'ext:185.220.101.47')?.alerted).toBe(false)
    expect(edges.some((e) => e.from === 'host:srv-dc01')).toBe(false) // a machine talking to itself is no relationship
  })
})

describe('groups', () => {
  const payload: HostGroupsPayload = {
    enabled: true, writable: true, ad: false,
    groups: [
      { name: 'servidores', label: 'Servidores', hosts: ['srv-*'], ad_ou: [], identities: [], members: ['SRV-DC01', 'SRV-FILE02'] },
      { name: 'puestos', label: 'Puestos de oficina', hosts: ['WS-014'], ad_ou: [], identities: [], members: ['WS-014'] },
    ],
    ungrouped: [],
  }

  test('one column per group and one for the machines in none', () => {
    expect(groupColumns(payload, rows(), 'Sin grupo').map((c) => [c.name, c.members])).toEqual([
      ['servidores', ['SRV-DC01', 'SRV-FILE02']],
      ['puestos', ['WS-014']],
      [null, ['LAB-WKS-01']],
    ])
  })

  test('patterns like the engine: * and ?, any case', () => {
    expect(patternMatches('srv-*', 'SRV-DC01')).toBe(true)
    expect(patternMatches('ws-0??', 'WS-014')).toBe(true)
    expect(patternMatches('ws-0?', 'WS-014')).toBe(false)
    expect(patternMatches('a.b', 'axb')).toBe(false)
  })

  test('moving a machine adds its exact name to the target and removes it from the source', () => {
    const base = plainGroups(payload)
    const m = moveHost(base, 'WS-014', 'puestos', 'servidores')
    expect(m.groups.find((g) => g.name === 'puestos')!.hosts).toEqual([])
    expect(m.groups.find((g) => g.name === 'servidores')!.hosts).toEqual(['srv-*', 'WS-014'])
    expect(m.stillIn).toEqual([])
    // a wider pattern keeps it in the source: said, not hidden
    const w = moveHost(base, 'SRV-DC01', 'servidores', 'puestos')
    expect(w.stillIn).toEqual(['servidores'])
    expect(w.groups.find((g) => g.name === 'puestos')!.hosts).toEqual(['WS-014', 'SRV-DC01'])
    // into a group whose pattern already matches: nothing to add
    expect(moveHost(base, 'SRV-NEW', null, 'servidores').groups.find((g) => g.name === 'servidores')!.hosts).toEqual(['srv-*'])
    expect(base.find((g) => g.name === 'puestos')!.hosts).toEqual(['WS-014']) // the input is not touched
  })
})

describe('series and url', () => {
  test('activity of one machine in buckets and its open alerts by severity', () => {
    // 120, 100 and 90 s ago fall in the fourth minute of the last five
    expect(activitySeries(EVENTS, 'lab-wks-01', NOW, 300_000, 5)).toEqual([0, 0, 0, 3, 0])
    expect(alertsBySeverity(ALERTS, 'ws-014')).toEqual({ critical: 1, high: 1, medium: 0, low: 0, info: 0 })
  })

  test('views, tabs, filters and links', () => {
    expect(hostsViewFromParam('riesgo')).toBe('riesgo')
    expect(hostsViewFromParam('x')).toBe('inventario')
    expect(hostTabFromParam('linea-base')).toBe('linea-base')
    expect(hostTabFromParam(null)).toBe('resumen')
    expect(statusFilterFromParam('silent')).toBe('silent')
    expect(statusFilterFromParam('nope')).toBe('all')
    expect(v2HostLink('WS-014')).toBe('/v2/equipos?equipo=WS-014')
    expect(v2HostLink('WS 1', 'sensor')).toBe('/v2/equipos?equipo=WS%201&pestana=sensor')
  })
})
