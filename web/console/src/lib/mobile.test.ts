import { describe, expect, test } from 'bun:test'
import { fullConsoleHref, hostsByAttention, mobileCounts, mobileQueue, openIncidents, MOBILE_MAX_ITEMS } from './mobile'
import type { SfAlert } from './console-types'
import type { Incident } from './engine-writes'
import type { FleetHost, FleetPayload } from './fleet'

const alert = (id: string, severity: SfAlert['severity'], minute: number, status?: SfAlert['status']): SfAlert => ({
  id, severity, status, timestamp: new Date(Date.UTC(2026, 9, 23, 10, minute)).toISOString(),
  rule_id: 'r', rule_name: 'R', host: 'H', event_id: 'e', event_type: 'process.create', summary: '', matched_on: [],
})

describe('phone view helpers', () => {
  const alerts = [
    alert('a1', 'high', 1), alert('a2', 'critical', 2), alert('a3', 'critical', 5), alert('a4', 'medium', 9),
    alert('a5', 'critical', 7, 'closed'), alert('a6', 'high', 8, 'acknowledged'), { ...alert('x', 'critical', 9), id: undefined },
  ]

  test('the queue keeps open, triageable alerts above the floor, most severe and newest first', () => {
    expect(mobileQueue(alerts, 'critical').map((a) => a.id)).toEqual(['a3', 'a2'])
    expect(mobileQueue(alerts, 'high').map((a) => a.id)).toEqual(['a3', 'a2', 'a6', 'a1'])
    expect(mobileQueue(alerts, 'all').map((a) => a.id)).toEqual(['a3', 'a2', 'a6', 'a1', 'a4'])
    const many = Array.from({ length: 80 }, (_, i) => alert(`m${i}`, 'high', i % 60))
    expect(mobileQueue(many, 'all')).toHaveLength(MOBILE_MAX_ITEMS)
  })

  test('the chips count open alerts per floor', () => {
    expect(mobileCounts(alerts)).toEqual({ critical: 2, high: 4, all: 5 })
  })

  test('open incidents: severity, then the most recently touched', () => {
    const inc = (id: string, severity: Incident['severity'], status: Incident['status'], minute: number): Incident => ({
      id, title: id, severity, status, hosts: [], alert_ids: [], timeline: [], created_at: '', updated_at: new Date(Date.UTC(2026, 9, 23, 9, minute)).toISOString(),
    })
    const list = [inc('i1', 'high', 'open', 5), inc('i2', 'critical', 'investigating', 1), inc('i3', 'high', 'contained', 9), inc('i4', 'critical', 'closed', 9)]
    expect(openIncidents(list).map((i) => i.id)).toEqual(['i2', 'i3', 'i1'])
  })

  test('silent machines come first, then idle, then online', () => {
    const h = (host: string, status: FleetHost['status']) => ({ host, status }) as FleetHost
    const fleet = { hosts: [h('b', 'online'), h('a', 'online'), h('z', 'silent'), h('c', 'idle'), h('y', 'silent')] } as FleetPayload
    expect(hostsByAttention(fleet).map((x) => x.host)).toEqual(['y', 'z', 'c', 'a', 'b'])
    expect(hostsByAttention(null)).toEqual([])
  })

  test('links open the full console on the same record', () => {
    expect(fullConsoleHref('alert', 'abc')).toBe('/?view=alertas&alert=abc')
    expect(fullConsoleHref('incident', '0123456789abcdef')).toBe('/?view=incidentes&incidente=0123456789abcdef')
    expect(fullConsoleHref('host', 'LAB WKS')).toBe('/?view=equipos&host=LAB+WKS')
  })
})
