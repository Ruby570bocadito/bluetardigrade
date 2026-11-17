// The v2 alert queue (Alertas): which alerts a lens shows, the counts on
// its severity chips and the links to what the classic console still
// owns. Same search semantics as the classic queue (lib/alert-search,
// observationSearch), so a filtered link means the same in both.
import type { Severity, SfAlert, SfAlertStatus } from '@/lib/console-types'
import { alertKey } from '@/lib/engine-client'
import { matchesAlertState, matchesAssignee, type AlertStateFilter, type AssigneeLens } from '@/lib/alert-search'
import { observationSearch } from '@/lib/source-observation'
import { alertTactic, type TacticSlug } from '@/lib/soc-metrics'
import type { SeverityFilter } from '@/lib/url-state'

export type QueueLens = { sev: SeverityFilter; state: AlertStateFilter; assignee: AssigneeLens; q: string }

export const DEFAULT_LENS: QueueLens = { sev: 'all', state: 'all', assignee: 'all', q: '' }

/** Anything an analyst remembers about an alert, lowercased (the classic queue's haystack). */
export function alertHaystack(a: SfAlert): string {
  return [
    a.rule_name, a.rule_id, a.summary, a.host, a.user ?? '', a.event_type, a.source ?? '', a.status_note ?? '',
    a.assignee ?? '', ...(a.tags ?? []), ...a.matched_on, ...observationSearch(a.attributes, a.network),
  ].join(' ').toLowerCase()
}

export function matchesQuery(a: SfAlert, q: string): boolean {
  const needle = q.trim().toLowerCase()
  return needle === '' || alertHaystack(a).includes(needle)
}

function byNewest(a: SfAlert, b: SfAlert): number {
  return (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0)
}

/** The alerts a lens shows, newest first. */
export function queueAlerts(alerts: readonly SfAlert[], lens: QueueLens, me: string): SfAlert[] {
  return alerts
    .filter((a) =>
      matchesAlertState(a, lens.state) &&
      matchesAssignee(a, lens.assignee, me) &&
      (lens.sev === 'all' || a.severity === lens.sev) &&
      matchesQuery(a, lens.q))
    .sort(byNewest)
}

/** What each severity chip counts: the lens without its own severity filter. */
export function severityChips(alerts: readonly SfAlert[], lens: QueueLens, me: string): Record<Severity, number> & { all: number } {
  const out = { all: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  for (const a of queueAlerts(alerts, { ...lens, sev: 'all' }, me)) {
    out.all++
    if (a.severity in out) out[a.severity]++
  }
  return out
}

export function isFiltering(lens: QueueLens): boolean {
  return lens.sev !== 'all' || lens.state !== 'all' || lens.assignee !== 'all' || lens.q.trim() !== ''
}

export function statusOf(a: Pick<SfAlert, 'status'>): SfAlertStatus {
  return a.status ?? 'new'
}

/** ATT&CK technique ids named by an alert's tags (attack.t1003.001 -> T1003.001), in order. */
export function techniqueIds(tags: readonly string[] | undefined): string[] {
  const out: string[] = []
  for (const tag of tags ?? []) {
    const m = /^attack\.(t\d{4}(?:\.\d{3})?)$/i.exec(tag.trim())
    if (m && !out.includes(m[1].toUpperCase())) out.push(m[1].toUpperCase())
  }
  return out
}

/** The tags an alert carries besides its ATT&CK ones. */
export function otherTags(tags: readonly string[] | undefined): string[] {
  return (tags ?? []).filter((t) => !t.toLowerCase().startsWith('attack.'))
}

export function alertTacticOf(a: Pick<SfAlert, 'tags'>): TacticSlug | null {
  return alertTactic(a)
}

/** Where the classic console opens what v2 does not rebuild yet. */
export const classicLink = {
  alert: (key: string): string => `/?view=alertas&alert=${encodeURIComponent(key)}`,
  host: (host: string): string => `/?view=equipos&host=${encodeURIComponent(host)}`,
  flow: (host: string): string => `/?view=flujo&fq=${encodeURIComponent(host)}`,
}

/** The v2 queue with one alert open (Inicio links here). */
export function v2AlertLink(key: string): string {
  return `/v2/alertas?alert=${encodeURIComponent(key)}`
}

// ---- views of the queue ------------------------------------------------------

/** How the queue is shown: the list with the open alert, the board by state, or one alert at a time. */
export type QueueView = 'lista' | 'tablero' | 'foco'

export function queueViewFromParam(raw: string | null): QueueView {
  return raw === 'tablero' || raw === 'foco' ? raw : 'lista'
}

/** A query string with one key set (or removed with null), keeping the rest. */
export function setSearchParam(search: string, key: string, value: string | null): string {
  const params = new URLSearchParams(search)
  if (value === null) params.delete(key)
  else params.set(key, value)
  const out = params.toString()
  return out ? `?${out}` : ''
}

export type TimelineDot = { key: string; x: number; severity: Severity; rule: string; host: string; at: string }

/** Where each alert of the last `windowMs` sits on the timeline (0 = window start, 1 = now), and how many came before. */
export function timelineDots(alerts: readonly SfAlert[], now: number, windowMs = 60 * 60_000): { dots: TimelineDot[]; older: number } {
  const start = now - windowMs
  const dots: TimelineDot[] = []
  let older = 0
  for (const a of alerts) {
    const t = Date.parse(a.timestamp)
    if (!Number.isFinite(t)) continue
    if (t < start) {
      older++
      continue
    }
    dots.push({ key: alertKey(a), x: Math.min(1, (t - start) / windowMs), severity: a.severity, rule: a.rule_name, host: a.host, at: a.timestamp })
  }
  return { dots, older }
}

const RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }

export type HostGroup = { host: string; alerts: SfAlert[]; counts: Record<Severity, number>; worst: Severity }

/** The queue grouped by host: the worst host first (severity, then how many), each keeping the queue's order. */
export function groupByHost(alerts: readonly SfAlert[]): HostGroup[] {
  const groups = new Map<string, HostGroup>()
  for (const a of alerts) {
    let g = groups.get(a.host)
    if (!g) groups.set(a.host, (g = { host: a.host, alerts: [], counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, worst: a.severity }))
    g.alerts.push(a)
    g.counts[a.severity]++
    if (RANK[a.severity] > RANK[g.worst]) g.worst = a.severity
  }
  return [...groups.values()].sort((x, y) => RANK[y.worst] - RANK[x.worst] || y.alerts.length - x.alerts.length || x.host.localeCompare(y.host))
}

/** The board: one column per triage state, each keeping the queue's order. */
export function boardColumns(alerts: readonly SfAlert[]): Record<SfAlertStatus, SfAlert[]> {
  const out: Record<SfAlertStatus, SfAlert[]> = { new: [], acknowledged: [], closed: [] }
  for (const a of alerts) out[statusOf(a)].push(a)
  return out
}

export type BulkChange = { id: string; key: string; from: SfAlertStatus }

/** What a bulk move to `to` would change: alerts the engine can address (with an id) not already there. */
export function bulkChanges(alerts: readonly SfAlert[], to: SfAlertStatus): BulkChange[] {
  return alerts.filter((a) => a.id && statusOf(a) !== to).map((a) => ({ id: a.id!, key: alertKey(a), from: statusOf(a) }))
}

/** Where focus mode starts: the open alert, else the first one still new, else the first. */
export function focusStart(alerts: readonly SfAlert[], key: string | null): number {
  if (alerts.length === 0) return -1
  const open = key === null ? -1 : alerts.findIndex((a) => alertKey(a) === key)
  if (open >= 0) return open
  const fresh = alerts.findIndex((a) => statusOf(a) === 'new')
  return fresh >= 0 ? fresh : 0
}
