// Hands the browser the analyst hub credential (HUB_ACCESS_TOKEN).
//
// The hub (web/console-service) authenticates every socket with this
// token when it is configured. The browser cannot hold it in the bundle
// (NEXT_PUBLIC_* values are public by definition), so it asks this
// same-origin route for it: the request crossed the console's own gate
// first (src/proxy.ts with CONSOLE_ACCESS_TOKEN), and the route applies
// the same credential and host-pinning checks as the engine proxy.
//
// The hub reads the engine with the console's own token and answers
// about every machine, so an account limited to host groups
// (lib/users.ts, scopeOf) gets no hub credential: the AI analyst is for
// accounts that see the whole fleet.

import { principalFor, unauthorizedResponse } from '@/lib/access'
import { scopeOf } from '@/lib/users'

export const dynamic = 'force-dynamic'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function hostAllowed(request: Request): boolean {
  const raw = request.headers.get('host') ?? new URL(request.url).host
  if (/[\s/@\\?#]/.test(raw)) return false
  let hostname: string
  try {
    hostname = new URL('http://' + raw).hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  } catch {
    return false
  }
  const extra = (process.env.CONSOLE_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  return LOOPBACK_HOSTS.has(hostname) || extra.includes(hostname)
}

export async function GET(request: Request): Promise<Response> {
  const principal = await principalFor(request)
  if (!principal) return unauthorizedResponse()
  if (!hostAllowed(request) || request.headers.get('sec-fetch-site') === 'cross-site') {
    return Response.json({ error: 'host_not_allowed' }, { status: 403 })
  }
  if (scopeOf(principal)) {
    return Response.json(
      { error: 'scoped_account', hint: 'El analista IA lee todos los equipos: no está disponible para cuentas limitadas a grupos de equipos.' },
      { status: 403, headers: { 'cache-control': 'no-store' } },
    )
  }
  return Response.json(
    { token: process.env.HUB_ACCESS_TOKEN || '' },
    { headers: { 'cache-control': 'no-store' } },
  )
}
