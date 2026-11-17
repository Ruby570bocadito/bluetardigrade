// The v2 incidents (Incidentes): which cases a filter shows and in what
// order, the step a case is on, how long it has been running, and what
// of the live state belongs to it (its alerts, its hosts' events). The
// cases themselves are the engine's (lib/engine-writes); nothing here
// invents a case, a step or a time.
import type { Severity, SfAlert, SfEvent } from '@/lib/console-types'
import type { Incident, IncidentEntry, IncidentStatus } from '@/lib/engine-writes'

export const STATUS_FLOW: readonly IncidentStatus[] = ['open', 'investigating', 'contained', 'closed']

/** The list filter: the cases still running (default), one state, or all. */
export type IncidentFilter = 'active' | IncidentStatus | 'all'

export function incidentFilterFromParam(raw: string | null): IncidentFilter {
  return raw === 'all' || (STATUS_FLOW as readonly string[]).includes(raw ?? '') ? (raw as IncidentFilter) : 'active'
}

const RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }

/** The cases a filter shows: running ones first, the most severe first, then the most recently touched. */
export function filterIncidents(incidents: readonly Incident[], filter: IncidentFilter): Incident[] {
  return incidents
    .filter((i) => filter === 'all' || (filter === 'active' ? i.status !== 'closed' : i.status === filter))
    .sort(
      (a, b) =>
        Number(a.status === 'closed') - Number(b.status === 'closed') ||
        RANK[b.severity] - RANK[a.severity] ||
        (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0),
    )
}

export function statusCounts(incidents: readonly Incident[]): Record<IncidentStatus, number> & { active: number; all: number } {
  const out = { open: 0, investigating: 0, contained: 0, closed: 0, active: 0, all: incidents.length }
  for (const i of incidents) {
    out[i.status]++
    if (i.status !== 'closed') out.active++
  }
  return out
}

/** "02:14:37", or "3 d 04:05:06" past a day (from `fromIso` to `toMs`). */
export function elapsed(fromIso: string, toMs: number): string {
  const from = Date.parse(fromIso)
  if (!Number.isFinite(from)) return '—'
  let s = Math.max(0, Math.floor((toMs - from) / 1000))
  const days = Math.floor(s / 86_400)
  s -= days * 86_400
  const hh = String(Math.floor(s / 3600)).padStart(2, '0')
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${days > 0 ? `${days} d ` : ''}${hh}:${mm}:${ss}`
}

/** The case's alerts still in the console's window, oldest first. */
export function caseAlerts(incident: Pick<Incident, 'alert_ids'>, alerts: readonly SfAlert[]): SfAlert[] {
  const ids = new Set(incident.alert_ids)
  return alerts.filter((a) => a.id && ids.has(a.id)).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

/** Only the case hosts' own events: the buffer holds every host's traffic. */
export function caseEvents(incident: Pick<Incident, 'hosts'>, events: readonly SfEvent[]): SfEvent[] {
  const hosts = new Set(incident.hosts.map((h) => h.toLowerCase()))
  return events.filter((e) => hosts.has((e.host || '').toLowerCase()))
}

/** Alerts that can still start a case: not closed, not in any case yet, newest first. */
export function candidateAlerts(alerts: readonly SfAlert[], incidents: readonly Pick<Incident, 'alert_ids'>[]): SfAlert[] {
  const taken = new Set(incidents.flatMap((i) => i.alert_ids))
  return alerts
    .filter((a) => a.id && !taken.has(a.id) && a.status !== 'closed')
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

export function worstSeverity(alerts: readonly Pick<SfAlert, 'severity'>[]): Severity {
  return alerts.reduce<Severity>((w, a) => (RANK[a.severity] > RANK[w] ? a.severity : w), 'info')
}

export function hostsOf(alerts: readonly Pick<SfAlert, 'host'>[]): string[] {
  return [...new Set(alerts.map((a) => a.host).filter(Boolean))]
}

/** The case timeline, newest first, each entry with a key that survives a refresh. */
export function activity(incident: Pick<Incident, 'timeline'>): (IncidentEntry & { key: string })[] {
  return incident.timeline
    .map((e, i) => ({ ...e, key: `${e.at}|${e.kind}|${i}` }))
    .sort((a, b) => b.at.localeCompare(a.at))
}

/** The words the console uses for the engine's own timeline lines. */
export type EntryWords = {
  status: (from: string, to: string) => string
  severity: (from: string, to: string, byAlerts: boolean) => string
  owner: (name: string) => string
  ownerCleared: string
  created: (n: number) => string
  alertsAdded: (n: number) => string
  titleChanged: (title: string) => string
}

/**
 * A timeline line in the operator's words. The engine writes its lines in
 * Spanish with the raw codes ("Estado open -> investigating"); the codes
 * become the console's labels and the line follows the console language.
 * Notes and any line of another shape are shown as stored.
 */
export function entryText(
  e: Pick<IncidentEntry, 'kind' | 'text'>,
  words: EntryWords,
  statusLabel: (code: string) => string,
  sevLabel: (code: string) => string,
): string {
  let m: RegExpExecArray | null
  switch (e.kind) {
    case 'status':
      if ((m = /^Estado (\w+) -> (\w+)$/.exec(e.text))) return words.status(statusLabel(m[1]), statusLabel(m[2]))
      break
    case 'severity':
      if ((m = /^Severidad (\w+) -> (\w+)( por las alertas añadidas)?$/.exec(e.text))) return words.severity(sevLabel(m[1]), sevLabel(m[2]), !!m[3])
      break
    case 'owner':
      if (e.text === 'Responsable retirado') return words.ownerCleared
      if ((m = /^Responsable: ([\s\S]+)$/.exec(e.text))) return words.owner(m[1])
      break
    case 'created':
      if ((m = /^Incidente abierto con (\d+) alertas$/.exec(e.text))) return words.created(Number(m[1]))
      break
    case 'alerts':
      if ((m = /^(\d+) alertas añadidas$/.exec(e.text))) return words.alertsAdded(Number(m[1]))
      break
    case 'note':
      if ((m = /^Titulo cambiado a «([\s\S]*)»$/.exec(e.text))) return words.titleChanged(m[1])
      break
  }
  return e.text
}

/** Two letters for a person ("CORP\\ana.garcia" -> "AG"). */
export function initials(name: string): string {
  const parts = name.replace(/^.*\\/, '').split(/[\s._@-]+/).filter(Boolean)
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.replace(/^.*\\/, '').slice(0, 2)).toUpperCase()
}

/** The v2 case page with one case open. */
export function v2IncidentLink(id: string): string {
  return `/v2/incidentes?incidente=${encodeURIComponent(id)}`
}
