// Detection-validation battery (SIM-4, engine `-scenarios`): typed views
// over GET /api/scenarios, POST /api/scenarios/run and the run history.
// The library is served by an ARMED engine only: an unarmed one answers
// 501 with an arming hint, and this lib surfaces exactly that state —
// the console never pretends the battery exists when it does not.

import { engineCall, type EngineResult } from './engine-writes'
import type { RuleMeta, SfSequence } from './console-types'
import { tacticSlug, type TacticSlug } from './soc-metrics'

export type ScenarioExpected = { rule: string; min: number }

export type ScenarioView = {
  id: string
  name: string
  description: string
  /** ATT&CK techniques the sequence exercises (engine sends them lowercase, e.g. t1003.001). */
  attack: string[]
  /** synthetic host of the replayed events (LAB-SIM-*) */
  host: string
  events: number
  expected: ScenarioExpected[]
  origin: string
}

export type ScenarioLibrary = {
  armed: boolean
  dir: string
  count: number
  scenarios: ScenarioView[]
}

export type ScenarioRunStatus = 'running' | 'completed'
export type ScenarioResultStatus = 'detected' | 'missing' | 'catalog' | 'error'

export type ScenarioMissingExpectation = { rule: string; expected: number; fired: number }

export type ScenarioResult = {
  scenario_id: string
  name: string
  attack: string[]
  status: ScenarioResultStatus
  host: string
  events_sent: number
  duration_ms: number
  /** expectations that did not reach their minimum (status missing) */
  missing?: ScenarioMissingExpectation[]
  /** alerts raised without the simulation tag: always 0 in a healthy pipeline */
  untagged?: number
  /** human-readable reason for catalog/error outcomes */
  detail?: string
}

export type ScenarioRun = {
  run_id: string
  started_at: string
  finished_at?: string
  status: ScenarioRunStatus
  total: number
  detected: number
  missing: number
  catalog_errors: number
  errors: number
  duration_ms: number
  /** detected / total in 0..1 — the trend-graph series */
  pass_rate: number
  /** per-scenario outcomes: the detail endpoint serves them, the history list omits them */
  results?: ScenarioResult[]
}

/** The engine answers 501 when it runs without -scenarios; the hint says how to arm it. */
export type ScenarioSurface =
  | { state: 'unavailable' }
  | { state: 'unarmed'; hint: string }
  | { state: 'armed'; library: ScenarioLibrary }

export async function fetchScenarioSurface(): Promise<ScenarioSurface> {
  const res = await engineCall<ScenarioLibrary>('GET', '/api/scenarios')
  if (res.ok) return { state: 'armed', library: res.data }
  if (res.status === 501) return { state: 'unarmed', hint: res.error }
  return { state: 'unavailable' }
}

export function fetchScenarioRuns(limit = 20): Promise<EngineResult<{ runs: ScenarioRun[] }>> {
  return engineCall<{ runs: ScenarioRun[] }>('GET', `/api/scenarios/runs?limit=${limit}`)
}

export function fetchScenarioRun(id: string): Promise<EngineResult<ScenarioRun>> {
  return engineCall<ScenarioRun>('GET', `/api/scenarios/runs/${encodeURIComponent(id)}`)
}

/** Launch the battery: the whole library, or only the named scenarios. */
export function launchScenarioRun(only?: string[], timeoutMs?: number): Promise<EngineResult<ScenarioRun>> {
  const body: { only?: string[]; timeout_ms?: number } = {}
  if (only && only.length > 0) body.only = only
  if (timeoutMs !== undefined) body.timeout_ms = timeoutMs
  return engineCall<ScenarioRun>('POST', '/api/scenarios/run', Object.keys(body).length ? body : undefined)
}

// ---- scenario <-> tactic mapping (SIM-3) ----------------------------------

/** 't1003.001' -> 'T1003.001' (rule `mitre` is uppercase); garbage stays out. */
export function normalizeTechnique(raw: string): string {
  const trimmed = raw.trim().toUpperCase()
  return /^T\d{4}(\.\d{3})?$/.test(trimmed) ? trimmed : ''
}

/** True when the rule's technique covers the scenario's technique: a
 * sub-technique (T1003.001) is covered by its parent (T1003) — MITRE
 * sub-techniques inherit the parent's tactic. */
export function techniqueCovers(ruleMitre: string, technique: string): boolean {
  const rule = normalizeTechnique(ruleMitre)
  const tech = normalizeTechnique(technique)
  if (!rule || !tech) return false
  return tech === rule || tech.startsWith(rule + '.')
}

/** Tactics a scenario validates: through its expected rules (direct id,
 * or sequence steps) and, as a fallback for expectations the console
 * cannot resolve, through its techniques matched against the loaded
 * rules' mitre. Empty when neither path yields a loaded tactic — a
 * scenario the console cannot place is simply not counted, never guessed. */
export function scenarioTacticSlugs(
  scenario: Pick<ScenarioView, 'attack' | 'expected'>,
  rules: readonly Pick<RuleMeta, 'id' | 'mitre' | 'tactic'>[],
  sequences: readonly Pick<SfSequence, 'id' | 'steps' | 'step_rules'>[],
): Set<TacticSlug> {
  const slugs = new Set<TacticSlug>()
  const byId = new Map(rules.map((r) => [r.id, r]))
  const sequenceRules = new Map(sequences.map((s) => [s.id, s.step_rules?.flat() ?? s.steps]))
  const addRule = (ruleId: string) => {
    const rule = byId.get(ruleId)
    if (rule) {
      const slug = tacticSlug(rule.tactic)
      if (slug) slugs.add(slug)
    }
  }
  for (const expectation of scenario.expected) {
    addRule(expectation.rule)
    for (const step of sequenceRules.get(expectation.rule) ?? []) addRule(step)
  }
  if (slugs.size === 0) {
    // fallback: place the scenario by technique via the loaded rules
    for (const technique of scenario.attack) {
      for (const rule of rules) {
        if (techniqueCovers(rule.mitre, technique)) {
          const slug = tacticSlug(rule.tactic)
          if (slug) slugs.add(slug)
        }
      }
    }
  }
  return slugs
}

/** Scenarios per tactic, for the ATT&CK matrix validation badge (SIM-3). */
export function scenarioCountsByTactic(
  scenarios: readonly ScenarioView[],
  rules: readonly Pick<RuleMeta, 'id' | 'mitre' | 'tactic'>[],
  sequences: readonly Pick<SfSequence, 'id' | 'steps' | 'step_rules'>[],
): Map<TacticSlug, number> {
  const counts = new Map<TacticSlug, number>()
  for (const scenario of scenarios) {
    for (const slug of scenarioTacticSlugs(scenario, rules, sequences)) {
      counts.set(slug, (counts.get(slug) ?? 0) + 1)
    }
  }
  return counts
}

/** Scenarios that validate a tactic, newest-agnostic stable order by id —
 * the deep link target of a validated matrix cell. */
export function scenariosForTactic(
  slug: TacticSlug,
  scenarios: readonly ScenarioView[],
  rules: readonly Pick<RuleMeta, 'id' | 'mitre' | 'tactic'>[],
  sequences: readonly Pick<SfSequence, 'id' | 'steps' | 'step_rules'>[],
): ScenarioView[] {
  return scenarios
    .filter((scenario) => scenarioTacticSlugs(scenario, rules, sequences).has(slug))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// ---- run formatting --------------------------------------------------------

export const RESULT_STATUS_LABEL: Record<ScenarioResultStatus, string> = {
  detected: 'detectado',
  missing: 'sin detección',
  catalog: 'catálogo',
  error: 'error',
}

export function passRatePercent(passRate: number): string {
  return `${Math.round(passRate * 100)} %`
}

/** Percent of the battery that finished with a real detection decision —
 * the honest denominator excludes catalog authoring errors. */
export function detectedShare(run: Pick<ScenarioRun, 'detected' | 'total' | 'catalog_errors'>): string {
  const denominator = run.total - run.catalog_errors
  return denominator > 0 ? passRatePercent(run.detected / denominator) : '—'
}
