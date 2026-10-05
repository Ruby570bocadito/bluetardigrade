// Unit tests for the VIZ-2 aggregation (alert-heatmap.ts): window
// boundaries, Monday-first rows, honest out-of-window / unreadable
// accounting and the table twin. Timestamps without an offset parse as
// LOCAL time, so the suite is timezone-independent by construction
// (the container runs UTC; a real analyst's browser runs their zone and
// the panel declares it).

//   bun test            (from web/console/)

import { describe, expect, test } from 'bun:test'
import {
  WEEK_HOUR_DAYS,
  mondayIndex,
  weekHourGrid,
  weekHourTableRows,
  weekStart,
  WEEKDAYS_SHORT,
  type WeekHourGrid,
} from './alert-heatmap'

// 2026-10-05 is a Monday; 12:00 local keeps every fixture inside the
// same calendar day in any timezone west of UTC+12.
const NOW = Date.parse('2026-10-05T12:00:00')

function gridOf(...timestamps: string[]): WeekHourGrid {
  return weekHourGrid(timestamps.map((timestamp) => ({ timestamp })), { now: NOW })
}

describe('weekHourGrid', () => {
  test('the window starts at local midnight six days back (7 local days)', () => {
    expect(weekStart(NOW)).toBe(Date.parse('2026-09-29T00:00:00'))
    expect(WEEK_HOUR_DAYS).toBe(7)
  })

  test('buckets alerts on the Monday-first grid by local weekday and hour', () => {
    // Monday (today) 00:15, Monday 12:00 (the window edge, inclusive) and
    // Tuesday of the window (Sep 29) 23:30 land inside; rows are Monday..Sunday.
    const grid = gridOf('2026-10-05T00:15:00', '2026-10-05T12:00:00', '2026-09-29T23:30:00')
    expect(grid.grid[0][0]).toBe(1)
    expect(grid.grid[0][12]).toBe(1)
    expect(grid.grid[1][23]).toBe(1)
    expect(grid.total).toBe(3)
    expect(grid.max).toBe(1)
    expect(grid.from).toBe(Date.parse('2026-09-29T23:30:00'))
    expect(grid.to).toBe(Date.parse('2026-10-05T12:00:00'))
  })

  test('Sunday maps to the last row', () => {
    const grid = gridOf('2026-10-04T08:00:00')
    expect(grid.grid[6][8]).toBe(1)
  })

  test('alerts outside the requested window are counted, not drawn', () => {
    const grid = gridOf('2026-09-28T10:00:00', '2026-10-05T13:00:00')
    expect(grid.total).toBe(0)
    expect(grid.outside).toBe(2)
    expect(grid.unreadable).toBe(0)
    expect(grid.received).toBe(2)
  })

  test('unreadable timestamps are reported, never silently dropped', () => {
    const grid = gridOf('not-a-date', '')
    expect(grid.total).toBe(0)
    expect(grid.unreadable).toBe(2)
    expect(grid.from).toBeNull()
    expect(grid.to).toBeNull()
  })

  test('an empty input yields a zero grid with null bounds', () => {
    const grid = gridOf()
    expect(grid.total).toBe(0)
    expect(grid.max).toBe(0)
    expect(grid.received).toBe(0)
    expect(grid.from).toBeNull()
    expect(grid.grid).toHaveLength(7)
    for (const row of grid.grid) expect(row).toEqual(Array<number>(24).fill(0))
  })

  test('a busy cell drives max for the sequential ramp', () => {
    const grid = gridOf(
      '2026-10-05T09:00:00',
      '2026-10-05T09:10:00',
      '2026-10-05T09:20:00',
      '2026-10-05T10:00:00',
    )
    expect(grid.max).toBe(3)
    expect(grid.grid[0][9]).toBe(3)
  })
})

describe('mondayIndex', () => {
  test('maps JS getDay() (0 = Sunday) onto Monday-first rows', () => {
    expect(mondayIndex(1)).toBe(0)
    expect(mondayIndex(2)).toBe(1)
    expect(mondayIndex(0)).toBe(6)
    expect(mondayIndex(6)).toBe(5)
  })
})

describe('weekHourTableRows', () => {
  test('collapses each day into quarters with a totals row', () => {
    const grid = weekHourGrid(
      [
        '2026-10-05T00:30:00', // Monday, quarter 0-5
        '2026-10-05T05:59:00', // Monday, quarter 0-5
        '2026-10-05T06:00:00', // Monday, quarter 6-11
        '2026-10-05T11:59:00', // Monday, quarter 6-11 (before the 12:00 edge)
        '2026-09-29T23:00:00', // Tuesday of the window, quarter 18-23
      ].map((timestamp) => ({ timestamp })),
      { now: NOW },
    )
    const rows = weekHourTableRows(grid)
    expect(rows[0]).toEqual(['lunes', 2, 2, 0, 0, 4])
    expect(rows[1]).toEqual(['martes', 0, 0, 0, 1, 1])
    expect(rows[7]).toEqual(['Total', 2, 2, 0, 1, 5])
  })

  test('the totals row agrees with the aggregated total on an empty grid', () => {
    const grid = gridOf()
    const rows = weekHourTableRows(grid)
    expect(rows).toHaveLength(8)
    expect(rows[7]).toEqual(['Total', 0, 0, 0, 0, 0])
  })
})

describe('WEEKDAYS_SHORT', () => {
  test('seven Monday-first labels with the Spanish X for miércoles', () => {
    expect(WEEKDAYS_SHORT).toEqual(['L', 'M', 'X', 'J', 'V', 'S', 'D'])
  })
})
