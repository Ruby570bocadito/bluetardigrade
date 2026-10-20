// POST /api/console/login: trades credentials for a session cookie
// (lib/sessions.ts). The login page posts a form and gets redirects;
// JSON clients get JSON. Public by design, like GET /login.
//
// Guards, in order: host pinning and a same-origin check (another site
// must not sign the operator's browser into an account of its choosing),
// then the credential through the same code as Basic auth (one lockout
// per account). Every attempt lands in the console audit trail.
//
// An account with two-step sign-in (lib/mfa.ts), or whose role requires
// it, does not get its session from the password: the password opens a
// pending sign-in (lib/challenges.ts) and the form comes back with
// step=code (a code, or a recovery code) or step=enroll (the QR code
// its role requires first). Enrolling answers with the recovery codes
// page instead of a redirect: they are shown once. An account whose
// password an administrator reset (must_change) then posts
// step=password with its new password before its session opens.

import { accessToken, tokenEquals } from '@/lib/access'
import {
  challengeCookie, clearedChallengeCookie, closeChallenge, failedAttempt, openChallenge, readChallenge, readChallengeCookie,
} from '@/lib/challenges'
import { newPasswordProblem } from '@/lib/accounts'
import { htmlResponse, recoveryPage, redirectTo, safeNext } from '@/lib/login'
import { codeLocked, enroll, mfaState, verifySecondStep } from '@/lib/mfa'
import { crossSiteContext, hostAllowed } from '@/lib/request-guard'
import { openSession, requestIsHttps, sessionCookie, tokenStamp } from '@/lib/sessions'
import { newTotpSecret } from '@/lib/totp'
import { accountStamp, audit, findAccount, passwordHash, updateAccount, usersFile, verifyAccount, type Principal, type Role } from '@/lib/users'

export const dynamic = 'force-dynamic'

const MAX_BODY = 4096
const NAME_RE = /^[\p{L}\p{N}._@ -]{1,64}$/u

type Fields = { user: string; password: string; next: string; step: string; code: string; newPassword: string; repeat: string }

// readCapped stops at MAX_BODY bytes: this route is public, so an
// oversized body must not be buffered whole before it is refused.
async function readCapped(request: Request): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    all.set(c, at)
    at += c.byteLength
  }
  return new TextDecoder().decode(all)
}

async function readFields(request: Request, json: boolean): Promise<Fields | null> {
  const text = await readCapped(request)
  if (text === null) return null
  let get: (key: string) => unknown
  if (json) {
    let doc: unknown
    try {
      doc = JSON.parse(text)
    } catch {
      return null
    }
    if (!doc || typeof doc !== 'object') return null
    get = (key) => (doc as Record<string, unknown>)[key]
  } else {
    const form = new URLSearchParams(text)
    get = (key) => form.get(key)
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  return {
    user: str(get('user')).trim(),
    password: str(get('password')),
    next: str(get('next')),
    step: str(get('step')),
    code: str(get('code')).slice(0, 64),
    newPassword: str(get('new_password')),
    repeat: str(get('repeat')),
  }
}

type Reply = {
  json: boolean
  next: string
  // the form goes back to a page with this message; JSON gets it as error
  back: (error: string, status: number, path?: string) => Response
}

const audited = (user: string, role: Role | '', path: string, status: number, outcome: 'ok' | 'denied') =>
  audit({ at: new Date().toISOString(), user, role, mode: 'users', method: 'POST', path, status, outcome })

// signedIn opens the session and sends the browser on (or, after an
// enrollment, to the recovery codes it must save first).
async function signedIn(request: Request, reply: Reply, principal: Principal, stamp: string, extra: string[] = [], codes?: string[]): Promise<Response> {
  const id = await openSession(principal, stamp)
  const cookies = [sessionCookie(id, requestIsHttps(request)), ...extra]
  if (reply.json) {
    const res = Response.json({ ok: true, next: reply.next, name: principal.name, role: principal.role, ...(codes ? { recovery_codes: codes } : {}) }, { headers: { 'cache-control': 'no-store' } })
    for (const c of cookies) res.headers.append('set-cookie', c)
    return res
  }
  if (codes) return htmlResponse(recoveryPage({ codes, next: reply.next, first: true }), cookies)
  return redirectTo(reply.next, {}, cookies)
}

// authenticated: the credentials, and the second step if any, are done.
// An account whose password an administrator reset chooses its own
// before any session opens (a pending sign-in of kind "password");
// after an enrollment, the recovery codes page leads there.
async function authenticated(request: Request, reply: Reply, principal: Principal, stamp: string, extra: string[] = [], codes?: string[]): Promise<Response> {
  if (principal.mode !== 'users' || !findAccount(principal.name)?.mustChange) return signedIn(request, reply, principal, stamp, extra, codes)
  const id = await openChallenge({ user: principal.name, role: principal.role, kind: 'password', next: reply.next })
  // replaces the cleared cookie of a finished second step, if any
  const cookie = challengeCookie(id, requestIsHttps(request))
  const target = `/login?paso=contrasena&next=${encodeURIComponent(reply.next)}`
  if (reply.json) {
    const res = Response.json({ ok: false, step: 'contrasena', ...(codes ? { recovery_codes: codes } : {}) }, { headers: { 'cache-control': 'no-store' } })
    res.headers.append('set-cookie', cookie)
    return res
  }
  if (codes) return htmlResponse(recoveryPage({ codes, next: target, first: true }), [cookie])
  return redirectTo(target, {}, [cookie])
}

// passwordStep: the owner of a reset account sets a new password, which
// is written to the users file before the session opens.
async function passwordStep(request: Request, reply: Reply, fields: Fields): Promise<Response> {
  const id = readChallengeCookie(request)
  const pending = await readChallenge(id)
  if (!pending || pending.kind !== 'password') return reply.back('caducado', 401)
  const problem = await newPasswordProblem(pending.user, fields.newPassword, fields.repeat)
  if (problem) {
    audited(pending.user, '', '/login/contrasena', 400, 'denied')
    if (!(await failedAttempt(id))) return reply.back('caducado', 401)
    return reply.back(problem, 400, `/login?paso=contrasena&error=${problem}&next=${encodeURIComponent(pending.next)}`)
  }
  const hash = await passwordHash(fields.newPassword)
  const error = updateAccount(pending.user, (entry) => {
    entry.password = hash
    delete entry.must_change
  })
  if (error) return reply.back('escritura', 500, `/login?paso=contrasena&error=escritura&next=${encodeURIComponent(pending.next)}`)
  await closeChallenge(id)
  const account = findAccount(pending.user)
  const stamp = await accountStamp(pending.user)
  if (!account || !stamp) return reply.back('credenciales', 401)
  const principal: Principal = { name: account.user, role: account.role, mode: 'users' }
  audited(principal.name, principal.role, '/login/contrasena', 200, 'ok')
  return signedIn(request, { ...reply, next: pending.next }, principal, stamp, [clearedChallengeCookie(requestIsHttps(request))])
}

// secondStep finishes a sign-in its password started: a code (or a
// recovery code), or the enrollment its role requires.
async function secondStep(request: Request, reply: Reply, code: string): Promise<Response> {
  const id = readChallengeCookie(request)
  const pending = await readChallenge(id)
  if (!pending || (pending.kind !== 'code' && pending.kind !== 'enroll')) return reply.back('caducado', 401)
  const page = pending.kind === 'code' ? 'codigo' : 'activar'
  const path = pending.kind === 'code' ? '/login/codigo' : '/login/activar'
  const result = pending.kind === 'code'
    ? await verifySecondStep(pending.user, code)
    : await enroll(pending.user, pending.secret ?? '', code)
  if (!result.ok) {
    audited(pending.user, '', path, result.reason === 'escritura' ? 500 : 401, 'denied')
    const alive = result.reason === 'codigo' ? await failedAttempt(id) : (await closeChallenge(id), false)
    if (!alive) return reply.back(result.reason === 'codigo' ? 'caducado' : result.reason, 401)
    return reply.back(result.reason, 401, `/login?paso=${page}&error=${result.reason}&next=${encodeURIComponent(pending.next)}`)
  }
  await closeChallenge(id)
  const account = findAccount(pending.user)
  const stamp = await accountStamp(pending.user)
  if (!account || !stamp) return reply.back('credenciales', 401)
  const principal: Principal = { name: account.user, role: account.role, mode: 'users' }
  if ('usedRecovery' in result && result.usedRecovery) audited(principal.name, principal.role, '/login/recuperacion', 200, 'ok')
  if (pending.kind === 'enroll') audited(principal.name, principal.role, '/mfa/activar', 200, 'ok')
  audited(principal.name, principal.role, '/login', 200, 'ok')
  const cleared = clearedChallengeCookie(requestIsHttps(request))
  return authenticated(request, { ...reply, next: pending.next }, principal, stamp, [cleared], 'codes' in result ? result.codes : undefined)
}

export async function POST(request: Request): Promise<Response> {
  const json = (request.headers.get('content-type') ?? '').toLowerCase().includes('application/json')
  const fields = await readFields(request, json)
  const next = safeNext(fields?.next)
  const reply: Reply = {
    json,
    next,
    back: (error, status, path) =>
      json
        ? Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } })
        : redirectTo(path ?? `/login?error=${error}&next=${encodeURIComponent(next)}`),
  }

  if (!hostAllowed(request) || crossSiteContext(request)) return reply.back('origen', 403)
  const users = usersFile()
  const token = accessToken()
  if (!users && !token) return json ? Response.json({ ok: true, next }) : redirectTo(next)
  if (users && fields && (fields.step === 'code' || fields.step === 'enroll')) return secondStep(request, reply, fields.code)
  if (users && fields && fields.step === 'password') return passwordStep(request, reply, fields)
  if (!fields || !fields.password || fields.password.length > 1024 || fields.user.length > 64) return reply.back('credenciales', 401)

  const typedName = NAME_RE.test(fields.user) ? fields.user : '?'
  if (!users) {
    if (!(await tokenEquals(fields.password, token))) {
      audit({ at: new Date().toISOString(), user: typedName, role: '', mode: 'token', method: 'POST', path: '/login', status: 401, outcome: 'denied' })
      return reply.back('credenciales', 401)
    }
    const principal: Principal = { name: typedName === '?' ? 'operador' : typedName, role: 'admin', mode: 'token' }
    audit({ at: new Date().toISOString(), user: principal.name, role: 'admin', mode: 'token', method: 'POST', path: '/login', status: 200, outcome: 'ok' })
    return signedIn(request, reply, principal, (await tokenStamp()) as string)
  }

  const principal = await verifyAccount(fields.user, fields.password)
  const stamp = principal ? await accountStamp(principal.name) : null
  if (!principal || !stamp) {
    audited(typedName, '', '/login', 401, 'denied')
    return reply.back('credenciales', 401)
  }
  const state = mfaState(principal.name)
  if (!state || (!state.enrolled && !state.required)) {
    audited(principal.name, principal.role, '/login', 200, 'ok')
    return authenticated(request, reply, principal, stamp)
  }
  // the password was right; the session waits for the second step
  if (codeLocked(principal.name)) {
    audited(principal.name, '', '/login/codigo', 401, 'denied')
    return reply.back('bloqueada', 401)
  }
  const kind = state.enrolled ? 'code' : 'enroll'
  const id = await openChallenge({ user: principal.name, role: principal.role, kind, secret: kind === 'enroll' ? newTotpSecret() : undefined, next })
  const cookie = challengeCookie(id, requestIsHttps(request))
  const step = kind === 'code' ? 'codigo' : 'activar'
  if (json) {
    const res = Response.json({ ok: false, step }, { headers: { 'cache-control': 'no-store' } })
    res.headers.append('set-cookie', cookie)
    return res
  }
  return redirectTo(`/login?paso=${step}&next=${encodeURIComponent(next)}`, {}, [cookie])
}
