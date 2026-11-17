// v2 · Plataforma: how the page arranges the engine's status report
// (lib/platform-status, the single source of every figure and label):
// the detectors and per-host quotas in their own panel, the rest in two
// balanced columns, and what the engine does not publish named once per
// section instead of row by row.
import { rowsHealth, type Health, type PlatformStatusReport, type StatusRow, type StatusSection } from '@/lib/platform-status'

export const DETECTOR_SECTIONS = ['deteccion', 'cuotas'] as const

export function splitSections(report: PlatformStatusReport): { detectors: StatusSection[]; rest: StatusSection[] } {
  const isDetector = (s: StatusSection) => (DETECTOR_SECTIONS as readonly string[]).includes(s.key)
  return { detectors: report.sections.filter(isDetector), rest: report.sections.filter((s) => !isDetector(s)) }
}

/** The rows the engine publishes, and the labels of the ones it does not. */
export function publishedRows(rows: readonly StatusRow[]): { shown: StatusRow[]; absent: string[] } {
  return { shown: rows.filter((r) => !r.absent), absent: rows.filter((r) => r.absent).map((r) => r.label) }
}

/** Two columns of similar height: each section goes to the shorter one, in order. */
export function balanceColumns(sections: readonly StatusSection[]): [StatusSection[], StatusSection[]] {
  const cols: [StatusSection[], StatusSection[]] = [[], []]
  const height = [0, 0]
  for (const s of sections) {
    const weight = 2 + publishedRows(s.rows).shown.length
    const i = height[1] < height[0] ? 1 : 0
    cols[i].push(s)
    height[i] += weight
  }
  return cols
}

export function sectionHealth(section: StatusSection): Health {
  return rowsHealth(section.rows)
}

/** How many sections need a look (warn or bad). */
export function sectionsToReview(report: PlatformStatusReport): number {
  return report.sections.filter((s) => {
    const h = sectionHealth(s)
    return h === 'warn' || h === 'bad'
  }).length
}

/** The share a capacity meter fills, 0–100. */
export function fillShare(fill: { value: number; max: number }): number {
  if (!(fill.max > 0)) return 0
  return Math.min(100, Math.max(0, (fill.value / fill.max) * 100))
}
