import { describe, expect, test } from 'bun:test'
import type { SfAlert, SfEvent, SfRespondRecord } from '@/lib/console-types'
import type { Incident } from '@/lib/engine-writes'
import { PLAYBOOK_TEMPLATES, type IncidentPlaybookState } from '@/lib/incident-playbook'
import {
  actionableAlerts,
  actionsFor,
  affected,
  auditCounts,
  containedAt,
  containmentBoard,
  containStats,
  dailyAttempts,
  denialGroups,
  filterAudit,
  goDurationSeconds,
  latest,
  percentile,
  pickWarIncident,
  reputationTargets,
  respondTabFromParam,
  timeToFirstAction,
  topBy,
  v2RespondLink,
  warTimeline,
} from './respond-model'

const NOW = Date.parse('2026-11-17T12:00:00Z')
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString()

const rec = (id: string, decision: 'executed' | 'denied', min: number, extra: Partial<SfRespondRecord> = {}): SfRespondRecord => ({
  ts: ago(min), action_id: id, decision, pid: 4300, process_name: 'powershell.exe', operator: 'ana', reason: 'contención', host: 'WS-014', source: '127.0.0.1:5000', ...extra,
})
const RECORDS: SfRespondRecord[] = [
  rec('a1', 'executed', 5, { alert_id: 'al1', rule_id: 'ps-enc', signal: 'SIGKILL', mechanism: 'handle' }),
  rec('a2', 'denied', 10, { code: 'process_protected', process_name: 'lsass.exe', pid: 744, host: 'SRV-DC01', operator: 'luis' }),
  rec('a3', 'denied', 20, { code: 'process_protected', process_name: 'lsass.exe', pid: 744, host: 'SRV-DC01', operator: 'ana' }),
  rec('a4', 'denied', 30, { code: 'host_mismatch', alert_id: 'al2', followup: true }),
]

const alert = (id: string, min: number, extra: Partial<SfAlert> = {}): SfAlert => ({
  id, timestamp: ago(min), rule_id: 'ps-enc', rule_name: 'PowerShell con comando codificado', severity: 'high', host: 'WS-014', event_id: `e-${id}`, event_type: 'process.create', summary: '', matched_on: [], ...extra,
})
const ALERTS: SfAlert[] = [alert('al1', 8, { user: 'CORP\\ana.garcia' }), alert('al2', 40, { network: { destination_ip: '185.220.101.47' } as SfAlert['network'] }), alert('al3', 2)]
const EVENTS: SfEvent[] = [
  { id: 'e-al1', timestamp: ago(8), type: 'process.create', host: 'WS-014', process: { pid: 4300, name: 'powershell.exe', command_line: 'powershell -enc x', hashes: { SHA256: 'A'.repeat(64) } } } as unknown as SfEvent,
  { id: 'e-al2', timestamp: ago(40), type: 'network.connect', host: 'WS-014', network: { destination_ip: '10.0.0.5' } } as unknown as SfEvent,
]

const incident = (id: string, status: Incident['status'], hosts: string[], extra: Partial<Incident> = {}): Incident => ({
  id, title: id, severity: 'high', status, hosts, alert_ids: [], timeline: [], created_at: ago(60), updated_at: ago(30), ...extra,
})

describe('the audit', () => {
  test('filters by decision, follow-up and a search over every field', () => {
    expect(filterAudit(RECORDS, 'denegadas', '').map((r) => r.action_id)).toEqual(['a2', 'a3', 'a4'])
    expect(filterAudit(RECORDS, 'seguimiento', '').map((r) => r.action_id)).toEqual(['a4'])
    expect(filterAudit(RECORDS, 'todas', 'lsass').map((r) => r.action_id)).toEqual(['a2', 'a3'])
    expect(filterAudit(RECORDS, 'todas', '744').length).toBe(2)
    expect(auditCounts(RECORDS)).toEqual({ todas: 4, ejecutadas: 1, denegadas: 3, seguimiento: 1 })
    expect(latest(RECORDS, 'denied')?.action_id).toBe('a2')
  })

  test('denials grouped by reason, most frequent first, with hosts and operators', () => {
    const [first, second] = denialGroups(RECORDS)
    expect(first).toMatchObject({ code: 'process_protected', count: 2, hosts: ['SRV-DC01'], operators: ['luis', 'ana'] })
    expect(first.latest.action_id).toBe('a2')
    expect(second).toMatchObject({ code: 'host_mismatch', count: 1 })
  })
})

describe('alerts to act on', () => {
  test('only alerts whose event in memory names a process, newest first, with their attempts', () => {
    const list = actionableAlerts(ALERTS, EVENTS, RECORDS)
    expect(list.map((a) => a.alert.id)).toEqual(['al1'])
    expect(list[0]).toMatchObject({ pid: 4300, process: 'powershell.exe', commandLine: 'powershell -enc x' })
    expect(list[0].actions.map((r) => r.action_id)).toEqual(['a1'])
    expect(actionsFor(RECORDS, 'al2').map((r) => r.action_id)).toEqual(['a4'])
  })

  test('reputation looks up public IPs, and hashes only with VirusTotal', () => {
    expect(reputationTargets(ALERTS[1], EVENTS[1], { abuseipdb: true })).toEqual([{ kind: 'ip', value: '185.220.101.47' }])
    expect(reputationTargets(ALERTS[0], EVENTS[0], { virustotal: true })).toEqual([{ kind: 'hash', value: 'a'.repeat(64) }])
    expect(reputationTargets(ALERTS[0], EVENTS[0], { abuseipdb: true })).toEqual([])
  })
})

describe('containment and the war room', () => {
  const plan: IncidentPlaybookState = {
    incidentId: 'inc-1', templateId: 'ransomware', appliedAt: ago(50), updatedAt: ago(40),
    checks: { alcance: { done: true, at: ago(45) } }, evidence: [], chronology: [],
  }
  const INCIDENTS = [
    incident('inc-1', 'investigating', ['WS-014', 'SRV-DC01'], { severity: 'critical', alert_ids: ['al1', 'al2'], timeline: [
      { at: ago(60), kind: 'created', text: 'Incidente abierto con 2 alertas' },
      { at: ago(15), kind: 'status', text: 'Estado open -> investigating', by: 'ana' },
    ] }),
    incident('inc-2', 'contained', ['ws-014'], { timeline: [{ at: ago(20), kind: 'status', text: 'Estado investigating -> contained' }] }),
    incident('inc-3', 'closed', ['WS-099'], { closed_at: ago(60 * 24 * 30) }),
  ]

  test('each host in the column of its least advanced case, with its attempts and next plan step', () => {
    const board = containmentBoard(INCIDENTS, RECORDS, { 'inc-1': plan }, PLAYBOOK_TEMPLATES, NOW)
    expect(board.investigating.map((c) => c.host).sort()).toEqual(['SRV-DC01', 'WS-014'])
    expect(board.contained).toEqual([])
    expect(board.closed).toEqual([])
    const ws = board.investigating.find((c) => c.host === 'WS-014')!
    expect(ws).toMatchObject({ executed: 1, denied: 1 })
    expect(ws.incidents.map((i) => i.id)).toEqual(['inc-1', 'inc-2'])
    expect(ws.nextStep).toEqual({ incidentId: 'inc-1', templateId: 'ransomware', itemId: 'aislar', text: PLAYBOOK_TEMPLATES[0].items[1].text })
  })

  test('the case to open first, its timeline and when it was contained', () => {
    expect(pickWarIncident(INCIDENTS)?.id).toBe('inc-1')
    // its alerts, its own lines and the attempts on its alerts or, since it opened, on its hosts
    const marks = warTimeline(INCIDENTS[0], ALERTS, RECORDS)
    expect(marks.map((m) => m.kind)).toEqual(['created', 'alert', 'denied', 'denied', 'status', 'denied', 'alert', 'executed'])
    expect(warTimeline({ ...INCIDENTS[0], created_at: ago(12) }, ALERTS, RECORDS).filter((m) => m.kind === 'denied').map((m) => m.ref)).toEqual(['a4', 'a2'])
    expect(affected(INCIDENTS[0], ALERTS)).toEqual({ hosts: ['SRV-DC01', 'WS-014'], users: ['CORP\\ana.garcia'] })
    expect(containedAt(INCIDENTS[1])).toBe(ago(20))
    expect(containedAt(INCIDENTS[0])).toBeUndefined()
  })
})

describe('response numbers', () => {
  test('attempts per day, time to first action, top operators and containment', () => {
    const days = dailyAttempts(RECORDS, NOW, 7)
    expect(days).toHaveLength(7)
    expect(days[6]).toMatchObject({ day: '2026-11-17', executed: 1, denied: 3 })
    expect(timeToFirstAction(RECORDS, ALERTS)).toEqual({ samples: 2, median: 180, p90: 600 })
    expect(topBy(RECORDS, 'operator')).toEqual([{ key: 'ana', count: 3 }, { key: 'luis', count: 1 }])
    const INC = [incident('a', 'contained', [], { timeline: [{ at: ago(30), kind: 'status', text: 'Estado open -> contained' }] }), incident('b', 'open', [])]
    expect(containStats(INC)).toEqual({ active: 1, contained: 1, closed: 0, median: 1800, samples: 1 })
    expect(percentile([5, 1, 3], 50)).toBe(3)
    expect(percentile([], 50)).toBeNull()
  })

  test('the window of a forensic snapshot, as the engine writes it', () => {
    expect(goDurationSeconds('5m0s before the triggering event (before the alert when it has none)')).toBe(300)
    expect(goDurationSeconds('1h30m')).toBe(5400)
    expect(goDurationSeconds('90s')).toBe(90)
    expect(goDurationSeconds('sin ventana')).toBeNull()
  })

  test('tabs and links', () => {
    expect(respondTabFromParam('sala')).toBe('sala')
    expect(respondTabFromParam('x')).toBe('estado')
    expect(v2RespondLink('a b')).toBe('/v2/respuesta?alerta=a%20b')
  })
})
