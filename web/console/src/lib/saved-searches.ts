import { alertStateFromParam, type AlertScope, type AlertStateFilter } from './alert-search'
import {
  feedTypeFromParam, queryFromParam, sevFromParam, writeAlertLens, writeFeedToSearch,
  writeViewToSearch, type SeverityFilter,
} from './url-state'

export const SAVED_SEARCH_KEY = 'bluetardigrade.saved-searches.v1'
export const MAX_SAVED_SEARCHES = 20
export const MAX_SEARCH_NAME = 60
const MAX_STORAGE_CHARS = 64 * 1024

export type SavedLens =
  | { kind: 'alerts'; severity: SeverityFilter; state: AlertStateFilter; scope: AlertScope; q: string }
  | { kind: 'events'; eventType: string; q: string }
export type SavedSearch = { id: string; name: string; lens: SavedLens }
type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'setItem'>

export function searchName(raw: string): string {
  const name = raw.trim()
  if (!name || name.length > MAX_SEARCH_NAME || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(name)) {
    throw new Error(`Usa un nombre de 1 a ${MAX_SEARCH_NAME} caracteres sin caracteres de control.`)
  }
  return name
}

export function alertSearchLens(severity: SeverityFilter, state: AlertStateFilter, scope: AlertScope, q: string): SavedLens {
  return { kind: 'alerts', severity, state, scope, q: queryFromParam(q) }
}

export function eventSearchLens(eventType: string, q: string): SavedLens {
  return { kind: 'events', eventType: feedTypeFromParam(eventType), q: queryFromParam(q) }
}

function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Registro de búsquedas incompatible.')
  return raw as Record<string, unknown>
}

// Reconstruct only the owned filter fields. Stored URLs, alert identities,
// payloads and unknown properties never become navigation or saved state.
function parseEntry(raw: unknown): SavedSearch {
  const entry = record(raw)
  if (typeof entry.id !== 'string' || !/^[a-f0-9]{32}$/.test(entry.id) || typeof entry.name !== 'string') {
    throw new Error('Registro de búsquedas incompatible.')
  }
  const value = record(entry.lens)
  if (typeof value.q !== 'string' || queryFromParam(value.q) !== value.q) throw new Error('Filtro de búsqueda incompatible.')
  let lens: SavedLens
  if (value.kind === 'alerts') {
    if (typeof value.severity !== 'string' || sevFromParam(value.severity) !== value.severity ||
        typeof value.state !== 'string' || alertStateFromParam(value.state) !== value.state ||
        (value.scope !== 'live' && value.scope !== 'history')) throw new Error('Filtro de alertas incompatible.')
    lens = alertSearchLens(sevFromParam(value.severity), alertStateFromParam(value.state), value.scope, value.q)
  } else if (value.kind === 'events') {
    if (typeof value.eventType !== 'string' || feedTypeFromParam(value.eventType) !== value.eventType) throw new Error('Filtro de eventos incompatible.')
    lens = eventSearchLens(value.eventType, value.q)
  } else {
    throw new Error('Tipo de búsqueda incompatible.')
  }
  return { id: entry.id, name: searchName(entry.name), lens }
}

function nameKey(item: SavedSearch): string {
  return `${item.lens.kind}:${item.name.normalize('NFKC').toLowerCase()}`
}

export function readSavedSearches(storage: StorageReader): SavedSearch[] {
  const raw = storage.getItem(SAVED_SEARCH_KEY)
  if (raw === null) return []
  if (raw.length > MAX_STORAGE_CHARS) throw new Error('El registro de búsquedas supera el límite de lectura.')
  const data = record(JSON.parse(raw))
  if (data.version !== 1 || !Array.isArray(data.items) || data.items.length > MAX_SAVED_SEARCHES) {
    throw new Error('Registro de búsquedas incompatible.')
  }
  const items = data.items.map(parseEntry)
  const ids = new Set(items.map((item) => item.id))
  const names = new Set(items.map(nameKey))
  if (ids.size !== items.length || names.size !== items.length) throw new Error('El registro contiene búsquedas duplicadas.')
  return items
}

export function writeSavedSearches(storage: StorageWriter, items: SavedSearch[]): void {
  if (items.length > MAX_SAVED_SEARCHES) throw new Error(`Puedes guardar hasta ${MAX_SAVED_SEARCHES} búsquedas. Elimina una para añadir otra.`)
  const clean = items.map(parseEntry)
  storage.setItem(SAVED_SEARCH_KEY, JSON.stringify({ version: 1, items: clean }))
}

export function upsertSavedSearch(items: SavedSearch[], candidate: SavedSearch): SavedSearch[] {
  const clean = parseEntry(candidate)
  const existing = items.find((item) => nameKey(item) === nameKey(clean))
  if (existing) return items.map((item) => item.id === existing.id ? { ...clean, id: existing.id } : item)
  if (items.length >= MAX_SAVED_SEARCHES) throw new Error(`Puedes guardar hasta ${MAX_SAVED_SEARCHES} búsquedas. Elimina una para añadir otra.`)
  return [...items, clean]
}

export function searchForSavedLens(search: string, lens: SavedLens): string {
  if (lens.kind === 'alerts') {
    return writeViewToSearch(writeAlertLens(search, lens.severity, lens.q, lens.state, lens.scope, null), 'alertas')
  }
  return writeViewToSearch(writeFeedToSearch(search, lens.eventType, lens.q), 'flujo')
}

export function describeSavedLens(lens: SavedLens): string {
  const filters = lens.kind === 'alerts'
    ? [lens.scope === 'history' ? 'Histórico' : 'En vivo', lens.severity === 'all' ? 'todas las severidades' : lens.severity, lens.state === 'all' ? 'todos los estados' : lens.state]
    : ['Flujo', lens.eventType === 'all' ? 'todos los tipos' : lens.eventType]
  if (lens.q) filters.push(`«${lens.q}»`)
  return filters.join(' · ')
}
