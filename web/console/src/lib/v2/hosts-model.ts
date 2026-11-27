// v2 · Equipos: the pure part of the section. One row per machine the
// console knows of — the engine's inventory, its risk scores and the
// alerts and events in memory — and the lenses built from those rows:
// the summary, the risk map, the heartbeats against the engine's own
// silence rule, the groups board, the relationships between machines,
// the process baseline and the sensor's health. Nothing is invented: a
// machine the inventory does not list has no status, a sensor that sent
// no heartbeat has no health, a relationship needs a real connection.

import type { HotHost, Severity, SfAlert, SfEvent } from '@/lib/console-types'
import type { FleetHost, FleetPayload, FleetSensor, FleetStatus, YaraStatus } from '@/lib/fleet'
import type { HostGroup, HostGroupsPayload } from '@/lib/host-groups'
import type { BaselineHost } from '@/lib/intel'

export type HostStatus = FleetStatus | 'unknown'

export type HostRow = {
  host: string
  status: HostStatus
  firstSeen?: string
  lastSeen?: string
  events: number
  events5m: number
  groups: string[]
  identity?: string
  peers: string[]
  sensor?: FleetSensor
  silentSince?: string
  /** the engine's decayed risk score; null when the engine does not track the machine */
  risk: number | null
  /** alerts still open (new or acknowledged) among those in memory */
  openAlerts: number
  worst: Severity | null
  inFleet: boolean
}

const SEV_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }

const lower = (s: string) => s.toLowerCase()

/**
 * Every machine the console knows of, by name: the inventory first, then
 * machines only seen in risk scores, alerts or events (they have no status
 * of their own: the inventory never heard from them).
 */
export function hostRows(
  fleet: FleetPayload | null,
  hot: readonly HotHost[],
  alerts: readonly SfAlert[],
  events: readonly SfEvent[],
): HostRow[] {
  const rows = new Map<string, HostRow>()
  const blank = (host: string): HostRow => ({
    host, status: 'unknown', events: 0, events5m: 0, groups: [], peers: [], risk: null, openAlerts: 0, worst: null, inFleet: false,
  })
  for (const h of fleet?.hosts ?? []) {
    rows.set(lower(h.host), {
      host: h.host, status: h.status, firstSeen: h.first_seen, lastSeen: h.last_seen, events: h.events, events5m: h.events_last_5m,
      groups: h.groups ?? [], identity: h.identity, peers: h.peers ?? [], sensor: h.sensor, silentSince: h.silent_since,
      risk: null, openAlerts: 0, worst: null, inFleet: true,
    })
  }
  const row = (host: string) => {
    const key = lower(host)
    let r = rows.get(key)
    if (!r) {
      r = blank(host)
      rows.set(key, r)
    }
    return r
  }
  for (const h of hot) row(h.host).risk = h.score
  for (const a of alerts) {
    if (!a.host) continue
    const r = row(a.host)
    if (a.status === 'closed') continue
    r.openAlerts++
    if (!r.worst || SEV_RANK[a.severity] > SEV_RANK[r.worst]) r.worst = a.severity
  }
  for (const e of events) {
    if (!e.host) continue
    const r = row(e.host)
    if (!r.inFleet) {
      r.events++
      if (!r.lastSeen || e.timestamp > r.lastSeen) r.lastSeen = e.timestamp
      if (!r.firstSeen || e.timestamp < r.firstSeen) r.firstSeen = e.timestamp
    }
  }
  return [...rows.values()].sort(byAttention)
}

const STATUS_RANK: Record<HostStatus, number> = { silent: 0, online: 1, idle: 2, unknown: 3 }

/** Silent machines first, then the riskiest, then by name. */
export function byAttention(a: HostRow, b: HostRow): number {
  return STATUS_RANK[a.status] - STATUS_RANK[b.status] || (b.risk ?? -1) - (a.risk ?? -1) || a.host.localeCompare(b.host)
}

export type FleetSummary = { total: number; online: number; silent: number; idle: number; unknown: number; outdated: number; atRisk: number }

export function fleetSummary(rows: readonly HostRow[], engineVersion: string | null | undefined): FleetSummary {
  const s: FleetSummary = { total: rows.length, online: 0, silent: 0, idle: 0, unknown: 0, outdated: 0, atRisk: 0 }
  for (const r of rows) {
    s[r.status]++
    if (engineVersion && r.sensor?.version && r.sensor.version !== engineVersion) s.outdated++
    if (riskLevel(r.risk, rows) === 'high') s.atRisk++
  }
  return s
}

// ---------- filters and URL ----------

export const HOST_VIEWS = ['inventario', 'riesgo', 'silenciosos', 'grupos', 'relaciones', 'alta'] as const
export type HostsView = (typeof HOST_VIEWS)[number]
export function hostsViewFromParam(v: string | null): HostsView {
  return (HOST_VIEWS as readonly string[]).includes(v ?? '') ? (v as HostsView) : 'inventario'
}

export const HOST_TABS = ['resumen', 'alertas', 'procesos', 'red', 'linea-base', 'sensor'] as const
export type HostTab = (typeof HOST_TABS)[number]
export function hostTabFromParam(v: string | null): HostTab {
  return (HOST_TABS as readonly string[]).includes(v ?? '') ? (v as HostTab) : 'resumen'
}

export type StatusFilter = 'all' | HostStatus
export function statusFilterFromParam(v: string | null): StatusFilter {
  return v === 'online' || v === 'silent' || v === 'idle' || v === 'unknown' ? v : 'all'
}

/** The group a filter means: a group name, '' for machines in none, null for all. */
export function filterRows(rows: readonly HostRow[], f: { q: string; status: StatusFilter; group: string | null }): HostRow[] {
  const q = f.q.trim().toLowerCase()
  return rows.filter(
    (r) =>
      (f.status === 'all' || r.status === f.status) &&
      (f.group === null || (f.group === '' ? r.groups.length === 0 : r.groups.includes(f.group))) &&
      (!q || [r.host, r.identity, r.sensor?.os, r.sensor?.version, ...r.groups].some((v) => !!v && v.toLowerCase().includes(q))),
  )
}

/** The v2 Equipos page on one of its views. */
export function v2HostsLink(view: HostsView = 'inventario'): string {
  return view === 'inventario' ? '/v2/equipos' : `/v2/equipos?vista=${view}`
}

/** The v2 Equipos page with one machine open. */
export function v2HostLink(host: string, tab: HostTab = 'resumen'): string {
  return `/v2/equipos?equipo=${encodeURIComponent(host)}${tab === 'resumen' ? '' : `&pestana=${tab}`}`
}

// ---------- risk ----------

export type RiskLevel = 'none' | 'low' | 'medium' | 'high'

/**
 * How hot a machine is next to the rest. The engine's score has no fixed
 * ceiling (it decays with time), so the level is relative to the hottest
 * machine shown, and a score that is practically nothing is no risk.
 */
export function riskLevel(score: number | null, rows: readonly Pick<HostRow, 'risk'>[]): RiskLevel {
  if (score === null || score < 0.5) return 'none'
  const max = Math.max(...rows.map((r) => r.risk ?? 0), score)
  const f = score / max
  return f >= 0.66 ? 'high' : f >= 0.33 ? 'medium' : 'low'
}

export type RiskGroup = { group: string | null; rows: HostRow[] }

/** Machines grouped by their first group (null: in none), the riskiest first in each. */
export function riskGroups(rows: readonly HostRow[], groupOrder: readonly string[]): RiskGroup[] {
  const by = new Map<string | null, HostRow[]>()
  for (const r of rows) {
    const g = r.groups[0] ?? null
    by.set(g, [...(by.get(g) ?? []), r])
  }
  const order = [...groupOrder.filter((g) => by.has(g)), ...[...by.keys()].filter((g): g is string => g !== null && !groupOrder.includes(g)).sort()]
  const out: RiskGroup[] = order.map((g) => ({ group: g, rows: by.get(g)! }))
  if (by.has(null)) out.push({ group: null, rows: by.get(null)! })
  for (const g of out) g.rows.sort((a, b) => (b.risk ?? -1) - (a.risk ?? -1) || a.host.localeCompare(b.host))
  return out
}

// ---------- heartbeats (the engine's silence rule) ----------

/** How long a sensor may stay quiet before the engine calls it silent: 3 intervals, at least the engine's minimum. */
export function graceSeconds(intervalS: number, minGraceS: number): number {
  return Math.max(3 * Math.max(0, intervalS), minGraceS)
}

export type HeartbeatBar = { host: string; ageS: number; graceS: number; intervalS: number; status: HostStatus; lastHeartbeat: string; past: boolean }

/** Machines whose sensor reports heartbeats, the quietest first. Machines without a sensor are not judged. */
export function heartbeatBars(rows: readonly HostRow[], now: number, minGraceS: number): HeartbeatBar[] {
  const out: HeartbeatBar[] = []
  for (const r of rows) {
    const s = r.sensor
    if (!s?.last_heartbeat) continue
    const t = Date.parse(s.last_heartbeat)
    if (!Number.isFinite(t)) continue
    const ageS = Math.max(0, (now - t) / 1000)
    const graceS = graceSeconds(s.interval_s, minGraceS)
    out.push({ host: r.host, ageS, graceS, intervalS: s.interval_s, status: r.status, lastHeartbeat: s.last_heartbeat, past: ageS > graceS })
  }
  return out.sort((a, b) => b.ageS / b.graceS - a.ageS / a.graceS || a.host.localeCompare(b.host))
}

// ---------- the sensor ----------

export type SensorHealth = {
  versionState: 'match' | 'outdated' | 'unknown'
  queueUse: number | null
  heartbeatAgeS: number | null
  yara: 'match' | 'stale' | 'no-report' | 'unavailable'
}

/** The sensor next to its engine: same build, how full its queue is, how long since it spoke, same YARA pack. */
export function sensorHealth(sensor: FleetSensor, engineVersion: string | null | undefined, yara: Pick<YaraStatus, 'enabled' | 'sha16'> | null, now: number): SensorHealth {
  const t = Date.parse(sensor.last_heartbeat)
  return {
    versionState: !engineVersion || !sensor.version ? 'unknown' : sensor.version === engineVersion ? 'match' : 'outdated',
    queueUse: sensor.queue_cap ? Math.min(1, sensor.spooled / sensor.queue_cap) : null,
    heartbeatAgeS: Number.isFinite(t) ? Math.max(0, (now - t) / 1000) : null,
    yara: !yara?.enabled || !yara.sha16 ? 'unavailable' : !sensor.yara_rules_sha ? 'no-report' : sensor.yara_rules_sha === yara.sha16 ? 'match' : 'stale',
  }
}

// ---------- the process baseline ----------

export type BaselineView = {
  learning: boolean
  /** 0..1 of the learning window gone, while learning */
  progress: number | null
  daysDone: number | null
  daysTotal: number | null
  /** the names the engine treats as normal, with how many process starts of each the loaded events hold */
  processes: { name: string; starts: number }[]
  novelties: SfAlert[]
}

export const BASELINE_RULE = 'baseline-new-process'

export function baselineView(b: BaselineHost, host: string, events: readonly SfEvent[], alerts: readonly SfAlert[], now: number): BaselineView {
  const starts = new Map<string, number>()
  for (const e of events) {
    if (lower(e.host) !== lower(host) || e.type !== 'process.create' || !e.process?.name) continue
    const n = lower(e.process.name)
    starts.set(n, (starts.get(n) ?? 0) + 1)
  }
  const from = b.first_seen ? Date.parse(b.first_seen) : NaN
  const until = b.learning_until ? Date.parse(b.learning_until) : NaN
  const span = until - from
  const progress = b.learning && Number.isFinite(span) && span > 0 ? Math.min(1, Math.max(0, (now - from) / span)) : null
  const day = 86_400_000
  return {
    learning: b.learning,
    progress,
    daysDone: progress !== null ? Math.floor((now - from) / day) : null,
    daysTotal: Number.isFinite(span) && span > 0 ? Math.round(span / day) : b.learn_s ? Math.round(b.learn_s / 86400) : null,
    processes: b.processes
      .map((name) => ({ name, starts: starts.get(lower(name)) ?? 0 }))
      .sort((a, b2) => b2.starts - a.starts || a.name.localeCompare(b2.name)),
    novelties: alerts
      .filter((a) => a.rule_id === BASELINE_RULE && lower(a.host) === lower(host))
      .sort((a, b2) => b2.timestamp.localeCompare(a.timestamp)),
  }
}

// ---------- relationships between machines ----------

export type RelNode = { id: string; label: string; kind: 'host' | 'external'; risk: number | null }
export type RelEdge = { from: string; to: string; connections: number; ports: number[]; alerted: boolean }

const PRIVATE = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/

/**
 * Who talks to whom, from the connections in memory. A destination is a
 * machine of the fleet when it is the address that machine's sensor
 * connects from (the inventory's peers); other private addresses are left
 * out (unknown machines), public ones are outside destinations. An edge
 * is alerted when an alert of the source names that destination or fired
 * on one of its connections.
 */
export function relations(rows: readonly HostRow[], events: readonly SfEvent[], alerts: readonly SfAlert[], maxExternal = 8): { nodes: RelNode[]; edges: RelEdge[] } {
  const byIp = new Map<string, string>()
  for (const r of rows) for (const p of r.peers) if (p && !p.startsWith('127.')) byIp.set(p.split(':')[0], r.host)
  const known = new Map(rows.map((r) => [lower(r.host), r]))
  const alertedDst = new Set<string>()
  const alertedEvents = new Set<string>()
  for (const a of alerts) {
    if (a.network?.destination_ip) alertedDst.add(`${lower(a.host)}|${a.network.destination_ip}`)
    alertedEvents.add(a.event_id)
  }
  const edges = new Map<string, RelEdge>()
  const external = new Map<string, number>()
  for (const e of events) {
    const ip = e.network?.destination_ip
    if (!ip || !e.host || e.type !== 'network.connect') continue
    const internal = byIp.get(ip)
    let to: string
    if (internal) {
      if (lower(internal) === lower(e.host)) continue
      to = `host:${lower(internal)}`
    } else if (PRIVATE.test(ip)) continue
    else {
      to = `ext:${ip}`
      external.set(ip, (external.get(ip) ?? 0) + 1)
    }
    const key = `host:${lower(e.host)}>${to}`
    const edge = edges.get(key) ?? { from: `host:${lower(e.host)}`, to, connections: 0, ports: [], alerted: false }
    edge.connections++
    const port = e.network?.destination_port
    if (port && !edge.ports.includes(port)) edge.ports.push(port)
    if (alertedEvents.has(e.id) || alertedDst.has(`${lower(e.host)}|${ip}`)) edge.alerted = true
    edges.set(key, edge)
  }
  // only the busiest outside destinations, so the drawing stays readable
  const keepExt = new Set([...external.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxExternal).map(([ip]) => `ext:${ip}`))
  const kept = [...edges.values()].filter((e) => !e.to.startsWith('ext:') || keepExt.has(e.to))
  const ids = new Set(kept.flatMap((e) => [e.from, e.to]))
  const nodes: RelNode[] = [...ids].map((id) => {
    if (id.startsWith('ext:')) return { id, label: id.slice(4), kind: 'external' as const, risk: null }
    const r = known.get(id.slice(5))
    return { id, label: r?.host ?? id.slice(5), kind: 'host' as const, risk: r?.risk ?? null }
  })
  return { nodes: nodes.sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'host' ? -1 : 1)), edges: kept }
}

// ---------- groups ----------

export type GroupColumn = { name: string | null; label: string; members: string[] }

/** One column per group with the machines it holds, and one for those in none. */
export function groupColumns(payload: HostGroupsPayload, rows: readonly HostRow[], noneLabel: string): GroupColumn[] {
  const cols: GroupColumn[] = payload.groups.map((g) => ({ name: g.name, label: g.label || g.name, members: [...g.members].sort() }))
  const grouped = new Set(payload.groups.flatMap((g) => g.members.map(lower)))
  const none = new Set(payload.ungrouped)
  for (const r of rows) if (!grouped.has(lower(r.host))) none.add(r.host)
  cols.push({ name: null, label: noneLabel, members: [...none].sort() })
  return cols
}

const escapeGlob = (s: string) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')

/** Does a host-name pattern (* any text, ? one character, any case) match the name? */
export function patternMatches(pattern: string, host: string): boolean {
  const re = new RegExp(`^${escapeGlob(pattern).replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i')
  return re.test(host)
}

export type MoveResult = { groups: HostGroup[]; stillIn: string[] }

/**
 * Moves a machine between groups the only way the engine's file allows:
 * its exact name joins the target's patterns and leaves the source's.
 * When the source still holds it through a wider pattern, an AD OU or an
 * identity, that group is named in `stillIn` (nothing else is touched).
 */
export function moveHost(groups: readonly HostGroup[], host: string, from: string | null, to: string | null): MoveResult {
  const next = groups.map((g) => ({ ...g, hosts: [...g.hosts], ad_ou: [...g.ad_ou], identities: [...g.identities] }))
  const stillIn: string[] = []
  if (from !== null) {
    const src = next.find((g) => g.name === from)
    if (src) {
      src.hosts = src.hosts.filter((p) => lower(p) !== lower(host))
      if (src.hosts.some((p) => patternMatches(p, host)) || src.ad_ou.length > 0 || src.identities.length > 0) stillIn.push(src.name)
    }
  }
  if (to !== null) {
    const dst = next.find((g) => g.name === to)
    if (dst && !dst.hosts.some((p) => patternMatches(p, host))) dst.hosts.push(host)
  }
  return { groups: next, stillIn }
}

/** The editable part of a group, as the engine's settings endpoint takes it. */
export function plainGroups(payload: HostGroupsPayload): HostGroup[] {
  return payload.groups.map(({ name, label, hosts, ad_ou, identities }) => ({ name, label, hosts, ad_ou, identities }))
}

// ---------- events of one machine ----------

/** Events in the last `windowMs` of one machine as `buckets` counts, oldest first (a sparkline). */
export function activitySeries(events: readonly SfEvent[], host: string, now: number, windowMs = 30 * 60_000, buckets = 12): number[] {
  const out = new Array<number>(buckets).fill(0)
  const from = now - windowMs
  for (const e of events) {
    if (lower(e.host) !== lower(host)) continue
    const t = Date.parse(e.timestamp)
    if (!Number.isFinite(t) || t < from || t > now) continue
    out[Math.min(buckets - 1, Math.floor(((t - from) / windowMs) * buckets))]++
  }
  return out
}

/** The open alerts of one machine by severity. */
export function alertsBySeverity(alerts: readonly SfAlert[], host: string): Record<Severity, number> {
  const out: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  for (const a of alerts) if (lower(a.host) === lower(host) && a.status !== 'closed') out[a.severity]++
  return out
}

export type { FleetHost }
