import { describe, expect, test } from 'bun:test'
import { pushRiskSample, riskSeriesView, RISK_SLOTS, type RiskSample } from './risk-history'

const SLOT = 10_000
const hot = (entries: [string, number][]) => entries.map(([host, score]) => ({ host, score }))
const ok = (t: number, values: Record<string, number>): RiskSample => ({ t, ok: true, values })
const gap = (t: number): RiskSample => ({ t, ok: false, values: {} })

describe('pushRiskSample', () => {
  test('first reading becomes a single ok slot with the observed scores', () => {
    const out = pushRiskSample([], hot([['pc-1', 7.5], ['pc-2', 3]]), 100_000)
    expect(out).toEqual([ok(100_000, { 'pc-1': 7.5, 'pc-2': 3 })])
  })

  test('a reading inside the same slot replaces it (latest wins, slot time kept)', () => {
    const first = pushRiskSample([], hot([['pc-1', 7.5]]), 100_000)
    const second = pushRiskSample(first, hot([['pc-1', 8.1], ['pc-2', 2]]), 100_000 + 4_000)
    expect(second).toHaveLength(1)
    expect(second[0]).toEqual(ok(100_000, { 'pc-1': 8.1, 'pc-2': 2 }))
  })

  test('skipped slots because no engine data arrived become ok:false gaps', () => {
    const first = pushRiskSample([], hot([['pc-1', 9]]), 100_000)
    const second = pushRiskSample(first, hot([['pc-1', 6]]), 100_000 + 3.5 * SLOT)
    expect(second).toHaveLength(5)
    expect(second[0]).toEqual(ok(100_000, { 'pc-1': 9 }))
    expect(second.slice(1, 4)).toEqual([gap(110_000), gap(120_000), gap(130_000)])
    expect(second[4]).toEqual(ok(135_000, { 'pc-1': 6 }))
  })

  test('a host leaving the top-5 is simply absent from the new values', () => {
    const first = pushRiskSample([], hot([['pc-1', 9], ['pc-2', 4]]), 100_000)
    const second = pushRiskSample(first, hot([['pc-3', 5]]), 100_000 + SLOT)
    expect(second[1]?.values).toEqual({ 'pc-3': 5 })
  })

  test('a clock going backwards leaves the history untouched', () => {
    const first = pushRiskSample([], hot([['pc-1', 9]]), 100_000)
    expect(pushRiskSample(first, hot([['pc-1', 1]]), 99_999)).toEqual(first)
  })

  test('a long outage fills gaps bounded by the ring and keeps the window capped', () => {
    let history = pushRiskSample([], hot([['pc-1', 9]]), 0)
    // one hour without engine data
    history = pushRiskSample(history, hot([['pc-1', 2]]), 60 * 60 * 1000)
    expect(history).toHaveLength(RISK_SLOTS)
    expect(history.at(-1)).toEqual(ok(60 * 60 * 1000, { 'pc-1': 2 }))
    // everything before the last maxSlots-1 slots was dropped, not bridged
    expect(history.filter((s) => s.ok)).toHaveLength(1)
    expect(history[0].t).toBe(60 * 60 * 1000 - (RISK_SLOTS - 1) * SLOT)
  })

  test('hosts without a name never enter a sample', () => {
    const out = pushRiskSample([], hot([['', 9], ['pc-1', 4]]), 100_000)
    expect(out[0]?.values).toEqual({ 'pc-1': 4 })
  })
})

describe('riskSeriesView', () => {
  const history = [
    ok(0, { 'a': 10, 'b': 8, 'c': 6, 'd': 4, 'e': 2, 'f': 1 }),
    gap(SLOT),
    ok(2 * SLOT, { 'a': 12, 'b': 9, 'c': 7, 'd': 5, 'e': 3, 'g': 2 }),
  ]

  test('ranks by latest observed score and folds past four series', () => {
    const view = riskSeriesView(history)
    expect(view.series.map((s) => s.host)).toEqual(['a', 'b', 'c', 'd'])
    expect(view.folded.map((s) => s.host)).toEqual(['e', 'g', 'f'])
    expect(view.observed).toBe(2)
  })

  test('last known score, first appearance and sample count per host', () => {
    const view = riskSeriesView([ok(0, { 'a': 10 }), ok(SLOT, { 'a': 14 }), ok(2 * SLOT, { 'b': 1 })])
    const a = view.series.find((s) => s.host === 'a')
    expect(a).toEqual({ host: 'a', last: 14, first: 0, samples: 2 })
    const b = view.series.find((s) => s.host === 'b')
    expect(b).toEqual({ host: 'b', last: 1, first: 2 * SLOT, samples: 1 })
  })

  test('a host missing from a later ok slot keeps its previous score as last known', () => {
    const view = riskSeriesView([ok(0, { 'a': 10, 'b': 5 }), ok(SLOT, { 'a': 11 })])
    expect(view.series[0]).toMatchObject({ host: 'a', last: 11 })
    expect(view.series[1]).toMatchObject({ host: 'b', last: 5, samples: 1 })
  })

  test('gap slots never update anything', () => {
    const view = riskSeriesView([ok(0, { 'a': 10 }), gap(SLOT), gap(2 * SLOT)])
    expect(view.observed).toBe(1)
    expect(view.series).toHaveLength(1)
  })

  test('no observations at all renders nothing honestly', () => {
    const view = riskSeriesView([gap(0), gap(SLOT)])
    expect(view.series).toEqual([])
    expect(view.folded).toEqual([])
    expect(view.observed).toBe(0)
  })
})
