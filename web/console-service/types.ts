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
}
