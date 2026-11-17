// Where an IPv4 address is, by country, without asking anyone: the DB-IP
// table embedded in dbip-ipv4.ts (built by scripts/build-geoip.mjs) is
// unpacked once per server process and searched in memory. Server only:
// the table never travels to the browser.
import { gunzipSync } from 'node:zlib'
import { COUNTRY_CENTROIDS } from './country-centroids'
import { DBIP_IPV4 } from './dbip-ipv4'
import { isPublicIPv4, parseIPv4 } from './ip'

export type CountryTable = { starts: Uint32Array; owners: Uint8Array; codes: string[] }

/** Unpacks the "BTGEO2" layout: count, start deltas, one country byte per range, the code list. */
export function parseCountryTable(raw: Buffer): CountryTable {
  if (raw.toString('ascii', 0, 6) !== 'BTGEO2') throw new Error('unknown geolocation table')
  const count = raw.readUInt32LE(6)
  const starts = new Uint32Array(count)
  let at = 0
  for (let i = 0; i < count; i++) {
    at += raw.readUInt32LE(10 + i * 4)
    starts[i] = at
  }
  const owners = new Uint8Array(raw.subarray(10 + count * 4, 10 + count * 5))
  const n = raw.readUInt8(10 + count * 5)
  const codes: string[] = []
  for (let i = 0; i < n; i++) codes.push(raw.toString('ascii', 11 + count * 5 + i * 2, 13 + count * 5 + i * 2))
  return { starts, owners, codes }
}

/** The country code of an address in a table (null when nobody owns it). */
export function countryIn(table: CountryTable, n: number): string | null {
  let lo = 0
  let hi = table.starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (table.starts[mid] <= n) lo = mid
    else hi = mid - 1
  }
  const code = table.codes[table.owners[lo]]
  return table.starts[lo] <= n && code && code !== '--' ? code : null
}

let table: CountryTable | null = null

export type GeoPoint = { country: string; lat: number; lon: number }

/** Country and map position of a public IPv4; null for anything else. */
export function locateIPv4(ip: string): GeoPoint | null {
  const n = parseIPv4(ip)
  if (n === null || !isPublicIPv4(n)) return null
  table ??= parseCountryTable(gunzipSync(Buffer.from(DBIP_IPV4, 'base64')))
  const country = countryIn(table, n)
  const at = country ? COUNTRY_CENTROIDS[country] : undefined
  return country && at ? { country, lat: at[0], lon: at[1] } : null
}
