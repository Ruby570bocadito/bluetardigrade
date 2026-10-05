// VIZ-3 — pure model behind the «Flujo del triaje» chart: declared
// source → ATT&CK tactic → triage state, aggregated from the alert
// window the console already received. Every alert flows exactly once,
// so both link sets always sum to the same total. The engine publishes
// three lifecycle states (new / acknowledged / closed); there is no
// false-positive state in the API, so none is drawn — the panel footer
// says so instead of inventing data.

import type { SfAlert } from './console-types'
import { alertTactic, ATTACK_TACTICS } from './soc-metrics'

export type TriageStateKey = 'nuevas' | 'reconocidas' | 'cerradas'

export const TRIAGE_STATES: readonly { key: TriageStateKey; label: string }[] = [
  { key: 'nuevas', label: 'Nuevas' },
  { key: 'reconocidas', label: 'Reconocidas' },
  { key: 'cerradas', label: 'Cerradas' },
] as const

export type TriageFlowNode = { key: string; label: string; value: number }
export type TriageFlowLink = { source: string; target: string; value: number }

/** One unfolded (source, tactic, state) row for the table twin. */
export type TriageFlowTriple = { source: string; tactic: string; state: string; value: number }

export type TriageFlowModel = {
  sources: TriageFlowNode[]
  tactics: TriageFlowNode[]
  states: TriageFlowNode[]
  /** source → tactic ribbons */
  sourceTactic: TriageFlowLink[]
  /** tactic → state ribbons */
  tacticState: TriageFlowLink[]
  /** alerts represented; equals the sum of both link sets */
  total: number
  /** how many source keys were folded into «Otras fuentes» */
  foldedSources: number
  /** how many tactic keys were folded into «Otras tácticas» */
  foldedTactics: number
  /** exact (source, tactic, state) rows, unfolded, for the table twin */
  triples: TriageFlowTriple[]
}

const OTHER_SOURCE_KEY = '__other-source'
const OTHER_TACTIC_KEY = '__other-tactic'
export const OTHER_SOURCE_LABEL = 'Otras fuentes'
export const OTHER_TACTIC_LABEL = 'Otras tácticas'
export const NO_SOURCE_KEY = '__sin-fuente'
export const NO_SOURCE_LABEL = 'Sin fuente'
export const NO_TACTIC_KEY = '__sin-tactica'
export const NO_TACTIC_LABEL = 'Sin táctica'

const TACTIC_LABEL = new Map<string, string>(ATTACK_TACTICS.map((t) => [t.slug, t.short]))
const TACTIC_FULL = new Map<string, string>(ATTACK_TACTICS.map((t) => [t.slug, t.label]))

/** Full (non-shortened) tactic label of a node key, for tables and hints. */
export function triageTacticFullLabel(node: Pick<TriageFlowNode, 'key' | 'label'>): string {
  return TACTIC_FULL.get(node.key) ?? node.label
}

/** Engine lifecycle state → the three visible triage states. */
export function triageStateOf(alert: Pick<SfAlert, 'status'>): TriageStateKey {
  return alert.status === 'acknowledged' ? 'reconocidas' : alert.status === 'closed' ? 'cerradas' : 'nuevas'
}

/**
 * Aggregate the alert window into the three-level flow. Ordering is
 * value desc, then label asc («Sin fuente»/«Sin táctica» compete like
 * any other bucket). Beyond `maxSources`/`maxTactics` buckets, the rest
 * folds into one «Otras …» node placed last, so the chart stays readable
 * while the sums stay exact. States are always the three fixed ones,
 * in workflow order, even at zero.
 */
export function buildTriageFlow(
  alerts: readonly Pick<SfAlert, 'source' | 'tags' | 'status'>[],
  options?: { maxSources?: number; maxTactics?: number },
): TriageFlowModel {
  const maxSources = Math.max(1, Math.floor(options?.maxSources ?? 6))
  const maxTactics = Math.max(1, Math.floor(options?.maxTactics ?? 6))

  // per (source, tactic, state) triple, in insertion order
  const triplesMap = new Map<string, { source: string; tactic: string; state: TriageStateKey; value: number }>()
  for (const alert of alerts) {
    const source = alert.source?.trim() ? alert.source.trim() : NO_SOURCE_KEY
    const slug = alertTactic(alert)
    const tactic = slug ?? NO_TACTIC_KEY
    const state = triageStateOf(alert)
    const key = `${source}\u0000${tactic}\u0000${state}`
    const found = triplesMap.get(key)
    if (found) found.value++
    else triplesMap.set(key, { source, tactic, state, value: 1 })
  }

  // fold + order per level
  const bySource = new Map<string, number>()
  const byTactic = new Map<string, number>()
  for (const t of triplesMap.values()) {
    bySource.set(t.source, (bySource.get(t.source) ?? 0) + t.value)
    byTactic.set(t.tactic, (byTactic.get(t.tactic) ?? 0) + t.value)
  }
  const rank = (map: Map<string, number>) => [...map.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value || labelOf(a.key).localeCompare(labelOf(b.key), 'es'))
  const labelOf = (key: string) => (
    key === NO_SOURCE_KEY ? NO_SOURCE_LABEL
      : key === NO_TACTIC_KEY ? NO_TACTIC_LABEL
        : TACTIC_LABEL.get(key) ?? key
  )

  const keepSources = rank(bySource)
  const keptSources = keepSources.slice(0, maxSources)
  const foldedSourceList = keepSources.slice(maxSources)
  const foldedSources = foldedSourceList.length
  const sourceKeyOf = (key: string) => (foldedSources > 0 && !keptSources.some((k) => k.key === key) ? OTHER_SOURCE_KEY : key)

  const keepTactics = rank(byTactic)
  const keptTactics = keepTactics.slice(0, maxTactics)
  const foldedTacticList = keepTactics.slice(maxTactics)
  const foldedTactics = foldedTacticList.length
  const tacticKeyOf = (key: string) => (foldedTactics > 0 && !keptTactics.some((k) => k.key === key) ? OTHER_TACTIC_KEY : key)

  // nodes: sources and tactics from observed data (value > 0 by
  // construction); states are the three fixed ones in workflow order.
  const sources: TriageFlowNode[] = keptSources.map((k) => ({ key: k.key, label: labelOf(k.key), value: k.value }))
  if (foldedSources > 0) {
    sources.push({
      key: OTHER_SOURCE_KEY,
      label: OTHER_SOURCE_LABEL,
      value: foldedSourceList.reduce((sum, k) => sum + k.value, 0),
    })
  }
  const tactics: TriageFlowNode[] = keptTactics.map((k) => ({ key: k.key, label: labelOf(k.key), value: k.value }))
  if (foldedTactics > 0) {
    tactics.push({
      key: OTHER_TACTIC_KEY,
      label: OTHER_TACTIC_LABEL,
      value: foldedTacticList.reduce((sum, k) => sum + k.value, 0),
    })
  }
  const states: TriageFlowNode[] = TRIAGE_STATES.map((s) => ({
    key: s.key,
    label: s.label,
    value: [...triplesMap.values()].filter((t) => t.state === s.key).reduce((sum, t) => sum + t.value, 0),
  }))

  // links, aggregated after folding; both hops must sum to the total
  const sourceTactic = new Map<string, number>()
  const tacticState = new Map<string, number>()
  for (const t of triplesMap.values()) {
    const s = sourceKeyOf(t.source)
    const tk = tacticKeyOf(t.tactic)
    const stKey = `${s}\u0000${tk}`
    sourceTactic.set(stKey, (sourceTactic.get(stKey) ?? 0) + t.value)
    const tsKey = `${tk}\u0000${t.state}`
    tacticState.set(tsKey, (tacticState.get(tsKey) ?? 0) + t.value)
  }
  const toLinks = (map: Map<string, number>) => [...map.entries()]
    .map(([key, value]) => {
      const [source, target] = key.split('\u0000')
      return { source, target, value }
    })
    .filter((l) => l.value > 0)
    .sort((a, b) => b.value - a.value || a.source.localeCompare(b.source, 'es') || a.target.localeCompare(b.target, 'es'))

  const stateLabel = new Map(TRIAGE_STATES.map((s) => [s.key, s.label]))
  const triples: TriageFlowTriple[] = [...triplesMap.entries()]
    .map(([, t]) => ({
      source: labelOf(t.source),
      tactic: TACTIC_FULL.get(t.tactic) ?? labelOf(t.tactic),
      state: stateLabel.get(t.state) ?? t.state,
      value: t.value,
    }))
    .sort((a, b) => b.value - a.value || a.source.localeCompare(b.source, 'es') || a.tactic.localeCompare(b.tactic, 'es') || a.state.localeCompare(b.state, 'es'))

  return {
    sources,
    tactics,
    states,
    sourceTactic: toLinks(sourceTactic),
    tacticState: toLinks(tacticState),
    total: alerts.length,
    foldedSources,
    foldedTactics,
    triples,
  }
}
