// Noise report (§2.4, engine endpoint by Implementación A): the
// processes, DNS domains and rules that most generate events or alerts,
// fleet-wide or per host. Read-only aggregation — the console adds the
// tuning affordances (create a suppression for a loud rule; known
// software arrives with v1.1), it never invents aggregates.

import { engineCall, type EngineResult } from './engine-writes'

export type NoiseProcess = {
  /** group key, lowercased executable path (or name) */
  image: string
  count: number
  distinct_hosts: number
  first_seen: string
  last_seen: string
  parent?: string
  /** newest sample, truncated to 200 characters by the engine */
  command_line?: string
  sha256?: string
}

export type NoiseDomain = {
  domain: string
  count: number
  distinct_hosts: number
  first_seen: string
  last_seen: string
}

export type NoiseRule = {
  rule_id: string
  rule_name: string
  count: number
  by_severity?: Record<string, number>
  distinct_hosts: number
  /** triage overlay over the rule's alerts: the engine's honest proxy
   * (current status) until a triage decision field exists */
  acknowledged_pct: number
  closed_pct: number
}

export type NoiseReport = {
  kind: 'noise'
  generated_at: string
  window: { preset: string; from: string; until: string }
  host: string
  source: 'store' | 'ring'
  scanned: { events: number; alerts: number; truncated: boolean }
  processes: NoiseProcess[]
  domains: NoiseDomain[]
  rules: NoiseRule[]
}

/** Noise windows the engine documents: 15m to 30d, default 24h. */
export const NOISE_WINDOWS = ['15m', '1h', '24h', '7d', '30d'] as const
export type NoiseWindow = (typeof NOISE_WINDOWS)[number]

export function noiseWindowPreset(raw: string | null | undefined): NoiseWindow {
  return (NOISE_WINDOWS as readonly string[]).includes(raw ?? '') ? (raw as NoiseWindow) : '24h'
}

export const NOISE_LIMITS = [10, 25, 50] as const

export function noiseLimit(raw: string | null | undefined): number {
  const value = Number(raw)
  return (NOISE_LIMITS as readonly number[]).includes(value) ? value : 10
}

export function fetchNoise(window: NoiseWindow, host = '', limit = 10): Promise<EngineResult<NoiseReport>> {
  const params = new URLSearchParams({ window, limit: String(limit) })
  if (host.trim()) params.set('host', host.trim())
  return engineCall<NoiseReport>('GET', `/api/noise?${params.toString()}`)
}
