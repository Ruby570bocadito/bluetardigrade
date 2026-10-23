// GET /cuenta/contrasena: a signed-in account changes its own password
// (lib/login.ts passwordPage, mode "self"), opened from the session
// panel. Behind the access gate like every console page.

import { principalFor } from '@/lib/access'
import { htmlResponse, passwordPage, redirectTo, unavailablePage } from '@/lib/login'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const principal = await principalFor(request)
  if (!principal) return redirectTo('/login?next=%2Fcuenta%2Fcontrasena')
  if (principal.source === 'domain') return htmlResponse(unavailablePage('contrasena', 'domain'))
  if (principal.mode !== 'users') return htmlResponse(unavailablePage('contrasena'))
  const error = new URL(request.url).searchParams.get('error')
  return htmlResponse(passwordPage({ user: principal.name, mode: 'self', error }))
}
