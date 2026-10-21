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

// ---- assignment (TEAM-3/M-1) ----------------------------------------------
//
// The engine owns the same guarantees as the triage route: 200-char
// ceilings for assignee and by, an 8 KiB body, scope enforcement and an
// alert_lifecycle broadcast per write. assignee "" unassigns. The batch
// route answers 200 even with per-id failures (NOT atomic on purpose):
// a failed id is the console's signal that its selection went stale.

export type AssignAction = {
  alert_id: string
  // "" clears the assignment (unassign)
  assignee: string
  by?: string
}

export type AssignAck = { ok: true; entry: SfAlertLifecycle } | { ok: false; error: string }

export type AssignBatchResult = {
  assigned: string[]
  failed: { id: string; error: string }[]
}

export type AssignBatchAck = { ok: true; result: AssignBatchResult } | { ok: false; error: string }

// The engine's own batchMaxIDs is 500, but its 8 KiB body cap is the
// real ceiling (~19 bytes per id): a batch between ~430 and 500 ids
// dies in 413 before the 500 check even runs. The client slices at 400
// so a giant selection degrades into two batches that always fit.
export const MAX_ASSIGN_BATCH_IDS = 400

export function isAssignActionValid(a: AssignAction): boolean {
  return ID_PATTERN.test(a.alert_id) && a.assignee.length <= 200 && (a.by?.length ?? 0) <= 200
}

export function isAssignBatchValid(ids: string[], assignee: string, by: string): boolean {
  return (
    ids.length > 0 &&
    ids.length <= MAX_ASSIGN_BATCH_IDS &&
    ids.every((id) => ID_PATTERN.test(id)) &&
    assignee.length <= 200 &&
    by.length <= 200
  )
}

// postAlertAssign assigns, reassigns (assign over) or unassigns one
// alert. The ack carries the full lifecycle entry (status + trio), so
// the caller patches the ring with the same applyAlertLifecycle path
// the SSE frame uses.
export async function postAlertAssign(action: AssignAction): Promise<AssignAck> {
  if (!isAssignActionValid(action)) {
    return { ok: false, error: 'accion de asignacion invalida (id o nombre fuera de rango)' }
  }
  try {
    const res = await fetch(`${engineApiBase()}/api/alerts/${action.alert_id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee: action.assignee, by: action.by ?? 'consola' }),
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
    return { ok: false, error: `no se pudo asignar: ${message}` }
  }
}

// postAlertAssignBatch assigns (or unassigns with assignee "") a whole
// selection from the bulk bar. The engine validates that every id
// EXISTS (a batch of unknown ids would fill the store with ghost
// assignments), so a stale selection comes back as per-id failures the
// dialog lists. Returns which ids made it and which did not.
export async function postAlertAssignBatch(rawIds: string[], assignee: string, by: string): Promise<AssignBatchAck> {
  const ids = [...new Set(rawIds)].slice(0, MAX_ASSIGN_BATCH_IDS)
  if (!isAssignBatchValid(ids, assignee, by)) {
    return { ok: false, error: 'lote de asignacion invalido (ids, nombre o tamaño fuera de rango)' }
  }
  try {
    const res = await fetch(`${engineApiBase()}/api/alerts/assign-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, assignee, by }),
      signal: AbortSignal.timeout(6000),
    })
    const body = (await res.json().catch(() => null)) as { error?: string; hint?: string; assigned?: unknown; failed?: unknown } | null
    if (!res.ok) {
      const refusal = body && typeof body === 'object' && body.error === 'role_forbidden' && typeof body.hint === 'string'
      const hint = refusal ? String(body.hint) : body && typeof body === 'object' && 'error' in body ? String(body.error) : `el motor respondio ${res.status}`
      return { ok: false, error: hint }
    }
    const assigned = Array.isArray(body?.assigned) ? body.assigned.filter((x): x is string => typeof x === 'string') : []
    const failed = Array.isArray(body?.failed)
      ? body.failed
          .filter((x): x is { id: unknown; error: unknown } => typeof x === 'object' && x !== null && 'id' in x)
          .map((x) => ({ id: String(x.id), error: String(x.error ?? 'error') }))
      : []
    return { ok: true, result: { assigned, failed } }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'error contactando al motor'
    return { ok: false, error: `no se pudo asignar el lote: ${message}` }
  }
}
