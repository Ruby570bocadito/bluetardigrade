import { describe, expect, test } from 'bun:test'
import { cellOf, dotPath, landCells, worldMap } from './world-map'
import { LOGO_BODY, logoSvg } from '@/lib/brand-logo'

describe('world map', () => {
  const map = worldMap()
  const land = new Set(map.cells.map(([c, r]) => `${c},${r}`))
  const isLand = (lat: number, lon: number) => {
    const cell = cellOf(lat, lon)
    return cell !== null && land.has(`${cell[0]},${cell[1]}`)
  }

  test('the baked grid is the real world: land where land is, sea where sea is', () => {
    expect(map.cols).toBe(180)
    expect(map.rows).toBe(71)
    // roughly three tenths of the grid is land
    expect(map.cells.length).toBeGreaterThan(3500)
    expect(map.cells.length).toBeLessThan(5500)
    for (const [lat, lon] of [[40.4, -3.7], [-15.8, -47.9], [35.7, 139.7], [-33.9, 151.2], [64.1, -21.9]]) {
      expect(isLand(lat, lon)).toBe(true) // Madrid, Brasilia, Tokyo, Sydney, Reykjavik
    }
    for (const [lat, lon] of [[30, -40], [-30, -120], [0, 80], [-40, 10]]) {
      expect(isLand(lat, lon)).toBe(false) // Atlantic, Pacific, Indian, South Atlantic
    }
  })

  test('cells outside the grid latitudes have no place on it', () => {
    expect(cellOf(-75, 0)).toBeNull()
    expect(cellOf(89, 0)).toBeNull()
    expect(cellOf(0, 180)).toEqual(cellOf(0, -180))
  })

  test('landCells reads one bit per cell and dotPath draws one dot per cell', () => {
    // bits 0 and 3 set: (0,0) and (1,1) on a 2 x 2 grid
    const cells = landCells(Buffer.from([0b1001]).toString('base64'), 2, 2)
    expect(cells).toEqual([[0, 0], [1, 1]])
    expect(dotPath(cells)).toBe('M0.5 0.5h0M1.5 1.5h0')
  })
})

describe('brand logo', () => {
  test('the sign-in pages draw the same figure as the console, in the color asked for', () => {
    const svg = logoSvg(40, '#123456')
    expect(svg).toContain(LOGO_BODY)
    expect(svg).toContain('width="40" height="33"')
    expect(svg).toContain('stroke="#123456"')
    expect(svg).not.toContain('<script')
  })
})
