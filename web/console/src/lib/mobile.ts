// The phone view (app/movil, F3): what an on-call analyst needs from a
// small screen — the open alerts worth waking up for, the open
// incidents and the machines that went quiet — and nothing that needs a
// wide table. Pure helpers; the view (mobile-console.tsx) only renders,
// and every write goes through the same lifecycle route as the full
// console.

import type { Incident } from './engine-writes'
import type { FleetHost, FleetPayload } from './fleet'
import type { Severity, SfAlert } from './console-types'

export type MobileFloor = 'critical' | 'high' | 'all'

const RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }

/** Cap of cards on the phone: past it, the full console. */
export const MOBILE_MAX_ITEMS = 50

const floorRank = (floor: MobileFloor) => (floor === 'critical' ? RANK.critical : floor === 'high' ? RANK.high : RANK.info)

/**
 * The alerts the phone shows: not closed, at or above the floor, the
 * most severe first and, inside a severity, the newest first. Alerts
 * without an id cannot be triaged and are left out.
 */
export function mobileQueue(alerts: SfAlert[], floor: MobileFloor): SfAlert[] {
  const min = floorRank(floor)
  return alerts
    .filter((a) => a.id && a.status !== 'closed' && (RANK[a.severity] ?? 0) >= min)
    .sort((a, b) => (RANK[b.severity] ?? 0) - (RANK[a.severity] ?? 0) || Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, MOBILE_MAX_ITEMS)
}

/** Counts per floor for the chips, over the open alerts. */
export function mobileCounts(alerts: SfAlert[]): Record<MobileFloor, number> {
  const open = alerts.filter((a) => a.id && a.status !== 'closed')
  return {
    critical: open.filter((a) => a.severity === 'critical').length,
    high: open.filter((a) => RANK[a.severity] >= RANK.high).length,
    all: open.length,
  }
}

/** Incidents still being worked, most severe and most recently touched first. */
export function openIncidents(incidents: Incident[]): Incident[] {
  return incidents
    .filter((i) => i.status !== 'closed')
    .sort((a, b) => (RANK[b.severity] ?? 0) - (RANK[a.severity] ?? 0) || Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .slice(0, MOBILE_MAX_ITEMS)
}

const STATUS_RANK: Record<FleetHost['status'], number> = { silent: 2, idle: 1, online: 0 }

/** Machines needing a look first (silent, then idle), each group by name. */
export function hostsByAttention(fleet: FleetPayload | null): FleetHost[] {
  if (!fleet) return []
  return [...fleet.hosts]
    .sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || a.host.localeCompare(b.host))
    .slice(0, MOBILE_MAX_ITEMS)
}

/** The full console, opened on the record the phone was looking at. */
export function fullConsoleHref(kind: 'alert' | 'incident' | 'host', id: string): string {
  const q = new URLSearchParams()
  if (kind === 'alert') {
    q.set('view', 'alertas')
    q.set('alert', id)
  } else if (kind === 'incident') {
    q.set('view', 'incidentes')
    q.set('incidente', id)
  } else {
    q.set('view', 'equipos')
    q.set('host', id)
  }
  return '/?' + q.toString()
}
