import { expect, test } from 'bun:test'
import type { SfAlert } from './console-types'
import { intelAlerts, kindBreakdown, learnText, listOfAlert } from './intel'

test('kind breakdown keeps a fixed order and drops empty kinds', () => {
  expect(kindBreakdown({ by_kind: { hash: 2, ip: 10, domain: 0 } })).toEqual([
    { kind: 'ip', label: 'IP', count: 10 },
    { kind: 'hash', label: 'Hashes', count: 2 },
  ])
  expect(kindBreakdown({ by_kind: {} })).toEqual([])
})

test('learning periods read naturally', () => {
  expect(learnText(86400)).toBe('1 día')
  expect(learnText(3 * 86400)).toBe('3 días')
  expect(learnText(86400 + 7200)).toBe('1 día 2 h')
  expect(learnText(5400)).toBe('1 h 30 min')
  expect(learnText(3600)).toBe('1 h')
  expect(learnText(600)).toBe('10 min')
  expect(learnText(3)).toBe('3 s')
  expect(learnText(0)).toBe('desactivada')
})

const a = (rule_id: string, timestamp: string): SfAlert => ({ rule_id, timestamp, rule_name: rule_id, severity: 'high', host: 'PC', event_id: 'e', event_type: 'x', summary: '', matched_on: [] })

test('intel alerts are the list hits and baseline novelties, newest first', () => {
  const got = intelAlerts([a('intel-match-bloqueo', '2026-10-04T10:00:00Z'), a('r-otra', '2026-10-04T11:00:00Z'), a('baseline-new-process', '2026-10-04T12:00:00Z')])
  expect(got.map((x) => x.rule_id)).toEqual(['baseline-new-process', 'intel-match-bloqueo'])
  expect(listOfAlert(got[1])).toBe('bloqueo')
  expect(listOfAlert(got[0])).toBe('')
})
