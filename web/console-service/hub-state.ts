// Hub state: what the analyst pipeline and the HTTP status surface read
// from. It only ever holds real engine data: ring buffers of events and
// alerts, the active rule set, the last stats poll and connection
// counters. None of it is pushed to sockets: the rings exist so the
// analyst works on the engine's copy of an alert instead of the
// browser's. There is no simulator and no synthetic fallback anywhere
// in this module.

import type { HubHealth, HubStats, RuleMeta, SfAlert, SfEvent, SfSequence, SfSuppression, SfAlertLifecycle } from './types'
import { analystStatusFromEnv, type AnalystStatus } from './analyst'

export const MAX_EVENTS = 160
export const MAX_ALERTS = 48

export type HubMode = 'engine' | 'sin-motor'

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

  // Both rings are keyed by id: every reconnect replays the engine's
  // recent window, and a record already held must not be stored twice
  // (duplicates would push real entries out of a 160/48-slot ring).
  recordEvent(ev: SfEvent) {
    this.lastEngineDataAtMs = Date.now()
    if (ev.id && this.events.some((e) => e.id === ev.id)) return
    this.events.unshift(ev)
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS
  }

  // A repeated alert replaces the stored copy in place: the replayed one
  // carries the engine's current lifecycle overlay.
  recordAlert(al: SfAlert) {
    this.lastEngineDataAtMs = Date.now()
    const at = al.id ? this.alerts.findIndex((a) => a.id === al.id) : -1
    if (at >= 0) {
      this.alerts[at] = al
      return
    }
    this.alerts.unshift(al)
    if (this.alerts.length > MAX_ALERTS) this.alerts.length = MAX_ALERTS
  }

  // Drops both rings. Called whenever the engine goes away, also when a
  // connection attempt failed halfway (the sync filled the rings and the
  // stream never opened): an engine restarted in between may have lost
  // those records, and the analyst must not answer from a copy the
  // engine no longer holds.
  clearRings() {
    this.events = []
    this.alerts = []
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
    this.clearRings()
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
    elastic_sent: 0,
    elastic_failed: 0,
    elastic_dropped: 0,
    splunk_sent: 0,
    splunk_failed: 0,
    splunk_dropped: 0,
    notify_channels: [],
    suppressions_active: 0,
    correlator_states: 0,
    correlator_sequences: 0,
    correlator_cap: 0,
  }
}
