// POST /api/console/login: trades credentials for a session cookie
// (lib/sessions.ts). The login page posts a form and gets redirects;
// JSON clients get JSON. Public by design, like GET /login.
//
// Guards, in order: host pinning and a same-origin check (another site
// must not sign the operator's browser into an account of its choosing),
// then the credential through the same code as Basic auth (one lockout
// per account). Every attempt lands in the console audit trail.

import { accessToken, tokenEquals } from '@/lib/access'
import { redirectTo, safeNext } from '@/lib/login'
import { crossSiteContext, hostAllowed } from '@/lib/request-guard'
import { openSession, requestIsHttps, sessionCookie, tokenStamp } from '@/lib/sessions'
import { accountStamp, audit, usersFile, verifyAccount, type Principal } from '@/lib/users'

export const dynamic = 'force-dynamic'

const MAX_BODY = 4096
const NAME_RE = /^[\p{L}\p{N}._@ -]{1,64}$/u

type Fields = { user: string; password: string; next: string }

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
  return { user: str(get('user')).trim(), password: str(get('password')), next: str(get('next')) }
}

export async function POST(request: Request): Promise<Response> {
  const json = (request.headers.get('content-type') ?? '').toLowerCase().includes('application/json')
  const fields = await readFields(request, json)
  const next = safeNext(fields?.next)
  const back = (error: string, status: number) =>
    json ? Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } }) : redirectTo(`/login?error=${error}&next=${encodeURIComponent(next)}`)

  if (!hostAllowed(request) || crossSiteContext(request)) return back('origen', 403)
  const users = usersFile()
  const token = accessToken()
  if (!users && !token) return json ? Response.json({ ok: true, next }) : redirectTo(next)
  if (!fields || !fields.password || fields.password.length > 1024 || fields.user.length > 64) return back('credenciales', 401)

  let principal: Principal | null = null
  let stamp: string | null = null
  if (users) {
    principal = await verifyAccount(fields.user, fields.password)
    if (principal) stamp = await accountStamp(principal.name)
  } else if (await tokenEquals(fields.password, token)) {
    principal = { name: NAME_RE.test(fields.user) ? fields.user : 'operador', role: 'admin', mode: 'token' }
    stamp = await tokenStamp()
  }

  const record = (status: number) =>
    audit({
      at: new Date().toISOString(),
      user: principal?.name ?? (NAME_RE.test(fields.user) ? fields.user : '?'),
      role: principal?.role ?? '',
      mode: users ? 'users' : 'token',
      method: 'POST',
      path: '/login',
      status,
      outcome: principal ? 'ok' : 'denied',
    })
  if (!principal || !stamp) {
    record(401)
    return back('credenciales', 401)
  }
  const id = await openSession(principal, stamp)
  record(200)
  const cookie = sessionCookie(id, requestIsHttps(request))
  if (json) return Response.json({ ok: true, next, name: principal.name, role: principal.role }, { headers: { 'set-cookie': cookie, 'cache-control': 'no-store' } })
  return redirectTo(next, { 'set-cookie': cookie })
}
