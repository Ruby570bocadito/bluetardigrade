// Unit tests for the operator-state-in-URL lib (url-state.ts): the
// pure parse/serialize contract that the shell (view) and the alerts
// queue (sev/q) write to the address bar. They run the REAL module —
// no DOM — so the vocabulary fallbacks, the default-omission rule and
// the unknown-param preservation are pinned exactly as the components
// invoke them.
//
//   bun test            (from web/console/)

import { describe, expect, test } from 'bun:test'
import type { ConsoleView } from '../components/console/dashboard'
import {
  MAX_QUERY_CHARS,
  readOperatorState,
  sevFromParam,
  viewFromParam,
  writeFilterToSearch,
  writeViewToSearch,
  type SeverityFilter,
} from './url-state'

describe('viewFromParam', () => {
  test('accepts every id of the shell navigation', () => {
    const views: readonly ConsoleView[] = [
      'panel',
      'flujo',
      'alertas',
      'reglas',
      'cadenas',
      'supresiones',
      'respuesta',
      'analista',
    ]
    for (const view of views) {
      expect(viewFromParam(view)).toBe(view)
    }
  })

  test('degrades anything unknown to panel (no crash on hand-typed URLs)', () => {
    expect(viewFromParam('alerta')).toBe('panel') // near-miss typo
    expect(viewFromParam('ALERTAS')).toBe('panel') // case is not canonical
    expect(viewFromParam('')).toBe('panel')
    expect(viewFromParam(null)).toBe('panel')
    expect(viewFromParam('../etc/passwd')).toBe('panel')
  })
})

describe('sevFromParam', () => {
  test('accepts the queue filter vocabulary', () => {
    const sevs: readonly SeverityFilter[] = ['all', 'critical', 'high', 'medium', 'low']
    for (const sev of sevs) {
      expect(sevFromParam(sev)).toBe(sev)
    }
  })

  test('degrades anything unknown to all', () => {
    expect(sevFromParam('CRITICAL')).toBe('all')
    expect(sevFromParam('info')).toBe('all')
    expect(sevFromParam('')).toBe('all')
    expect(sevFromParam(null)).toBe('all')
  })
})

describe('queryFromParam via readOperatorState', () => {
  test('trims surrounding whitespace and caps length', () => {
    expect(readOperatorState('?q=  lsass  ').q).toBe('lsass')
    expect(readOperatorState(`?q=${'x'.repeat(MAX_QUERY_CHARS)}`).q).toHaveLength(MAX_QUERY_CHARS)
    expect(readOperatorState(`?q=${'x'.repeat(MAX_QUERY_CHARS + 50)}`).q).toHaveLength(MAX_QUERY_CHARS)
  })
})

describe('readOperatorState', () => {
  test('parses the full contract from one search string', () => {
    const state = readOperatorState('?view=alertas&sev=critical&q=lsass')
    expect(state.view).toBe('alertas')
    expect(state.sev).toBe('critical')
    expect(state.q).toBe('lsass')
  })

  test('returns every default on an empty search (SSR-safe boot)', () => {
    const state = readOperatorState('')
    expect(state).toEqual({ view: 'panel', sev: 'all', q: '' })
  })

  test('invalid values fall back per key, valid keys survive', () => {
    const state = readOperatorState('?view=nope&sev=nope&q=keepers')
    expect(state.view).toBe('panel')
    expect(state.sev).toBe('all')
    expect(state.q).toBe('keepers')
  })

  test('unknown params are readable state for whoever owns them', () => {
    const state = readOperatorState('?view=reglas&tab=advanced')
    expect(state.view).toBe('reglas')
    // and round-trips of writes must keep them (covered below)
  })
})

describe('writeViewToSearch', () => {
  test('sets non-default views and omits panel entirely', () => {
    expect(writeViewToSearch('', 'alertas')).toBe('?view=alertas')
    expect(writeViewToSearch('', 'panel')).toBe('')
    expect(writeViewToSearch('?view=reglas', 'panel')).toBe('')
  })

  test('preserves unknown params on read-modify-write', () => {
    // Ordering is deterministic: URLSearchParams.set() replaces the first
    // occurrence in place, preserved params keep their position.
    expect(writeViewToSearch('?tab=advanced', 'alertas')).toBe('?tab=advanced&view=alertas')
    expect(writeViewToSearch('?view=flujo&tab=advanced', 'cadenas')).toBe('?view=cadenas&tab=advanced')
  })

  test('keeps the filter keys of the queue untouched', () => {
    expect(writeViewToSearch('?sev=critical&q=lsass', 'alertas')).toBe('?sev=critical&q=lsass&view=alertas')
  })
})

describe('writeFilterToSearch', () => {
  test('writes active filters and omits defaults (no ?sev=all noise)', () => {
    // Keys render in the order the writer applies them (sev first, q second).
    expect(writeFilterToSearch('', 'critical', 'lsass')).toBe('?sev=critical&q=lsass')
    expect(writeFilterToSearch('', 'all', '')).toBe('')
    expect(writeFilterToSearch('?sev=high', 'all', '')).toBe('')
    expect(writeFilterToSearch('', 'high', '')).toBe('?sev=high')
    expect(writeFilterToSearch('', 'all', 'mimikatz')).toBe('?q=mimikatz')
  })

  test('normalizes the query before writing (trim + cap)', () => {
    expect(writeFilterToSearch('', 'all', '  base64  ')).toBe('?q=base64')
    expect(writeFilterToSearch('', 'all', 'x'.repeat(MAX_QUERY_CHARS + 1))).toHaveLength(
      `?q=`.length + MAX_QUERY_CHARS,
    )
  })

  test('preserves unknown params and the shell view key', () => {
    expect(writeFilterToSearch('?view=alertas&tab=x', 'low', 'run')).toBe('?view=alertas&tab=x&sev=low&q=run')
  })

  test('replacing a previous filter overwrites instead of duplicating', () => {
    expect(writeFilterToSearch('?sev=high&q=old', 'medium', 'new')).toBe('?sev=medium&q=new')
  })
})

describe('round-trip write → read', () => {
  test('every written state reads back identical', () => {
    const cases: { view: ConsoleView; sev: SeverityFilter; q: string }[] = [
      { view: 'alertas', sev: 'critical', q: 'lsass' },
      { view: 'panel', sev: 'all', q: '' },
      { view: 'supresiones', sev: 'low', q: '' },
      { view: 'analista', sev: 'all', q: 'phish' },
    ]
    for (const c of cases) {
      const search = writeFilterToSearch(writeViewToSearch('', c.view), c.sev, c.q)
      expect(readOperatorState(search)).toEqual({
        view: c.view,
        sev: c.sev,
        q: c.q,
      })
    }
  })
})
