import { describe, expect, test } from 'bun:test'
import { chordTarget, fold, isTypingTarget, searchPalette, V2_SECTIONS, type PaletteItem } from './palette-model'

const items: PaletteItem[] = [
  { id: 's:deteccion', group: 'sections', label: 'Detección', href: '/v2/deteccion' },
  { id: 's:equipos', group: 'sections', label: 'Equipos', href: '/v2/equipos' },
  { id: 'h:srv', group: 'hosts', label: 'SRV-DC01', detail: '3 alertas abiertas' },
  { id: 'h:ws', group: 'hosts', label: 'WS-014' },
  { id: 'a:1', group: 'alerts', label: 'Kerberoasting', detail: 'SRV-DC01 · crítica' },
  { id: 'x:lang', group: 'actions', label: 'Cambiar a English', action: 'language' },
]

describe('palette model', () => {
  test('every section has its own chord', () => {
    const chords = V2_SECTIONS.map((s) => s.chord)
    expect(new Set(chords).size).toBe(chords.length)
    expect(chordTarget('D')?.href).toBe('/v2/directorio')
    expect(chordTarget('z')).toBeUndefined()
  })

  test('an empty query lists sections and actions', () => {
    expect(searchPalette(items, '  ').map((i) => i.id)).toEqual(['s:deteccion', 's:equipos', 'x:lang'])
  })

  test('words match without accents or case, across label and detail, in group order', () => {
    expect(searchPalette(items, 'srv-dc').map((i) => i.id)).toEqual(['h:srv', 'a:1'])
    expect(searchPalette(items, 'deteccion').map((i) => i.id)).toEqual(['s:deteccion'])
    expect(searchPalette(items, 'kerb critica').map((i) => i.id)).toEqual(['a:1'])
    expect(searchPalette(items, 'nada así')).toEqual([])
  })

  test('a label that starts with the query comes first and groups are capped', () => {
    const many: PaletteItem[] = Array.from({ length: 8 }, (_, i) => ({ id: `h${i}`, group: 'hosts', label: i === 7 ? 'web-07' : `srv-web-0${i}` }))
    const found = searchPalette(many, 'web', 3)
    expect(found.map((i) => i.id)).toEqual(['h7', 'h0', 'h1'])
  })

  test('folding and typing targets', () => {
    expect(fold('Detección ÁÉ')).toBe('deteccion ae')
    expect(isTypingTarget(null)).toBe(false)
    expect(isTypingTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true)
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true)
    expect(isTypingTarget({ tagName: 'BUTTON', isContentEditable: false } as unknown as EventTarget)).toBe(false)
  })
})
