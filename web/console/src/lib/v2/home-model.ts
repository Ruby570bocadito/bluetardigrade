// What the v2 home (Inicio) says, computed from the same live state the
// classic console reads (use-engine-stream, fleet). Pure functions: the
// components only draw what these return.
import type { EngineStatus } from '@/hooks/use-engine-stream'
import type { EngineStats, RuleMeta, Severity, SfAlert } from '@/lib/console-types'
import type { FleetPayload } from '@/lib/fleet'
import { ATTACK_TACTICS, SEVERITIES, alertTactic, tacticCoverage, tacticSlug, type StatsSample, type TacticSlug } from '@/lib/soc-metrics'

export type HomeStatus =
  | { kind: 'connecting' }
  | { kind: 'offline' }
  | { kind: 'alert'; severity: 'critical' | 'high'; count: number }
  | { kind: 'waiting' }
  | { kind: 'calm'; open: number }

/** Alerts still on the queue: anything not closed (no status = new). */
export function openAlerts(alerts: readonly SfAlert[]): SfAlert[] {
  return alerts.filter((a) => a.status !== 'closed')
}

/** Not yet looked at: new, or no lifecycle status at all. */
export function unreviewed(alert: Pick<SfAlert, 'status'>): boolean {
  return alert.status === undefined || alert.status === 'new'
}

/**
 * What the status line says. `eventsTotal` is the engine's counter since
 * it started: zero with nothing on the queue means no sensor has sent
 * anything yet, and the line says so instead of "all quiet".
 */
export function homeStatus(engine: EngineStatus, alerts: readonly SfAlert[], eventsTotal: number | null = null): HomeStatus {
  if (engine === 'connecting') return { kind: 'connecting' }
  if (engine === 'down') return { kind: 'offline' }
  const open = openAlerts(alerts)
  for (const severity of ['critical', 'high'] as const) {
    const count = open.filter((a) => a.severity === severity && unreviewed(a)).length
    if (count > 0) return { kind: 'alert', severity, count }
  }
  if (eventsTotal === 0 && open.length === 0) return { kind: 'waiting' }
  return { kind: 'calm', open: open.length }
}

export function severityTally(alerts: readonly Pick<SfAlert, 'severity'>[]): Record<Severity, number> {
  const out = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>
  for (const a of alerts) out[a.severity] = (out[a.severity] ?? 0) + 1
  return out
}

export type RiskLevel = 'critical' | 'elevated' | 'low'

/** Same bands as the classic hot-hosts panel. */
export function riskLevel(score: number): RiskLevel {
  if (score >= 20) return 'critical'
  if (score >= 5) return 'elevated'
  return 'low'
}

export type HomeKpis = {
  eventsPerMin: number | null
  eventsTotal: number | null
  open: number
  openBySeverity: Record<Severity, number>
  hostsOnline: number | null
  hostsTotal: number | null
  hostsSilent: number | null
  topRisk: { host: string; score: number; level: RiskLevel } | null
  rules: number
  tacticsCovered: number
  tacticsTotal: number
}

export function homeKpis(
  stats: EngineStats | null,
  alerts: readonly SfAlert[],
  fleet: FleetPayload | null,
  rules: readonly Pick<RuleMeta, 'tactic' | 'tags'>[],
): HomeKpis {
  const open = openAlerts(alerts)
  const top = stats?.hot_hosts?.[0]
  const coverage = tacticCoverage(rules, [])
  return {
    eventsPerMin: stats ? stats.events_per_min : null,
    eventsTotal: stats ? stats.events_total : null,
    open: open.length,
    openBySeverity: severityTally(open),
    hostsOnline: fleet?.enabled ? fleet.online : null,
    hostsTotal: fleet?.enabled ? fleet.hosts.length : null,
    hostsSilent: fleet?.enabled ? fleet.silent : null,
    topRisk: top ? { host: top.host, score: top.score, level: riskLevel(top.score) } : null,
    rules: stats?.rules_count ?? rules.length,
    tacticsCovered: coverage.filter((c) => c.rules > 0).length,
    tacticsTotal: ATTACK_TACTICS.length,
  }
}

/** ATT&CK techniques named by tags (attack.t1059.001) or a rule's `mitre`, as parent techniques (T1059). */
export function parentTechniques(tags: readonly string[] | undefined, mitre?: string): string[] {
  const out = new Set<string>()
  for (const raw of [...(tags ?? []), mitre ?? '']) {
    const m = /^(?:attack\.)?(t\d{4})(?:\.\d{3})?$/i.exec(raw.trim())
    if (m) out.add(m[1].toUpperCase())
  }
  return [...out]
}

export type MatrixCell = { id: string; rules: number; alerts: number }
export type MatrixColumn = { slug: TacticSlug; cells: MatrixCell[]; rules: number; alerts: number }
export type AttackMatrix = {
  columns: MatrixColumn[]
  /** most alerts on one technique (0 = none) */
  max: number
  /** tallest column */
  rows: number
  /** distinct tactic-technique cells */
  techniques: number
  /** alerts without an ATT&CK tactic */
  untagged: number
}

/**
 * The ATT&CK matrix of the console: the 14 tactics in kill-chain order,
 * each with the techniques its rules detect (what the console covers)
 * and the alerts seen on each (what is happening).
 */
export function attackMatrix(
  rules: readonly Pick<RuleMeta, 'tactic' | 'tags' | 'mitre'>[],
  alerts: readonly Pick<SfAlert, 'tags'>[],
): AttackMatrix {
  const cells = new Map<TacticSlug, Map<string, MatrixCell>>(ATTACK_TACTICS.map((t) => [t.slug, new Map()]))
  const totals = new Map<TacticSlug, { rules: number; alerts: number }>(ATTACK_TACTICS.map((t) => [t.slug, { rules: 0, alerts: 0 }]))
  const cell = (slug: TacticSlug, id: string): MatrixCell => {
    const column = cells.get(slug)!
    let found = column.get(id)
    if (!found) column.set(id, (found = { id, rules: 0, alerts: 0 }))
    return found
  }
  for (const rule of rules) {
    const slug = tacticSlug(rule.tactic) ?? alertTactic(rule)
    if (!slug) continue
    totals.get(slug)!.rules++
    for (const id of parentTechniques(rule.tags, rule.mitre)) cell(slug, id).rules++
  }
  let untagged = 0
  for (const alert of alerts) {
    const slug = alertTactic(alert)
    if (!slug) {
      untagged++
      continue
    }
    totals.get(slug)!.alerts++
    for (const id of parentTechniques(alert.tags)) cell(slug, id).alerts++
  }
  const columns = ATTACK_TACTICS.map((t) => ({
    slug: t.slug,
    cells: [...cells.get(t.slug)!.values()].sort((a, b) => a.id.localeCompare(b.id)),
    ...totals.get(t.slug)!,
  }))
  const all = columns.flatMap((c) => c.cells)
  return {
    columns,
    max: all.reduce((m, c) => Math.max(m, c.alerts), 0),
    rows: columns.reduce((m, c) => Math.max(m, c.cells.length), 0),
    techniques: all.length,
    untagged,
  }
}

/** Newest first, at most `limit`. */
export function latestAlerts(alerts: readonly SfAlert[], limit: number): SfAlert[] {
  return [...alerts]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, limit)
}

/** The events-per-minute line of the retained stats samples, and the minutes it spans. */
export function telemetrySeries(history: readonly StatsSample[]): { values: number[]; minutes: number } {
  const values = history.map((s) => s.eventsPerMin)
  const span = history.length > 1 ? history[history.length - 1].t - history[0].t : 0
  return { values, minutes: Math.max(1, Math.round(span / 60_000)) }
}

/** A round top for a chart axis: 4 at least, then 1, 2, 2.5 or 5 times a power of ten. */
export function chartCeiling(max: number): number {
  if (!(max > 4)) return 4
  const pow = 10 ** Math.floor(Math.log10(max))
  return ([1, 2, 2.5, 5, 10].map((s) => s * pow).find((v) => v >= max) ?? 10 * pow)
}

/**
 * SVG path of a line in a w x h box ('' with fewer than two points);
 * `fromZero` keeps 0 at the bottom and `ceiling` fixes the top.
 */
export function sparkPath(values: readonly number[], w: number, h: number, pad = 2, fromZero = false, ceiling?: number): string {
  if (values.length < 2) return ''
  const max = ceiling ?? Math.max(...values)
  const min = fromZero ? Math.min(0, ...values) : Math.min(...values)
  const span = max - min || 1
  const step = (w - pad * 2) / (values.length - 1)
  return values
    .map((v, i) => {
      const x = pad + i * step
      const y = h - pad - ((v - min) / span) * (h - pad * 2)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}
