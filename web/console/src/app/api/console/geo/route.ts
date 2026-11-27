// Where some public IPv4 addresses are, by country, for the console's
// map: GET /api/console/geo?ips=185.220.101.4,8.8.8.8. The answer comes
// from the DB-IP table embedded in the console (lib/geo, CC BY 4.0): no
// address ever leaves the console to be located. Private and reserved
// addresses, and anything that is not an IPv4, come back as null.

import { principalFor, unauthorizedResponse } from '@/lib/access'
import { locateIPv4, type GeoPoint } from '@/lib/geo/ip-country'
import { readRefused } from '@/lib/request-guard'

export const dynamic = 'force-dynamic'

const MAX_IPS = 256

export async function GET(request: Request): Promise<Response> {
  const principal = await principalFor(request)
  if (!principal) return unauthorizedResponse()
  const refused = readRefused(request)
  if (refused) return refused
  const raw = new URL(request.url).searchParams.get('ips') ?? ''
  const ips = [...new Set(raw.split(',').map((ip) => ip.trim()).filter((ip) => ip.length > 0 && ip.length <= 15))]
  if (ips.length > MAX_IPS) {
    return Response.json({ error: 'too_many_ips', max: MAX_IPS }, { status: 400, headers: { 'cache-control': 'no-store' } })
  }
  const results: Record<string, GeoPoint | null> = {}
  for (const ip of ips) results[ip] = locateIPv4(ip)
  return Response.json(
    { results, attribution: 'IP Geolocation by DB-IP', source: 'https://db-ip.com' },
    { headers: { 'cache-control': 'private, max-age=3600' } },
  )
}
