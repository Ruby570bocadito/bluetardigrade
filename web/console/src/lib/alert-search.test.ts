import { describe, expect, test } from 'bun:test'
import { alertSearchPath, applyAlertLifecycle, matchesAlertState, matchesAssignee } from './alert-search'
import { readAlertLens, writeAlertLens } from './url-state'
import { mapAlert } from './engine-client'

const alert = mapAlert({ id: 'a', timestamp: '2026-10-01T00:00:00Z', rule_id: 'rule', severity: 'info' })
describe('alert investigation', () => {
  test('keeps lifecycle and source lenses on refresh and preserves unrelated URL keys', () => {
    const url = writeAlertLens('?view=alertas&fq=other', 'info', 'lab', 'closed', 'history')
    expect(readAlertLens(url)).toEqual({ state: 'closed', scope: 'history', alert: null })
    expect(new URLSearchParams(url).get('fq')).toBe('other')
    const clean = writeAlertLens(url, 'all', '', 'all', 'live')
    expect(readAlertLens(clean)).toEqual({ state: 'all', scope: 'live', alert: null })
    expect(new URLSearchParams(clean).has('historial')).toBe(false)
  })
  test('invalid lifecycle/source values fall back per key', () => {
    expect(readAlertLens('?estado=wrong&historial=yes')).toEqual({ state: 'all', scope: 'live', alert: null })
  })
  test('maps info without fabricating a low severity and tolerates legacy missing arrays', () => {
    expect(alert.severity).toBe('info')
    expect(alert.matched_on).toEqual([])
    expect(matchesAlertState(alert, 'new')).toBe(true)
    expect(matchesAlertState({ ...alert, status: 'acknowledged' }, 'open')).toBe(true)
    expect(matchesAlertState({ ...alert, status: 'closed' }, 'open')).toBe(false)
  })
  test('encodes server queries without losing or forging search/cursor characters', () => {
    const path = alertSearchPath({ severity: 'critical', state: 'open', q: ' x&status=closed ' }, 'opaque?&')
    const params = new URL(path, 'http://localhost').searchParams
    expect(params.get('status')).toBe('open')
    expect(params.get('q')).toBe('x&status=closed')
    expect(params.get('cursor')).toBe('opaque?&')
    expect(params.get('limit')).toBe('25')
  })
  test('a newer close or reopen wins over delayed REST/SSE lifecycle data', () => {
    const closed = applyAlertLifecycle(alert, { alert_id: 'a', status: 'closed', at: '2026-10-01T00:02:00Z', note: 'done' })
    expect(applyAlertLifecycle(closed, { alert_id: 'a', status: 'acknowledged', at: '2026-10-01T00:01:00Z' })).toBe(closed)
    expect(applyAlertLifecycle(closed, { alert_id: 'a', status: 'new', at: '2026-10-01T00:03:00Z' }).status).toBe('new')
    expect(applyAlertLifecycle(closed, { alert_id: 'other', status: 'new', at: '2026-10-01T00:03:00Z' })).toBe(closed)
  })
})

describe('assignment trio (TEAM-3/M-1)', () => {
  const base = mapAlert({ id: 'ab', timestamp: '2026-10-01T00:00:00Z', rule_id: 'rule', severity: 'high' })

  test('REST alerts carry the trio and engines without M-1 stay unassigned', () => {
    const assigned = mapAlert({
      id: 'ab', timestamp: '2026-10-01T00:00:00Z', rule_id: 'rule', severity: 'high',
      assignee: 'ana', assigned_by: 'carlos', assigned_at: '2026-10-01T09:00:00Z',
    })
    expect(assigned.assignee).toBe('ana')
    expect(assigned.assigned_by).toBe('carlos')
    expect(assigned.assigned_at).toBe('2026-10-01T09:00:00Z')
    expect(base.assignee).toBeUndefined()
    expect(base.assigned_by).toBeUndefined()
    expect(base.assigned_at).toBeUndefined()
  })

  test('an assignment frame patches the trio even when the entry timestamp did not move', () => {
    // Assign() keeps the entry's `at` for an existing entry: the frame
    // lands with incoming == previous and the freshness gate must let
    // it through.
    const triaged = applyAlertLifecycle(base, { alert_id: 'ab', status: 'acknowledged', at: '2026-10-01T00:02:00Z', by: 'carlos' })
    const assigned = applyAlertLifecycle(triaged, {
      alert_id: 'ab', status: 'acknowledged', at: '2026-10-01T00:02:00Z', by: 'carlos',
      assignee: 'ana', assigned_by: 'carlos', assigned_at: '2026-10-01T09:00:00Z',
    })
    expect(assigned.assignee).toBe('ana')
    expect(assigned.assigned_at).toBe('2026-10-01T09:00:00Z')
    expect(assigned.status).toBe('acknowledged')
  })

  test('a frame without the trio IS the unassigned state, not unknown data', () => {
    // The engine omits the three fields together; a triage write from an
    // engine without M-1 never carries them either, and such an engine
    // never assigned anything — clearing is safe in both worlds.
    const assigned = applyAlertLifecycle(base, {
      alert_id: 'ab', status: 'new', at: '2026-10-01T00:02:00Z',
      assignee: 'ana', assigned_by: 'carlos', assigned_at: '2026-10-01T09:00:00Z',
    })
    const unassigned = applyAlertLifecycle(assigned, { alert_id: 'ab', status: 'new', at: '2026-10-01T09:05:00Z', by: 'carlos' })
    expect(unassigned.assignee).toBeUndefined()
    expect(unassigned.assigned_by).toBeUndefined()
    expect(unassigned.assigned_at).toBeUndefined()
    // blank strings are treated the same as absent (defensive)
    const blank = applyAlertLifecycle(assigned, { alert_id: 'ab', status: 'new', at: '2026-10-01T09:06:00Z', assignee: '  ', assigned_by: '', assigned_at: '' })
    expect(blank.assignee).toBeUndefined()
  })

  test('a stale frame never resurrects an old assignment', () => {
    const assigned = applyAlertLifecycle(base, {
      alert_id: 'ab', status: 'new', at: '2026-10-01T09:00:00Z',
      assignee: 'ana', assigned_by: 'carlos', assigned_at: '2026-10-01T09:00:00Z',
    })
    expect(applyAlertLifecycle(assigned, { alert_id: 'ab', status: 'new', at: '2026-10-01T08:00:00Z', assignee: 'bruno' })).toBe(assigned)
  })

  test('matchesAssignee mirrors the engine assignee=/unassigned= filters', () => {
    const ana = { ...base, assignee: 'Ana' }
    expect(matchesAssignee(ana, 'all', 'ana')).toBe(true)
    expect(matchesAssignee(ana, 'mine', 'ana')).toBe(true)
    expect(matchesAssignee(ana, 'mine', '  ANA ')).toBe(true)
    expect(matchesAssignee(ana, 'mine', 'bruno')).toBe(false)
    expect(matchesAssignee(ana, 'unassigned', 'ana')).toBe(false)
    expect(matchesAssignee(base, 'unassigned', 'ana')).toBe(true)
    expect(matchesAssignee({ ...base, assignee: '   ' }, 'unassigned', 'ana')).toBe(true)
    expect(matchesAssignee(base, 'mine', '')).toBe(false)
  })
})
