// The dotted world map of the command center, from the land grid baked by
// scripts/build-world-grid.mjs (equirectangular: one column per GRID_STEP
// degrees of longitude, one row per GRID_STEP degrees of latitude).
import { GRID_COLS, GRID_LAT_TOP, GRID_ROWS, GRID_STEP, LAND_GRID } from './world-grid'

export type Cell = readonly [col: number, row: number]

/** The land cells of a grid mask (bit i of byte i >> 3, row by row). */
export function landCells(maskB64: string, cols: number, rows: number): Cell[] {
  const bytes = typeof atob === 'function' ? atob(maskB64) : Buffer.from(maskB64, 'base64').toString('binary')
  const cells: Cell[] = []
  for (let i = 0; i < cols * rows; i++) {
    if (bytes.charCodeAt(i >> 3) & (1 << (i & 7))) cells.push([i % cols, Math.floor(i / cols)])
  }
  return cells
}

/** The grid cell holding a place (null outside the grid's latitudes). */
export function cellOf(lat: number, lon: number): Cell | null {
  const row = Math.floor((GRID_LAT_TOP - lat) / GRID_STEP)
  if (row < 0 || row >= GRID_ROWS) return null
  const col = Math.floor((((lon + 180) % 360) + 360) % 360 / GRID_STEP)
  return [Math.min(GRID_COLS - 1, col), row]
}

/**
 * One SVG path for every dot: a zero-length segment per cell, which a
 * round line cap draws as a dot (`viewBox="0 0 cols rows"`).
 */
export function dotPath(cells: readonly Cell[]): string {
  return cells.map(([c, r]) => `M${c + 0.5} ${r + 0.5}h0`).join('')
}

let cached: { cells: Cell[]; path: string } | null = null

/** The world map of world-grid.ts, decoded once. */
export function worldMap(): { cols: number; rows: number; cells: Cell[]; path: string } {
  if (!cached) {
    const cells = landCells(LAND_GRID, GRID_COLS, GRID_ROWS)
    cached = { cells, path: dotPath(cells) }
  }
  return { cols: GRID_COLS, rows: GRID_ROWS, ...cached }
}
