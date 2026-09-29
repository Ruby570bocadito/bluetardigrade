// Alert lifecycle contracts (r6): the triage state an operator records
// on an alert via POST /api/alerts/{id}/status, and the SSE frame the
// engine broadcasts on every change.

export type SfAlertStatus = 'new' | 'acknowledged' | 'closed'

// One lifecycle record as the engine stores and broadcasts it
// (the `alert_lifecycle` SSE frame payload).
export type SfAlertLifecycle = {
  alert_id: string
  status: SfAlertStatus
  note?: string
  by?: string
  at: string
}

export const LIFECYCLE_STATUSES: readonly SfAlertStatus[] = ['new', 'acknowledged', 'closed']

export const MAX_NOTE_LEN = 2000
export const MAX_BY_LEN = 200

export type ParsedLifecycleRequest = {
  alert_id: string
  status: SfAlertStatus
  note: string
  by: string
}

export type ParseResult =
  | { ok: true; value: ParsedLifecycleRequest }
  | { ok: false; error: string }

const ID_PATTERN = /^[0-9a-f]{16}$/

// parseLifecycleRequest validates the console -> hub `lifecycle:set`
// payload BEFORE the hub touches the engine API. Same rules as the
// engine side (internal/lifecycle): the id must be the 16-hex alert
// id, the status one of the three documented states, and the free
// text fields within their caps. Returns a discriminated result so
// the socket handler can ack with a precise error message.
export function parseLifecycleRequest(payload: unknown): ParseResult {
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, error: 'payload invalido: falta el objeto de estado' }
  }
  const p = payload as Record<string, unknown>
  const alert_id = typeof p.alert_id === 'string' ? p.alert_id : ''
  if (!ID_PATTERN.test(alert_id)) {
    return { ok: false, error: 'alert_id invalido: deben ser 16 caracteres hexadecimales (campo id de la alerta)' }
  }
  const status = p.status
  if (typeof status !== 'string' || !LIFECYCLE_STATUSES.includes(status as SfAlertStatus)) {
    return { ok: false, error: 'status invalido: valores validos new, acknowledged, closed' }
  }
  const note = typeof p.note === 'string' ? p.note : ''
  if (note.length > MAX_NOTE_LEN) {
    return { ok: false, error: `nota demasiado larga (max ${MAX_NOTE_LEN} caracteres)` }
  }
  const by = typeof p.by === 'string' ? p.by : ''
  if (by.length > MAX_BY_LEN) {
    return { ok: false, error: `by demasiado largo (max ${MAX_BY_LEN} caracteres)` }
  }
  return { ok: true, value: { alert_id, status: status as SfAlertStatus, note, by } }
}
