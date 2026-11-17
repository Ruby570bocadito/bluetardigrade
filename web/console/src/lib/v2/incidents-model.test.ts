import { describe, expect, test } from 'bun:test'
import type { SfAlert, SfEvent } from '@/lib/console-types'
import type { Incident } from '@/lib/engine-writes'
import {
  entryText,
  activity, candidateAlerts, caseAlerts, caseEvents, elapsed, filterIncidents, hostsOf, incidentFilterFromParam, initials, statusCounts,
  v2IncidentLink, worstSeverity,
} from './incidents-model'

function incident(over: Partial<Incident>): Incident {
  return {
    id: over.id ?? 'i',
    title: 'Caso',
    severity: 'medium',
    status: 'open',
    hosts: [],
    alert_ids: [],
    timeline: [],
    created_at: '2026-11-16T10:00:00Z',
    updated_at: '2026-11-16T10:00:00Z',
    ...over,
  }
}

const cases = [
  incident({ id: 'a', severity: 'high', status: 'investigating', updated_at: '2026-11-16T10:05:00Z' }),
  incident({ id: 'b', severity: 'critical', status: 'closed' }),
  incident({ id: 'c', severity: 'critical', status: 'open', updated_at: '2026-11-16T09:00:00Z' }),
  incident({ id: 'd', severity: 'high', status: 'contained', updated_at: '2026-11-16T10:09:00Z' }),
]

describe('case list', () => {
  test('the default filter shows the running cases, the most severe and most recently touched first', () => {
    expect(filterIncidents(cases, 'active').map((i) => i.id)).toEqual(['c', 'd', 'a'])
    expect(filterIncidents(cases, 'all').map((i) => i.id)).toEqual(['c', 'd', 'a', 'b'])
    expect(filterIncidents(cases, 'closed').map((i) => i.id)).toEqual(['b'])
  })

  test('counts per state and the filter read from the URL', () => {
    expect(statusCounts(cases)).toEqual({ open: 1, investigating: 1, contained: 1, closed: 1, active: 3, all: 4 })
    expect([incidentFilterFromParam('contained'), incidentFilterFromParam('all'), incidentFilterFromParam('x'), incidentFilterFromParam(null)]).toEqual([
      'contained', 'all', 'active', 'active',
    ])
  })
})

describe('a case', () => {
  test('the timer reads hours, minutes and seconds, and days past one', () => {
    const t0 = '2026-11-16T10:00:00Z'
    expect(elapsed(t0, Date.parse(t0) + (2 * 3600 + 14 * 60 + 37) * 1000)).toBe('02:14:37')
    expect(elapsed(t0, Date.parse(t0) + (3 * 86_400 + 4 * 3600 + 5 * 60 + 6) * 1000)).toBe('3 d 04:05:06')
    expect(elapsed(t0, Date.parse(t0) - 5000)).toBe('00:00:00')
    expect(elapsed('nonsense', 0)).toBe('—')
  })

  const alerts = [
    { id: 'x1', host: 'WS-014', severity: 'high', timestamp: '2026-11-16T10:02:00Z' },
    { id: 'x2', host: 'SRV-DC01', severity: 'critical', timestamp: '2026-11-16T10:01:00Z' },
    { id: 'x3', host: 'WS-014', severity: 'low', timestamp: '2026-11-16T10:03:00Z', status: 'closed' },
    { id: undefined, host: 'WS-099', severity: 'low', timestamp: '2026-11-16T10:04:00Z' },
  ] as SfAlert[]

  test('its alerts come from the live window, oldest first; its events only from its hosts', () => {
    const c = incident({ alert_ids: ['x1', 'x2', 'gone'], hosts: ['ws-014'] })
    expect(caseAlerts(c, alerts).map((a) => a.id)).toEqual(['x2', 'x1'])
    const events = [{ host: 'WS-014' }, { host: 'SRV-DC01' }, { host: '' }] as SfEvent[]
    expect(caseEvents(c, events)).toHaveLength(1)
  })

  test('alerts that can still start a case: open, with an id and in no case yet', () => {
    expect(candidateAlerts(alerts, [incident({ alert_ids: ['x1'] })]).map((a) => a.id)).toEqual(['x2'])
  })

  test('helpers: worst severity, hosts, initials, link', () => {
    expect(worstSeverity(alerts)).toBe('critical')
    expect(worstSeverity([])).toBe('info')
    expect(hostsOf(alerts)).toEqual(['WS-014', 'SRV-DC01', 'WS-099'])
    expect([initials('CORP\\ana.garcia'), initials('consola'), initials('Luis Pérez')]).toEqual(['AG', 'CO', 'LP'])
    expect(v2IncidentLink('0123abcd')).toBe('/v2/incidentes?incidente=0123abcd')
  })

  test('activity is the timeline newest first with stable keys', () => {
    const c = incident({
      timeline: [
        { at: '2026-11-16T10:00:00Z', kind: 'created', text: 'Creado' },
        { at: '2026-11-16T10:05:00Z', kind: 'status', text: 'Investigando' },
      ],
    })
    expect(activity(c).map((e) => [e.kind, e.key])).toEqual([
      ['status', '2026-11-16T10:05:00Z|status|1'],
      ['created', '2026-11-16T10:00:00Z|created|0'],
    ])
  })
})

describe('entryText', () => {
  const words = {
    status: (a: string, b: string) => `Estado: ${a} → ${b}`,
    severity: (a: string, b: string, byAlerts: boolean) => `Severidad: ${a} → ${b}${byAlerts ? ' (alertas)' : ''}`,
    owner: (n: string) => `Responsable: ${n}`,
    ownerCleared: 'Sin responsable',
    created: (n: number) => `Abierto con ${n}`,
    alertsAdded: (n: number) => `+${n}`,
    titleChanged: (s: string) => `Título: ${s}`,
  }
  const label = (c: string) => c.toUpperCase()
  const say = (kind: Incident['timeline'][number]['kind'], text: string) => entryText({ kind, text }, words, label, label)

  test('the engine lines come out in the console words, with labels for the codes', () => {
    expect(say('status', 'Estado open -> investigating')).toBe('Estado: OPEN → INVESTIGATING')
    expect(say('severity', 'Severidad high -> critical')).toBe('Severidad: HIGH → CRITICAL')
    expect(say('severity', 'Severidad high -> critical por las alertas añadidas')).toBe('Severidad: HIGH → CRITICAL (alertas)')
    expect(say('owner', 'Responsable: CORP\ana')).toBe('Responsable: CORP\ana')
    expect(say('owner', 'Responsable retirado')).toBe('Sin responsable')
    expect(say('created', 'Incidente abierto con 3 alertas')).toBe('Abierto con 3')
    expect(say('alerts', '2 alertas añadidas')).toBe('+2')
    expect(say('note', 'Titulo cambiado a «Ransomware en WS-014»')).toBe('Título: Ransomware en WS-014')
  })

  test('notes and lines of another shape are shown as stored', () => {
    expect(say('note', 'Estado open -> closed')).toBe('Estado open -> closed')
    expect(say('status', 'cerrado a mano')).toBe('cerrado a mano')
    expect(say('note', 'Aislado el equipo')).toBe('Aislado el equipo')
  })
})
