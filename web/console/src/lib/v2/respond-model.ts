// v2 · Respuesta: the pure part of the section. What the engine's active
// response surface did (its audit: every attempt, executed or denied, one
// line per attempt), the alerts an operator can act on, the hosts of the
// open cases by state, one case as a timeline and the response numbers.
// The engine's only action is terminating a process on its own host
// (kill_process, SIGKILL fixed): nothing here invents another one.

import type { Severity, SfAlert, SfEvent, SfRespondRecord } from '@/lib/console-types'
import type { Incident, IncidentStatus } from '@/lib/engine-writes'
import { eventSha256, isPublicIPv4 } from '@/lib/engine-writes'
import type { IncidentPlaybookState, PlaybookTemplate } from '@/lib/incident-playbook'

const lower = (s: string | undefined) => (s ?? '').toLowerCase()
const time = (iso: string | undefined) => {
  const t = Date.parse(iso ?? '')
  return Number.isFinite(t) ? t : NaN
}
const SEV_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }

// ---------- URL ----------

export const RESPOND_TABS = ['estado', 'actuar', 'registro', 'denegaciones', 'contencion', 'sala', 'planes', 'metricas'] as const
export type RespondTab = (typeof RESPOND_TABS)[number]
export function respondTabFromParam(v: string | null): RespondTab {
  return (RESPOND_TABS as readonly string[]).includes(v ?? '') ? (v as RespondTab) : 'estado'
}

/** The response page of one alert (its process, reputation and forensic snapshot). */
export function v2RespondLink(alertKey: string): string {
  return `/v2/respuesta?alerta=${encodeURIComponent(alertKey)}`
}

// ---------- the audit ----------

/**
 * Every refusal the engine names (internal/respond plus the API's own
 * host-scope check). The console explains each one in plain words; a
 * code outside this list is shown as the engine sent it.
 */
export const DENY_CODES = [
  'operator_not_allowed', 'operator_credential_invalid', 'operator_rate_limited', 'host_mismatch', 'host_scope',
  'pid_invalid', 'pid_not_found', 'pid_mismatch', 'pid_access_denied', 'process_protected', 'self_protected',
  'cooldown_active', 'rate_limited', 'audit_unavailable', 'idempotency_repeated',
] as const
export type DenyCode = (typeof DENY_CODES)[number]

export type AuditFilter = 'todas' | 'ejecutadas' | 'denegadas' | 'seguimiento'
export const AUDIT_FILTERS: readonly AuditFilter[] = ['todas', 'ejecutadas', 'denegadas', 'seguimiento']

/** The attempts a filter and a search leave (host, process, operator, rule, alert, reason or code). */
export function filterAudit(records: readonly SfRespondRecord[], filter: AuditFilter, q: string): SfRespondRecord[] {
  const needle = q.trim().toLowerCase()
  return records.filter((r) => {
    if (filter === 'ejecutadas' && r.decision !== 'executed') return false
    if (filter === 'denegadas' && r.decision !== 'denied') return false
    if (filter === 'seguimiento' && !r.followup) return false
    if (!needle) return true
    return [r.host, r.process_name, r.resolved_name, r.operator, r.rule_id, r.alert_id, r.reason, r.code, r.action_id, String(r.pid)]
      .some((v) => lower(v).includes(needle))
  })
}

export function auditCounts(records: readonly SfRespondRecord[]): Record<AuditFilter, number> {
  return {
    todas: records.length,
    ejecutadas: records.filter((r) => r.decision === 'executed').length,
    denegadas: records.filter((r) => r.decision === 'denied').length,
    seguimiento: records.filter((r) => r.followup).length,
  }
}

/** The newest attempt with that decision (the audit tail may come in any order). */
export function latest(records: readonly SfRespondRecord[], decision: SfRespondRecord['decision']): SfRespondRecord | undefined {
  let best: SfRespondRecord | undefined
  for (const r of records) if (r.decision === decision && (!best || time(r.ts) > time(best.ts))) best = r
  return best
}

export type DenialGroup = { code: string; count: number; latest: SfRespondRecord; hosts: string[]; operators: string[] }

/** The denied attempts grouped by the engine's reason, most frequent first. */
export function denialGroups(records: readonly SfRespondRecord[]): DenialGroup[] {
  const groups = new Map<string, SfRespondRecord[]>()
  for (const r of records) {
    if (r.decision !== 'denied') continue
    const code = r.code || 'unknown'
    groups.set(code, [...(groups.get(code) ?? []), r])
  }
  return [...groups.entries()]
    .map(([code, list]) => {
      const newest = list.reduce((a, b) => (time(b.ts) > time(a.ts) ? b : a))
      return {
        code,
        count: list.length,
        latest: newest,
        hosts: [...new Set(list.map((r) => r.host).filter(Boolean))],
        operators: [...new Set(list.map((r) => r.operator).filter(Boolean))],
      }
    })
    .sort((a, b) => b.count - a.count || time(b.latest.ts) - time(a.latest.ts))
}

// ---------- alerts an operator can act on ----------

export type ActionableAlert = {
  alert: SfAlert
  event?: SfEvent
  pid: number | null
  process: string
  commandLine?: string
  actions: SfRespondRecord[]
}

/** The attempts made from one alert (the audit keeps its id). */
export function actionsFor(records: readonly SfRespondRecord[], alertId: string | undefined): SfRespondRecord[] {
  if (!alertId) return []
  return records.filter((r) => r.alert_id === alertId).sort((a, b) => time(b.ts) - time(a.ts))
}

/**
 * The alerts whose event is still in memory and names a process: the ones
 * a terminate request can be written for without guessing a PID. Newest
 * first; the ones already acted on carry their attempts.
 */
export function actionableAlerts(alerts: readonly SfAlert[], events: readonly SfEvent[], records: readonly SfRespondRecord[]): ActionableAlert[] {
  const byId = new Map(events.map((e) => [e.id, e]))
  return alerts
    .map((alert) => {
      const event = byId.get(alert.event_id)
      const pid = event?.process?.pid
      return {
        alert,
        event,
        pid: typeof pid === 'number' && pid > 0 ? pid : null,
        process: event?.process?.name ?? '',
        commandLine: event?.process?.command_line,
        actions: actionsFor(records, alert.id),
      }
    })
    .filter((a) => a.pid !== null && a.process !== '')
    .sort((a, b) => time(b.alert.timestamp) - time(a.alert.timestamp))
}

/** What of an alert can be looked up for reputation: its public IPs and, with VirusTotal, its SHA-256 hashes. */
export function reputationTargets(alert: SfAlert, event: SfEvent | undefined, providers: Record<string, boolean>): { kind: 'ip' | 'hash'; value: string }[] {
  const ips = [...new Set([alert.network?.destination_ip, alert.network?.source_ip, event?.network?.destination_ip].filter(isPublicIPv4))]
  const hashes = providers.virustotal ? eventSha256(event) : []
  return [...ips.map((value) => ({ kind: 'ip' as const, value })), ...hashes.map((value) => ({ kind: 'hash' as const, value }))]
}

// ---------- containment by host ----------

const STATE_ORDER: Record<IncidentStatus, number> = { open: 0, investigating: 1, contained: 2, closed: 3 }
export const BOARD_STATES: readonly IncidentStatus[] = ['open', 'investigating', 'contained', 'closed']

export type HostCard = {
  host: string
  status: IncidentStatus
  incidents: Incident[]
  executed: number
  denied: number
  lastAction?: SfRespondRecord
  /** the first unchecked step of the plan of its most urgent case (text in Spanish; the ids localize it) */
  nextStep?: { incidentId: string; templateId: string; itemId: string; text: string }
}

/**
 * The machines of the cases, each in the column of its least advanced
 * case (a host still open in one case is not contained), with the
 * response attempts made on it and the next unchecked step of its plan.
 * Closed cases count only while they closed recently.
 */
export function containmentBoard(
  incidents: readonly Incident[],
  records: readonly SfRespondRecord[],
  plans: Record<string, IncidentPlaybookState>,
  templates: readonly PlaybookTemplate[],
  now: number,
  closedWithinMs = 7 * 86_400_000,
): Record<IncidentStatus, HostCard[]> {
  const byHost = new Map<string, { host: string; incidents: Incident[] }>()
  for (const inc of incidents) {
    if (inc.status === 'closed' && !(now - time(inc.closed_at ?? inc.updated_at) <= closedWithinMs)) continue
    for (const host of inc.hosts) {
      const key = lower(host)
      const entry = byHost.get(key) ?? { host, incidents: [] }
      entry.incidents.push(inc)
      byHost.set(key, entry)
    }
  }
  const board: Record<IncidentStatus, HostCard[]> = { open: [], investigating: [], contained: [], closed: [] }
  for (const [key, { host, incidents: cases }] of byHost) {
    cases.sort((a, b) => STATE_ORDER[a.status] - STATE_ORDER[b.status] || SEV_RANK[b.severity] - SEV_RANK[a.severity])
    const mine = records.filter((r) => lower(r.host) === key)
    let nextStep: HostCard['nextStep']
    for (const inc of cases) {
      const plan = plans[inc.id]
      const template = plan && templates.find((t) => t.id === plan.templateId)
      const item = template?.items.find((i) => !plan.checks[i.id]?.done)
      if (item) {
        nextStep = { incidentId: inc.id, templateId: plan.templateId, itemId: item.id, text: item.text }
        break
      }
    }
    board[cases[0].status].push({
      host,
      status: cases[0].status,
      incidents: cases,
      executed: mine.filter((r) => r.decision === 'executed').length,
      denied: mine.filter((r) => r.decision === 'denied').length,
      lastAction: latest(mine, 'executed') ?? latest(mine, 'denied'),
      nextStep,
    })
  }
  for (const s of BOARD_STATES)
    board[s].sort((a, b) => SEV_RANK[b.incidents[0].severity] - SEV_RANK[a.incidents[0].severity] || a.host.localeCompare(b.host))
  return board
}

// ---------- one case, as a war room ----------

/** The case to open first: an active one, the most severe, the most recently touched. */
export function pickWarIncident(incidents: readonly Incident[]): Incident | undefined {
  return [...incidents]
    .filter((i) => i.status !== 'closed')
    .sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || time(b.updated_at) - time(a.updated_at))[0]
}

/** When the case was first marked contained (the engine writes "Estado x -> contained"). */
export function containedAt(incident: Pick<Incident, 'timeline'>): string | undefined {
  return incident.timeline
    .filter((e) => e.kind === 'status' && /-> contained$/.test(e.text))
    .map((e) => e.at)
    .sort()[0]
}

export type WarMarker = {
  at: string
  kind: 'alert' | 'executed' | 'denied' | 'status' | 'note' | 'created'
  text: string
  by?: string
  severity?: Severity
  ref?: string
}

/**
 * The case in one line of time: its alerts, the engine's timeline lines
 * (status, notes) and the response attempts on its hosts or alerts since
 * the case opened, oldest first.
 */
export function warTimeline(incident: Incident, alerts: readonly SfAlert[], records: readonly SfRespondRecord[]): WarMarker[] {
  const ids = new Set(incident.alert_ids)
  const hosts = new Set(incident.hosts.map(lower))
  const start = time(incident.created_at)
  const markers: WarMarker[] = []
  for (const a of alerts)
    if (a.id && ids.has(a.id)) markers.push({ at: a.timestamp, kind: 'alert', text: a.rule_name, severity: a.severity, ref: a.id, by: a.host })
  for (const e of incident.timeline) {
    if (e.kind === 'status' || e.kind === 'note' || e.kind === 'created') markers.push({ at: e.at, kind: e.kind, text: e.text, by: e.by })
  }
  for (const r of records) {
    const mine = (r.alert_id && ids.has(r.alert_id)) || (hosts.has(lower(r.host)) && time(r.ts) >= start)
    if (mine) markers.push({ at: r.ts, kind: r.decision, text: `${r.process_name} (PID ${r.pid}) · ${r.host}`, by: r.operator, ref: r.action_id })
  }
  return markers.filter((m) => Number.isFinite(time(m.at))).sort((a, b) => time(a.at) - time(b.at))
}

/** The machines and the accounts a case touches (the accounts come from its alerts). */
export function affected(incident: Incident, alerts: readonly SfAlert[]): { hosts: string[]; users: string[] } {
  const ids = new Set(incident.alert_ids)
  const users = new Set<string>()
  for (const a of alerts) if (a.id && ids.has(a.id) && a.user) users.add(a.user)
  return { hosts: [...incident.hosts].sort(), users: [...users].sort() }
}

/**
 * Seconds of the Go duration that opens a text ("5m0s before the
 * triggering event…" → 300); null when the text does not start with one.
 */
export function goDurationSeconds(text: string): number | null {
  const m = /^((?:\d+(?:\.\d+)?(?:h|m(?!s)|s|ms))+)/.exec(text.trim())
  if (!m) return null
  let total = 0
  for (const [, n, unit] of m[1].matchAll(/(\d+(?:\.\d+)?)(h|ms|m|s)/g)) total += Number(n) * ({ h: 3600, m: 60, s: 1, ms: 0.001 } as Record<string, number>)[unit]
  return total
}

// ---------- response numbers ----------

export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[i]
}

/** Executed and denied attempts per day over the last `days` days, oldest first (UTC days). */
export function dailyAttempts(records: readonly SfRespondRecord[], now: number, days = 30): { day: string; executed: number; denied: number }[] {
  const out: { day: string; executed: number; denied: number }[] = []
  const today = Math.floor(now / 86_400_000)
  for (let d = today - days + 1; d <= today; d++) out.push({ day: new Date(d * 86_400_000).toISOString().slice(0, 10), executed: 0, denied: 0 })
  for (const r of records) {
    const d = Math.floor(time(r.ts) / 86_400_000)
    const slot = out[d - (today - days + 1)]
    if (slot) slot[r.decision]++
  }
  return out
}

/**
 * Seconds from an alert to the first attempt made from it, over the
 * attempts whose alert is still in memory (the others are not counted:
 * their start is unknown here).
 */
export function timeToFirstAction(records: readonly SfRespondRecord[], alerts: readonly SfAlert[]): { samples: number; median: number | null; p90: number | null } {
  const alertTime = new Map(alerts.map((a) => [a.id, time(a.timestamp)]))
  const first = new Map<string, number>()
  for (const r of records) {
    if (!r.alert_id || !alertTime.has(r.alert_id)) continue
    const t = time(r.ts)
    if (!Number.isFinite(t)) continue
    first.set(r.alert_id, Math.min(first.get(r.alert_id) ?? Infinity, t))
  }
  const deltas = [...first.entries()].map(([id, t]) => (t - (alertTime.get(id) as number)) / 1000).filter((s) => Number.isFinite(s) && s >= 0)
  return { samples: deltas.length, median: percentile(deltas, 50), p90: percentile(deltas, 90) }
}

/** The most frequent values of one field of the attempts. */
export function topBy(records: readonly SfRespondRecord[], key: 'operator' | 'rule_id' | 'host', max = 6): { key: string; count: number }[] {
  const m = new Map<string, number>()
  for (const r of records) {
    const k = r[key]
    if (k) m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, max)
}

/** Cases contained or closed against the active ones, and the median time to contain. */
export function containStats(incidents: readonly Incident[]): { active: number; contained: number; closed: number; median: number | null; samples: number } {
  const spans: number[] = []
  for (const inc of incidents) {
    const at = containedAt(inc)
    if (!at) continue
    const s = (time(at) - time(inc.created_at)) / 1000
    if (Number.isFinite(s) && s >= 0) spans.push(s)
  }
  return {
    active: incidents.filter((i) => i.status === 'open' || i.status === 'investigating').length,
    contained: incidents.filter((i) => i.status === 'contained').length,
    closed: incidents.filter((i) => i.status === 'closed').length,
    median: percentile(spans, 50),
    samples: spans.length,
  }
}
