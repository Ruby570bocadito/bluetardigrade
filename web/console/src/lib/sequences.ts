// Kill-chain sequences for display: a step completes with any one of its
// alternative rules, and a chain is scoped to one host or to one
// account across several hosts (internal/correlate).

import type { SfSequence } from './console-types'

/** The rules that complete step i (one for a plain step). */
export function stepAlternatives(seq: SfSequence, i: number): string[] {
  const alts = seq.step_rules?.[i]
  return alts && alts.length > 0 ? alts : [seq.steps[i]]
}

export type StepStatus = {
  rules: string[]
  /** alternatives the engine has loaded */
  loaded: string[]
  /** alerts of any alternative in the received window */
  hits: number
}

export function stepStatus(seq: SfSequence, i: number, live: ReadonlySet<string>, hits: ReadonlyMap<string, number>): StepStatus {
  const rules = stepAlternatives(seq, i)
  return {
    rules,
    loaded: rules.filter((r) => live.has(r)),
    hits: rules.reduce((sum, r) => sum + (hits.get(r) ?? 0), 0),
  }
}

/** Steps that no loaded rule can complete. */
export function unarmedSteps(seq: SfSequence, live: ReadonlySet<string>): number[] {
  return seq.steps.map((_, i) => i).filter((i) => !stepAlternatives(seq, i).some((r) => live.has(r)))
}

export function isUserScoped(seq: SfSequence): boolean {
  return seq.scope === 'user'
}

/** "mismo equipo" / "misma cuenta en 3 equipos o más". */
export function scopeText(seq: SfSequence): string {
  if (!isUserScoped(seq)) return 'mismo equipo'
  const n = Math.max(1, seq.min_hosts ?? 1)
  return n > 1 ? `misma cuenta en ${n} equipos o más` : 'misma cuenta'
}
