import { describe, expect, test } from 'bun:test'
import { alertSearchPath, applyAlertLifecycle, matchesAlertState } from './alert-search'
import { readAlertLens, writeAlertLens } from './url-state'
import { mapAlert } from './engine-client'

const alert = mapAlert({ id: 'a', timestamp: '2026-10-01T00:00:00Z', rule_id: 'rule', severity: 'info' })
describe('alert investigation', () => {
  test('keeps lifecycle and source lenses on refresh and preserves unrelated URL keys', () => {
    const url = writeAlertLens('?view=alertas&fq=other', 'info', 'lab', 'closed', 'history')
    expect(readAlertLens(url)).toEqual({ state: 'closed', scope: 'history' })
    expect(new URLSearchParams(url).get('fq')).toBe('other')
    const clean = writeAlertLens(url, 'all', '', 'all', 'live')
    expect(readAlertLens(clean)).toEqual({ state: 'all', scope: 'live' })
    expect(new URLSearchParams(clean).has('historial')).toBe(false)
  })
  test('invalid lifecycle/source values fall back per key', () => {
    expect(readAlertLens('?estado=wrong&historial=yes')).toEqual({ state: 'all', scope: 'live' })
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
