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
// The frame carries the FULL entry, so the assignment trio is merged the
// same way: absent fields mean the alert is unassigned now (the engine
// omits the three together), never "unknown". An assignment-only write
// keeps the entry's `at`, so it lands with incoming == previous and the
// freshness gate still lets it through.
export function applyAlertLifecycle(alert: SfAlert, entry: SfAlertLifecycle): SfAlert {
  if (alert.id !== entry.alert_id) return alert
  const previous = Date.parse(alert.status_at ?? '') || 0
  const incoming = Date.parse(entry.at) || 0
  if (incoming < previous) return alert
  return {
    ...alert,
    status: entry.status,
    status_note: entry.note,
    status_by: entry.by,
    status_at: entry.at,
    assignee: entry.assignee?.trim() ? entry.assignee : undefined,
    assigned_by: entry.assigned_by?.trim() ? entry.assigned_by : undefined,
    assigned_at: entry.assigned_at?.trim() ? entry.assigned_at : undefined,
  }
}

// Assignment lens of the queue (TEAM-3/C-2): every alert, only mine, or
// the unassigned queue. Matching is case-insensitive like the engine's
// assignee= filter; 'mine' compares against the console session account.
// Deliberately ephemeral (not part of the URL lens): the assignment
// state of a live queue is volatile; a shareable link is a roadmap
// proposal once the search language grows the assignment filter.
export type AssigneeLens = 'all' | 'mine' | 'unassigned'

export function matchesAssignee(alert: SfAlert, lens: AssigneeLens, me: string): boolean {
  if (lens === 'all') return true
  const owner = alert.assignee?.trim() ?? ''
  if (lens === 'unassigned') return owner === ''
  return owner !== '' && owner.toLowerCase() === me.trim().toLowerCase()
}
