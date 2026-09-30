// Shared types for the security-framework web console. They mirror the
// JSON contracts served by the Go engine's local API (internal/api,
// :7778 by default): /api/stats, /api/events, /api/alerts, /api/rules
// and the SSE frames of /api/stream. The console never invents data:
// when the engine is unreachable every view shows a real empty state.

export type Severity = 'critical' | 'high' | 'medium' | 'low'

// model.Event (pkg/model) as delivered by /api/events and /api/stream.
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
  // Target of process.access (Sysmon event ID 10).
  target?: {
    pid: number
    name?: string
    image?: string
  }
  // Handle rights of process.access (granted_access is a hex mask).
  access?: {
    granted_access?: string
    call_trace?: string
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
  // Registry telemetry (Sysmon event IDs 12/13/14).
  registry?: {
    key?: string
    value_name?: string
    value?: string
    operation?: string
  }
  tags?: string[]
  enrichment?: Record<string, string>
}

// alert.Alert (internal/alert) as served by /api/alerts and /api/stream.
// Since r6 the engine assigns a unique 16-hex id to every alert (the
// lifecycle key); older engines without it fall back to the
// event_id + rule_id natural key (the provider derives a stable React
// key from what is available plus a monotonic counter).
export type SfAlert = {
  id?: string
  timestamp: string
  rule_id: string
  rule_name: string
  severity: Severity
  host: string
  user?: string
  event_id: string
  event_type: string
  summary: string
  // rendered by the engine when the rule declares an alert action
  message?: string
  // rule asks for external notification (config.notify)
  notify?: boolean
  matched_on: string[]
  tags?: string[]
  // actions declared by the rule (alert, webhook, ...)
  actions?: string[]
  // threat intel / context attached by internal/enrich
  enrichment?: Record<string, string>
  // lifecycle overlay (r6): triage state merged by the engine read-side
  // and updated live via the alert_lifecycle SSE frame. undefined = new.
  status?: SfAlertStatus
  status_note?: string
  status_by?: string
  status_at?: string
}

export type SfAlertStatus = 'new' | 'acknowledged' | 'closed'

// One lifecycle record (engine POST /api/alerts/{id}/status response
// and the alert_lifecycle SSE frame).
export type SfAlertLifecycle = {
  alert_id: string
  status: SfAlertStatus
  note?: string
  by?: string
  at: string
}

export type LifecycleAck =
  | { ok: true; entry: SfAlertLifecycle | null }
  | { ok: false; error: string }

// rulePayload served by /api/rules: the YAML contract as the engine
// sees it, with mitre/tactic derived from the attack.* tags.
export type RuleMeta = {
  id: string
  name: string
  description: string
  severity: Severity
  event_type: string
  mitre: string
  tactic: string
  tags: string[]
  conditions: { field: string; operator: string; value: string | string[] }[]
}

// One operator allowlist entry (engine GET /api/suppressions). Empty host
// means every host; expires is the raw RFC 3339 string or '' (no expiry).
export type SfSuppression = {
  rule_id: string
  host?: string
  reason?: string
  expires?: string
}

// One entry of the engine's hot_hosts list (package A1): a host's
// decayed risk score. Triage-prioritization signal, not a verdict —
// the score models what the engine SAW, not what the operator decided.
export type HotHost = {
  host: string
  score: number
  alerts: number
  last_seen: string
}

// One kill-chain sequence (engine GET /api/sequences, direct or via the
// hub). Steps are listed in declared order for display; the correlator
// matches them unordered inside the window.
export type SfSequence = {
  id: string
  name: string
  description: string
  severity: Severity
  window_seconds: number
  tags: string[]
  steps: string[]
}

// Active response surface state (engine GET /api/respond/state). Only
// an ARMED engine serves it (-allow-kill AND token AND an open audit
// file); a disarmed engine answers a real 404, which the console maps
// to a real "no disponible" state — never to a fake card.
export type SfRespondState = {
  armed: boolean
  signal: string
  operators_count: number
  protected_count: number
  operators_path?: string
  protected_path?: string
  audit_path: string
  audit_size: number
  audit_ceiling: number
}

// One attempt line of the engine's -respond-audit JSONL (Record, R5a
// schema) as returned by GET /api/respond/audit: executed AND denied
// attempts, one line per attempt, audit written before the signal.
export type SfRespondRecord = {
  ts: string
  action_id: string
  decision: 'executed' | 'denied'
  code?: string
  pid: number
  process_name: string
  resolved_name?: string
  operator: string
  rule_id?: string
  alert_id?: string
  reason: string
  host: string
  signal?: string
  mechanism?: string
  source: string
  followup?: boolean
}

// The audit tail payload: records newest first plus the honest
// bookkeeping of the scan (skipped lines are torn tails or malformed
// lines, counted and never served as data; truncated marks older
// records beyond the read window).
export type SfRespondAudit = {
  records: SfRespondRecord[]
  skipped: number
  truncated: boolean
}

// statsPayload served by /api/stats (verified against internal/api/api.go
// and a real smoke) — also the shape the hub re-emits over socket.io,
// with mode flipping to 'sin-motor' and interval_ms set by the hub when
// the engine is unreachable (the console never invents numbers).
export type EngineStats = {
  uptime_s: number
  events_total: number
  dropped: number
  ingest_rejected: number
  events_per_min: number
  alerts_total: number
  by_severity: Record<string, number>
  rules_count: number
  rules_types: string[]
  events_buffered: number
  // webhook delivery counters (engine -webhook flag); forwarded by the
  // hub since r3. All zero = connector disabled or nothing delivered yet.
  webhook_sent: number
  webhook_failed: number
  webhook_dropped: number
  // non-expired operator suppression entries, forwarded since r4
  suppressions_active: number
  // kill-chain correlator observability, forwarded since r5: in-flight
  // (sequence, host) chains, loaded sequences, tracking cap. All zero =
  // correlator off (engine found no sequences/ directory).
  correlator_states: number
  correlator_sequences: number
  correlator_cap: number
  // optional SQLite persistence (engine -store flag), forwarded by the
  // hub when the engine reports it; undefined = no store attached
  store_enabled?: boolean
  store_events?: number
  store_alerts?: number
  // per-host risk scoring (engine A1): width of the signal (how many
  // hosts carry non-cold risk) + top-5 decayed scores. Optional for the
  // same reason as the store trio: the hub forwards them when the
  // engine reports them; in sin-motor mode they are absent.
  risk_hosts_tracked?: number
  hot_hosts?: HotHost[]
  // beaconing detector observability (engine A3), documented in the
  // OpenAPI Stats schema: live (profile, host, destination) keys,
  // tracking cap and beacons fired since startup. All zero = detector
  // off (engine without -beacons); undefined on engines predating A3.
  // The header chip reads the trio: hidden while off, red at the cap.
  beacons_tracked?: number
  beacons_cap?: number
  beacons_fired?: number
  // volumetric threshold detector observability (engine A2): loaded
  // definitions, live aggregation keys and threshold alerts fired.
  // All zero = detector off (missing -thresholds file); undefined on
  // engines predating A2. No cap is exposed by the engine, so the
  // header chip stays neutral and never invents one.
  threshold_rules?: number
  threshold_keys?: number
  threshold_fired?: number
  // hub-only fields: the engine itself sends neither mode nor
  // interval_ms (mode optional so direct-engine responses type-check)
  interval_ms?: number
  mode?: 'engine' | 'sin-motor'
}

// hub-forwarded alias: same wire shape as EngineStats
export type SimStats = EngineStats

export type ConsoleSnapshot = {
  events: SfEvent[]
  alerts: SfAlert[]
  rules: RuleMeta[]
  suppressions?: SfSuppression[]
  sequences?: SfSequence[]
  stats: EngineStats
  started_at: string
}

export type AnalystStep = { label: string; state: 'run' | 'done' }

export type AnalystMessage = {
  id: string
  role: 'user' | 'analyst'
  alertName?: string
  question?: string
  // operator-suppression context captured when the analysis started
  // (active suppressions.yaml entries matching this rule)
  suppressionNote?: string
  steps?: AnalystStep[]
  text?: string
  error?: string
}

// Semantic severity colors (data semantics, not decoration):
// critical=red-500/600, high=orange-500, medium=amber-400, low=sky-400.
export const SEVERITY_STYLE: Record<Severity, { label: string; text: string; bg: string; border: string; bar: string; dot: string }> = {
  critical: {
    label: 'critical',
    text: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    bar: 'bg-red-500',
    dot: 'bg-red-500',
  },
  high: {
    label: 'high',
    text: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/30',
    bar: 'bg-orange-500',
    dot: 'bg-orange-500',
  },
  medium: {
    label: 'medium',
    text: 'text-amber-400',
    bg: 'bg-amber-400/10',
    border: 'border-amber-400/30',
    bar: 'bg-amber-400',
    dot: 'bg-amber-400',
  },
  low: {
    label: 'low',
    text: 'text-sky-400',
    bg: 'bg-sky-400/10',
    border: 'border-sky-400/30',
    bar: 'bg-sky-400',
    dot: 'bg-sky-400',
  },
}

export function severityOf(value: string | undefined): Severity {
  return value === 'critical' || value === 'high' || value === 'medium' || value === 'low' ? value : 'low'
}

export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('es-ES', { hour12: false })
  } catch {
    return iso
  }
}

export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-ES', { hour12: false })
  } catch {
    return iso
  }
}

export function formatUptime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}

// One-line human summary of an event, mirroring what the engine stores
// per event type (process, network, file, registry, process.access).
export function eventDetail(ev: SfEvent): string {
  if (ev.access) {
    const who = ev.process?.name ?? '?'
    const target = ev.target?.name ?? '?'
    return `${who} -> ${target} (${ev.access.granted_access ?? 'n/d'})`
  }
  if (ev.registry) {
    const value = ev.registry.value_name ? ` \\${ev.registry.value_name}` : ''
    return `${ev.registry.operation ?? 'registry'} ${ev.registry.key ?? ''}${value}`
  }
  if (ev.process) {
    return ev.process.command_line ? `${ev.process.name} ${ev.process.command_line}` : ev.process.name
  }
  if (ev.network) {
    const port = ev.network.destination_port ?? ''
    return `${ev.network.domain ?? ev.network.destination_ip ?? ''}${port ? `:${port}` : ''}`
  }
  if (ev.file) return ev.file.path
  return ev.type
}
