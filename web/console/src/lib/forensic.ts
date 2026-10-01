// Forensic evidence bundle client (engine GET /api/alerts/{id}/forensics).
//
// The bundle is frozen at detection time by the engine's flight
// recorder; this module only reads it back. The failure states are
// modeled explicitly because the endpoint distinguishes them on
// purpose: 404 = no bundle for this id (severity below threshold,
// evicted or engine restarted), 501 = capture disabled on the engine,
// anything else = transient transport error. The panel renders an
// honest sentence for each instead of a generic "error".

export type ForensicEvent = {
  id: string
  timestamp: string
  type: string
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
    destination_ip?: string
    destination_port?: number
    domain?: string
  }
  file?: { path?: string }
  registry?: { key?: string }
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
    const bundle = (await res.json()) as ForensicBundle
    if (!bundle || !Array.isArray(bundle.timeline)) return { kind: 'error' }
    return { kind: 'bundle', bundle }
  } catch {
    return { kind: 'error' }
  }
}

// One-line description of a timeline event, the same vocabulary the
// live feed uses so operators read both surfaces with one eye.
export function forensicEventLine(ev: ForensicEvent): string {
  switch (ev.type) {
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
      return ev.process ? `${ev.process.name} abre maneja de otro proceso` : 'acceso a proceso'
    default:
      return ev.type
  }
}
