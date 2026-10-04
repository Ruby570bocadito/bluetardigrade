// Alert lifecycle write path (r6): the console's triage decisions go
// straight to the engine's local API through the SAME-Origin proxy the
// telemetry reads use (/api/engine), so no CORS and no extra config.
// The engine validates everything again server-side; the helpers here
// only keep the vocabulary and shape in one place.

import type { LifecycleAck, SfAlertLifecycle, SfAlertStatus } from './console-types'

// Same-origin proxy by default; NEXT_PUBLIC_ENGINE_API allows a direct
// URL (only useful when the engine itself serves CORS). Must stay in
// sync with use-engine-stream.ts.
function engineApiBase(): string {
  return process.env.NEXT_PUBLIC_ENGINE_API || '/api/engine'
}

export type TriageAction = {
  alert_id: string
  status: SfAlertStatus
  note?: string
  by?: string
}

const ID_PATTERN = /^[0-9a-f]{16}$/

export function isTriageActionValid(a: TriageAction): boolean {
  return (
    ID_PATTERN.test(a.alert_id) &&
    (a.status === 'new' || a.status === 'acknowledged' || a.status === 'closed') &&
    (a.note?.length ?? 0) <= 2000 &&
    (a.by?.length ?? 0) <= 200
  )
}

// postAlertStatus records one triage decision. The ack carries either
// the stored lifecycle entry or an actionable error message (the
// engine's JSON body names the problem; the UI renders it inline).
export async function postAlertStatus(action: TriageAction): Promise<LifecycleAck> {
  if (!isTriageActionValid(action)) {
    return { ok: false, error: 'accion de triaje invalida (id, estado o nota fuera de rango)' }
  }
  try {
    const res = await fetch(`${engineApiBase()}/api/alerts/${action.alert_id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: action.status, note: action.note ?? '', by: action.by ?? 'consola' }),
      signal: AbortSignal.timeout(6000),
    })
    const body = (await res.json().catch(() => null)) as { error?: string; hint?: string } | Record<string, unknown> | null
    if (!res.ok) {
      const refusal = body && typeof body === 'object' && body.error === 'role_forbidden' && typeof body.hint === 'string'
      const hint = refusal ? String(body.hint) : body && typeof body === 'object' && 'error' in body ? String(body.error) : `el motor respondio ${res.status}`
      return { ok: false, error: hint }
    }
    return { ok: true, entry: body as SfAlertLifecycle }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'error contactando al motor'
    return { ok: false, error: `no se pudo registrar el estado: ${message}` }
  }
}
