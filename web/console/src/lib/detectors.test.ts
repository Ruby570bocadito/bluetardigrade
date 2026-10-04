import { expect, test } from 'bun:test'
import type { EngineStats } from './console-types'
import { detectorRows, worstState } from './detectors'

const base = {
  events_total: 0, alerts_total: 0, by_severity: {}, events_per_min: 0, uptime_s: 0,
  webhook_sent: 0, webhook_failed: 0, webhook_dropped: 0, suppressions_active: 0,
  correlator_states: 0, correlator_sequences: 0, correlator_cap: 0,
} as unknown as EngineStats

test('detectors that are off have no row', () => {
  expect(detectorRows(null)).toEqual([])
  expect(detectorRows(base)).toEqual([])
  expect(detectorRows({ ...base, mode: 'sin-motor' } as EngineStats)).toEqual([])
})

test('every running detector gets a row in a fixed order', () => {
  const rows = detectorRows({
    ...base,
    correlator_states: 3, correlator_sequences: 13, correlator_cap: 8192,
    beacons_tracked: 7, beacons_cap: 8192, beacons_fired: 1,
    threshold_rules: 4, threshold_keys: 2, threshold_fired: 0,
    intel_indicators: 6, intel_lists: 2, intel_hits: 0,
    baseline_hosts: 3, baseline_learning: 1, baseline_novelties: 2,
  })
  expect(rows.map((r) => r.key)).toEqual(['correlator', 'beacons', 'thresholds', 'intel', 'baseline'])
  expect(rows.map((r) => r.value)).toEqual(['3/8192', '7/8192', '4 · 0', '6 · 0', '3 · 2'])
  expect(worstState(rows)).toBe('ok')
  expect(rows[1].detail).toBe('7 destinos seguidos, 1 disparo desde el arranque.')
  expect(rows[2].detail).toContain('4 definiciones cargadas, 2 claves de agregación vivas, 0 disparos')
})

test('a full tracker is an alert, intel hits a warning', () => {
  const full = detectorRows({ ...base, correlator_states: 8192, correlator_sequences: 2, correlator_cap: 8192, intel_indicators: 1, intel_lists: 1, intel_hits: 4 })
  expect(full[0].state).toBe('alert')
  expect(full[0].detail).toContain('Al límite')
  expect(full[1].state).toBe('warn')
  expect(worstState(full)).toBe('alert')
  expect(worstState(full.slice(1))).toBe('warn')
})
