import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AREAS, areaColor, areaOf, areaSelection } from './areas'
import { CONSOLE_DESTINATIONS } from './console-commands'

const css = readFileSync(join(import.meta.dir, '..', 'app', 'globals.css'), 'utf8')

/** The declarations of the first top-level rule with this exact selector. */
function block(selector: string): string {
  const start = css.indexOf('\n' + selector + ' {')
  expect(start).toBeGreaterThan(-1)
  const end = css.indexOf('\n}', start)
  return css.slice(start, end)
}

describe('area hues', () => {
  test('every view belongs to an area', () => {
    for (const { id } of CONSOLE_DESTINATIONS) expect(AREAS).toContain(areaOf(id))
  })

  test('the detection tabs share one area, and so do the alert views', () => {
    for (const view of ['reglas', 'cadenas', 'inteligencia', 'supresiones', 'probador', 'ruido', 'simulacion'] as const) {
      expect(areaOf(view)).toBe('detection')
    }
    expect(areaOf('alertas')).toBe(areaOf('incidentes'))
  })

  test('the colour is a theme-aware token, never a literal', () => {
    expect(areaColor('fleet')).toBe('var(--area-fleet)')
    expect(areaSelection('alerts').backgroundColor).toBe('color-mix(in srgb, var(--area-alerts) 15%, transparent)')
  })

  test('each area is defined for dark, light and the dark sidebar island', () => {
    for (const selector of [':root', 'html.light', 'html.light .theme-island-dark']) {
      const rules = block(selector)
      for (const area of AREAS) expect(rules).toMatch(new RegExp(`--area-${area}: #[0-9a-f]{6};`))
    }
  })
})
