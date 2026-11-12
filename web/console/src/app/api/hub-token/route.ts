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
import { readRefused } from '@/lib/request-guard'
import { scopeOf } from '@/lib/users'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const principal = await principalFor(request)
  if (!principal) return unauthorizedResponse()
  const refused = readRefused(request)
  if (refused) return refused
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
