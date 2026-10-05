// VIZ-1 — pure model behind the donut charts. The console's validated
// categorical palette has four hues plus a muted "other", so the visual
// slice count is capped (maxNamed) and everything beyond folds into one
// «Otros» slice. The exact, unfolded rows stay available for the table
// twin, so no value is only reachable through a hover tooltip.

export type DonutEntry = { key: string; label: string; value: number }

export type DonutSlice = DonutEntry & {
  /** value / total, 0..1 */
  share: number
}

export type DonutFold = {
  /** how many entries were folded away */
  count: number
  /** their combined value */
  value: number
}

export type DonutModel = {
  /** visible slices, largest first, «Otros» last (key '__other') */
  slices: DonutSlice[]
  /** sum of every valid entry */
  total: number
  /** fold descriptor, null when nothing was folded */
  fold: DonutFold | null
  /** every valid entry, sorted, without folding (for the table twin) */
  entries: DonutEntry[]
}

const OTHER_KEY = '__other'
export const OTHER_LABEL = 'Otros'

/**
 * Fold a list of (key, label, value) into donut slices. Entries with a
 * non-finite or non-positive value are dropped (a donut portion must be
 * a positive count). Ordering: value desc, then label asc (es collation)
 * so the same data always paints the same way. At most `maxNamed` named
 * slices survive; the remainder becomes one «Otros» slice.
 */
export function buildDonut(entries: readonly DonutEntry[], options?: { maxNamed?: number }): DonutModel {
  const maxNamed = Math.max(1, Math.floor(options?.maxNamed ?? 4))
  const valid = entries
    .filter((e) => Number.isFinite(e.value) && e.value > 0)
    .map((e) => ({ key: e.key, label: e.label, value: e.value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'es'))
  const total = valid.reduce((sum, e) => sum + e.value, 0)
  const named = valid.slice(0, maxNamed)
  const rest = valid.slice(maxNamed)
  const slices: DonutSlice[] = named.map((e) => ({ ...e, share: total ? e.value / total : 0 }))
  let fold: DonutFold | null = null
  if (rest.length > 0) {
    const value = rest.reduce((sum, e) => sum + e.value, 0)
    fold = { count: rest.length, value }
    slices.push({ key: OTHER_KEY, label: OTHER_LABEL, value, share: total ? value / total : 0 })
  }
  return { slices, total, fold, entries: valid }
}

/** True when the slice is the folded «Otros» bucket. */
export function isOtherSlice(slice: Pick<DonutSlice, 'key'>): boolean {
  return slice.key === OTHER_KEY
}
