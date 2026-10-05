// Unit tests for the VIZ-1 donut model (donut.ts): folding into «Otros»,
// deterministic ordering, shares and the honest drop of non-positive
// values. The unfolded entries stay available for the table twin.

//   bun test            (from web/console/)

import { describe, expect, test } from 'bun:test'
import { buildDonut, isOtherSlice, OTHER_LABEL } from './donut'

const e = (key: string, label: string, value: number) => ({ key, label, value })

describe('buildDonut', () => {
  test('empty input gives an empty model with total 0', () => {
    const m = buildDonut([])
    expect(m.slices).toEqual([])
    expect(m.total).toBe(0)
    expect(m.fold).toBeNull()
    expect(m.entries).toEqual([])
  })

  test('all-zero input is empty: a donut never draws null portions', () => {
    const m = buildDonut([e('a', 'A', 0), e('b', 'B', 0)])
    expect(m.slices).toEqual([])
    expect(m.total).toBe(0)
  })

  test('non-finite and non-positive values are dropped, never invented', () => {
    const m = buildDonut([e('a', 'A', 3), e('bad', 'Bad', Number.NaN), e('neg', 'Neg', -1), e('zero', 'Zero', 0)])
    expect(m.entries).toHaveLength(1)
    expect(m.total).toBe(3)
    expect(m.slices.map((s) => s.key)).toEqual(['a'])
  })

  test('a single entry draws one full slice with share 1', () => {
    const m = buildDonut([e('a', 'A', 7)])
    expect(m.slices).toEqual([{ key: 'a', label: 'A', value: 7, share: 1 }])
    expect(m.fold).toBeNull()
  })

  test('orders by value desc, then label asc for ties', () => {
    const m = buildDonut([e('b', 'Bravo', 2), e('a', 'Alfa', 2), e('c', 'Charlie', 5)])
    expect(m.entries.map((x) => x.key)).toEqual(['c', 'a', 'b'])
  })

  test('folds beyond maxNamed into one «Otros» slice placed last', () => {
    const m = buildDonut(
      [e('1', 'Uno', 9), e('2', 'Dos', 8), e('3', 'Tres', 7), e('4', 'Cuatro', 6), e('5', 'Cinco', 2), e('6', 'Seis', 1)],
      { maxNamed: 4 },
    )
    expect(m.slices).toHaveLength(5)
    expect(m.slices.slice(0, 4).map((s) => s.key)).toEqual(['1', '2', '3', '4'])
    const other = m.slices[4]
    expect(isOtherSlice(other)).toBe(true)
    expect(other.label).toBe(OTHER_LABEL)
    expect(other.value).toBe(3) // 2 + 1
    expect(m.fold).toEqual({ count: 2, value: 3 })
  })

  test('no fold node when everything fits', () => {
    const m = buildDonut([e('a', 'A', 1), e('b', 'B', 1)], { maxNamed: 4 })
    expect(m.slices).toHaveLength(2)
    expect(m.fold).toBeNull()
  })

  test('shares sum to 1 and match value / total', () => {
    const m = buildDonut([e('a', 'A', 3), e('b', 'B', 1)])
    const sum = m.slices.reduce((acc, s) => acc + s.share, 0)
    expect(sum).toBeCloseTo(1, 12)
    expect(m.slices[0].share).toBeCloseTo(0.75, 12)
  })

  test('maxNamed is clamped to at least one slice', () => {
    const m = buildDonut([e('a', 'A', 1), e('b', 'B', 2)], { maxNamed: 0 })
    expect(m.slices).toHaveLength(2) // 1 named + Otros
    expect(isOtherSlice(m.slices[1])).toBe(true)
  })

  test('entries keep the unfolded detail for the table twin', () => {
    const m = buildDonut([e('a', 'A', 5), e('b', 'B', 3), e('c', 'C', 1), e('d', 'D', 1), e('f', 'F', 1), e('g', 'G', 1)], { maxNamed: 2 })
    expect(m.entries.map((x) => x.key)).toEqual(['a', 'b', 'c', 'd', 'f', 'g'])
    expect(m.slices).toHaveLength(3) // a, b + Otros
  })
})
