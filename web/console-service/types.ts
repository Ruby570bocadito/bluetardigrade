// Shared JSON contracts between the Go engine (pkg/model, internal/alert),
// the EngineBridge and the web console. Types only: no behavior, no data.

export type SfEvent = {
  id: string
  timestamp: string
  type: string
  source: string
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
  severity: 'high' | 'critical' | 'medium' | 'low'
  host: string
  user?: string
  event_id: string
  event_type: string
  summary: string
  // engine-side fields: the engine renders rule messages (internal/actions)
  // and the notify flag; alerts without an alert action leave them unset
  message?: string
  notify?: boolean
  matched_on: string[]
  tags: string[]
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
}
