// GET /login: the sign-in page (lib/login.ts). Public by design (the
// proxy lets it through without a session). A console without
// credentials, or a caller already signed in, goes straight on.

import { accessToken, lockedReason, principalFor } from '@/lib/access'
import { loginPage, redirectTo, safeNext } from '@/lib/login'
import { usersFile } from '@/lib/users'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const next = safeNext(url.searchParams.get('next'))
  const mode = usersFile() ? 'users' : accessToken() ? 'token' : null
  if (!mode || (await principalFor(request))) return redirectTo(next)
  return new Response(loginPage({ mode, next, error: url.searchParams.get('error'), locked: lockedReason() }), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}
