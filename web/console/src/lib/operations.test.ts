import { describe, expect, test } from 'bun:test'
import { pipelineIssues, triageSummary, writeTriageDestination } from './operations'
import { readAlertLens, readOperatorState, readLensState } from './url-state'
import type { EngineStats, SfAlert } from './console-types'

describe('operations summary', () => {
  test('counts triage state separately from severity and lifetime totals', () => {
    const alerts = [
      { severity: 'critical' },
      { severity: 'critical', status: 'acknowledged' },
      { severity: 'critical', status: 'closed' },
      { severity: 'low', status: 'new' },
    ] as SfAlert[]
    expect(triageSummary(alerts)).toEqual({ pending: 2, acknowledged: 1, closed: 1, critical: 2 })
  })
  test('empty telemetry contributes no fictional alerts', () => {
    expect(triageSummary([])).toEqual({ pending: 0, acknowledged: 0, closed: 0, critical: 0 })
    expect(pipelineIssues(null)).toEqual([])
  })
  test('flags ingest loss, delivery failure and detector saturation', () => {
    const stats = {
      dropped: 2, ingest_rejected: 1, webhook_failed: 1, webhook_dropped: 2,
      correlator_cap: 10, correlator_states: 10, beacons_cap: 20, beacons_tracked: 20,
    } as EngineStats
    expect(pipelineIssues(stats)).toHaveLength(4)
    expect(pipelineIssues({ ...stats, correlator_states: 9, beacons_tracked: 19 })).toHaveLength(2)
  })
})

describe('dashboard triage destinations', () => {
  test('critical shortcut includes new and acknowledged critical alerts in the live window', () => {
    const search = writeTriageDestination('', 'critical')
    expect(readOperatorState(search)).toEqual({ view: 'alertas', sev: 'critical', q: '' })
    expect(readAlertLens(search)).toEqual({ state: 'open', scope: 'live', alert: null })
  })
  for (const target of ['new', 'acknowledged', 'closed'] as const) {
    test(`${target} shortcut opens that lifecycle across all severities`, () => {
      const search = writeTriageDestination('', target)
      expect(readOperatorState(search)).toEqual({ view: 'alertas', sev: 'all', q: '' })
      expect(readAlertLens(search)).toEqual({ state: target, scope: 'live', alert: null })
    })
  }
  test('stale search, history, severity and selected alert cannot hide the counted rows', () => {
    const before = '?view=panel&q=unrelated&sev=low&estado=closed&historial=1&alert=old-id'
    for (const target of ['critical', 'new', 'acknowledged', 'closed'] as const) {
      const search = writeTriageDestination(before, target)
      expect(readOperatorState(search).q).toBe('')
      expect(readOperatorState(search).sev).toBe(target === 'critical' ? 'critical' : 'all')
      expect(readAlertLens(search).scope).toBe('live')
      expect(readAlertLens(search).alert).toBe(null)
    }
  })
  test('feed, rules, audit and unknown lenses survive triage navigation', () => {
    const before = '?view=panel&tipo=process.create&fq=demo&rq=lsass&regla=r-1&clase=denied&custom=a%26b'
    const after = writeTriageDestination(before, 'critical')
    expect(readLensState(after)).toEqual(readLensState(before))
    expect(new URLSearchParams(after).get('custom')).toBe('a&b')
  })
})
