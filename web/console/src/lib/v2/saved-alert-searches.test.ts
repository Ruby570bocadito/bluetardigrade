import { describe, expect, test } from 'bun:test'
import { DEFAULT_LENS } from './alerts-model'
import { activeAlertSearch, MAX_ALERT_SEARCHES, parseAlertSearches, removeAlertSearch, saveAlertSearch, searchNameOf } from './saved-alert-searches'

const id = (n: number) => n.toString(16).padStart(32, '0')
const kerberos = { ...DEFAULT_LENS, sev: 'critical' as const, state: 'open' as const, q: 'kerberos' }

describe('saved alert searches', () => {
  test('names', () => {
    expect(searchNameOf('  Críticas abiertas ')).toBe('Críticas abiertas')
    expect(searchNameOf('')).toBeNull()
    expect(searchNameOf('a'.repeat(61))).toBeNull()
    expect(searchNameOf('x‮y')).toBeNull()
  })

  test('save, update by name, remove and find the active one', () => {
    const first = saveAlertSearch([], 'Kerberos', kerberos, 'live', id(1))
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const again = saveAlertSearch(first.list, 'KERBEROS', { ...kerberos, q: 'kerberoast' }, 'history', id(2))
    expect(again.ok && again.list.length).toBe(1)
    if (!again.ok) return
    expect(again.saved.id).toBe(id(1))
    expect(again.saved.scope).toBe('history')
    expect(activeAlertSearch(again.list, { ...kerberos, q: 'kerberoast' }, 'history')?.name).toBe('KERBEROS')
    expect(activeAlertSearch(again.list, kerberos, 'history')).toBeUndefined()
    expect(removeAlertSearch(again.list, id(1))).toEqual([])
    expect(saveAlertSearch([], ' ', kerberos, 'live', id(3))).toEqual({ ok: false, error: 'name' })
  })

  test('a full list refuses a new name', () => {
    let list = parseAlertSearches(null)
    for (let i = 0; i < MAX_ALERT_SEARCHES; i++) {
      const r = saveAlertSearch(list, `b${i}`, DEFAULT_LENS, 'live', id(i + 10))
      if (r.ok) list = r.list
    }
    expect(saveAlertSearch(list, 'otra', DEFAULT_LENS, 'live', id(99))).toEqual({ ok: false, error: 'full' })
  })

  test('reading keeps only what reads back exactly', () => {
    const good = { id: id(1), name: 'Bien', lens: kerberos, scope: 'live' }
    const stored = JSON.stringify([
      good,
      { ...good, id: id(2), lens: { ...kerberos, sev: 'apocalyptic' } },
      { ...good, id: id(3), scope: 'forever' },
      { ...good, id: 'short' },
      { ...good, id: id(4), lens: { ...kerberos, assignee: 'boss' } },
      { ...good, id: id(5), extra: '<script>', lens: { ...kerberos, extra: 1 } },
      good,
    ])
    const list = parseAlertSearches(stored)
    expect(list.map((s) => s.id)).toEqual([id(1), id(5)])
    expect(list[1]).toEqual({ id: id(5), name: 'Bien', lens: kerberos, scope: 'live' })
    expect(parseAlertSearches('{nope')).toEqual([])
    expect(parseAlertSearches('{"a":1}')).toEqual([])
  })
})
