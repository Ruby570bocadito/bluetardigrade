// Multi-alert incident analysis (ROADMAP H5): groups alerts by host and
// time window, picks a bounded set and assembles the payload the AI
// analyst hub validates and turns into the multi-alert prompt.
//
// Everything here is pure data shaping: no fetches, no socket calls. The
// forensic bundle digest is built by the caller from a real
// GET /api/alerts/{id}/forensics response; when there is no bundle the
// payload simply carries none (the hub prompt never pretends otherwise).
// Caps keep the socket payload bounded regardless of case size.

import type { IncidentEntry } from './engine-writes'
import type { Severity, SfAlert } from './console-types'
import type { ForensicBundle, ForensicEvent } from './forensic'

/** Maximum alerts an analysis may carry; the hub rejects more. */
export const MAX_INCIDENT_ALERTS = 8
/** Alerts farther apart than this do not share a window group. */
export const GROUP_WINDOW_MS = 30 * 60_000
/** Maximum engine-recorded case timeline entries sent as context. */
export const MAX_TIMELINE_ENTRIES = 20
/** Maximum frozen bundle events sent as context. */
export const MAX_BUNDLE_EVENTS = 40

const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }

/** Operator-authored case data the hub echoes in its own delimited block. */
export type IncidentMeta = {
  title: string
  severity?: Severity
  status?: string
  summary?: string
  hosts: string[]
}

/** One host+window cluster of available alerts. */
export type AlertGroup = {
  host: string
  from: string
  to: string
  alerts: SfAlert[]
}

/** Frozen bundle digest attached to the analysis payload. */
export type BundleDigest = {
  alert_id: string
  host: string
  window: string
  captured_at: string
  summary?: ForensicBundle['summary']
  events: ForensicEvent[]
}

export type IncidentAnalysisPayload = {
  source: 'incident' | 'selection'
  incident?: IncidentMeta
  alerts: SfAlert[]
  /** Alerts of the case left out by the cap, when any. */
  omitted_alerts?: number
  /** host+window summary computed over the alerts that travel. */
  groups: { host: string; from: string; to: string; count: number }[]
  /** Engine-recorded case timeline (incident source only). */
  timeline?: IncidentEntry[]
  /** Digest of the frozen bundle of the most severe alert, when it exists. */
  bundle?: BundleDigest
}

/** What the shell hands over to the analyst view; the bundle is fetched
 * (and the payload completed) by the panel right before emitting. */
export type PendingIncidentAnalysis = {
  payload: IncidentAnalysisPayload
  /** Human label for the transcript bubble (case title or selection). */
  label: string
}

function timeOf(alert: SfAlert): number {
  const t = Date.parse(alert.timestamp)
  return Number.isFinite(t) ? t : 0
}

/** Groups alerts per host, chaining alerts whose timestamps stay within
 * `windowMs` of the running group. Alerts with unparsable timestamps sort
 * as epoch 0 instead of breaking the grouping. Hosts are alphabetical;
 * within a host, chronological. */
export function groupAlertsByHostWindow(alerts: readonly SfAlert[], windowMs = GROUP_WINDOW_MS): AlertGroup[] {
  const byHost = new Map<string, SfAlert[]>()
  for (const a of alerts) {
    const host = a.host || '(sin equipo)'
    const list = byHost.get(host)
    if (list) list.push(a)
    else byHost.set(host, [a])
  }
  const groups: AlertGroup[] = []
  for (const host of [...byHost.keys()].sort((a, b) => a.localeCompare(b))) {
    const sorted = [...byHost.get(host)!].sort((a, b) => timeOf(a) - timeOf(b) || a.timestamp.localeCompare(b.timestamp))
    let current: SfAlert[] = []
    for (const alert of sorted) {
      if (current.length === 0) {
        current = [alert]
        continue
      }
      const last = current[current.length - 1]
      if (timeOf(alert) - timeOf(last) <= windowMs) current.push(alert)
      else {
        groups.push(makeGroup(host, current))
        current = [alert]
      }
    }
    if (current.length > 0) groups.push(makeGroup(host, current))
  }
  return groups
}

function makeGroup(host: string, alerts: SfAlert[]): AlertGroup {
  const times = alerts.map((a) => timeOf(a))
  return {
    host,
    from: new Date(Math.min(...times)).toISOString(),
    to: new Date(Math.max(...times)).toISOString(),
    alerts,
  }
}

/** Picks at most `max` alerts for the payload: most severe first, then
 * most recent; ties break by rule name so the order is deterministic. */
export function selectAlertsForAnalysis(
  alerts: readonly SfAlert[],
  max = MAX_INCIDENT_ALERTS,
): { picked: SfAlert[]; omitted: number } {
  const ranked = [...alerts].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    if (bySeverity !== 0) return bySeverity
    const byTime = timeOf(b) - timeOf(a)
    if (byTime !== 0) return byTime
    return a.rule_name.localeCompare(b.rule_name)
  })
  return { picked: ranked.slice(0, max), omitted: Math.max(0, alerts.length - max) }
}

/** Digest of a frozen forensic bundle: at most `maxEvents` events. Under
 * the cap the chronological order of the frozen timeline is preserved;
 * over it, events are chosen round-robin across event types (so a burst
 * of one kind cannot crowd out the rest of the story) and re-sorted by
 * time so the digest keeps reading as a sequence. */
export function digestBundle(bundle: ForensicBundle, maxEvents = MAX_BUNDLE_EVENTS): BundleDigest {
  if (bundle.timeline.length <= maxEvents) {
    return {
      alert_id: bundle.alert.id,
      host: bundle.host,
      window: bundle.window,
      captured_at: bundle.captured_at,
      summary: bundle.summary,
      events: [...bundle.timeline],
    }
  }
  const byType = new Map<string, { ev: ForensicEvent; order: number }[]>()
  bundle.timeline.forEach((ev, order) => {
    const list = byType.get(ev.type)
    if (list) list.push({ ev, order })
    else byType.set(ev.type, [{ ev, order }])
  })
  const types = [...byType.keys()].sort((a, b) => a.localeCompare(b))
  const picked: { ev: ForensicEvent; order: number }[] = []
  let added = true
  while (picked.length < maxEvents && added) {
    added = false
    for (const type of types) {
      const next = byType.get(type)!.shift()
      if (next) {
        picked.push(next)
        added = true
        if (picked.length >= maxEvents) break
      }
    }
  }
  return {
    alert_id: bundle.alert.id,
    host: bundle.host,
    window: bundle.window,
    captured_at: bundle.captured_at,
    summary: bundle.summary,
    events: picked.sort((a, b) => a.order - b.order).map((p) => p.ev),
  }
}

/** Assembles the bounded analysis payload from what the case (or the
 * selection) has available right now. Nothing is invented: if only some
 * alerts are in the live window, `omitted_alerts` says how many are not. */
export function buildIncidentAnalysis(input: {
  alerts: readonly SfAlert[]
  source: 'incident' | 'selection'
  incident?: IncidentMeta
  timeline?: readonly IncidentEntry[]
}): IncidentAnalysisPayload {
  const { picked, omitted } = selectAlertsForAnalysis(input.alerts)
  const groups = groupAlertsByHostWindow(picked).map((g) => ({
    host: g.host,
    from: g.from,
    to: g.to,
    count: g.alerts.length,
  }))
  const timeline =
    input.source === 'incident' && input.timeline && input.timeline.length > 0
      ? input.timeline.slice(-MAX_TIMELINE_ENTRIES)
      : undefined
  return {
    source: input.source,
    incident: input.incident,
    alerts: picked,
    ...(omitted > 0 ? { omitted_alerts: omitted } : {}),
    groups,
    ...(timeline ? { timeline } : {}),
  }
}

/** The alert whose frozen bundle is worth attaching: the most severe
 * available one that carries an id, so the forensics endpoint can answer. */
export function pickBundleAlert(alerts: readonly SfAlert[]): SfAlert | undefined {
  const { picked } = selectAlertsForAnalysis(alerts.filter((a) => typeof a.id === 'string' && a.id))
  return picked[0]
}
