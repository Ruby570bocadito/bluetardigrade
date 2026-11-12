// Messages built outside React follow the operator's language too: the
// engine call helper, the alert history errors and the export tooltips.

import { afterEach, describe, expect, test } from 'bun:test'
import { alertHistoryError } from '../alert-search'
import { formatTime, localeOf } from '../console-types'
import { listIncidents } from '../engine-writes'
import { DICTS, LANG_STORAGE_KEY, activeDict } from './index'

const g = globalThis as { window?: unknown; navigator?: unknown }
const realFetch = globalThis.fetch
const realWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

function browser(stored: string | null, language: string) {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: (k: string) => (k === LANG_STORAGE_KEY ? stored : null) } } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language } })
}

afterEach(() => {
  globalThis.fetch = realFetch
  if (realWindow) Object.defineProperty(globalThis, 'window', realWindow)
  else delete g.window
  if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator)
  else delete g.navigator
})

describe('language outside React', () => {
  test('activeDict follows the stored choice, then the browser, and is Spanish on the server', () => {
    delete g.window
    expect(activeDict()).toBe(DICTS.es)
    browser('en', 'es-ES')
    expect(activeDict()).toBe(DICTS.en)
    browser(null, 'en-GB')
    expect(activeDict()).toBe(DICTS.en)
    browser('es', 'en-GB')
    expect(activeDict()).toBe(DICTS.es)
    // storage that throws (private mode): the browser preference decides
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { get localStorage(): never { throw new Error('blocked') } } })
    expect(activeDict()).toBe(DICTS.en)
  })

  test('an unreachable engine is reported in the console language', async () => {
    globalThis.fetch = (async () => {
      throw new Error('fetch failed')
    }) as unknown as typeof fetch
    browser('en', 'es-ES')
    const en = await listIncidents()
    expect(en).toEqual({ ok: false, status: 0, error: 'could not reach the engine: fetch failed' })
    browser('es', 'en-GB')
    const es = await listIncidents()
    expect(es).toEqual({ ok: false, status: 0, error: 'no se pudo contactar con el motor: fetch failed' })
  })

  test('alert history failures are codes with a sentence in both languages', () => {
    expect(alertHistoryError(404)).toBe('unsupported')
    expect(alertHistoryError(400)).toBe('expired')
    expect(alertHistoryError(504)).toBe('timeout')
    for (const other of [undefined, 500, 502, 403]) expect(alertHistoryError(other)).toBe('failed')
    for (const code of ['unsupported', 'expired', 'timeout', 'failed'] as const) {
      expect(DICTS.es.alerts.historyErrors[code]).not.toBe(DICTS.en.alerts.historyErrors[code])
      expect(DICTS.en.alerts.historyErrors[code]).not.toMatch(/[áéíóúñ¿¡]/)
    }
  })

  test('export tooltips and the analyst strings have an English form', () => {
    const en = DICTS.en.chrome
    expect(en.exportTitle(en.exportNoun.alerts, 'CSV', 256)).toBe('Download alerts as CSV. Up to 256 recent records from the engine or SQLite.')
    expect(en.exportFilterNote('critical', 3)).toContain('including 3 hidden')
    expect(en.exportFilterNote('critical')).not.toContain('hidden')
    expect(DICTS.es.chrome.exportTitle(DICTS.es.chrome.exportNoun.events, 'CSV', 1000)).toContain('Descargar eventos en CSV')
    expect(en.auditExportFiltered('denied', 10, 4)).toContain('the 10 records')
    expect(DICTS.en.analyst.disconnected).not.toBe(DICTS.es.analyst.disconnected)
    expect(DICTS.en.respond.auditAdminOnly).toContain('administrators')
  })

  test('the analyst queue formats its times in the console language', () => {
    const iso = '2026-11-12T15:04:05Z'
    expect(formatTime(iso, 'en')).toBe(new Date(iso).toLocaleTimeString(localeOf('en'), { hour12: false }))
    expect(formatTime(iso, 'es')).toBe(new Date(iso).toLocaleTimeString(localeOf('es'), { hour12: false }))
  })
})
