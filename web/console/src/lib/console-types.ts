// Shared types for the security-framework web console. These mirror the
// JSON contracts of the Go engine (pkg/model, internal/alert) and of
// web/console-service so the UI talks the same language as the hub. The
// hub forwards engine data only; 'sin-motor' means the engine is
// unreachable and the console shows no data at all.

export type Severity = 'critical' | 'high' | 'medium' | 'low'

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
  severity: Severity
  host: string
  user?: string
  event_id: string
  event_type: string
  summary: string
  // rendered by the engine when the rule declares an alert action;
  // absent in simulated mode (the simulator does not run actions)
  message?: string
  // rule asks for external notification (config.notify)
  notify?: boolean
  matched_on: string[]
  tags: string[]
}

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

export type SimStats = {
  events_total: number
  alerts_total: number
  by_severity: Record<string, number>
  events_per_min: number
  uptime_s: number
  interval_ms: number
  mode: 'engine' | 'sin-motor'
}

export type ConsoleSnapshot = {
  events: SfEvent[]
  alerts: SfAlert[]
  rules: RuleMeta[]
  stats: SimStats
  started_at: string
}

export type AnalystStep = { label: string; state: 'run' | 'done' }

export type AnalystMessage = {
  id: string
  role: 'user' | 'analyst'
  alertName?: string
  question?: string
  steps?: AnalystStep[]
  text?: string
  error?: string
}

export const SEVERITY_STYLE: Record<Severity, { label: string; text: string; bg: string; border: string; bar: string }> = {
  critical: {
    label: 'critical',
    text: 'text-red-300',
    bg: 'bg-red-400/10',
    border: 'border-red-400/30',
    bar: 'bg-red-400',
  },
  high: {
    label: 'high',
    text: 'text-orange-300',
    bg: 'bg-orange-400/10',
    border: 'border-orange-400/30',
    bar: 'bg-orange-400',
  },
  medium: {
    label: 'medium',
    text: 'text-amber-200',
    bg: 'bg-amber-300/10',
    border: 'border-amber-300/30',
    bar: 'bg-amber-300',
  },
  low: {
    label: 'low',
    text: 'text-zinc-300',
    bg: 'bg-zinc-400/10',
    border: 'border-zinc-400/30',
    bar: 'bg-zinc-400',
  },
}

export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('es-ES', { hour12: false })
  } catch {
    return iso
  }
}

export function formatUptime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}

export function eventDetail(ev: SfEvent): string {
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
