import { describe, expect, test } from 'bun:test'
import { DEFAULT_NOTIFY_PREFS, newCriticalAlerts, notificationText, NOTIFY_KEY, readNotifyPrefs, writeNotifyPrefs } from './alert-notify'
import type { SfAlert } from './console-types'

const alert = (id: string, over: Partial<SfAlert> = {}): SfAlert => ({
  id, timestamp: '2026-10-04T10:00:00Z', rule_id: 'r', rule_name: 'Volcado de LSASS', severity: 'critical',
  host: 'LAB-WKS-01', event_id: 'e' + id, event_type: 'process.create', summary: 'rundll32 comsvcs.dll MiniDump', matched_on: [], ...over,
})
const key = (a: SfAlert) => a.id!

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v }, data }
}

describe('notification preference', () => {
  test('defaults to off and survives corrupt or partial values', () => {
    expect(readNotifyPrefs(undefined)).toEqual(DEFAULT_NOTIFY_PREFS)
    expect(readNotifyPrefs(memoryStorage({ [NOTIFY_KEY]: '{broken' }))).toEqual(DEFAULT_NOTIFY_PREFS)
    expect(readNotifyPrefs(memoryStorage({ [NOTIFY_KEY]: '{"enabled":"yes","sound":true}' }))).toEqual({ enabled: false, sound: true })
  })

  test('round-trips and reports a refused write', () => {
    const storage = memoryStorage()
    expect(writeNotifyPrefs(storage, { enabled: true, sound: false })).toBe(true)
    expect(readNotifyPrefs(storage)).toEqual({ enabled: true, sound: false })
    const full = { getItem: () => null, setItem: () => { throw new Error('quota') } }
    expect(writeNotifyPrefs(full, { enabled: true, sound: true })).toBe(false)
  })
})

describe('critical arrivals', () => {
  test('the first pass only primes: no backlog replay', () => {
    const { fresh, seen } = newCriticalAlerts([alert('a'), alert('b')], null, key)
    expect(fresh).toEqual([])
    expect([...seen]).toEqual(['a', 'b'])
  })

  test('only new, open, critical alerts notify', () => {
    const seen = new Set(['a'])
    const { fresh } = newCriticalAlerts(
      [alert('a'), alert('b'), alert('c', { severity: 'high' }), alert('d', { status: 'closed' }), alert('e', { status: 'acknowledged' })],
      seen,
      key,
    )
    expect(fresh.map(key)).toEqual(['b', 'e'])
  })

  test('one arrival names the rule; several collapse into one toast', () => {
    expect(notificationText([alert('a', { user: 'CORP\\ana' })])).toEqual({
      title: 'Alerta crítica: Volcado de LSASS',
      body: 'LAB-WKS-01 · CORP\\ana\nrundll32 comsvcs.dll MiniDump',
    })
    const many = ['h1', 'h2', 'h3', 'h4', 'h4'].map((h, i) => alert(String(i), { host: h }))
    expect(notificationText(many)).toEqual({ title: '5 alertas críticas nuevas', body: 'h1, h2, h3 y 1 equipo más' })
  })
})
