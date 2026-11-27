// IPv4 helpers shared by the console server (lookup) and the map (which
// addresses are worth asking about). Strict parsing: four decimal octets,
// no leading zeros games, no ports.

/** "185.220.101.4" -> 3118230788; null for anything that is not a plain IPv4. */
export function parseIPv4(raw: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(raw.trim())
  if (!m) return null
  let n = 0
  for (let i = 1; i <= 4; i++) {
    const octet = Number(m[i])
    if (octet > 255 || (m[i].length > 1 && m[i][0] === '0')) return null
    n = n * 256 + octet
  }
  return n
}

// address blocks that never sit anywhere on the map (RFC 6890 and friends):
// private, loopback, link-local, carrier NAT, documentation, multicast...
const RESERVED: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]
const BLOCKS = RESERVED.map(([base, bits]) => {
  const start = parseIPv4(base)!
  return [start, start + 2 ** (32 - bits) - 1] as const
})

/** Whether an IPv4 (as a number) is a public Internet address. */
export function isPublicIPv4(n: number): boolean {
  return !BLOCKS.some(([from, to]) => n >= from && n <= to)
}

/** The public IPv4 addresses among some strings, each once, in order. */
export function publicIPv4s(values: Iterable<string | undefined>): string[] {
  const out = new Set<string>()
  for (const v of values) {
    if (!v) continue
    const n = parseIPv4(v)
    if (n !== null && isPublicIPv4(n)) out.add(v.trim())
  }
  return [...out]
}
