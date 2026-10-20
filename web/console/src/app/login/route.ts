// GET /login: the sign-in pages (lib/login.ts). Public by design (the
// proxy lets it through without a session). A console without
// credentials, or a caller already signed in, goes straight on.
//
// ?paso=codigo and ?paso=activar are the second step of an account with
// two-step sign-in (lib/mfa.ts): they need the pending sign-in its
// password opened (lib/challenges.ts), and fall back to the password
// form when it is gone.

import { accessToken, lockedReason, principalFor } from '@/lib/access'
import { readChallenge, readChallengeCookie } from '@/lib/challenges'
import { codePage, enrollPage, htmlResponse, loginPage, redirectTo, safeNext } from '@/lib/login'
import { qrSvg } from '@/lib/qr'
import { otpauthUri } from '@/lib/totp'
import { ROLE_LABEL, usersFile } from '@/lib/users'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const next = safeNext(url.searchParams.get('next'))
  const error = url.searchParams.get('error')
  const mode = usersFile() ? 'users' : accessToken() ? 'token' : null
  if (!mode || (await principalFor(request))) return redirectTo(next)
  const step = url.searchParams.get('paso')
  if (mode === 'users' && step) {
    const pending = await readChallenge(readChallengeCookie(request))
    if (pending?.kind === 'code' && step === 'codigo') return htmlResponse(codePage({ user: pending.user, next: pending.next, error }))
    if (pending?.kind === 'enroll' && step === 'activar' && pending.secret) {
      const qr = qrSvg(otpauthUri(pending.secret, pending.user), { title: 'Código QR para tu app de autenticación' })
      return htmlResponse(enrollPage({ user: pending.user, roleLabel: ROLE_LABEL[pending.role], secret: pending.secret, qr, next: pending.next, error }))
    }
    return htmlResponse(loginPage({ mode, next, error: 'caducado', locked: lockedReason() }))
  }
  return htmlResponse(loginPage({ mode, next, error, locked: lockedReason() }))
}
