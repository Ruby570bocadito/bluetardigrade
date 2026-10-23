// POST /api/console/password: the form of /cuenta/contrasena. The
// current password is checked through the same code as the sign-in (and
// its lockout), the new one against the console's rules; the users file
// then holds the new hash. The new hash changes the account's stamp,
// which ends all its sessions: this one is replaced on the spot.

import { principalFor, unauthorizedResponse } from '@/lib/access'
import { newPasswordProblem } from '@/lib/accounts'
import { htmlResponse, passwordChangedPage, redirectTo } from '@/lib/login'
import { crossSiteContext, hostAllowed } from '@/lib/request-guard'
import { closeSession, openSession, readSessionCookie, requestIsHttps, sessionCookie } from '@/lib/sessions'
import { accountStamp, audit, passwordHash, updateAccount, verifyAccount } from '@/lib/users'

export const dynamic = 'force-dynamic'

const MAX_BODY = 4096

export async function POST(request: Request): Promise<Response> {
  if (!hostAllowed(request) || crossSiteContext(request)) {
    return Response.json({ error: 'cross_site', hint: 'Solo la propia consola puede cambiar la contraseña.' }, { status: 403 })
  }
  const principal = await principalFor(request)
  if (!principal) return unauthorizedResponse()
  if (principal.mode !== 'users') return Response.json({ error: 'no_accounts' }, { status: 400 })
  // the directory owns a domain account's password and second step
  if (principal.source === 'domain') return Response.json({ error: 'domain_account' }, { status: 400 })
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return redirectTo('/cuenta/contrasena?error=larga')
  const form = new URLSearchParams((await request.text()).slice(0, MAX_BODY))
  const record = (ok: boolean, status: number) =>
    audit({ at: new Date().toISOString(), user: principal.name, role: principal.role, mode: 'users', method: 'POST', path: '/cuenta/contrasena', status, outcome: ok ? 'ok' : 'denied' })

  if (!(await verifyAccount(principal.name, form.get('current') ?? ''))) {
    record(false, 401)
    return redirectTo('/cuenta/contrasena?error=actual')
  }
  const password = form.get('new_password') ?? ''
  const problem = await newPasswordProblem(principal.name, password, form.get('repeat') ?? '')
  if (problem) {
    record(false, 400)
    return redirectTo(`/cuenta/contrasena?error=${problem}`)
  }
  const hash = await passwordHash(password)
  if (updateAccount(principal.name, (entry) => { entry.password = hash })) return redirectTo('/cuenta/contrasena?error=escritura')
  record(true, 200)
  await closeSession(readSessionCookie(request))
  const fresh = await openSession(principal, (await accountStamp(principal.name)) as string)
  return htmlResponse(passwordChangedPage(), [sessionCookie(fresh, requestIsHttps(request))])
}
