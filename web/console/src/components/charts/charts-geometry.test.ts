// Geometry tests for the VIZ-1/VIZ-3 chart helpers: the annular sector
// of the donut and the ribbon / gutter-label helpers of the triage
// flow. They run without a DOM, so the SVG math stays honest even when
// jsdom cannot measure anything.

//   bun test            (from web/console/)

import { describe, expect, test } from 'bun:test'
import { donutSector } from './donut'
import { fitGutterLabel, ribbonPath } from './triage-flow'

describe('donutSector', () => {
  test('more than a half turn uses the large-arc flag', () => {
    const d = donutSector(100, 100, 90, 60, 0, Math.PI + 0.01)
    expect(d).toContain('A90,90 0 1 1')
    expect(d).toContain('A60,60 0 1 0')
    expect(d.endsWith('Z')).toBe(true)
  })

  test('an exact half turn stays a valid closed path', () => {
    const d = donutSector(100, 100, 90, 60, 0, Math.PI)
    expect(d).not.toContain('NaN')
    expect(d.endsWith('Z')).toBe(true)
  })

  test('a small slice keeps the small-arc flag and closed path', () => {
    const d = donutSector(100, 100, 90, 60, 0.1, 0.4)
    expect(d).toContain('A90,90 0 0 1')
    expect(d).not.toContain('NaN')
  })

  test('coordinates stay inside the outer radius box', () => {
    const d = donutSector(100, 100, 90, 60, 0.7, 2.4)
    const nums = d.match(/-?[\d.]+/g)?.map(Number) ?? []
    expect(nums.length).toBeGreaterThan(0)
    for (const n of nums) {
      expect(Number.isFinite(n)).toBe(true)
      // 0 and 1 are the SVG arc flags; every coordinate and radius sits
      // inside the [cx - rOut, cx + rOut] box
      if (n !== 0 && n !== 1) {
        expect(n).toBeGreaterThanOrEqual(10)
        expect(n).toBeLessThanOrEqual(190)
      }
    }
  })
})

describe('ribbonPath', () => {
  test('straight ribbon when both sides align', () => {
    const d = ribbonPath(100, 200, 50, 50, 10)
    expect(d.startsWith('M100,50')).toBe(true)
    expect(d).toContain('L200,60')
    expect(d.endsWith('Z')).toBe(true)
    expect(d).not.toContain('NaN')
  })

  test('a taller value keeps the ribbon height positive on both sides', () => {
    const d = ribbonPath(100, 200, 40, 90, 25)
    // bottom edges: target side first, then back to the source side
    expect(d).toContain(`L200,${90 + 25}`)
    expect(d).toContain(`C150,${90 + 25} 150,${40 + 25} 100,${40 + 25}`)
  })
})

describe('fitGutterLabel', () => {
  test('short labels pass through untouched', () => {
    expect(fitGutterLabel('sysmon', 10)).toBe('sysmon')
  })

  test('long labels are truncated with an ellipsis', () => {
    expect(fitGutterLabel('Escalada de privilegios', 10)).toBe('Escalada …')
  })

  test('a budget of 1 keeps one visible character plus the ellipsis', () => {
    expect(fitGutterLabel('impacto', 1)).toBe('i…')
  })
})
