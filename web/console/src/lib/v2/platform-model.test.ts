import { describe, expect, test } from 'bun:test'
import type { PlatformStatusReport, StatusRow, StatusSection } from '@/lib/platform-status'
import { balanceColumns, fillShare, publishedRows, sectionsToReview, splitSections } from './platform-model'

const row = (key: string, tone: StatusRow['tone'], absent = false): StatusRow => ({ key, label: key, display: absent ? 'no publicado' : '1', tone, absent })
const section = (key: string, rows: StatusRow[]): StatusSection => ({ key, title: key, rows })

describe('platform model', () => {
  const report: PlatformStatusReport = {
    sections: [
      section('motor', [row('a', 'neutral'), row('b', 'neutral', true)]),
      section('deteccion', [row('c', 'warn')]),
      section('ingesta', [row('d', 'bad'), row('e', 'ok'), row('f', 'ok')]),
      section('cuotas', [row('g', 'neutral', true)]),
      section('almacen', [row('h', 'ok')]),
    ],
    unavailable: [],
    healthy: false,
  }

  test('detectors and quotas go to their own panel', () => {
    const { detectors, rest } = splitSections(report)
    expect(detectors.map((s) => s.key)).toEqual(['deteccion', 'cuotas'])
    expect(rest.map((s) => s.key)).toEqual(['motor', 'ingesta', 'almacen'])
  })

  test('absent rows are named, not shown', () => {
    expect(publishedRows(report.sections[0].rows)).toEqual({ shown: [report.sections[0].rows[0]], absent: ['b'] })
  })

  test('columns stay balanced and keep the order inside each', () => {
    const [left, right] = balanceColumns(splitSections(report).rest)
    expect(left.map((s) => s.key)).toEqual(['motor', 'almacen'])
    expect(right.map((s) => s.key)).toEqual(['ingesta'])
  })

  test('sections to review and meter shares', () => {
    expect(sectionsToReview(report)).toBe(2)
    expect(fillShare({ value: 50, max: 200 })).toBe(25)
    expect(fillShare({ value: 9, max: 0 })).toBe(0)
    expect(fillShare({ value: 300, max: 200 })).toBe(100)
  })
})
