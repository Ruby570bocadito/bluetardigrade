// What the world map of the command center shows: the public addresses
// the hosts connected to (the network events the console holds) and the
// ones alerts point at, gathered by country. Private traffic has no place
// on a world map and is left out; nothing is placed without a lookup.
import type { SfAlert, SfEvent } from '@/lib/console-types'
import { isPublicIPv4, parseIPv4 } from '@/lib/geo/ip'
import { GRID_LAT_TOP, GRID_STEP } from './world-grid'

export type Destination = { ip: string; connections: number; alerts: number }

const isPublic = (ip: string | undefined): ip is string => {
  if (!ip) return false
  const n = parseIPv4(ip)
  return n !== null && isPublicIPv4(n)
}

/** Public destinations of the recent network events and of the alerts, busiest first. */
export function destinations(events: readonly SfEvent[], alerts: readonly SfAlert[]): Destination[] {
  const out = new Map<string, Destination>()
  const at = (ip: string) => {
    let d = out.get(ip)
    if (!d) out.set(ip, (d = { ip, connections: 0, alerts: 0 }))
    return d
  }
  const byEvent = new Map<string, string>()
  for (const ev of events) {
    const ip = ev.network?.destination_ip?.trim()
    if (!isPublic(ip)) continue
    at(ip).connections++
    byEvent.set(ev.id, ip)
  }
  // an alert points at its own flow, or at the connection that raised it
  for (const a of alerts) {
    const ip = a.network?.destination_ip?.trim() || byEvent.get(a.event_id)
    if (isPublic(ip)) at(ip).alerts++
  }
  return [...out.values()].sort((x, y) => y.alerts - x.alerts || y.connections - x.connections || x.ip.localeCompare(y.ip))
}

export type Located = { country: string; lat: number; lon: number }

export type CountryMark = { country: string; lat: number; lon: number; ips: number; connections: number; alerts: number }

/** The destinations gathered by country (the ones with alerts first), and how many could not be placed. */
export function countryMarks(dests: readonly Destination[], located: Readonly<Record<string, Located | null | undefined>>): { marks: CountryMark[]; unlocated: number } {
  const byCountry = new Map<string, CountryMark>()
  let unlocated = 0
  for (const d of dests) {
    const geo = located[d.ip]
    if (!geo) {
      if (geo === null) unlocated++
      continue
    }
    let m = byCountry.get(geo.country)
    if (!m) byCountry.set(geo.country, (m = { country: geo.country, lat: geo.lat, lon: geo.lon, ips: 0, connections: 0, alerts: 0 }))
    m.ips++
    m.connections += d.connections
    m.alerts += d.alerts
  }
  const marks = [...byCountry.values()].sort((x, y) => Number(x.alerts > 0) - Number(y.alerts > 0) || x.ips - y.ips)
  return { marks, unlocated }
}

/** A place on the dotted map, in the units of its grid (viewBox "0 0 cols rows"). */
export function gridPoint(lat: number, lon: number): [number, number] {
  return [(lon + 180) / GRID_STEP, (GRID_LAT_TOP - lat) / GRID_STEP]
}

/** Radius of a country mark in grid units: grows with the addresses, gently. */
export function markRadius(ips: number): number {
  return Math.round((0.75 + Math.min(1.5, Math.log2(1 + ips) * 0.45)) * 100) / 100
}
