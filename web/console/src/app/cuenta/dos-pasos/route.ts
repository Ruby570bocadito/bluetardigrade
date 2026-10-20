// GET /cuenta/dos-pasos: the signed-in operator's two-step sign-in
// settings (lib/login.ts accountMfaPage), opened from the session panel.
// Behind the access gate like every console page. Enrolling keeps its
// new secret in a pending enrollment (lib/challenges.ts, kind
// "account"), so a reload or a wrong code shows the same QR code the
// app may already have scanned.

import { principalFor } from '@/lib/access'
import { challengeCookie, openChallenge, readChallenge, readChallengeCookie } from '@/lib/challenges'
import { accountMfaPage, htmlResponse, redirectTo, unavailablePage } from '@/lib/login'
import { mfaState } from '@/lib/mfa'
import { qrSvg } from '@/lib/qr'
import { requestIsHttps } from '@/lib/sessions'
import { newTotpSecret, otpauthUri } from '@/lib/totp'
import { ROLE_LABEL } from '@/lib/users'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const principal = await principalFor(request)
  if (!principal) return redirectTo('/login?next=%2Fcuenta%2Fdos-pasos')
  const state = principal.mode === 'users' ? mfaState(principal.name) : null
  if (!state) return htmlResponse(unavailablePage('dos-pasos'))
  const error = new URL(request.url).searchParams.get('error')
  const base = { user: principal.name, roleLabel: ROLE_LABEL[principal.role], state, error }
  if (state.enrolled) return htmlResponse(accountMfaPage(base))
  const pending = await readChallenge(readChallengeCookie(request))
  const reuse = pending?.kind === 'account' && pending.user === principal.name && pending.secret
  const secret = reuse ? (pending.secret as string) : newTotpSecret()
  const cookies = reuse
    ? []
    : [challengeCookie(await openChallenge({ user: principal.name, role: principal.role, kind: 'account', secret, next: '/' }), requestIsHttps(request))]
  const qr = qrSvg(otpauthUri(secret, principal.name), { title: 'Código QR para tu app de autenticación' })
  return htmlResponse(accountMfaPage({ ...base, enroll: { secret, qr } }), cookies)
}
