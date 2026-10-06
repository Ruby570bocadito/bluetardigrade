// AD-5 — Active Directory directory view (engine `-ad`): typed views over
// the engine's read-only routes (/api/ad/status, /api/ad/objects/{kind},
// /api/ad/posture, /api/ad/posture/history). The surface only exists on an
// engine started with the AD connector armed: a 501 answers with an arming
// hint and this lib surfaces exactly that state — the console never draws
// a directory it did not receive. Engine prose (finding titles,
// descriptions, remediations) travels verbatim: it is data, not chrome.

import { engineCall, type EngineResult } from './engine-writes'

export type ADObjectsCounts = { users: number; groups: number; computers: number; ous: number }

export type ADStatus = {
  connected: boolean
  last_sync_at: string | null
  last_success_at: string | null
  next_sync_at: string | null
  last_error: string
  truncated: boolean
  syncs: number
  objects: ADObjectsCounts
  warnings: string[]
}

/** Object kinds the engine's snapshot API documents (501 while unarmed). */
export const AD_KINDS = ['user', 'group', 'computer', 'ou'] as const
export type ADKind = (typeof AD_KINDS)[number]

export function adKind(raw: string | null | undefined): ADKind {
  return (AD_KINDS as readonly string[]).includes(raw ?? '') ? (raw as ADKind) : 'user'
}

export type ADObject = {
  dn: string
  kind: string
  name: string
  sid?: string
  user_account_control: number
  admin_count: number
  pwd_last_set_unix: number
  last_logon_unix: number
  spn_count: number
  enc_types: number
  os?: string
  when_changed_unix: number
  attributes?: Record<string, string>
}

export type ADObjectsPage = { total: number; offset: number; objects: ADObject[] }

export type ADAffectedObject = { dn: string; name?: string; detail?: string }

export type ADFinding = {
  id: string
  title: string
  severity: string
  description: string
  remediation: string
  count: number
  objects: ADAffectedObject[]
  objects_truncated: boolean
}

export type ADPosture = {
  /** false while the connector is armed but no sync completed yet */
  ready: boolean
  /** RFC 3339 of the frozen analysis, "" while not ready */
  generated_at: string
  score: number | null
  /** severity -> finding-class count */
  summary: Record<string, number>
  findings: ADFinding[]
  objects_checked: number
  /** configured stale-account threshold (the engine serves the real one) */
  inactive_days: number
  krbtgt_max_age_days: number
}

export type ADPosturePoint = { at: number; score: number }

export function fetchADStatus(): Promise<EngineResult<ADStatus>> {
  return engineCall<ADStatus>('GET', '/api/ad/status')
}

export function fetchADPosture(): Promise<EngineResult<ADPosture>> {
  return engineCall<ADPosture>('GET', '/api/ad/posture')
}

/** One point per completed sync, oldest first, capped by the engine at 500. */
export function fetchADPostureHistory(limit = 100): Promise<EngineResult<{ points: ADPosturePoint[] }>> {
  return engineCall<{ points: ADPosturePoint[] }>('GET', `/api/ad/posture/history?limit=${limit}`)
}

/** One page of one kind. The query runs against the engine's LOCAL
 * snapshot (never LDAP), so operator input carries no injection surface. */
export function fetchADObjects(kind: ADKind, q: string, limit: number, offset: number): Promise<EngineResult<ADObjectsPage>> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (q.trim()) params.set('q', q.trim())
  return engineCall<ADObjectsPage>('GET', `/api/ad/objects/${kind}?${params.toString()}`)
}

/** Page sizes the explorer offers (the engine caps a page at 500). */
export const AD_PAGE_SIZES = [25, 50, 100] as const
export const AD_DEFAULT_PAGE_SIZE = 50

export function adPageSize(raw: number): number {
  return (AD_PAGE_SIZES as readonly number[]).includes(raw) ? raw : AD_DEFAULT_PAGE_SIZE
}

// ─── userAccountControl bits the users table annotates ─────────────────
// The analysis lives in the engine; these flags only label what the
// snapshot already carries, so the table never re-derives a posture.
export const UAC_DISABLED = 0x2
export const UAC_DONT_EXPIRE_PASSWORD = 0x10000
export const UAC_TRUSTED_FOR_DELEGATION = 0x80000
export const UAC_DONT_REQUIRE_PREAUTH = 0x400000

export const UAC_FLAG_LABELS: { bit: number; label: string }[] = [
  { bit: UAC_DISABLED, label: 'deshabilitada' },
  { bit: UAC_DONT_EXPIRE_PASSWORD, label: 'sin caducidad' },
  { bit: UAC_TRUSTED_FOR_DELEGATION, label: 'delegación' },
  { bit: UAC_DONT_REQUIRE_PREAUTH, label: 'sin preauth' },
]

/** Spanish labels of the UAC bits the console annotates, in stable order. */
export function uacFlagLabels(uac: number): string[] {
  return UAC_FLAG_LABELS.filter((f) => (uac & f.bit) !== 0).map((f) => f.label)
}

// ─── donut + coverage derivations (pure, tested) ────────────────────────

export const AD_SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'] as const

export const AD_SEVERITY_LABELS: Record<string, string> = {
  critical: 'crítica',
  high: 'alta',
  medium: 'media',
  low: 'baja',
}

/** Donut entries (findings by severity), engine order, zero rows dropped. */
export function severityEntries(summary: Record<string, number>): { key: string; label: string; value: number }[] {
  return AD_SEVERITY_ORDER
    .map((sev) => ({ key: sev, label: AD_SEVERITY_LABELS[sev] ?? sev, value: summary[sev] ?? 0 }))
    .filter((e) => e.value > 0)
}

/** The finding id the engine uses for domain coverage (AD-5). */
export const COVERAGE_FINDING_ID = 'computers_without_sensor'
/** The finding id listing effective privileged members (paths included). */
export const PRIVILEGED_FINDING_ID = 'privileged_effective_members'

export function findingById(findings: ADFinding[], id: string): ADFinding | undefined {
  return findings.find((f) => f.id === id)
}

export type ADCoverage = {
  /** enabled domain computers the engine found WITHOUT a sensor */
  withoutSensor: number
  /** computers in the last completed snapshot (the directory's view) */
  inDirectory: number
  /** hosts reporting to the engine right now (fleet stats) */
  withSensor: number | null
  objects: ADAffectedObject[]
  truncated: boolean
}

/**
 * Coverage triple for AD-5 («equipos del dominio frente a equipos con
 * sensor»). Every number is engine-published: the finding count, the
 * snapshot counts and the fleet's live host count. withSensor stays null
 * when the fleet stat is absent (sin-motor mode) — no difference is
 * invented from partial data.
 */
export function coverageFrom(
  findings: ADFinding[],
  objects: ADObjectsCounts | undefined,
  fleetHosts: number | null,
): ADCoverage | null {
  const f = findingById(findings, COVERAGE_FINDING_ID)
  if (!f || !objects) return null
  return {
    withoutSensor: f.count,
    inDirectory: objects.computers,
    withSensor: typeof fleetHosts === 'number' ? fleetHosts : null,
    objects: f.objects,
    truncated: f.objects_truncated,
  }
}

/** Score → meter hue: the same three bands the console uses for risk,
 * reversed (a high posture score is good). Pure thresholds, no invention. */
export function scoreTone(score: number): 'ok' | 'warn' | 'bad' {
  return score >= 80 ? 'ok' : score >= 50 ? 'warn' : 'bad'
}
