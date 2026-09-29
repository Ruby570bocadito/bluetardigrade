// Hub state: the single source of truth both the socket.io bus and the
// HTTP status surface read from. It only ever holds real engine data:
// ring buffers of events and alerts, the active rule set, the last
// stats poll and connection counters. There is no simulator and no
// synthetic fallback anywhere in this module.

import type { HubHealth, HubStats, RuleMeta, SfAlert, SfEvent, SfSequence, SfSuppression, SfAlertLifecycle } from './types'
import { analystStatusFromEnv, type AnalystStatus } from './analyst'

export const MAX_EVENTS = 160
export const MAX_ALERTS = 48
// The initial snapshot the console gets after connecting; smaller than
// the ring so the first paint stays light. Part of the existing contract.
export const SNAPSHOT_EVENTS = 120

export type HubMode = 'engine' | 'sin-motor'

export type ConsoleSnapshot = {
  events: SfEvent[]
  alerts: SfAlert[]
  rules: RuleMeta[]
  suppressions?: SfSuppression[]
  sequences?: SfSequence[]
  stats: HubStats
  started_at: string
}

export class HubState {
  readonly startedAtMs = Date.now()

  // Ring buffers, newest first.
  events: SfEvent[] = []
  alerts: SfAlert[] = []
  rules: RuleMeta[] = []
  // Operator allowlist entries, forwarded as-is from the engine
  // (GET /api/suppressions). Cleared when the engine goes down: with no
  // engine there is nothing honest to display, same policy as rings.
  suppressions: SfSuppression[] = []
  // Kill-chain sequences, forwarded as-is from the engine
  // (GET /api/sequences -> correlate.SequenceInfo). Same clearing
  // policy as suppressions: with the engine down there is nothing
  // honest to display.
  sequences: SfSequence[] = []

  mode: HubMode = 'sin-motor'
  engineEndpoint = ''
  lastStats: HubStats | null = null
  lastStatsAtMs = 0
  lastEngineDataAtMs = 0

  clientsConnected = 0
  clientsTotal = 0
  analystAsks = 0

  readonly analystStatus: AnalystStatus

  constructor(env: Record<string, string | undefined> = process.env) {
    this.analystStatus = analystStatusFromEnv(env)
  }

  recordEvent(ev: SfEvent) {
    this.lastEngineDataAtMs = Date.now()
    this.events.unshift(ev)
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS
  }

  recordAlert(al: SfAlert) {
    this.lastEngineDataAtMs = Date.now()
    this.alerts.unshift(al)
    if (this.alerts.length > MAX_ALERTS) this.alerts.length = MAX_ALERTS
  }

  // r6 triage: patch the stored alert in place (the lifecycle frame
  // carries only the status fields) so snapshots stay honest.
  applyLifecycle(entry: SfAlertLifecycle) {
    const al = this.alerts.find((a) => a.id === entry.alert_id)
    if (al) {
      al.status = entry.status
      al.status_note = entry.note
      al.status_by = entry.by
      al.status_at = entry.at
    }
  }

  setRules(rules: RuleMeta[]) {
    this.rules = rules
  }

  setSuppressions(entries: SfSuppression[]) {
    this.suppressions = entries
  }

  setSequences(seqs: SfSequence[]) {
    this.sequences = seqs
  }

  setUp(endpoint: string) {
    this.mode = 'engine'
    this.engineEndpoint = endpoint
  }

  setDown() {
    this.mode = 'sin-motor'
    this.lastStats = null
    this.suppressions = []
    this.sequences = []
  }

  setStats(st: HubStats) {
    this.lastStats = st
    this.lastStatsAtMs = Date.now()
  }

  incClients() {
    this.clientsConnected += 1
    this.clientsTotal += 1
  }

  decClients() {
    this.clientsConnected = Math.max(0, this.clientsConnected - 1)
  }

  stats(): HubStats {
    return this.lastStats ?? offlineStats()
  }

  /** The shape the console has always received on 'console:snapshot'. */
  snapshot(): ConsoleSnapshot {
    // Between onUp and the first stats poll there is a brief window with
    // a connected engine and no numbers yet: report the real mode instead
    // of a stale 'sin-motor' label. No synthetic values either way.
    const stats = this.lastStats ?? { ...offlineStats(), mode: this.mode }
    return {
      events: this.events.slice(0, SNAPSHOT_EVENTS),
      alerts: this.alerts.slice(0, MAX_ALERTS),
      rules: this.rules,
      suppressions: this.suppressions,
      sequences: this.sequences,
      stats,
      // engine session start, derived from the engine's own uptime
      started_at: new Date(Date.now() - stats.uptime_s * 1000).toISOString(),
    }
  }

  health(version: string): HubHealth {
    const now = Date.now()
    const stats = this.stats()
    const engineConnected = this.mode === 'engine'
    return {
      service: 'console-service',
      version,
      status: engineConnected ? 'ok' : 'degraded',
      mode: this.mode,
      started_at: new Date(this.startedAtMs).toISOString(),
      uptime_s: Math.max(0, Math.round((now - this.startedAtMs) / 1000)),
      engine: {
        endpoint: this.engineEndpoint,
        connected: engineConnected,
        uptime_s: stats.uptime_s,
        events_total: stats.events_total,
        alerts_total: stats.alerts_total,
        events_per_min: stats.events_per_min,
        by_severity: stats.by_severity,
        last_stats_age_s:
          this.lastStatsAtMs === 0 ? null : Math.max(0, Math.round((now - this.lastStatsAtMs) / 1000)),
      },
      buffers: {
        events: this.events.length,
        alerts: this.alerts.length,
        max_events: MAX_EVENTS,
        max_alerts: MAX_ALERTS,
      },
      clients: { connected: this.clientsConnected, total: this.clientsTotal },
      rules_loaded: this.rules.length,
      analyst: {
        configured: this.analystStatus.configured,
        missing: this.analystStatus.missing,
        model: this.analystStatus.model,
        base_url: this.analystStatus.baseUrl,
      },
    }
  }
}

function offlineStats(): HubStats {
  return {
    events_total: 0,
    alerts_total: 0,
    by_severity: {},
    events_per_min: 0,
    uptime_s: 0,
    interval_ms: 0,
    mode: 'sin-motor',
    webhook_sent: 0,
    webhook_failed: 0,
    webhook_dropped: 0,
    suppressions_active: 0,
    correlator_states: 0,
    correlator_sequences: 0,
    correlator_cap: 0,
  }
}
