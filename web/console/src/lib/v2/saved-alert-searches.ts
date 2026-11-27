// v2 · Alertas: saved searches of the queue, kept in this browser. A saved
// search is a name plus the queue's own lens (severity, state, assignment,
// text) and its scope (live or history). Reading rebuilds only those
// fields from what is stored, entry by entry: a damaged or foreign entry
// is dropped, never turned into a filter.
import { alertStateFromParam, type AlertScope, type AssigneeLens } from '@/lib/alert-search'
import { queryFromParam, sevFromParam } from '@/lib/url-state'
import type { QueueLens } from './alerts-model'

export const ALERT_SEARCHES_KEY = 'bluetardigrade.v2.alert-searches.v1'
export const MAX_ALERT_SEARCHES = 20
export const MAX_ALERT_SEARCH_NAME = 60

export type SavedAlertSearch = { id: string; name: string; lens: QueueLens; scope: AlertScope }

const ASSIGNEES: readonly AssigneeLens[] = ['all', 'mine', 'unassigned']

/** A usable name, trimmed; null when empty, too long or with control or direction characters. */
export function searchNameOf(raw: string): string | null {
  const name = raw.trim()
  if (!name || name.length > MAX_ALERT_SEARCH_NAME || /[\u0000-\u001f\u007f‪-‮⁦-⁩]/.test(name)) return null
  return name
}

function parseEntry(raw: unknown): SavedAlertSearch | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const e = raw as Record<string, unknown>
  if (typeof e.id !== 'string' || !/^[a-f0-9]{32}$/.test(e.id) || typeof e.name !== 'string') return null
  const name = searchNameOf(e.name)
  const l = e.lens as Record<string, unknown> | null
  if (!name || !l || typeof l !== 'object') return null
  if (typeof l.sev !== 'string' || sevFromParam(l.sev) !== l.sev) return null
  if (typeof l.state !== 'string' || alertStateFromParam(l.state) !== l.state) return null
  if (typeof l.assignee !== 'string' || !(ASSIGNEES as readonly string[]).includes(l.assignee)) return null
  if (typeof l.q !== 'string' || queryFromParam(l.q) !== l.q) return null
  if (e.scope !== 'live' && e.scope !== 'history') return null
  return {
    id: e.id,
    name,
    lens: { sev: sevFromParam(l.sev), state: alertStateFromParam(l.state), assignee: l.assignee as AssigneeLens, q: l.q },
    scope: e.scope,
  }
}

/** The saved searches in a stored value; whatever cannot be read back exactly is left out. */
export function parseAlertSearches(stored: string | null): SavedAlertSearch[] {
  if (!stored) return []
  let raw: unknown
  try {
    raw = JSON.parse(stored)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const out: SavedAlertSearch[] = []
  for (const item of raw) {
    const entry = parseEntry(item)
    if (entry && !out.some((o) => o.id === entry.id) && out.length < MAX_ALERT_SEARCHES) out.push(entry)
  }
  return out
}

const sameName = (a: string, b: string) => a.normalize('NFKC').toLowerCase() === b.normalize('NFKC').toLowerCase()

/**
 * The list with this search saved under `name`: a name already in use is
 * updated in place (same id), a new one goes first. Fails on an unusable
 * name or a full list.
 */
export function saveAlertSearch(
  list: readonly SavedAlertSearch[],
  rawName: string,
  lens: QueueLens,
  scope: AlertScope,
  newId: string,
): { ok: true; list: SavedAlertSearch[]; saved: SavedAlertSearch } | { ok: false; error: 'name' | 'full' } {
  const name = searchNameOf(rawName)
  if (!name) return { ok: false, error: 'name' }
  const clean: QueueLens = { ...lens, q: queryFromParam(lens.q) }
  const existing = list.find((s) => sameName(s.name, name))
  if (existing) {
    const saved = { ...existing, name, lens: clean, scope }
    return { ok: true, list: list.map((s) => (s.id === existing.id ? saved : s)), saved }
  }
  if (list.length >= MAX_ALERT_SEARCHES) return { ok: false, error: 'full' }
  const saved = { id: newId, name, lens: clean, scope }
  return { ok: true, list: [saved, ...list], saved }
}

export function removeAlertSearch(list: readonly SavedAlertSearch[], id: string): SavedAlertSearch[] {
  return list.filter((s) => s.id !== id)
}

/** The saved search the queue shows right now, if any. */
export function activeAlertSearch(list: readonly SavedAlertSearch[], lens: QueueLens, scope: AlertScope): SavedAlertSearch | undefined {
  const q = queryFromParam(lens.q)
  return list.find((s) => s.scope === scope && s.lens.sev === lens.sev && s.lens.state === lens.state && s.lens.assignee === lens.assignee && s.lens.q === q)
}
