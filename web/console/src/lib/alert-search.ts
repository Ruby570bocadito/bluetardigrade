import type { SeverityFilter } from './url-state'
import type { SfAlert, SfAlertLifecycle, SfAlertStatus } from './console-types'

export type AlertStateFilter = 'all' | 'open' | SfAlertStatus
export type AlertScope = 'live' | 'history'
export type AlertSearchFilters = { severity: SeverityFilter; state: AlertStateFilter; q: string }
export type AlertSearchPage = {
  items: SfAlert[]
  source: 'memory' | 'sqlite'
  has_more: boolean
  next_cursor: string
  page_cursor: string
  scanned: number
  scan_limited: boolean
}

export function alertStateFromParam(raw: string | null): AlertStateFilter {
  return raw === 'open' || raw === 'new' || raw === 'acknowledged' || raw === 'closed' ? raw : 'all'
}

export function matchesAlertState(alert: SfAlert, state: AlertStateFilter): boolean {
  const status = alert.status ?? 'new'
  return state === 'all' || status === state || (state === 'open' && status !== 'closed')
}

export function alertSearchPath(filters: AlertSearchFilters, cursor = ''): string {
  const params = new URLSearchParams({ limit: '25' })
  if (filters.severity !== 'all') params.set('severity', filters.severity)
  if (filters.state !== 'all') params.set('status', filters.state)
  if (filters.q.trim()) params.set('q', filters.q.trim().slice(0, 120))
  if (cursor) params.set('cursor', cursor)
  return '/api/alerts/search?' + params.toString()
}

// A REST page can arrive after an SSE/POST decision. Apply the freshest
// lifecycle timestamp; an old frame must never undo a newer close/reopen.
export function applyAlertLifecycle(alert: SfAlert, entry: SfAlertLifecycle): SfAlert {
  if (alert.id !== entry.alert_id) return alert
  const previous = Date.parse(alert.status_at ?? '') || 0
  const incoming = Date.parse(entry.at) || 0
  if (incoming < previous) return alert
  return { ...alert, status: entry.status, status_note: entry.note, status_by: entry.by, status_at: entry.at }
}
