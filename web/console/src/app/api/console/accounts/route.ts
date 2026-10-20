// /api/console/accounts: account management for administrators
// (lib/accounts.ts). GET lists the accounts of the users file; POST
// {action, user, role?} creates, changes the role, disables or enables,
// resets the password, removes the two-step sign-in or deletes one.
// A creation or a reset answers with the temporary password, once.
//
// Only a signed-in administrator of the users file; writes are
// same-origin only and every one, allowed or refused, is audited with
// the account it targeted.

import { principalFor, unauthorizedResponse } from '@/lib/access'
import { accountAction, listAccounts } from '@/lib/accounts'
import { crossSiteContext, hostAllowed } from '@/lib/request-guard'
import { audit, type Principal } from '@/lib/users'

export const dynamic = 'force-dynamic'

const MAX_BODY = 2048
const NO_STORE = { 'cache-control': 'no-store' }

async function administrator(request: Request): Promise<Principal | Response> {
  const principal = await principalFor(request)
  if (!principal) return unauthorizedResponse()
  if (principal.mode !== 'users') {
    return Response.json({ error: 'no_accounts', hint: 'La consola no usa cuentas (CONSOLE_USERS_FILE): crea la primera con sf-console -AddUser.' }, { status: 400, headers: NO_STORE })
  }
  if (principal.role !== 'admin') return Response.json({ error: 'admin' }, { status: 403, headers: NO_STORE })
  return principal
}

export async function GET(request: Request): Promise<Response> {
  const actor = await administrator(request)
  if (actor instanceof Response) return actor
  const list = listAccounts()
  if ('error' in list) return Response.json({ error: 'fichero', hint: list.error }, { status: 500, headers: NO_STORE })
  return Response.json(list, { headers: NO_STORE })
}

export async function POST(request: Request): Promise<Response> {
  if (!hostAllowed(request) || crossSiteContext(request)) {
    return Response.json({ error: 'cross_site' }, { status: 403, headers: NO_STORE })
  }
  const actor = await administrator(request)
  if (actor instanceof Response) return actor
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return Response.json({ error: 'accion' }, { status: 413, headers: NO_STORE })
  let body: { action?: unknown; user?: unknown; role?: unknown }
  try {
    body = JSON.parse((await request.text()).slice(0, MAX_BODY))
  } catch {
    return Response.json({ error: 'accion' }, { status: 400, headers: NO_STORE })
  }
  const action = typeof body?.action === 'string' ? body.action : ''
  const result = await accountAction(actor, action, body ?? {})
  audit({
    at: new Date().toISOString(),
    user: actor.name,
    role: actor.role,
    mode: 'users',
    method: 'POST',
    path: `/accounts/${/^[a-z-]{1,16}$/.test(action) ? action : 'accion'}`,
    status: result.ok ? 200 : result.status,
    outcome: result.ok ? 'ok' : 'denied',
    target: result.ok ? result.user : typeof body?.user === 'string' ? body.user.slice(0, 64) : undefined,
  })
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status, headers: NO_STORE })
  return Response.json(result, { headers: NO_STORE })
}
