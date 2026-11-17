import { describe, expect, test } from 'bun:test'
import type { SfAlert } from '@/lib/console-types'
import {
  DEFAULT_LENS, boardColumns, bulkChanges, classicLink, focusStart, groupByHost, isFiltering, matchesQuery, otherTags, queueAlerts,
  queueViewFromParam, setSearchParam, severityChips, statusOf, techniqueIds, timelineDots, v2AlertLink,
} from './alerts-model'

function alert(over: Partial<SfAlert>): SfAlert {
  return {
    id: over.id ?? Math.random().toString(16).slice(2),
    timestamp: '2026-11-16T10:00:00Z',
    rule_id: 'r1',
    rule_name: 'Regla',
    severity: 'low',
    host: 'PC-01',
    event_id: 'e1',
    event_type: 'process.create',
    summary: '',
    matched_on: [],
    tags: [],
    ...over,
  } as SfAlert
}

const queue = [
  alert({ id: 'a', severity: 'critical', host: 'WS-014', rule_name: 'Volcado de credenciales', timestamp: '2026-11-16T10:05:00Z' }),
  alert({ id: 'b', severity: 'high', host: 'SRV-DC01', status: 'acknowledged', assignee: 'ana', timestamp: '2026-11-16T10:09:00Z' }),
  alert({ id: 'c', severity: 'high', host: 'WS-020', status: 'closed', timestamp: '2026-11-16T09:00:00Z' }),
  alert({ id: 'd', severity: 'low', host: 'WS-014', user: 'CORP\\luis', attributes: { parent: 'winword.exe' }, timestamp: '2026-11-16T10:01:00Z' }),
]

describe('queueAlerts', () => {
  test('the default lens shows every alert, newest first', () => {
    expect(queueAlerts(queue, DEFAULT_LENS, 'ana').map((a) => a.id)).toEqual(['b', 'a', 'd', 'c'])
  })

  test('severity, state and assignment narrow the queue like the classic one', () => {
    expect(queueAlerts(queue, { ...DEFAULT_LENS, sev: 'high' }, 'ana').map((a) => a.id)).toEqual(['b', 'c'])
    expect(queueAlerts(queue, { ...DEFAULT_LENS, state: 'open' }, 'ana').map((a) => a.id)).toEqual(['b', 'a', 'd'])
    expect(queueAlerts(queue, { ...DEFAULT_LENS, state: 'new' }, 'ana').map((a) => a.id)).toEqual(['a', 'd'])
    expect(queueAlerts(queue, { ...DEFAULT_LENS, assignee: 'mine' }, 'ANA').map((a) => a.id)).toEqual(['b'])
    expect(queueAlerts(queue, { ...DEFAULT_LENS, assignee: 'unassigned' }, 'ana').map((a) => a.id)).toEqual(['a', 'd', 'c'])
  })

  test('the search reads rule, host, user and what the source observed', () => {
    expect(queueAlerts(queue, { ...DEFAULT_LENS, q: 'ws-014' }, '').map((a) => a.id)).toEqual(['a', 'd'])
    expect(queueAlerts(queue, { ...DEFAULT_LENS, q: 'winword' }, '').map((a) => a.id)).toEqual(['d'])
    expect(matchesQuery(queue[0], '  credenciales ')).toBe(true)
  })
})

describe('severityChips', () => {
  test('counts each severity under the rest of the lens, not under its own severity filter', () => {
    const chips = severityChips(queue, { ...DEFAULT_LENS, sev: 'critical', state: 'open' }, '')
    expect(chips).toEqual({ all: 3, critical: 1, high: 1, medium: 0, low: 1, info: 0 })
  })
})

describe('helpers', () => {
  test('isFiltering is false only for the default lens', () => {
    expect(isFiltering(DEFAULT_LENS)).toBe(false)
    expect(isFiltering({ ...DEFAULT_LENS, q: '  ' })).toBe(false)
    expect(isFiltering({ ...DEFAULT_LENS, assignee: 'mine' })).toBe(true)
  })

  test('an alert without lifecycle is new', () => {
    expect(statusOf({})).toBe('new')
    expect(statusOf({ status: 'closed' })).toBe('closed')
  })

  test('tags split into ATT&CK techniques and the rest', () => {
    const tags = ['attack.credential-access', 'attack.t1003.001', 'attack.T1003.001', 'attack.t1059', 'pack:core']
    expect(techniqueIds(tags)).toEqual(['T1003.001', 'T1059'])
    expect(otherTags(tags)).toEqual(['pack:core'])
  })

  test('links keep their parameters encoded', () => {
    expect(classicLink.host('CORP host&1')).toBe('/?view=equipos&host=CORP%20host%261')
    expect(classicLink.flow('WS-014')).toBe('/?view=flujo&fq=WS-014')
    expect(classicLink.alert('a b')).toBe('/?view=alertas&alert=a%20b')
    expect(v2AlertLink('0123456789abcdef')).toBe('/v2/alertas?alert=0123456789abcdef')
  })
})

describe('views of the queue', () => {
  test('the view and the query string keys', () => {
    expect([queueViewFromParam('tablero'), queueViewFromParam('foco'), queueViewFromParam('otra'), queueViewFromParam(null)]).toEqual([
      'tablero', 'foco', 'lista', 'lista',
    ])
    expect(setSearchParam('?sev=high', 'vista', 'tablero')).toBe('?sev=high&vista=tablero')
    expect(setSearchParam('?vista=tablero', 'vista', null)).toBe('')
  })

  test('timeline: the last hour from start (0) to now (1), the rest counted apart', () => {
    const now = Date.parse('2026-11-16T10:10:00Z')
    const { dots, older } = timelineDots(queue, now)
    // a 10:05 -> 55 min into the window; c 09:00 is older than an hour
    expect(older).toBe(1)
    expect(dots.find((d) => d.key === 'a')!.x).toBeCloseTo(55 / 60, 5)
    expect(dots.map((d) => d.key).sort()).toEqual(['a', 'b', 'd'])
  })

  test('groups by host, the worst host first, each in queue order', () => {
    const groups = groupByHost(queueAlerts(queue, DEFAULT_LENS, ''))
    expect(groups.map((g) => [g.host, g.alerts.map((a) => a.id), g.worst])).toEqual([
      ['WS-014', ['a', 'd'], 'critical'],
      ['SRV-DC01', ['b'], 'high'],
      ['WS-020', ['c'], 'high'],
    ])
    expect(groups[0].counts).toEqual({ critical: 1, high: 0, medium: 0, low: 1, info: 0 })
  })

  test('the board has one column per state', () => {
    const cols = boardColumns(queue)
    expect([cols.new.map((a) => a.id), cols.acknowledged.map((a) => a.id), cols.closed.map((a) => a.id)]).toEqual([['a', 'd'], ['b'], ['c']])
  })

  test('a bulk move only touches what changes and remembers where each alert was', () => {
    const changes = bulkChanges([...queue, alert({ id: undefined, rule_id: 'x' })], 'acknowledged')
    expect(changes).toEqual([
      { id: 'a', key: 'a', from: 'new' },
      { id: 'c', key: 'c', from: 'closed' },
      { id: 'd', key: 'd', from: 'new' },
    ])
  })

  test('focus starts on the open alert, else the first new one', () => {
    const list = queueAlerts(queue, DEFAULT_LENS, '')
    expect(focusStart(list, 'c')).toBe(3)
    expect(focusStart(list, null)).toBe(1)
    expect(focusStart([], null)).toBe(-1)
  })
})
