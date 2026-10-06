// Unit tests for the pure half of the chart export kit (chart-export.ts):
// RFC 4180 CSV building, file-name slugging and the structural SVG style
// inliner. The DOM half (serialization, PNG, download click) stays in the
// wiring per the repo doctrine: tsc and the browser own it.

//   bun test            (from web/console/)

import { describe, expect, test } from 'bun:test'
import {
  csvCell,
  inlineSvgStyles,
  slugFileName,
  tableToCsv,
  type InlineNode,
} from './chart-export'

describe('csvCell', () => {
  test('leaves plain values untouched', () => {
    expect(csvCell(12)).toBe('12')
    expect(csvCell('viernes 09:00')).toBe('viernes 09:00')
  })

  test('quotes cells with commas, quotes or line breaks and doubles the quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('dijo "hola"')).toBe('"dijo ""hola"""')
    expect(csvCell('una\rlínea')).toBe('"una\rlínea"')
    expect(csvCell('dos\nlíneas')).toBe('"dos\nlíneas"')
  })
})

describe('csvCell — spreadsheet formula guard (the engine export rule)', () => {
  test('prefixes with an apostrophe cells whose first non-space character starts a formula', () => {
    expect(csvCell('=1+1|maliciosa')).toBe("'=1+1|maliciosa")
    expect(csvCell('+34600')).toBe("'+34600")
    expect(csvCell('-cmd')).toBe("'-cmd")
    expect(csvCell('@sum(a1)')).toBe("'@sum(a1)")
    expect(csvCell('＝completa')).toBe("'＝completa")
    expect(csvCell('＋completa')).toBe("'＋completa")
    expect(csvCell('－completa')).toBe("'－completa")
    expect(csvCell('＠completa')).toBe("'＠completa")
    expect(csvCell('\ttabulada')).toBe("'\ttabulada")
    // a guarded cell that still carries CR/LF also gets the RFC 4180 quoting
    expect(csvCell('\rretorno')).toBe("\"'\rretorno\"")
    expect(csvCell('\nlinea')).toBe("\"'\nlinea\"")
  })

  test('decides on the first non-space character and keeps the leading spaces verbatim', () => {
    expect(csvCell('   =cmd')).toBe("'   =cmd")
    expect(csvCell('\t\t@at')).toBe("'\t\t@at")
    expect(csvCell('  texto plano')).toBe('  texto plano')
    expect(csvCell('total-1')).toBe('total-1')
  })

  test('a finite number is exempt: its string form cannot start a formula, only a value', () => {
    expect(csvCell(-12.5)).toBe('-12.5')
    expect(csvCell(3)).toBe('3')
    expect(csvCell(-0)).toBe('0')
  })

  test('keeps the nullish-to-empty-cell contract the alert export already had', () => {
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(null)).toBe('')
  })

  test('tableToCsv applies the guard to the whole row (a hostile host in the table twin)', () => {
    const csv = tableToCsv(['Host', 'Alertas'], [['=equipo.maligno', 3], ['equipo bueno', -2]])
    expect(csv).toBe('Host,Alertas\r\n\'=equipo.maligno,3\r\n' + 'equipo bueno,-2\r\n')
  })
})

describe('tableToCsv', () => {
  test('emits an RFC 4180 body: header, CRLF rows, trailing CRLF', () => {
    const csv = tableToCsv(['Día', 'Total'], [['lunes', 4], ['martes', 'con, coma']])
    expect(csv).toBe('Día,Total\r\nlunes,4\r\nmartes,"con, coma"\r\n')
  })

  test('keeps an empty body honest (header only)', () => {
    expect(tableToCsv(['Día'], [])).toBe('Día\r\n')
  })
})

describe('slugFileName', () => {
  test('folds accents, dashes the rest and lowercases', () => {
    expect(slugFileName('Carga de alertas por hora y día')).toBe('carga-de-alertas-por-hora-y-dia')
    expect(slugFileName('Evolución del riesgo por equipo')).toBe('evolucion-del-riesgo-por-equipo')
  })

  test('collapses symbol runs and trims the edges', () => {
    expect(slugFileName('ATT&CK × táctica!')).toBe('att-ck-tactica')
    expect(slugFileName('  --Cobertura--  ')).toBe('cobertura')
  })

  test('caps the length and never returns an empty base', () => {
    expect(slugFileName('x'.repeat(80))).toHaveLength(60)
    expect(slugFileName('***')).toBe('grafica')
    expect(slugFileName('')).toBe('grafica')
  })
})

// ---- structural fakes for the SVG inliner ----

type FakeAttrs = Record<string, string | undefined>

function fakeNode(attrs: FakeAttrs = {}, children: FakeNode[] = []): FakeNode {
  const own: FakeAttrs = { ...attrs }
  return {
    own,
    children,
    getAttribute: (name: string) => own[name] ?? null,
    setAttribute: (name: string, value: string) => {
      own[name] = value
    },
  }
}

type FakeNode = InlineNode & { own: FakeAttrs }

/** Read a fake node's attribute bag through the structural contract. */
function ownOf(node: InlineNode): FakeAttrs {
  return (node as FakeNode).own
}

function fakeStyleOf(values: FakeAttrs) {
  return () =>
    ({
      getPropertyValue: (prop: string) => values[prop] ?? '',
    }) as unknown as CSSStyleDeclaration
}

describe('inlineSvgStyles', () => {
  test('pins computed presentation values onto the clone in lockstep', () => {
    const original = fakeNode({}, [fakeNode({ fill: 'url(#g)' }, [fakeNode()])])
    const clone = fakeNode({}, [fakeNode({}, [fakeNode()])])
    // The fake style is constant, so every node in the walk gets the same
    // computed value pinned; that is exactly the contract the DOM half
    // relies on (getComputedStyle resolves per real element there).
    inlineSvgStyles(original, clone, fakeStyleOf({ fill: 'rgb(228, 78, 66)', 'stop-color': '#123456' }))
    expect(ownOf(clone)['fill']).toBe('rgb(228, 78, 66)')
    expect(ownOf(clone.children[0])['fill']).toBe('rgb(228, 78, 66)')
    expect(ownOf(clone.children[0].children[0])['fill']).toBe('rgb(228, 78, 66)')
    expect(ownOf(clone)['stop-color']).toBe('#123456')
  })

  test('skips empty, none and unresolved var() values instead of inventing ink', () => {
    const original = fakeNode()
    const clone = fakeNode()
    inlineSvgStyles(original, clone, fakeStyleOf({ fill: 'var(--seq-1)', stroke: 'none', 'stroke-width': '' }))
    expect(ownOf(clone)['fill']).toBeUndefined()
    expect(ownOf(clone)['stroke']).toBeUndefined()
    expect(ownOf(clone)['stroke-width']).toBeUndefined()
  })

  test('a computed none is skipped so the element stays transparent', () => {
    const original = fakeNode()
    const clone = fakeNode()
    inlineSvgStyles(original, clone, fakeStyleOf({ fill: 'none' }))
    expect(ownOf(clone)['fill']).toBeUndefined()
  })

  test('mismatched tree shapes never crash (shared prefix only)', () => {
    const original = fakeNode({}, [fakeNode(), fakeNode()])
    const clone = fakeNode()
    expect(() => inlineSvgStyles(original, clone, fakeStyleOf({ fill: '#fff' }))).not.toThrow()
  })
})
