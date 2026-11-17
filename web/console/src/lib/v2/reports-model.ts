// v2 · Informes: the pure part of the section. The engine computes four
// reports (executive summary, SOC activity, fleet coverage, one incident)
// over a window that always ends now (24 h, 7 or 30 days); the console
// lays them out, says where each number comes from, compares today with
// the daily average of the longer windows, builds the export links of
// the raw data and keeps the analysts' write-ups. Nothing here estimates
// a number the engine did not give.

import type { Severity } from '@/lib/console-types'
import type { ExecutiveReport, FleetCoverageReport, ReportEnvelope, ReportWindowPreset, SocActivityReport } from '@/lib/reports'
import { tacticSlug, type TacticSlug } from '@/lib/soc-metrics'
import type { Decision, SocReport } from '@/lib/soc-report'

// ---------- URL ----------

export const REPORT_TABS = ['catalogo', 'ejecutivo', 'soc', 'flota', 'incidente', 'analista', 'biblioteca', 'exportar', 'hoy'] as const
export type ReportsTab = (typeof REPORT_TABS)[number]
export function reportsTabFromParam(v: string | null): ReportsTab {
  return (REPORT_TABS as readonly string[]).includes(v ?? '') ? (v as ReportsTab) : 'catalogo'
}

/** The tabs that can be printed as a sheet. */
export const PRINTABLE: readonly ReportsTab[] = ['ejecutivo', 'soc', 'flota', 'analista']

export function v2ReportLink(tab: ReportsTab, params: Record<string, string> = {}): string {
  const p = new URLSearchParams()
  if (tab !== 'catalogo') p.set('vista', tab)
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v)
  const s = p.toString()
  return `/v2/informes${s ? `?${s}` : ''}`
}

/** The analyst write-up of one alert (from Alertas or Respuesta). */
export function v2WriteUpLink(alertId: string): string {
  return v2ReportLink('analista', { alerta: alertId })
}

export const WINDOW_DAYS: Record<ReportWindowPreset, number> = { '24h': 1, '7d': 7, '30d': 30 }

// ---------- where the numbers come from ----------

export type SourceInfo = { from: 'store' | 'ring' | 'unknown'; complete: boolean; oldest?: string }

/**
 * Whether a report covers its whole window: the evidence database does
 * (within its retention); the engine's memory does only while its oldest
 * record is older than the window start, and a truncated scan never does.
 */
export function sourceOf(env: Pick<ReportEnvelope, 'source' | 'truncated' | 'oldest_record' | 'window'>): SourceInfo {
  const from = env.source === 'store' || env.source === 'ring' ? env.source : 'unknown'
  if (env.truncated) return { from, complete: false, oldest: env.oldest_record || undefined }
  if (from === 'store') return { from, complete: true }
  const oldest = env.oldest_record ? Date.parse(env.oldest_record) : NaN
  const start = env.window ? Date.parse(env.window.from) : NaN
  const complete = Number.isFinite(oldest) && Number.isFinite(start) ? oldest <= start : false
  return { from, complete, oldest: env.oldest_record || undefined }
}

// ---------- executive summary ----------

const SEVS: Severity[] = ['critical', 'high', 'medium', 'low', 'info']

export type Share = { key: string; count: number; share: number }

/** Alerts by severity in fixed order, with their share of the total (empty ones left out). */
export function severityShares(bySeverity: Record<string, number>): (Share & { key: Severity })[] {
  const total = SEVS.reduce((n, s) => n + (bySeverity[s] ?? 0), 0)
  return SEVS.filter((s) => (bySeverity[s] ?? 0) > 0).map((s) => ({ key: s, count: bySeverity[s], share: total ? bySeverity[s] / total : 0 }))
}

export const TRIAGE_STATES = ['new', 'acknowledged', 'closed'] as const

export function triageShares(byStatus: Record<string, number>): Share[] {
  const total = TRIAGE_STATES.reduce((n, s) => n + (byStatus[s] ?? 0), 0)
  return TRIAGE_STATES.map((s) => ({ key: s, count: byStatus[s] ?? 0, share: total ? (byStatus[s] ?? 0) / total : 0 }))
}

/** The ATT&CK tactics of the window, busiest first; the engine names them ("Credential Access"), the console knows their slugs. */
export function tacticBars(byTactic: Record<string, number>): { slug: TacticSlug | null; name: string; count: number }[] {
  return Object.entries(byTactic)
    .map(([name, count]) => ({ slug: tacticSlug(name), name, count }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

// ---------- SOC activity ----------

export type SocDay = { day: string; created: number; acknowledged: number; closed: number }

/** One row per UTC day of the window, oldest first: the engine only lists the days with activity. */
export function fillDays(report: Pick<SocActivityReport, 'days' | 'window'>, fallbackDays: number): SocDay[] {
  const until = report.window ? Date.parse(report.window.until) : NaN
  const from = report.window ? Date.parse(report.window.from) : NaN
  const day = 86_400_000
  const last = Number.isFinite(until) ? Math.floor(until / day) : Math.floor(Date.now() / day)
  const first = Number.isFinite(from) ? Math.floor(from / day) : last - fallbackDays + 1
  const byDay = new Map(report.days.map((d) => [d.day, d]))
  const out: SocDay[] = []
  for (let d = first; d <= last; d++) {
    const key = new Date(d * day).toISOString().slice(0, 10)
    const found = byDay.get(key)
    out.push({ day: key, created: found?.created ?? 0, acknowledged: found?.acknowledged ?? 0, closed: found?.closed ?? 0 })
  }
  return out
}

/** A mean the engine computed over zero items is no mean: none closed means no time to close. */
export function meanOrNull(seconds: number, samples: number): number | null {
  return samples > 0 && Number.isFinite(seconds) ? seconds : null
}

export function ranking(counts: Record<string, number>): { key: string; count: number }[] {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

// ---------- fleet coverage ----------

const STATUS_ORDER: Record<string, number> = { silent: 0, idle: 1, online: 2 }

/** Hosts that sent nothing in the window first, then silent, idle and online ones. */
export function fleetRows(hosts: FleetCoverageReport['hosts']): (FleetCoverageReport['hosts'][number] & { quiet: boolean })[] {
  return hosts
    .map((h) => ({ ...h, quiet: h.events_in_window === 0 }))
    .sort((a, b) => Number(b.quiet) - Number(a.quiet) || (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3) || a.host.localeCompare(b.host))
}

// ---------- today against the week ----------

export type Comparison = {
  key: 'alerts' | 'critical' | 'high' | 'mtta' | 'mttc' | 'hosts'
  today: number | null
  avg7: number | null
  avg30: number | null
  /** % change of today against the 7-day daily average (null when it cannot be said) */
  delta7: number | null
  delta30: number | null
  /** lower is better (times); higher is worse (alerts) */
  kind: 'count' | 'time'
}

export function deltaPct(today: number | null, base: number | null): number | null {
  if (today === null || base === null || base <= 0) return null
  return ((today - base) / base) * 100
}

type ExecLike = Pick<ExecutiveReport, 'alerts_total' | 'by_severity' | 'hosts_affected'>
type SocLike = Pick<SocActivityReport, 'mean_time_to_ack_seconds' | 'mean_time_to_close_seconds' | 'backlog' | 'days'>

const ackSamples = (s: SocLike) => s.days.reduce((n, d) => n + d.acknowledged, 0)
const closeSamples = (s: SocLike) => s.days.reduce((n, d) => n + d.closed, 0)

/**
 * The last 24 hours against the daily average of the last 7 and 30 days.
 * Counts are divided by the days of their window (they add up); the mean
 * times are already per alert and compare as they are. The hosts of a
 * longer window are distinct machines, not a daily sum: they are shown
 * without an average.
 */
export function compareToday(
  e24: ExecLike | null,
  e7: ExecLike | null,
  e30: ExecLike | null,
  s24: SocLike | null,
  s7: SocLike | null,
  s30: SocLike | null,
): Comparison[] {
  const count = (r: ExecLike | null, pick: (r: ExecLike) => number, days: number) => (r ? pick(r) / days : null)
  const rows: Comparison[] = []
  const add = (key: Comparison['key'], kind: Comparison['kind'], today: number | null, avg7: number | null, avg30: number | null) =>
    rows.push({ key, kind, today, avg7, avg30, delta7: deltaPct(today, avg7), delta30: deltaPct(today, avg30) })
  add('alerts', 'count', count(e24, (r) => r.alerts_total, 1), count(e7, (r) => r.alerts_total, 7), count(e30, (r) => r.alerts_total, 30))
  add('critical', 'count', count(e24, (r) => r.by_severity.critical ?? 0, 1), count(e7, (r) => r.by_severity.critical ?? 0, 7), count(e30, (r) => r.by_severity.critical ?? 0, 30))
  add('high', 'count', count(e24, (r) => r.by_severity.high ?? 0, 1), count(e7, (r) => r.by_severity.high ?? 0, 7), count(e30, (r) => r.by_severity.high ?? 0, 30))
  const mtta = (s: SocLike | null) => (s ? meanOrNull(s.mean_time_to_ack_seconds, ackSamples(s)) : null)
  const mttc = (s: SocLike | null) => (s ? meanOrNull(s.mean_time_to_close_seconds, closeSamples(s)) : null)
  add('mtta', 'time', mtta(s24), mtta(s7), mtta(s30))
  add('mttc', 'time', mttc(s24), mttc(s7), mttc(s30))
  rows.push({ key: 'hosts', kind: 'count', today: e24 ? e24.hosts_affected : null, avg7: null, avg30: null, delta7: null, delta30: null })
  return rows
}

/** Rules that fired today at least twice their 7-day daily average (and at least 3 times): what is unusual today. */
export function unusualRules(
  today: Pick<ExecutiveReport, 'top_rules'> | null,
  week: Pick<ExecutiveReport, 'top_rules'> | null,
  minToday = 3,
): { rule_id: string; rule_name: string; today: number; avg7: number }[] {
  if (!today) return []
  const weekly = new Map((week?.top_rules ?? []).map((r) => [r.rule_id, r.count / 7]))
  return today.top_rules
    .map((r) => ({ rule_id: r.rule_id, rule_name: r.rule_name, today: r.count, avg7: weekly.get(r.rule_id) ?? 0 }))
    .filter((r) => r.today >= minToday && (r.avg7 === 0 || r.today >= 2 * r.avg7))
    .sort((a, b) => b.today - a.today)
}

// ---------- raw data export ----------

export type ExportFilter = { format: 'jsonl' | 'csv'; since: '' | ReportWindowPreset; severity: Severity[]; host: string }

/** The export's since takes a Go duration (or a timestamp): Go durations have no days. */
const SINCE: Record<ReportWindowPreset, string> = { '24h': '24h', '7d': '168h', '30d': '720h' }

/** The engine's bulk export of alerts or events, as a same-origin link the browser downloads. */
export function exportHref(kind: 'alerts' | 'events', f: ExportFilter): string {
  const p = new URLSearchParams({ format: f.format })
  if (f.since) p.set('since', SINCE[f.since])
  if (kind === 'alerts' && f.severity.length) p.set('severity', f.severity.join(','))
  if (f.host.trim()) p.set('host', f.host.trim())
  return `/api/engine/api/${kind}/export?${p.toString()}`
}

// ---------- the library of write-ups ----------

export function filterLibrary(reports: readonly SocReport[], q: string, decision: Decision | 'all'): SocReport[] {
  const needle = q.trim().toLowerCase()
  return reports
    .filter((r) => decision === 'all' || r.fields.decision === decision)
    .filter(
      (r) =>
        !needle ||
        [r.fields.title, r.fields.analyst, r.fields.findings, r.alert.rule_name, r.alert.host, r.alert_id].some((v) => (v ?? '').toLowerCase().includes(needle)),
    )
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}
