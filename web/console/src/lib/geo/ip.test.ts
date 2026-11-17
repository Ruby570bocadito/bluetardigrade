import { describe, expect, test } from 'bun:test'
import { isPublicIPv4, parseIPv4, publicIPv4s } from './ip'
import { countryIn, locateIPv4, parseCountryTable } from './ip-country'
import { COUNTRY_CENTROIDS } from './country-centroids'

describe('IPv4 helpers', () => {
  test('parse only plain dotted quads', () => {
    expect(parseIPv4('1.2.3.4')).toBe(16909060)
    expect(parseIPv4(' 255.255.255.255 ')).toBe(4294967295)
    for (const bad of ['1.2.3', '1.2.3.256', '01.2.3.4', '1.2.3.4:80', '::1', 'a.b.c.d', '']) expect(parseIPv4(bad)).toBeNull()
  })

  test('private, loopback, link-local, documentation and multicast never reach the map', () => {
    for (const ip of ['10.0.0.21', '172.16.5.1', '172.31.255.255', '192.168.1.10', '127.0.0.1', '169.254.1.1', '100.64.0.1', '192.0.2.7', '224.0.0.251', '0.0.0.0'])
      expect(isPublicIPv4(parseIPv4(ip)!)).toBe(false)
    for (const ip of ['8.8.8.8', '172.32.0.1', '185.220.101.4', '193.0.6.139']) expect(isPublicIPv4(parseIPv4(ip)!)).toBe(true)
  })

  test('publicIPv4s keeps each public address once, in order', () => {
    expect(publicIPv4s(['10.0.0.1', '8.8.8.8', undefined, '8.8.8.8', 'host.example', '185.220.101.4'])).toEqual(['8.8.8.8', '185.220.101.4'])
  })
})

describe('country table', () => {
  // a hand-made table: 0.0.0.0 nobody, 1.0.0.0 AU, 1.0.1.0 CN, 2.0.0.0 nobody
  const raw = (() => {
    const starts = [0, 16777216, 16777472, 33554432]
    const owners = [0, 1, 2, 0]
    const codes = ['--', 'AU', 'CN']
    const b = Buffer.alloc(10 + starts.length * 5 + 1 + codes.length * 2)
    b.write('BTGEO2', 0, 'ascii')
    b.writeUInt32LE(starts.length, 6)
    starts.forEach((s, i) => b.writeUInt32LE(s - (i ? starts[i - 1] : 0), 10 + i * 4))
    owners.forEach((o, i) => b.writeUInt8(o, 10 + starts.length * 4 + i))
    b.writeUInt8(codes.length, 10 + starts.length * 5)
    codes.forEach((c, i) => b.write(c, 11 + starts.length * 5 + i * 2, 'ascii'))
    return b
  })()

  test('finds the range an address falls in', () => {
    const table = parseCountryTable(raw)
    expect(countryIn(table, parseIPv4('1.0.0.5')!)).toBe('AU')
    expect(countryIn(table, parseIPv4('1.0.3.255')!)).toBe('CN')
    expect(countryIn(table, parseIPv4('0.1.2.3')!)).toBeNull()
    expect(countryIn(table, parseIPv4('9.9.9.9')!)).toBeNull()
  })

  test('the embedded DB-IP table answers for well-known addresses', () => {
    expect(locateIPv4('8.8.8.8')?.country).toBe('US')
    expect(locateIPv4('193.0.6.139')?.country).toBe('NL') // RIPE NCC, Amsterdam
    expect(locateIPv4('200.160.2.3')?.country).toBe('BR') // registro.br
    expect(locateIPv4('10.0.0.21')).toBeNull()
    const es = locateIPv4('80.58.61.250') // Telefónica, Spain
    expect(es?.country).toBe('ES')
    expect([es?.lat, es?.lon]).toEqual([...COUNTRY_CENTROIDS.ES])
  })
})
