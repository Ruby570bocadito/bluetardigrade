// VIZ-2 — alert load aggregated on a weekday × hour grid (local time).
// Pure module: the caller declares the window it actually fetched; the
// aggregation never invents coverage and reports what fell outside the
// window or had an unusable timestamp, so the chart can stay honest about
// what it represents.

export type HeatAlert = { timestamp: string }

export type WeekHourGrid = {
  /** 7 rows (Monday..Sunday) × 24 columns (local hours 0..23) */
  grid: number[][]
  /** alerts aggregated into the grid */
  total: number
  /** busiest single cell (drives the sequential ramp) */
  max: number
  /** local epoch ms of the oldest / newest aggregated alert */
  from: number | null
  to: number | null
  /** window actually requested (local day boundaries) */
  start: number
  end: number
  /** input diagnostics: everything the caller gave us */
  received: number
  /** inputs inside the window whose timestamp could not be parsed */
  unreadable: number
  /** inputs with a valid timestamp that fall outside [start, end] */
  outside: number
}

/** Monday-first short labels (Spanish SOC convention: X = miércoles). */
export const WEEKDAYS_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const
export const WEEKDAYS_LONG = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const

export const WEEK_HOUR_DAYS = 7

/** Local midnight of `now`'s day, shifted back days-1 days (DST-safe). */
export function weekStart(now: number, days = WEEK_HOUR_DAYS): number {
  const d = new Date(now)
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (days - 1), 0, 0, 0, 0)
  return start.getTime()
}

/** JS getDay() (0 = Sunday) → Monday-first row index (0 = Monday). */
export function mondayIndex(jsDay: number): number {
  return (jsDay + 6) % 7
}

function quarterTotals(row: readonly number[]): [number, number, number, number] {
  const quarters: [number, number, number, number] = [0, 0, 0, 0]
  for (let hour = 0; hour < 24; hour++) quarters[Math.floor(hour / 6)] += row[hour]
  return quarters
}

/** Rows for the table twin (and its CSV): per-day quarters, not 24 cells. */
export function weekHourTableRows(grid: WeekHourGrid): (string | number)[][] {
  const rows: (string | number)[][] = grid.grid.map((row, day) => {
    const quarters = quarterTotals(row)
    return [WEEKDAYS_LONG[day], ...quarters, quarters[0] + quarters[1] + quarters[2] + quarters[3]]
  })
  const totals: (string | number)[] = ['Total', 0, 0, 0, 0, 0]
  for (const row of rows) {
    for (let i = 1; i <= 4; i++) totals[i] = (totals[i] as number) + (row[i] as number)
  }
  totals[5] = grid.total
  rows.push(totals)
  return rows
}

/**
 * Aggregate alerts on the weekday × hour grid of the requested window.
 * `now` is the reference instant (the caller's fetch time, not the
 * render time, so re-renders do not drift the window).
 */
export function weekHourGrid(alerts: readonly HeatAlert[], options: { now: number; days?: number }): WeekHourGrid {
  const days = options.days ?? WEEK_HOUR_DAYS
  const start = weekStart(options.now, days)
  const end = options.now
  const grid: number[][] = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
  let total = 0
  let unreadable = 0
  let outside = 0
  let from: number | null = null
  let to: number | null = null
  for (const alert of alerts) {
    const time = Date.parse(alert.timestamp)
    if (!Number.isFinite(time)) {
      unreadable++
      continue
    }
    if (time < start || time > end) {
      outside++
      continue
    }
    const date = new Date(time)
    grid[mondayIndex(date.getDay())][date.getHours()]++
    total++
    if (from === null || time < from) from = time
    if (to === null || time > to) to = time
  }
  let max = 0
  for (const row of grid) {
    for (const value of row) {
      if (value > max) max = value
    }
  }
  return { grid, total, max, from, to, start, end, received: alerts.length, unreadable, outside }
}
