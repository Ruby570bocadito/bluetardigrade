// Pure aggregations behind the console charts. Everything is derived from
// what the engine actually delivered (client buffers and /api/stats
// polls): no projection, no interpolation, no invented baseline.

import type { EngineStats, RuleMeta, Severity, SfAlert, SfEvent } from './console-types'

export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info']

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
  info: 'Info',
}

// MITRE ATT&CK Enterprise tactics in kill-chain order.
export const ATTACK_TACTICS = [
  { slug: 'reconnaissance', label: 'Reconocimiento', short: 'Recon' },
  { slug: 'resource-development', label: 'Desarrollo de recursos', short: 'Recursos' },
  { slug: 'initial-access', label: 'Acceso inicial', short: 'Acceso' },
  { slug: 'execution', label: 'Ejecución', short: 'Ejecución' },
  { slug: 'persistence', label: 'Persistencia', short: 'Persistencia' },
  { slug: 'privilege-escalation', label: 'Escalada de privilegios', short: 'Escalada' },
  { slug: 'defense-evasion', label: 'Evasión de defensas', short: 'Evasión' },
  { slug: 'credential-access', label: 'Acceso a credenciales', short: 'Credenciales' },
  { slug: 'discovery', label: 'Descubrimiento', short: 'Descubrim.' },
  { slug: 'lateral-movement', label: 'Movimiento lateral', short: 'Lateral' },
  { slug: 'collection', label: 'Recolección', short: 'Recolección' },
  { slug: 'command-and-control', label: 'Mando y control', short: 'C2' },
  { slug: 'exfiltration', label: 'Exfiltración', short: 'Exfiltración' },
  { slug: 'impact', label: 'Impacto', short: 'Impacto' },
] as const

export type TacticSlug = (typeof ATTACK_TACTICS)[number]['slug']
const TACTIC_SLUGS = new Set<string>(ATTACK_TACTICS.map((t) => t.slug))

/** "Command And Control", "attack.command-and-control" -> "command-and-control". */
export function tacticSlug(raw: string | undefined): TacticSlug | null {
  if (!raw) return null
  const slug = raw.trim().toLowerCase().replace(/^attack\./, '').replace(/[\s_]+/g, '-')
  return TACTIC_SLUGS.has(slug) ? (slug as TacticSlug) : null
}

/** First ATT&CK tactic tag of an alert (technique tags are skipped). */
export function alertTactic(alert: Pick<SfAlert, 'tags'>): TacticSlug | null {
  for (const tag of alert.tags ?? []) {
    const slug = tacticSlug(tag)
    if (slug) return slug
  }
  return null
}

export type TacticCell = { slug: TacticSlug; label: string; short: string; rules: number; alerts: number }

/** Rule coverage and alerts in the window per tactic, in kill-chain order. */
export function tacticCoverage(rules: readonly Pick<RuleMeta, 'tactic' | 'tags'>[], alerts: readonly Pick<SfAlert, 'tags'>[]): TacticCell[] {
  const ruleCount = new Map<string, number>()
  for (const rule of rules) {
    const slug = tacticSlug(rule.tactic) ?? alertTactic(rule)
    if (slug) ruleCount.set(slug, (ruleCount.get(slug) ?? 0) + 1)
  }
  const alertCount = new Map<string, number>()
  for (const alert of alerts) {
    const slug = alertTactic(alert)
    if (slug) alertCount.set(slug, (alertCount.get(slug) ?? 0) + 1)
  }
  return ATTACK_TACTICS.map((t) => ({ ...t, rules: ruleCount.get(t.slug) ?? 0, alerts: alertCount.get(t.slug) ?? 0 }))
}

export function severityCounts(alerts: readonly Pick<SfAlert, 'severity'>[]): Record<Severity, number> {
  const out: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  for (const alert of alerts) if (alert.severity in out) out[alert.severity]++
  return out
}

export type SeverityBucket = { start: number; end: number; counts: Record<Severity, number>; total: number }

/**
 * Alerts per severity in fixed buckets over (now - window, now]. Alerts
 * outside the window (or with unreadable timestamps) do not count.
 */
export function severityBuckets(alerts: readonly Pick<SfAlert, 'severity' | 'timestamp'>[], now: number, windowMs: number, bucketMs: number): SeverityBucket[] {
  const n = Math.max(1, Math.round(windowMs / bucketMs))
  const out: SeverityBucket[] = Array.from({ length: n }, (_, i) => ({
    start: now - (n - i) * bucketMs,
    end: now - (n - i - 1) * bucketMs,
    counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    total: 0,
  }))
  for (const alert of alerts) {
    const age = now - Date.parse(alert.timestamp)
    if (!Number.isFinite(age) || age < 0 || age >= n * bucketMs) continue
    const bucket = out[n - 1 - Math.floor(age / bucketMs)]
    if (!(alert.severity in bucket.counts)) continue
    bucket.counts[alert.severity]++
    bucket.total++
  }
  return out
}

export type Ranked = { key: string; count: number }

/** Top keys by count (ties by key), plus the remainder folded into `rest`. */
export function topCounts<T>(items: readonly T[], keyOf: (item: T) => string | undefined | null, limit: number): { top: Ranked[]; rest: number; distinct: number } {
  const counts = new Map<string, number>()
  for (const item of items) {
    const key = keyOf(item)
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const ranked = [...counts].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
  const top = ranked.slice(0, limit)
  const rest = ranked.slice(limit).reduce((sum, r) => sum + r.count, 0)
  return { top, rest, distinct: ranked.length }
}

export function eventTypeMix(events: readonly Pick<SfEvent, 'type'>[], limit = 5) {
  return topCounts(events, (e) => e.type, limit)
}

// /api/stats is polled every 2 s; the console keeps a short in-memory
// history of the counters so the stat tiles can show their trend. It is
// cleared on an outage: a sparkline never bridges a gap it did not see.
export type StatsSample = {
  t: number
  uptime: number
  eventsPerMin: number
  eventsTotal: number
  alertsTotal: number
  rejected: number
  webhookSent: number
  riskHosts: number
  rules: number
}

export const STATS_HISTORY_MAX = 60

export function sampleOf(stats: EngineStats, t: number): StatsSample {
  return {
    t,
    uptime: stats.uptime_s,
    eventsPerMin: stats.events_per_min,
    eventsTotal: stats.events_total,
    alertsTotal: stats.alerts_total,
    rejected: stats.dropped + stats.ingest_rejected,
    webhookSent: stats.webhook_sent,
    riskHosts: stats.risk_hosts_tracked ?? 0,
    rules: stats.rules_count,
  }
}

/** Append a sample; an engine restart (uptime going back) starts over. */
export function pushSample(history: readonly StatsSample[], sample: StatsSample, max = STATS_HISTORY_MAX): StatsSample[] {
  const last = history.at(-1)
  if (last && sample.uptime < last.uptime) return [sample]
  return [...history, sample].slice(-max)
}

/** Change of a counter across the retained history (null with < 2 samples). */
export function counterDelta(history: readonly StatsSample[], pick: (s: StatsSample) => number): number | null {
  if (history.length < 2) return null
  return pick(history[history.length - 1]) - pick(history[0])
}

/** Clean axis ticks: 0..max in 1/2/5 x 10^n steps, at most `count` + 1 ticks. */
export function niceTicks(max: number, count = 3): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1]
  const raw = max / count
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6)
  return ticks
}

/** 1284 -> "1284", 12940 -> "12,9 k", 4200000 -> "4,2 M" (es-ES). */
export function formatCompact(value: number): string {
  const abs = Math.abs(value)
  if (abs < 10_000) return value.toLocaleString('es-ES')
  if (abs < 1_000_000) return (value / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' k'
  return (value / 1_000_000).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' M'
}

/** "hace 35 s", "hace 4 min", "hace 2 h". */
export function formatAgo(ms: number): string {
  if (ms < 1000) return 'ahora'
  const s = Math.round(ms / 1000)
  if (s < 60) return `hace ${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `hace ${m} min`
  return `hace ${Math.round(m / 60)} h`
}
