// Hands the browser the analyst hub credential (HUB_ACCESS_TOKEN).
//
// The hub (web/console-service) authenticates every socket with this
// token when it is configured. The browser cannot hold it in the bundle
// (NEXT_PUBLIC_* values are public by definition), so it asks this
// same-origin route for it: the request crossed the console's own gate
// first (src/proxy.ts with CONSOLE_ACCESS_TOKEN), and the route applies
// the same credential and host-pinning checks as the engine proxy.

import { authorized, unauthorizedResponse } from '@/lib/access'

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
  if (!(await authorized(request))) return unauthorizedResponse()
  if (!hostAllowed(request) || request.headers.get('sec-fetch-site') === 'cross-site') {
    return Response.json({ error: 'host_not_allowed' }, { status: 403 })
  }
  return Response.json(
    { token: process.env.HUB_ACCESS_TOKEN || '' },
    { headers: { 'cache-control': 'no-store' } },
  )
}
