import { describe, expect, test } from 'bun:test'
import { pipelineIssues, triageSummary } from './operations'
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
