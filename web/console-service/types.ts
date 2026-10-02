// Shared JSON contracts between the Go engine (pkg/model, internal/alert),
// the EngineBridge and the web console. Types only: no behavior, no data.

export type SfEvent = {
  id: string
  timestamp: string
  type: string
  source: string
  attributes?: Record<string, string>
  host: string
  user?: string
  process?: {
    pid: number
    ppid?: number
    name: string
    command_line?: string
    image?: string
  }
  file?: {
    path: string
    extension?: string
    size_bytes?: number
  }
  network?: {
    protocol?: string
    source_ip?: string
    source_port?: number
    destination_ip?: string
    destination_port?: number
    domain?: string
  }
  tags?: string[]
  enrichment?: Record<string, string>
}

export type SfAlert = {
  id: string
  timestamp: string
  rule_id: string
  rule_name: string
  severity: 'high' | 'critical' | 'medium' | 'low' | 'info'
  host: string
  user?: string
  event_id: string
  event_type: string
  source?: string
  attributes?: Record<string, string>
  network?: SfEvent['network']
  actions?: string[]
  enrichment?: Record<string, string>
  summary: string
  // engine-side fields: the engine renders rule messages (internal/actions)
  // and the notify flag; alerts without an alert action leave them unset
  message?: string
  notify?: boolean
  matched_on: string[]
  tags: string[]
  // lifecycle overlay (r6): merged by GET /api/alerts read-side, and
  // updated live through the `alert_lifecycle` SSE frame. undefined on
  // an alert that just arrived means "new".
  status?: 'new' | 'acknowledged' | 'closed'
  status_note?: string
  status_by?: string
  status_at?: string
}

// One lifecycle record as the engine stores and broadcasts it
// (POST /api/alerts/{id}/status response and `alert_lifecycle` frame).
export type SfAlertLifecycle = {
  alert_id: string
  status: 'new' | 'acknowledged' | 'closed'
  note?: string
  by?: string
  at: string
}

export type RuleMeta = {
  id: string
  name: string
  description: string
  severity: SfAlert['severity']
  event_type: string
  mitre: string
  tactic: string
  tags: string[]
  conditions: { field: string; operator: string; value: string | string[] }[]
}

// One operator allowlist entry as the engine serves it
// (GET /api/suppressions -> suppress.Entry). rule_id and host are exact
// matches; an empty host means every host. expires is the raw RFC 3339
// string from suppressions.yaml ('' = no expiration).
export type SfSuppression = {
  rule_id: string
  host?: string
  reason?: string
  expires?: string
}

// One kill-chain sequence as the engine serves it
// (GET /api/sequences -> correlate.SequenceInfo). Steps are listed in
// declared order for display; matching itself is unordered.
export type SfSequence = {
  id: string
  name: string
  description: string
  severity: SfAlert['severity']
  window_seconds: number
  tags: string[]
  steps: string[]
}

// The hub has exactly two modes: forwarding the real engine, or having
// nothing to show. There is no simulation mode anywhere in this service.
export type HubStats = {
  events_total: number
  alerts_total: number
  by_severity: Record<string, number>
  events_per_min: number
  uptime_s: number
  interval_ms: number
  mode: 'engine' | 'sin-motor'
  // webhook delivery counters from the engine (-webhook flag); all
  // zero means the connector is disabled or has not delivered anything
  webhook_sent: number
  webhook_failed: number
  webhook_dropped: number
  // non-expired operator suppression entries (suppressions.yaml)
  suppressions_active: number
  // kill-chain correlator observability (engine sequences/): in-flight
  // (sequence, host) chains, loaded sequences and the tracking cap.
  // All zero = correlator off (no sequences/ directory found).
  correlator_states: number
  correlator_sequences: number
  correlator_cap: number
  // optional SQLite persistence (-store): present since the store landed
  store_enabled?: boolean
  store_write_failures?: number
  // event ids re-sent with different content (first copy kept)
  store_id_conflicts?: number
  store_events?: number
  store_alerts?: number
  // per-host risk scoring (engine A1): width of the signal (how many
  // hosts carry non-cold risk) + top-5 decayed scores, forwarded since
  // the risk round. Sanitized by the bridge: malformed rows are dropped.
  risk_hosts_tracked?: number
  hot_hosts?: HotHost[]
  // beaconing detector observability (engine A3): live (profile, host,
  // destination) keys, tracking cap and beacons fired since startup.
  // All zero = detector off (engine without -beacons); the OpenAPI Stats
  // schema documents the trio.
  beacons_tracked?: number
  beacons_cap?: number
  beacons_fired?: number
  // volumetric threshold detector observability (engine A2): loaded
  // definitions, live aggregation keys and threshold alerts fired. All
  // zero = detector off (missing -thresholds file); documented trio in
  // the OpenAPI Stats schema.
  threshold_rules?: number
  threshold_keys?: number
  threshold_fired?: number
}

// One entry of the engine's hot_hosts list (package A1 of the owner's
// roadmap): a triage-prioritization signal, not a compromise verdict.
export type HotHost = {
  host: string
  score: number
  alerts: number
  last_seen: string
}

// Machine-readable status of the hub itself, served at GET /health (and
// GET /healthz). Purely additive: the console keeps consuming the same
// socket.io events as before and never needs to call this.
export type HubHealth = {
  service: 'console-service'
  version: string
  // 'ok' with the engine attached; 'degraded' when the hub process is
  // healthy but the telemetry source is unreachable (no data, no
  // simulation: the console shows empty states until it comes back).
  status: 'ok' | 'degraded'
  mode: 'engine' | 'sin-motor'
  started_at: string
  uptime_s: number
  engine: {
    endpoint: string
    connected: boolean
    uptime_s: number
    events_total: number
    alerts_total: number
    events_per_min: number
    by_severity: Record<string, number>
    // seconds since the last /api/stats poll succeeded; null when the
    // engine has never answered
    last_stats_age_s: number | null
  }
  buffers: { events: number; alerts: number; max_events: number; max_alerts: number }
  clients: { connected: number; total: number }
  rules_loaded: number
  // Analyst configuration state. Never includes the API key: the health
  // payload can end up in logs, screenshots and monitoring systems.
  analyst: { configured: boolean; missing: string[]; model: string; base_url: string }
}
