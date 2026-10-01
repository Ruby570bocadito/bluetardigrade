import { describe, expect, test } from 'bun:test'
import {
  alertSearchLens, eventSearchLens, MAX_SAVED_SEARCHES, readSavedSearches,
  searchForSavedLens, searchName, upsertSavedSearch, writeSavedSearches, type SavedSearch,
} from './saved-searches'

const entry: SavedSearch = { id: 'a'.repeat(32), name: 'Críticas abiertas', lens: { kind: 'alerts', severity: 'critical', state: 'open', scope: 'history', q: 'Office' } }
const reader = (items: unknown[], version = 1) => ({ getItem: () => JSON.stringify({ version, items }) })

describe('saved investigations', () => {
  test('round-trips alert and event filters through versioned storage', () => {
    const events: SavedSearch = { id: 'b'.repeat(32), name: 'Ficheros', lens: eventSearchLens('file.write', 'Public') }
    let value = ''
    writeSavedSearches({ setItem: (_key, raw) => { value = raw } }, [entry, events])
    expect(readSavedSearches({ getItem: () => value })).toEqual([entry, events])
  })
  test('stores only owned filters and names, stripping URLs and payloads', () => {
    const raw = { ...entry, url: 'https://example.invalid', payload: { secret: 'test-only' }, lens: { ...entry.lens, alert: 'old', apiToken: 'test-only' } }
    let value = ''
    writeSavedSearches({ setItem: (_key, text) => { value = text } }, [raw])
    expect(JSON.parse(value).items).toEqual([entry])
    expect(readSavedSearches(reader([raw]))).toEqual([entry])
  })
  test('captures trimmed, bounded text before URL debounce completes', () => {
    expect(alertSearchLens('high', 'new', 'live', ' Office ')).toEqual({ kind: 'alerts', severity: 'high', state: 'new', scope: 'live', q: 'Office' })
    expect(eventSearchLens(' network.connect ', 'x'.repeat(200))).toEqual({ kind: 'events', eventType: 'network.connect', q: 'x'.repeat(120) })
  })
  test('same normalized name updates a hunt while keeping its identity', () => {
    const updated = upsertSavedSearch([entry], { ...entry, id: 'b'.repeat(32), name: 'CRÍTICAS ABIERTAS', lens: alertSearchLens('high', 'new', 'live', '') })
    expect(updated).toEqual([{ ...entry, name: 'CRÍTICAS ABIERTAS', lens: alertSearchLens('high', 'new', 'live', '') }])
  })
  test('alert and telemetry hunts may share a name without replacing each other', () => {
    const events = { ...entry, id: 'b'.repeat(32), lens: eventSearchLens('file.write', '') }
    expect(upsertSavedSearch([entry], events)).toEqual([entry, events])
  })
  test('capacity rejects a new hunt but permits updating an existing one', () => {
    const full = Array.from({ length: MAX_SAVED_SEARCHES }, (_, i) => ({ ...entry, id: i.toString(16).padStart(32, '0'), name: `Búsqueda ${i}` }))
    expect(() => upsertSavedSearch(full, entry)).toThrow(/20 búsquedas/)
    expect(upsertSavedSearch(full, { ...entry, name: 'Búsqueda 0' })).toHaveLength(20)
  })
  test('empty storage is an empty catalogue', () => {
    expect(readSavedSearches({ getItem: () => null })).toEqual([])
  })
  test('invalid JSON, schema versions and oversized storage are rejected', () => {
    expect(() => readSavedSearches({ getItem: () => '{invalid' })).toThrow()
    expect(() => readSavedSearches(reader([entry], 2))).toThrow()
    expect(() => readSavedSearches({ getItem: () => ' '.repeat(65537) })).toThrow(/límite/)
    expect(() => readSavedSearches(reader(Array.from({ length: 21 }, () => entry)))).toThrow()
  })
  test('invalid severities, states and scopes never silently broaden a hunt', () => {
    for (const field of ['severity', 'state', 'scope']) {
      expect(() => readSavedSearches(reader([{ ...entry, lens: { ...entry.lens, [field]: 'unknown' } }]))).toThrow()
    }
  })
  test('unsafe navigation kinds and malformed identifiers are rejected', () => {
    expect(() => readSavedSearches(reader([{ ...entry, id: '../x' }]))).toThrow()
    expect(() => readSavedSearches(reader([{ ...entry, lens: { kind: 'url', q: '', url: 'javascript:alert(1)' } }]))).toThrow()
  })
  test('duplicate identities and duplicate names are rejected', () => {
    expect(() => readSavedSearches(reader([entry, { ...entry, name: 'Otra' }]))).toThrow(/duplicadas/)
    expect(() => readSavedSearches(reader([entry, { ...entry, id: 'b'.repeat(32), name: 'CRÍTICAS ABIERTAS' }]))).toThrow(/duplicadas/)
  })
  test('names reject control characters and excessive lengths', () => {
    expect(searchName('  Críticas abiertas  ')).toBe(entry.name)
    for (const name of ['', ' '.repeat(5), 'x'.repeat(61), 'fake\nlabel', 'name\u202eexe']) expect(() => searchName(name)).toThrow()
  })
  test('storage failures are surfaced instead of pretending to save', () => {
    expect(() => readSavedSearches({ getItem: () => { throw new Error('denied') } })).toThrow(/denied/)
    expect(() => writeSavedSearches({ setItem: () => { throw new Error('quota') } }, [entry])).toThrow(/quota/)
  })
  test('applying an alert hunt clears selection and preserves other investigations', () => {
    const result = new URLSearchParams(searchForSavedLens('?view=alertas&alert=old&fq=network&custom=keep', entry.lens))
    expect(Object.fromEntries(result)).toEqual({ view: 'alertas', fq: 'network', custom: 'keep', sev: 'critical', q: 'Office', estado: 'open', historial: '1' })
  })
  test('applying an event hunt preserves alert filters and omits event defaults', () => {
    const result = new URLSearchParams(searchForSavedLens('?view=alertas&sev=high&q=host&tipo=file.write&fq=old', eventSearchLens('all', '')))
    expect(Object.fromEntries(result)).toEqual({ view: 'flujo', sev: 'high', q: 'host' })
  })
})
