// Offline threat intelligence and the per-host baseline as the engine
// reports them (GET /api/intel): the indicator lists the operator placed
// in the intel directory and how many hosts are still learning what is
// normal. Pure helpers plus the fetch.

import { engineCall, type EngineResult } from './engine-writes'
import type { SfAlert } from './console-types'

export type IntelKind = 'ip' | 'cidr' | 'domain' | 'hash'

export type IntelList = {
  name: string
  file: string
  indicators: number
  by_kind: Partial<Record<IntelKind, number>>
  modified: string
  skipped: number
}

export type IntelPayload = {
  enabled: boolean
  dir: string
  total: number
  lists: IntelList[]
  baseline: { enabled: boolean; learn_s: number; hosts: number; learning: number }
}

export const INTEL_KIND_LABEL: Record<IntelKind, string> = { ip: 'IP', cidr: 'Rangos', domain: 'Dominios', hash: 'Hashes' }
const KIND_ORDER: IntelKind[] = ['ip', 'cidr', 'domain', 'hash']

export const INTEL_RULE_PREFIX = 'intel-match-'
export const BASELINE_RULE_ID = 'baseline-new-process'

export function fetchIntel(): Promise<EngineResult<IntelPayload>> {
  return engineCall<IntelPayload>('GET', '/api/intel')
}

/** "IP 120 · Dominios 3" in a fixed order, kinds without indicators left out. */
export function kindBreakdown(list: Pick<IntelList, 'by_kind'>): { kind: IntelKind; label: string; count: number }[] {
  return KIND_ORDER.filter((k) => (list.by_kind[k] ?? 0) > 0).map((k) => ({ kind: k, label: INTEL_KIND_LABEL[k], count: list.by_kind[k] ?? 0 }))
}

/** 86400 -> "24 h", 5400 -> "1 h 30 min", 0 -> "desactivada". */
export function learnText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'desactivada'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (days) parts.push(days === 1 ? '1 día' : `${days} días`)
  if (hours) parts.push(`${hours} h`)
  if (minutes && !days) parts.push(`${minutes} min`)
  if (!parts.length) parts.push(`${seconds} s`)
  return parts.join(' ')
}

/** Alerts raised by the intel lists or the baseline, newest first. */
export function intelAlerts(alerts: readonly SfAlert[], limit = 25): SfAlert[] {
  return alerts
    .filter((a) => a.rule_id.startsWith(INTEL_RULE_PREFIX) || a.rule_id === BASELINE_RULE_ID)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit)
}

/** The list name of an intel alert (intel-match-<list>), or '' for others. */
export function listOfAlert(alert: Pick<SfAlert, 'rule_id'>): string {
  return alert.rule_id.startsWith(INTEL_RULE_PREFIX) ? alert.rule_id.slice(INTEL_RULE_PREFIX.length) : ''
}

// ---- per-host baseline (GET /api/baseline?host=) -------------------------

export type BaselineHost = {
  enabled: boolean
  learn_s: number
  host: string
  known: boolean
  first_seen?: string
  learning: boolean
  learning_until?: string
  processes: string[]
  full: boolean
}

export function fetchBaselineHost(host: string): Promise<EngineResult<BaselineHost>> {
  return engineCall<BaselineHost>('GET', `/api/baseline?host=${encodeURIComponent(host)}`)
}

/** One sentence on where a host stands in its baseline. */
export function baselineStatus(b: BaselineHost, now = new Date()): string {
  if (!b.enabled) return 'Línea base desactivada en el motor (-baseline-learn 0).'
  if (!b.known) return 'El motor todavía no ha visto arrancar procesos en este equipo.'
  if (b.full) return 'Límite de 4096 procesos alcanzado: el equipo ya no aprende nombres nuevos.'
  if (b.learning && b.learning_until) {
    const left = Math.max(0, Math.round((new Date(b.learning_until).getTime() - now.getTime()) / 1000))
    return `Aprendiendo: avisará de procesos nuevos dentro de ${left > 0 ? learnText(left) : 'unos segundos'}.`
  }
  return 'Activa: un proceso que no esté en esta lista genera una alerta baja.'
}

/** Process names filtered by a case-insensitive substring, capped. */
export function filterProcesses(names: readonly string[], query: string, limit = 400): { shown: string[]; total: number } {
  const q = query.trim().toLowerCase()
  const matching = q ? names.filter((n) => n.includes(q)) : [...names]
  return { shown: matching.slice(0, limit), total: matching.length }
}
