// Forensic evidence bundle client (engine GET /api/alerts/{id}/forensics).
//
// The bundle is frozen at detection time by the engine's flight
// recorder; this module only reads it back. The failure states are
// modeled explicitly because the endpoint distinguishes them on
// purpose: 404 = no bundle for this id (severity below threshold or
// evicted), 501 = capture disabled on the engine,
// anything else = transient transport error. The panel renders an
// honest sentence for each instead of a generic "error".

export type ForensicEvent = {
  id: string
  timestamp: string
  type: string
  source?: string
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
  network?: {
    protocol?: string
    source_ip?: string
    source_port?: number
    destination_ip?: string
    destination_port?: number
    domain?: string
  }
  file?: { path?: string }
  registry?: { key?: string }
  target?: { pid: number; name: string; image?: string }
  access?: { granted_access?: string; call_trace?: string }
}

export type ForensicBundle = {
  alert: { id: string }
  captured_at: string
  host: string
  window: string
  timeline: ForensicEvent[]
  summary: {
    events: number
    process_creates: number
    network_connects: number
    file_writes: number
    registry_sets: number
    process_accesses: number
    other: number
    distinct_users: number
    distinct_images: string[]
  }
}

// Explicit tri-state so the UI can say WHY there is no bundle.
export type ForensicResult =
  | { kind: 'bundle'; bundle: ForensicBundle }
  | { kind: 'missing' } // 404: no bundle for this alert id
  | { kind: 'disabled' } // 501: engine runs without forensic capture
  | { kind: 'error' } // transient: retry later

// Same-origin proxy by default; NEXT_PUBLIC_ENGINE_API allows a direct
// URL. Must stay in sync with lifecycle.ts.
function engineApiBase(): string {
  return process.env.NEXT_PUBLIC_ENGINE_API || '/api/engine'
}

const ID_PATTERN = /^[0-9a-f]{16}$/

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalStrings(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => value[key] === undefined || typeof value[key] === 'string')
}

function validEvent(value: unknown): value is ForensicEvent {
  if (!record(value) || !['id', 'timestamp', 'type', 'host'].every((key) => typeof value[key] === 'string')) return false
  if (value.source !== undefined && typeof value.source !== 'string') return false
  if (value.attributes !== undefined && (!record(value.attributes) || !Object.values(value.attributes).every((item) => typeof item === 'string'))) return false
  const sections: Record<string, string[]> = {
    process: ['name', 'command_line', 'image'],
    target: ['name', 'image'],
    network: ['protocol', 'source_ip', 'destination_ip', 'domain'],
    file: ['path'],
    registry: ['key'],
    access: ['granted_access', 'call_trace'],
  }
  for (const [key, fields] of Object.entries(sections)) {
    const section = value[key]
    if (section !== undefined && (!record(section) || !optionalStrings(section, fields))) return false
  }
  for (const key of ['process', 'target']) {
    const section = value[key]
    if (record(section) && (!Number.isSafeInteger(section.pid) || (section.pid as number) < 0 ||
      (section.ppid !== undefined && (!Number.isSafeInteger(section.ppid) || (section.ppid as number) < 0)))) return false
  }
  if (record(value.network)) {
    for (const key of ['source_port', 'destination_port']) {
      const port = value.network[key]
      if (port !== undefined && (!Number.isSafeInteger(port) || (port as number) < 0 || (port as number) > 65535)) return false
    }
  }
  return true
}

// Validate the fields the panel consumes instead of trusting a TS cast.
// Older engine bundles used null for empty slices; normalize those only.
// Spreads retain all other alert/event/enrichment fields for offline export.
function normalizeBundle(value: unknown, alertId: string): ForensicBundle | null {
  if (!record(value) || !record(value.alert) || value.alert.id !== alertId || !record(value.summary)) return null
  if (!['captured_at', 'host', 'window'].every((key) => typeof value[key] === 'string')) return null
  const timeline = value.timeline === null ? [] : value.timeline
  if (!Array.isArray(timeline) || !timeline.every(validEvent)) return null
  const summary = value.summary
  const counts = ['events', 'process_creates', 'network_connects', 'file_writes', 'registry_sets', 'process_accesses', 'other', 'distinct_users']
  if (!counts.every((key) => typeof summary[key] === 'number' && Number.isSafeInteger(summary[key]) && (summary[key] as number) >= 0)) return null
  if (summary.events !== timeline.length || timeline.some((ev) => ev.host !== value.host)) return null
  const images = summary.distinct_images === null ? [] : summary.distinct_images
  if (!Array.isArray(images) || !images.every((item) => typeof item === 'string')) return null
  return { ...value, timeline, summary: { ...summary, distinct_images: images } } as ForensicBundle
}

export async function readForensicBundle(alertId: string): Promise<ForensicResult> {
  if (!ID_PATTERN.test(alertId)) return { kind: 'missing' }
  try {
    const res = await fetch(`${engineApiBase()}/api/alerts/${alertId}/forensics`, {
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    })
    if (res.status === 404) return { kind: 'missing' }
    if (res.status === 501) return { kind: 'disabled' }
    if (!res.ok) return { kind: 'error' }
    const bundle = normalizeBundle(await res.json(), alertId)
    if (!bundle) return { kind: 'error' }
    return { kind: 'bundle', bundle }
  } catch {
    return { kind: 'error' }
  }
}

// JSON contains the whole frozen bundle. JSONL starts with one metadata
// envelope (including the full alert), followed by one envelope per event.
// Nesting avoids collisions with telemetry's own type/id fields.
export function buildForensicExport(bundle: ForensicBundle, format: 'json' | 'jsonl') {
  if (!ID_PATTERN.test(bundle.alert.id)) throw new Error('Invalid forensic alert id')
  const { timeline, ...metadata } = bundle
  const contents = format === 'json'
    ? `${JSON.stringify(bundle, null, 2)}\n`
    : [
        { record_type: 'forensic.bundle', version: 1, bundle: metadata },
        ...timeline.map((event) => ({ record_type: 'forensic.event', event })),
      ].map((entry) => JSON.stringify(entry)).join('\n') + '\n'
  return {
    filename: `forensic-${bundle.alert.id}.${format}`,
    mime: format === 'json' ? 'application/json;charset=utf-8' : 'application/x-ndjson;charset=utf-8',
    contents,
  }
}

// One-line description of a timeline event, the same vocabulary the
// live feed uses so operators read both surfaces with one eye.
export function forensicEventLine(ev: ForensicEvent): string {
  const a = ev.attributes ?? {}
  switch (ev.type) {
    case 'network.alert': return `IDS ${a.ids_signature ?? '?'} · veredicto ${a.ids_verdict ?? 'no declarado'}`
    case 'host.query': return `osquery ${a.query_name ?? '?'} · ${a.query_action ?? '?'}`
    case 'network.firewall': return `Firewall ${a.firewall_action ?? '?'} ${a.firewall_direction ?? ''}`
    case 'email.message': return `Correo ${a.mail_subject ?? '(sin asunto)'}`
    case 'honeypot.connect':
    case 'honeypot.login':
    case 'honeypot.command': return `Cowrie ${a.honeypot_event ?? ev.type} ${a.honeypot_input ?? ''}`
    case 'process.create':
      return ev.process?.command_line || ev.process?.name || 'proceso creado'
    case 'process.terminate':
      return `fin de ${ev.process?.name ?? 'proceso'} (pid ${ev.process?.pid ?? '?'})`
    case 'network.connect': {
      const n = ev.network
      if (!n) return 'conexion de red'
      const dest = n.domain || n.destination_ip
      return dest ? `${n.protocol ?? 'net'} -> ${dest}${n.destination_port ? ':' + n.destination_port : ''}` : 'conexion de red'
    }
    case 'file.write':
      return ev.file?.path ? `escribe ${ev.file.path}` : 'escritura de fichero'
    case 'registry.set':
      return ev.registry?.key ? `registro ${ev.registry.key}` : 'escritura de registro'
    case 'process.access':
      return `${ev.process?.name || 'proceso'} accede a ${ev.target?.name || 'otro proceso'}${ev.access?.granted_access ? ` (${ev.access.granted_access})` : ''}`
    case 'image.load':
      return ev.file?.path ? `carga ${ev.file.path}` : 'carga de modulo'
    default:
      return ev.type
  }
}
