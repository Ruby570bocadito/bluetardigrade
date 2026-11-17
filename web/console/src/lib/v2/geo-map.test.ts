import { describe, expect, test } from 'bun:test'
import type { SfAlert, SfEvent } from '@/lib/console-types'
import { countryMarks, destinations, gridPoint, markRadius } from './geo-map'

const ev = (ip: string | undefined) => ({ id: Math.random().toString(), timestamp: '', type: 'network.connect', source: 'etw', host: 'WS-014', network: ip ? { destination_ip: ip } : undefined }) as SfEvent
const alert = (ip: string, eventId = 'x') => ({ id: 'a', timestamp: '', severity: 'high', host: 'WS-014', event_id: eventId, network: ip ? { destination_ip: ip } : undefined }) as unknown as SfAlert

describe('world map data', () => {
  test('keeps public destinations only, counting connections and alerts, alerted first', () => {
    const d = destinations(
      [ev('185.220.101.4'), ev('185.220.101.4'), ev('10.0.0.5'), ev('8.8.8.8'), ev(undefined), ev('192.168.1.1')],
      [alert('185.220.101.4'), alert('172.16.0.9')],
    )
    expect(d).toEqual([
      { ip: '185.220.101.4', connections: 2, alerts: 1 },
      { ip: '8.8.8.8', connections: 1, alerts: 0 },
    ])
  })

  test('an alert raised by a connection points at that connection', () => {
    const connection = { ...ev('8.8.4.4'), id: 'ev-1' }
    expect(destinations([connection], [alert('', 'ev-1')])).toEqual([{ ip: '8.8.4.4', connections: 1, alerts: 1 }])
  })

  test('gathers by country and counts what could not be placed', () => {
    const { marks, unlocated } = countryMarks(
      [
        { ip: '185.220.101.4', connections: 2, alerts: 1 },
        { ip: '185.220.101.5', connections: 1, alerts: 0 },
        { ip: '8.8.8.8', connections: 4, alerts: 0 },
        { ip: '203.0.0.1', connections: 1, alerts: 0 },
        { ip: '1.1.1.1', connections: 1, alerts: 0 },
      ],
      { '185.220.101.4': { country: 'DE', lat: 51, lon: 10 }, '185.220.101.5': { country: 'DE', lat: 51, lon: 10 }, '8.8.8.8': { country: 'US', lat: 39, lon: -98 }, '203.0.0.1': null },
    )
    // 1.1.1.1 has no answer yet: neither placed nor counted as unplaceable
    expect(unlocated).toBe(1)
    // alerted countries are drawn last, so they sit on top
    expect(marks.map((m) => [m.country, m.ips, m.connections, m.alerts])).toEqual([
      ['US', 1, 4, 0],
      ['DE', 2, 3, 1],
    ])
  })

  test('places on the dotted grid and sizes the marks gently', () => {
    expect(gridPoint(84, -180)).toEqual([0, 0])
    expect(gridPoint(40, 0)).toEqual([90, 22])
    expect(markRadius(1)).toBeLessThan(markRadius(10))
    expect(markRadius(10_000)).toBe(2.25)
  })
})
