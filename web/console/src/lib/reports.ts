// REP-1 report surfaces (engine part A by Implementación A): the catalog
// (GET /api/reports) and one report (GET /api/reports/{kind}) in JSON or
// CSV. The console renders the picker from the catalog — kinds the engine
// cannot compute today simply do not appear — and downloads exactly the
// bytes the engine serves (the CSV carries the engine's own formula
// escaping; the console never re-serializes report data).

import { engineCall, type EngineResult } from './engine-writes'
import { downloadText } from './chart-export'

export type ReportKind = 'executive' | 'incident' | 'fleet' | 'soc'

export type ReportCatalogEntry = {
  kind: string
  title: string
  description: string
  /** accepted query parameters, engine-worded (e.g. "24h | 7d | 30d (default 7d)") */
  params: Record<string, string>
  formats: string[]
}

export type ReportCatalog = { reports: ReportCatalogEntry[] }

export type ReportWindow = { preset: string; from: string; until: string }

/** Envelope every report carries so the console can say where the numbers
 * came from and whether the window is really covered. */
export type ReportEnvelope = {
  kind: string
  generated_at: string
  window?: ReportWindow
  source?: 'store' | 'ring'
  truncated?: boolean
  oldest_record?: string
}

export type ReportRuleCount = { rule_id: string; rule_name: string; count: number }

export type ExecutiveReport = ReportEnvelope & {
  kind: 'executive'
  alerts_total: number
  by_severity: Record<string, number>
  by_status: Record<string, number>
  by_tactic: Record<string, number>
  hosts_affected: number
  top_rules: ReportRuleCount[]
  incidents: { opened_in_window: number; closed_in_window: number; open: number; persistent: boolean }
  fleet: { enabled: boolean; total: number; online: number; silent: number; idle: number }
}

export type FleetCoverageReport = ReportEnvelope & {
  kind: 'fleet'
  enabled: boolean
  summary: { total: number; online: number; silent: number; idle: number; no_signal_in_window: number }
  hosts: {
    host: string
    status: 'online' | 'silent' | 'idle'
    first_seen: string
    last_seen: string
    last_event_type?: string
    events: number
    events_in_window: number
    sensor_version?: string
    identity?: string
  }[]
}

export type SocActivityReport = ReportEnvelope & {
  kind: 'soc'
  created: number
  backlog: { new: number; acknowledged: number; closed: number }
  mean_time_to_ack_seconds: number
  mean_time_to_close_seconds: number
  days: { day: string; created: number; acknowledged: number; closed: number }[]
  by_operator: Record<string, number>
}

export type IncidentReport = ReportEnvelope & {
  kind: 'incident'
  incident: {
    id: string
    title: string
    summary?: string
    severity: string
    status: string
    owner?: string
    hosts: string[]
    created_at: string
    updated_at: string
    closed_at?: string
  }
  alerts: {
    id: string
    rule_id?: string
    rule_name?: string
    severity?: string
    host?: string
    event_type?: string
    timestamp?: string
    summary?: string
    tags?: string[]
    status?: string
    status_at?: string
    status_by?: string
    found: boolean
  }[]
  timeline: { at: string; by?: string; kind: string; text: string }[]
}

export type ReportData = ExecutiveReport | FleetCoverageReport | SocActivityReport | IncidentReport

export const INCIDENT_ID_RE = /^[0-9a-f]{16}$/

export function fetchReportCatalog(): Promise<EngineResult<ReportCatalog>> {
  return engineCall<ReportCatalog>('GET', '/api/reports')
}

export type ReportQuery = { kind: string; window?: string; id?: string }

export function fetchReport(query: ReportQuery): Promise<EngineResult<ReportData>> {
  return engineCall<ReportData>('GET', reportPath(query))
}

/** URL of the report as the engine (via the same-origin proxy) serves it,
 * for downloads that keep the engine's own bytes. */
export function reportPath(query: ReportQuery, format: 'json' | 'csv' = 'json'): string {
  const params = new URLSearchParams()
  if (query.window) params.set('window', query.window)
  if (query.id) params.set('id', query.id)
  if (format !== 'json') params.set('format', format)
  const qs = params.toString()
  return `/api/reports/${encodeURIComponent(query.kind)}${qs ? `?${qs}` : ''}`
}

/** Download one report keeping the engine's bytes: CSV arrives as the
 * engine's text/csv (its escaping) and JSON as pretty text. The anchor
 * wiring is the shared downloadText helper; this wrapper only owns the
 * fetch and turns every failure into a sentence. */
export async function downloadReport(query: ReportQuery, format: 'json' | 'csv'): Promise<{ ok: true; filename: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(reportPath(query, format), { cache: 'no-store', signal: AbortSignal.timeout(15000) })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `el motor respondió ${res.status}${text ? `: ${text.trim().slice(0, 200)}` : ''}` }
    }
    const body = format === 'json' ? JSON.stringify(await res.json(), null, 2) : await res.text()
    const filename = `${query.kind}-${downloadStamp()}.${format}`
    downloadText(body, filename, format === 'json' ? 'application/json' : 'text/csv')
    return { ok: true, filename }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'error de red' }
  }
}

/** UTC stamp for download filenames (no colons: Windows-safe). */
export function downloadStamp(now = new Date()): string {
  return now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

/** Window presets the engine documents for the windowed kinds. */
export const REPORT_WINDOWS = ['24h', '7d', '30d'] as const
export type ReportWindowPreset = (typeof REPORT_WINDOWS)[number]

export function reportWindowPreset(raw: string | null | undefined): ReportWindowPreset {
  return (REPORT_WINDOWS as readonly string[]).includes(raw ?? '') ? (raw as ReportWindowPreset) : '7d'
}
