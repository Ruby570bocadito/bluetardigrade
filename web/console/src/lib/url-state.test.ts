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
  MAX_ALERT_KEY_CHARS,
  MAX_FEED_TYPE_CHARS,
  MAX_QUERY_CHARS,
  readAlertLens,
  readLensState,
  readOperatorState,
  sevFromParam,
  viewFromParam,
  writeAlertLens,
  writeAuditKindToSearch,
  writeFeedToSearch,
  writeFilterToSearch,
  writeHostToSearch,
  writeIncidentToSearch,
  writeRulesToSearch,
  writeViewToSearch,
  type LensState,
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
    const sevs: readonly SeverityFilter[] = ['all', 'critical', 'high', 'medium', 'low', 'info']
    for (const sev of sevs) {
      expect(sevFromParam(sev)).toBe(sev)
    }
  })

  test('degrades anything unknown to all', () => {
    expect(sevFromParam('CRITICAL')).toBe('all')
    expect(sevFromParam('unknown')).toBe('all')
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

describe('auditKindFromParam', () => {
  test('accepts the audit class vocabulary', () => {
    const kinds = ['all', 'executed', 'denied', 'followup'] as const
    for (const kind of kinds) {
      expect(readLensState(`?clase=${kind}`).clase).toBe(kind)
    }
  })

  test('degrades anything unknown to all (no crash on hand-typed URLs)', () => {
    expect(readLensState('?clase=DENIED').clase).toBe('all') // case is not canonical
    expect(readLensState('?clase=kill').clase).toBe('all') // near-miss vocabulary
    expect(readLensState('?clase=').clase).toBe('all')
    expect(readLensState('').clase).toBe('all')
  })
})

describe('feedTypeFromParam', () => {
  test('sanitizes but does NOT whitelist: unknown types stay honest equality filters', () => {
    // The type inventory is derived from the delivered buffer, so there
    // is no static vocabulary to enforce — a typo degrades to an empty
    // (honest) feed, never to a silently different lens.
    expect(readLensState('?tipo=FileCreate').tipo).toBe('FileCreate')
    expect(readLensState('?tipo=NoSuchType').tipo).toBe('NoSuchType')
  })

  test('trims, caps and collapses empties to all', () => {
    expect(readLensState('?tipo=%20ProcessCreate%20').tipo).toBe('ProcessCreate')
    expect(readLensState('?tipo=').tipo).toBe('all')
    expect(readLensState('?tipo=%20%20').tipo).toBe('all')
    expect(readLensState('').tipo).toBe('all')
    const long = 'x'.repeat(MAX_FEED_TYPE_CHARS + 1)
    expect(readLensState(`?tipo=${long}`).tipo).toHaveLength(MAX_FEED_TYPE_CHARS)
  })
})

describe('readLensState — per-lens keys never contaminate each other', () => {
  test('the three query lenses (q/fq/rq) are distinct keys', () => {
    const lens = readLensState('?q=alerts-search&fq=feed-search&rq=rules-search')
    expect(lens.fq).toBe('feed-search')
    expect(lens.rq).toBe('rules-search')
    // q belongs to the alerts queue (readOperatorState); readLensState
    // simply does not claim it.
    expect('q' in lens).toBe(false)
    expect(readOperatorState('?q=alerts-search').q).toBe('alerts-search')
  })

  test('parses the full lens surface in one call', () => {
    expect(readLensState('?clase=denied&tipo=FileCreate&fq=mimikatz&rq=lateral&regla=R-042')).toEqual({
      clase: 'denied',
      tipo: 'FileCreate',
      fq: 'mimikatz',
      rq: 'lateral',
      regla: 'R-042',
      host: '',
      incidente: '',
    })
  })
})

describe('writeAuditKindToSearch', () => {
  test('writes the class lens and omits the all default', () => {
    expect(writeAuditKindToSearch('', 'denied')).toBe('?clase=denied')
    expect(writeAuditKindToSearch('', 'all')).toBe('')
    expect(writeAuditKindToSearch('?clase=executed', 'all')).toBe('')
  })

  test('preserves unknown params and other lenses', () => {
    expect(writeAuditKindToSearch('?view=respuesta&fq=x', 'followup')).toBe(
      '?view=respuesta&fq=x&clase=followup',
    )
  })
})

describe('writeFeedToSearch', () => {
  test('writes both lenses and omits defaults (no ?tipo=all noise)', () => {
    expect(writeFeedToSearch('', 'FileCreate', 'mimikatz')).toBe('?tipo=FileCreate&fq=mimikatz')
    expect(writeFeedToSearch('', 'all', '')).toBe('')
    expect(writeFeedToSearch('', 'all', 'hunt')).toBe('?fq=hunt')
    expect(writeFeedToSearch('', 'DnsQuery', '')).toBe('?tipo=DnsQuery')
  })

  test('normalizes the query before writing (trim + cap) and never duplicates', () => {
    expect(writeFeedToSearch('', 'all', '  base64  ')).toBe('?fq=base64')
    expect(writeFeedToSearch('?tipo=FileCreate&fq=old', 'DnsQuery', 'new')).toBe(
      '?tipo=DnsQuery&fq=new',
    )
  })
})

describe('writeRulesToSearch', () => {
  test('writes the search and the expanded rule, omitting defaults', () => {
    expect(writeRulesToSearch('', 'lateral', 'R-042')).toBe('?rq=lateral&regla=R-042')
    expect(writeRulesToSearch('', '', null)).toBe('')
    expect(writeRulesToSearch('', 'hunt', null)).toBe('?rq=hunt')
    expect(writeRulesToSearch('', '', 'R-001')).toBe('?regla=R-001')
  })

  test('collapsing the row removes the regla key (no ghosts)', () => {
    expect(writeRulesToSearch('?view=reglas&regla=R-042', '', null)).toBe('?view=reglas')
  })

  test('preserves unknown params', () => {
    expect(writeRulesToSearch('?tab=x', 'mitre', 'R-007')).toBe('?tab=x&rq=mitre&regla=R-007')
  })
})

describe('round-trip write → read (lenses)', () => {
  test('every written lens state reads back identical', () => {
    const cases: { search: string; expect: LensState }[] = [
      { search: writeAuditKindToSearch('', 'denied'), expect: { clase: 'denied', tipo: 'all', fq: '', rq: '', regla: '', host: '', incidente: '' } },
      { search: writeFeedToSearch('', 'FileCreate', 'mimikatz'), expect: { clase: 'all', tipo: 'FileCreate', fq: 'mimikatz', rq: '', regla: '', host: '', incidente: '' } },
      { search: writeRulesToSearch('', 'lateral', 'R-042'), expect: { clase: 'all', tipo: 'all', fq: '', rq: 'lateral', regla: 'R-042', host: '', incidente: '' } },
      { search: writeHostToSearch('', 'LAB-WKS-01'), expect: { clase: 'all', tipo: 'all', fq: '', rq: '', regla: '', host: 'LAB-WKS-01', incidente: '' } },
      { search: writeIncidentToSearch('', '0123456789abcdef'), expect: { clase: 'all', tipo: 'all', fq: '', rq: '', regla: '', host: '', incidente: '0123456789abcdef' } },
    ]
    for (const c of cases) {
      expect(readLensState(c.search)).toEqual(c.expect)
    }
  })
})

describe('readAlertLens — the alerts lens (estado/historial/alert)', () => {
  test('defaults when the URL carries no lens keys', () => {
    expect(readAlertLens('?view=alertas')).toEqual({ state: 'all', scope: 'live', alert: null })
    expect(readAlertLens('')).toEqual({ state: 'all', scope: 'live', alert: null })
  })

  test('parses the full lens surface', () => {
    expect(readAlertLens('?view=alertas&historial=1&estado=open&alert=a1b2c3')).toEqual({
      state: 'open',
      scope: 'history',
      alert: 'a1b2c3',
    })
  })

  test('estado falls back to all outside the closed whitelist', () => {
    expect(readAlertLens('?estado=weird').state).toBe('all')
    expect(readAlertLens('?estado=CLOSED').state).toBe('all') // case is not canonical
  })

  test('an oversized alert key reads as absent (honest unresolved, not a broken lens)', () => {
    const oversized = 'k'.repeat(MAX_ALERT_KEY_CHARS + 1)
    expect(readAlertLens(`?alert=${oversized}`).alert).toBeNull()
    expect(readAlertLens(`?alert=${'k'.repeat(MAX_ALERT_KEY_CHARS)}`).alert).toBe('k'.repeat(MAX_ALERT_KEY_CHARS))
    expect(readAlertLens('?alert=').alert).toBeNull()
  })
})

describe('writeAlertLens — the alerts lens with the handoff key', () => {
  test('writes every key and omits the defaults (no all/live noise)', () => {
    expect(writeAlertLens('?view=alertas', 'all', '', 'all', 'live', null)).toBe('?view=alertas')
    expect(writeAlertLens('?view=alertas', 'critical', 'lsass', 'open', 'history', 'a1b2c3')).toBe(
      '?view=alertas&sev=critical&q=lsass&estado=open&historial=1&alert=a1b2c3',
    )
  })

  test('deselecting clears the alert key (no ghosts)', () => {
    const linked = writeAlertLens('?view=alertas', 'all', '', 'all', 'live', 'a1b2c3')
    expect(readAlertLens(linked).alert).toBe('a1b2c3')
    expect(writeAlertLens(linked, 'all', '', 'all', 'live', null)).toBe('?view=alertas')
  })

  test('a lens change clears the linked alert in the same write (handler contract)', () => {
    const linked = writeAlertLens('?view=alertas', 'all', '', 'all', 'live', 'a1b2c3')
    const changed = writeAlertLens(linked, 'high', '', 'all', 'live', null)
    expect(changed).toBe('?view=alertas&sev=high')
    expect(readAlertLens(changed).alert).toBeNull()
  })

  test('preserves unknown params and other lenses', () => {
    expect(writeAlertLens('?tab=x&clase=denied', 'all', '', 'open', 'live', 'a1')).toBe('?tab=x&clase=denied&estado=open&alert=a1')
  })

  test('round-trip with a composite key (\\x1f separators survive the URL)', () => {
    const composite = ['2026-10-01T10:00:00Z', 'evt-9', 'R-042'].join('\x1f')
    const written = writeAlertLens('?view=alertas', 'all', '', 'all', 'history', composite)
    const lens = readAlertLens(written)
    expect(lens.alert).toBe(composite)
    expect(lens.scope).toBe('history')
  })
})
