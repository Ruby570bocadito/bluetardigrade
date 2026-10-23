// POST /api/console/mfa: the forms of /cuenta/dos-pasos for the
// signed-in account. action=activar (a code of the new secret the page
// showed), recuperacion (new recovery codes) or desactivar, the last two
// against a current code. Behind the access gate; same-origin only.
//
// Enrolling and disabling change the account's stamp, which ends its
// sessions (lib/sessions.ts): enrolling hands the operator a new
// session on the spot, disabling signs them out.

import { principalFor, unauthorizedResponse } from '@/lib/access'
import { clearedChallengeCookie, closeChallenge, failedAttempt, readChallenge, readChallengeCookie } from '@/lib/challenges'
import { htmlResponse, recoveryPage, redirectTo } from '@/lib/login'
import { disable, enroll, regenerateRecovery } from '@/lib/mfa'
import { crossSiteContext, hostAllowed } from '@/lib/request-guard'
import { clearedSessionCookie, closeSession, openSession, readSessionCookie, requestIsHttps, sessionCookie } from '@/lib/sessions'
import { accountStamp, audit, type Principal } from '@/lib/users'

export const dynamic = 'force-dynamic'

const MAX_BODY = 2048

export async function POST(request: Request): Promise<Response> {
  if (!hostAllowed(request) || crossSiteContext(request)) {
    return Response.json({ error: 'cross_site', hint: 'Solo la propia consola puede cambiar la verificación en dos pasos.' }, { status: 403 })
  }
  const principal = await principalFor(request)
  if (!principal) return unauthorizedResponse()
  if (principal.mode !== 'users') return Response.json({ error: 'no_accounts' }, { status: 400 })
  // the directory owns a domain account's password and second step
  if (principal.source === 'domain') return Response.json({ error: 'domain_account' }, { status: 400 })
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return redirectTo('/cuenta/dos-pasos?error=codigo')
  const form = new URLSearchParams((await request.text()).slice(0, MAX_BODY))
  const action = form.get('action') ?? ''
  const code = (form.get('code') ?? '').slice(0, 64)
  const secure = requestIsHttps(request)
  const record = (path: string, ok: boolean) =>
    audit({ at: new Date().toISOString(), user: principal.name, role: principal.role, mode: 'users', method: 'POST', path, status: ok ? 200 : 401, outcome: ok ? 'ok' : 'denied' })
  const again = (error: string) => redirectTo(`/cuenta/dos-pasos?error=${error}`)

  if (action === 'activar') {
    const id = readChallengeCookie(request)
    const pending = await readChallenge(id)
    if (!pending || pending.kind !== 'account' || pending.user !== principal.name || !pending.secret) return again('caducado')
    const result = await enroll(principal.name, pending.secret, code)
    record('/mfa/activar', result.ok)
    if (!result.ok) {
      if (result.reason !== 'codigo' || !(await failedAttempt(id))) await closeChallenge(id)
      return again(result.reason)
    }
    await closeChallenge(id)
    // the old session ended with the stamp: hand over a new one
    await closeSession(readSessionCookie(request))
    const fresh = await openSession(principal as Principal, (await accountStamp(principal.name)) as string)
    return htmlResponse(recoveryPage({ codes: result.codes, next: '/', first: true }), [sessionCookie(fresh, secure), clearedChallengeCookie(secure)])
  }
  if (action === 'recuperacion') {
    const result = await regenerateRecovery(principal.name, code)
    record('/mfa/recuperacion', result.ok)
    if (!result.ok) return again(result.reason)
    return htmlResponse(recoveryPage({ codes: result.codes, next: '/', first: false }))
  }
  if (action === 'desactivar') {
    const result = await disable(principal.name, code)
    record('/mfa/desactivar', result.ok)
    if (!result.ok) return again(result.reason)
    await closeSession(readSessionCookie(request))
    return redirectTo('/login?error=desactivada', {}, [clearedSessionCookie(secure)])
  }
  return again('codigo')
}
