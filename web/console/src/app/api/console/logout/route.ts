// POST /api/console/logout: ends the caller's session and clears the
// cookie. Same-origin only, so another site cannot sign the operator
// out. A form post is redirected to the login page; fetch gets JSON.

import { principalFor } from '@/lib/access'
import { redirectTo } from '@/lib/login'
import { crossSiteContext, hostAllowed } from '@/lib/request-guard'
import { clearedSessionCookie, closeSession, readSessionCookie, requestIsHttps } from '@/lib/sessions'
import { audit } from '@/lib/users'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  const json = (request.headers.get('accept') ?? '').includes('application/json')
  if (!hostAllowed(request) || crossSiteContext(request)) {
    return Response.json({ error: 'cross_site', hint: 'Solo la propia consola puede cerrar la sesión.' }, { status: 403 })
  }
  const principal = await principalFor(request)
  await closeSession(readSessionCookie(request))
  if (principal && principal.mode !== 'open') {
    audit({ at: new Date().toISOString(), user: principal.name, role: principal.role, mode: principal.mode, method: 'POST', path: '/logout', status: 200, outcome: 'ok' })
  }
  const cookie = clearedSessionCookie(requestIsHttps(request))
  if (json) return Response.json({ ok: true }, { headers: { 'set-cookie': cookie, 'cache-control': 'no-store' } })
  return redirectTo('/login', { 'set-cookie': cookie })
}
