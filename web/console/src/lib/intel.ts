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
