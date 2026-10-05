// Client-side history of the engine's per-host decayed risk
// (stats.hot_hosts, polled every 2 s but sampled here on a slower fixed
// grid so the chart stays readable). The engine publishes only a top-5
// list: a host leaving it is recorded as "not observed", never as a
// cold score, and the line chart breaks there. Outage slots are
// recorded as such; nothing is interpolated across a gap.

export type RiskSample = {
  /** grid slot time (ms epoch); the grid starts at the first sample */
  t: number
  /** false when the slot covers an engine outage (line gap) */
  ok: boolean
  /** decayed score per host observed in this slot (the engine top-5) */
  values: Record<string, number>
}

export const RISK_SLOT_MS = 10_000
export const RISK_SLOTS = 60 // 10 minutes of window

/**
 * Add the current hot-hosts reading on a fixed grid. A reading that
 * lands in the same slot replaces it (latest wins); slots skipped
 * because no engine data arrived are filled as ok:false gaps; a clock
 * going backwards leaves the history untouched. Pure: returns a new
 * array, never mutates.
 */
export function pushRiskSample(
  history: readonly RiskSample[],
  hot: ReadonlyArray<{ host: string; score: number }>,
  now: number,
  slotMs = RISK_SLOT_MS,
  maxSlots = RISK_SLOTS,
): RiskSample[] {
  const values: Record<string, number> = {}
  for (const h of hot) if (h.host) values[h.host] = h.score
  const last = history.at(-1)
  if (last && now < last.t) return history.slice()
  if (last && now - last.t < slotMs) {
    return [...history.slice(0, -1), { t: last.t, ok: true, values }]
  }
  const next = history.slice()
  if (last) {
    // skipped slots (outage or backgrounded console), bounded by the ring
    const firstGap = Math.max(last.t + slotMs, now - (maxSlots - 1) * slotMs)
    for (let t = firstGap; t < now; t += slotMs) {
      next.push({ t, ok: false, values: {} })
    }
  }
  next.push({ t: now, ok: true, values })
  return next.slice(-maxSlots)
}

export type RiskHostSerie = {
  host: string
  /** latest observed score (never interpolated) */
  last: number
  /** grid time of the first sample that carried this host */
  first: number
  /** how many ok slots carried the host */
  samples: number
}

export type RiskSeriesView = {
  /** rendered lines, latest score first (palette order, capped at 4) */
  series: RiskHostSerie[]
  /** hosts observed but outside the rendered cap (table twin only) */
  folded: RiskHostSerie[]
  /** ok slots that actually carried a top-5 reading */
  observed: number
}

/**
 * Which hosts to draw and which to fold: the rendered series are the
 * hosts with the highest latest observed score (the categorical palette
 * is capped at 4 lines); everyone else stays reachable in the table
 * twin with their last known score. A host missing from a later ok slot
 * keeps its previous score as "last known" until it reappears.
 */
export function riskSeriesView(history: readonly RiskSample[], maxSeries = 4): RiskSeriesView {
  const info = new Map<string, RiskHostSerie>()
  let observed = 0
  for (const sample of history) {
    if (!sample.ok) continue
    observed++
    for (const [host, value] of Object.entries(sample.values)) {
      const entry = info.get(host)
      if (!entry) info.set(host, { host, last: value, first: sample.t, samples: 1 })
      else {
        entry.last = value
        entry.samples++
      }
    }
  }
  const ranked = [...info.values()].sort((a, b) => b.last - a.last || a.host.localeCompare(b.host))
  return { series: ranked.slice(0, maxSeries), folded: ranked.slice(maxSeries), observed }
}
