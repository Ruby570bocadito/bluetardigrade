// Tests for the incident analysis payload builder: host+window grouping,
// severity-based caps, bundle digest round-robin and payload shape.

import { describe, expect, test } from 'bun:test'
import {
  buildIncidentAnalysis,
  digestBundle,
  groupAlertsByHostWindow,
  MAX_BUNDLE_EVENTS,
  MAX_INCIDENT_ALERTS,
  MAX_TIMELINE_ENTRIES,
  pickBundleAlert,
  selectAlertsForAnalysis,
  type IncidentMeta,
} from './incident-analysis'
import type { ForensicBundle } from './forensic'
import type { Severity, SfAlert } from './console-types'

function alert(overrides: Partial<SfAlert> & { id?: string }): SfAlert {
  return {
    id: 'a1',
    timestamp: '2026-10-05T10:00:00Z',
    rule_id: 'r-1',
    rule_name: 'regla de prueba',
    severity: 'high',
    host: 'LAB-WKS-01',
    event_id: 'ev-1',
    event_type: 'process.create',
    summary: 'resumen',
    matched_on: ['process.name'],
    ...overrides,
  } as SfAlert
}

const meta: IncidentMeta = {
  title: 'Caso de prueba',
  severity: 'high',
  status: 'investigating',
  hosts: ['LAB-WKS-01'],
}

describe('groupAlertsByHostWindow', () => {
  test('chains alerts within the window and splits across hosts', () => {
    const groups = groupAlertsByHostWindow([
      alert({ id: 'a1', timestamp: '2026-10-05T10:00:00Z' }),
      alert({ id: 'a2', timestamp: '2026-10-05T10:10:00Z' }),
      alert({ id: 'a3', host: 'SRV-DC-02', timestamp: '2026-10-05T10:05:00Z' }),
    ])
    expect(groups.map((g) => g.host)).toEqual(['LAB-WKS-01', 'SRV-DC-02'])
    expect(groups[0].alerts.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(groups[0].from).toBe('2026-10-05T10:00:00.000Z')
    expect(groups[0].to).toBe('2026-10-05T10:10:00.000Z')
  })

  test('opens a new window when the gap exceeds the window', () => {
    const groups = groupAlertsByHostWindow([
      alert({ id: 'a1', timestamp: '2026-10-05T10:00:00Z' }),
      alert({ id: 'a2', timestamp: '2026-10-05T10:31:00Z' }),
      alert({ id: 'a3', timestamp: '2026-10-05T10:45:00Z' }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].alerts.map((a) => a.id)).toEqual(['a1'])
    expect(groups[1].alerts.map((a) => a.id)).toEqual(['a2', 'a3'])
  })

  test('keeps a broken timestamp without crashing: it sorts as epoch and lands in its own window', () => {
    const groups = groupAlertsByHostWindow([
      alert({ id: 'a1', timestamp: 'not-a-date' }),
      alert({ id: 'a2', timestamp: '2026-10-05T10:00:00Z' }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].alerts.map((a) => a.id)).toEqual(['a1'])
    expect(groups[0].from).toBe('1970-01-01T00:00:00.000Z')
    expect(groups[1].alerts.map((a) => a.id)).toEqual(['a2'])
    expect(groups[1].to).toBe('2026-10-05T10:00:00.000Z')
  })

  test('sorts hosts alphabetically and alerts chronologically', () => {
    const groups = groupAlertsByHostWindow([
      alert({ id: 'b2', host: 'B-EQUIPO', timestamp: '2026-10-05T10:20:00Z' }),
      alert({ id: 'b1', host: 'B-EQUIPO', timestamp: '2026-10-05T10:10:00Z' }),
      alert({ id: 'a1', host: 'A-EQUIPO', timestamp: '2026-10-05T10:15:00Z' }),
    ])
    expect(groups.map((g) => g.host)).toEqual(['A-EQUIPO', 'B-EQUIPO'])
    expect(groups[1].alerts.map((a) => a.id)).toEqual(['b1', 'b2'])
  })
})

describe('selectAlertsForAnalysis', () => {
  test('caps by severity first and reports the omitted count', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      alert({ id: `a${i}`, severity: (i % 2 === 0 ? 'low' : 'medium') as Severity, timestamp: `2026-10-05T10:0${i % 10}:00Z` }),
    )
    const { picked, omitted } = selectAlertsForAnalysis(many)
    expect(picked).toHaveLength(MAX_INCIDENT_ALERTS)
    expect(omitted).toBe(4)
    // the six medium alerts travel first, then two of the four lows
    expect(picked.slice(0, 6).every((a) => a.severity === 'medium')).toBe(true)
    expect(picked.slice(6).every((a) => a.severity === 'low')).toBe(true)
  })

  test('breaks ties by recency and then by rule name', () => {
    const { picked } = selectAlertsForAnalysis([
      alert({ id: 'old', rule_name: 'igual', severity: 'low', timestamp: '2026-10-05T10:00:00Z' }),
      alert({ id: 'new', rule_name: 'igual', severity: 'low', timestamp: '2026-10-05T10:05:00Z' }),
      alert({ id: 'aaa', rule_name: 'AAA primero', severity: 'low', timestamp: '2026-10-05T10:05:00Z' }),
    ], 2)
    expect(picked.map((a) => a.id)).toEqual(['aaa', 'new'])
  })

  test('leaves a small selection untouched and omits nothing', () => {
    const alerts = [alert({ id: 'a1' }), alert({ id: 'a2' })]
    const { picked, omitted } = selectAlertsForAnalysis(alerts)
    expect(picked).toHaveLength(2)
    expect(omitted).toBe(0)
  })
})

describe('digestBundle', () => {
  function bundleOf(types: string[]): ForensicBundle {
    return {
      alert: { id: 'a1' },
      captured_at: '2026-10-05T10:06:00Z',
      host: 'LAB-WKS-01',
      window: '5m',
      timeline: types.map((type, i) => ({ id: `ev-${i}`, timestamp: `2026-10-05T10:0${i}:00Z`, type, host: 'LAB-WKS-01' })),
      summary: {
        events: types.length,
        process_creates: types.filter((t) => t === 'process.create').length,
        network_connects: 0,
        file_writes: 0,
        registry_sets: 0,
        process_accesses: 0,
        other: 0,
        distinct_users: 1,
        distinct_images: ['cmd.exe'],
      },
    }
  }

  test('keeps every event under the cap, in the frozen chronological order', () => {
    const digest = digestBundle(bundleOf(['process.create', 'network.connect', 'file.write']))
    expect(digest.alert_id).toBe('a1')
    expect(digest.events.map((e) => e.type)).toEqual(['process.create', 'network.connect', 'file.write'])
    expect(digest.summary?.events).toBe(3)
  })

  test('round-robins across types so one burst cannot crowd the rest out', () => {
    const types = [...Array(50).fill('network.connect'), 'process.create', 'registry.set']
    const digest = digestBundle(bundleOf(types))
    expect(digest.events).toHaveLength(MAX_BUNDLE_EVENTS)
    const kinds = new Set(digest.events.map((e) => e.type))
    expect(kinds.has('process.create')).toBe(true)
    expect(kinds.has('registry.set')).toBe(true)
    expect(kinds.has('network.connect')).toBe(true)
  })

  test('carries the frozen window metadata', () => {
    const digest = digestBundle(bundleOf(['process.create']))
    expect(digest.host).toBe('LAB-WKS-01')
    expect(digest.window).toBe('5m')
    expect(digest.captured_at).toBe('2026-10-05T10:06:00Z')
  })
})

describe('buildIncidentAnalysis', () => {
  test('assembles the incident payload with groups and timeline', () => {
    const timeline = Array.from({ length: 25 }, (_, i) => ({
      at: `2026-10-05T10:${String(i).padStart(2, '0')}:00Z`,
      kind: 'note' as const,
      text: `nota ${i}`,
    }))
    const payload = buildIncidentAnalysis({
      source: 'incident',
      incident: meta,
      alerts: [
        alert({ id: 'a1', timestamp: '2026-10-05T10:00:00Z' }),
        alert({ id: 'a2', timestamp: '2026-10-05T10:05:00Z' }),
      ],
      timeline,
    })
    expect(payload.source).toBe('incident')
    expect(payload.incident?.title).toBe('Caso de prueba')
    expect(payload.alerts).toHaveLength(2)
    expect(payload.omitted_alerts).toBeUndefined()
    expect(payload.groups).toEqual([
      { host: 'LAB-WKS-01', from: '2026-10-05T10:00:00.000Z', to: '2026-10-05T10:05:00.000Z', count: 2 },
    ])
    expect(payload.timeline).toHaveLength(MAX_TIMELINE_ENTRIES)
    expect(payload.timeline?.[0].text).toBe('nota 5')
  })

  test('selection source carries no timeline and labels the omission', () => {
    const many = Array.from({ length: 10 }, (_, i) => alert({ id: `a${i}`, severity: 'critical' as Severity }))
    const payload = buildIncidentAnalysis({ source: 'selection', alerts: many })
    expect(payload.source).toBe('selection')
    expect(payload.incident).toBeUndefined()
    expect(payload.timeline).toBeUndefined()
    expect(payload.alerts).toHaveLength(MAX_INCIDENT_ALERTS)
    expect(payload.omitted_alerts).toBe(2)
    expect(payload.groups).toEqual([
      { host: 'LAB-WKS-01', from: '2026-10-05T10:00:00.000Z', to: '2026-10-05T10:00:00.000Z', count: 8 },
    ])
  })

  test('an empty case produces an honest empty payload', () => {
    const payload = buildIncidentAnalysis({ source: 'incident', incident: meta, alerts: [] })
    expect(payload.alerts).toHaveLength(0)
    expect(payload.groups).toEqual([])
  })
})

describe('pickBundleAlert', () => {
  test('prefers the most severe alert that has an id', () => {
    const top = pickBundleAlert([
      alert({ id: undefined, severity: 'critical' }),
      alert({ id: 'low', severity: 'low' }),
      alert({ id: 'high', severity: 'high' }),
    ])
    expect(top?.id).toBe('high')
  })

  test('returns undefined when nothing carries an id', () => {
    expect(pickBundleAlert([alert({ id: undefined })])).toBeUndefined()
    expect(pickBundleAlert([])).toBeUndefined()
  })
})
