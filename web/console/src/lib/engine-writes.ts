// Write and on-demand calls to the engine through the same-origin proxy
// (/api/engine): incidents, the rule tester, suppressions, kill_process
// and reputation lookups. The engine validates everything again; these
// helpers keep the wire shapes in one place and turn every failure into
// a sentence the UI can show inline.

import type { Severity, SfEvent } from './console-types'

function engineApiBase(): string {
  return process.env.NEXT_PUBLIC_ENGINE_API || '/api/engine'
}

export type EngineResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

export async function engineCall<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  timeoutMs = 8000,
): Promise<EngineResult<T>> {
  try {
    const res = await fetch(engineApiBase() + path, {
      method,
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await res.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = null
    }
    if (!res.ok) {
      // the console's own refusals (role, credentials) carry a sentence
      // for the operator in "hint"; engine errors name the problem
      const body = parsed && typeof parsed === 'object' ? (parsed as { error?: unknown; hint?: unknown }) : null
      const message =
        body && (body.error === 'role_forbidden' || body.error === 'console_auth_required') && typeof body.hint === 'string'
          ? body.hint
          : body && 'error' in body
            ? String(body.error)
            : text.trim() || `el motor respondió ${res.status}`
      return { ok: false, status: res.status, error: message }
    }
    return { ok: true, data: parsed as T }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'error de red'
    return { ok: false, status: 0, error: `no se pudo contactar con el motor: ${message}` }
  }
}

// ---- incidents -----------------------------------------------------------

export type IncidentStatus = 'open' | 'investigating' | 'contained' | 'closed'

export type IncidentEntry = {
  at: string
  by?: string
  kind: 'created' | 'status' | 'severity' | 'owner' | 'alerts' | 'note'
  text: string
}

export type Incident = {
  id: string
  title: string
  summary?: string
  severity: Severity
  status: IncidentStatus
  owner?: string
  hosts: string[]
  alert_ids: string[]
  timeline: IncidentEntry[]
  created_at: string
  updated_at: string
  closed_at?: string
}

export const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = {
  open: 'Abierto',
  investigating: 'Investigando',
  contained: 'Contenido',
  closed: 'Cerrado',
}

export function listIncidents() {
  return engineCall<{ incidents: Incident[]; persistent: boolean }>('GET', '/api/incidents')
}

export function createIncident(input: {
  title: string
  summary?: string
  severity?: Severity
  owner?: string
  alert_ids?: string[]
  hosts?: string[]
  by?: string
}) {
  return engineCall<Incident>('POST', '/api/incidents', { by: 'consola', ...input })
}

export function updateIncident(
  id: string,
  patch: Partial<{ title: string; summary: string; severity: Severity; status: IncidentStatus; owner: string }>,
  by = 'consola',
) {
  return engineCall<Incident>('PATCH', `/api/incidents/${id}`, { ...patch, by })
}

export function addIncidentAlerts(id: string, alertIds: string[], hosts: string[] = [], by = 'consola') {
  return engineCall<Incident>('POST', `/api/incidents/${id}/alerts`, { alert_ids: alertIds, hosts, by })
}

export function addIncidentNote(id: string, text: string, by = 'consola') {
  return engineCall<Incident>('POST', `/api/incidents/${id}/notes`, { text, by })
}

// ---- rule tester -----------------------------------------------------------

export type RuleTestMatch = {
  id: string
  name: string
  severity: Severity
  mitre: string
  tactic: string
  tags: string[]
  matched_on: string[]
}

export type RuleTestResult = { event_type: string; evaluated: number; matches: RuleTestMatch[] }

export function testRules(event: Partial<SfEvent> & { type: string }) {
  return engineCall<RuleTestResult>('POST', '/api/rules/test', { event })
}

// ---- suppressions ----------------------------------------------------------

export type SuppressionInput = { rule_id: string; host?: string; reason: string; expires?: string }

export function createSuppression(entry: SuppressionInput) {
  return engineCall<unknown>('POST', '/api/suppressions', entry)
}

export function deleteSuppression(ruleId: string, host = '') {
  const q = new URLSearchParams({ rule_id: ruleId, host })
  return engineCall<unknown>('DELETE', `/api/suppressions?${q}`)
}

/** RFC 3339 expiry `days` from now (UTC, whole seconds). */
export function expiryInDays(days: number, now = Date.now()): string {
  return new Date(now + days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// ---- active response -------------------------------------------------------

export type KillRequest = {
  host: string
  pid: number
  process_name: string
  operator: string
  reason: string
  rule_id?: string
  alert_id?: string
}

export function killProcess(req: KillRequest, operatorToken: string) {
  return engineCall<{ action_id: string; status: string; signal?: string; mechanism?: string }>(
    'POST', '/api/respond/kill', req, { 'X-SF-Operator-Token': operatorToken },
  )
}

// ---- reputation ------------------------------------------------------------

export type ReputationResult = {
  provider: 'virustotal' | 'abuseipdb'
  status: 'ok' | 'not_found' | 'rate_limited' | 'error' | 'unsupported'
  detail?: string
  link?: string
  malicious?: number
  suspicious?: number
  harmless?: number
  undetected?: number
  score?: number
  reports?: number
  country?: string
  owner?: string
  name?: string
}

export type ReputationReport = { indicator: string; kind: 'ip' | 'hash'; results: ReputationResult[]; cached: boolean; at: string }

export function reputationProviders() {
  return engineCall<{ providers: Record<string, boolean> }>('GET', '/api/reputation')
}

export function lookupReputation(kind: 'ip' | 'hash', value: string) {
  return engineCall<ReputationReport>('GET', `/api/reputation?${kind}=${encodeURIComponent(value)}`)
}

/** SHA-256 digests an event carries (process image, written file), lowercase and deduplicated. */
export function eventSha256(ev: Pick<SfEvent, 'process' | 'file'> | undefined): string[] {
  const out = new Set<string>()
  for (const hashes of [ev?.process?.hashes, ev?.file?.hashes]) {
    for (const [algo, value] of Object.entries(hashes ?? {})) {
      const v = String(value).trim().toLowerCase()
      if (algo.toLowerCase() === 'sha256' && /^[0-9a-f]{64}$/.test(v)) out.add(v)
    }
  }
  return [...out]
}

/** A public IPv4 worth sending to a reputation service (private ranges never are). */
export function isPublicIPv4(ip: string | undefined): ip is string {
  if (!ip) return false
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (m.slice(1).some((x) => Number(x) > 255)) return false
  if (a === 10 || a === 127 || a === 0 || a >= 224) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 169 && b === 254) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  return true
}
