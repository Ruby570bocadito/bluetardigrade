// Domain sign-in (AD-7), console half. The login page offers «Cuenta
// del dominio» next to the local accounts when CONSOLE_DOMAIN_AUTH=1
// and the console has a users file: local accounts stay as the
// fallback (a broken DC must never lock the administrators out), so
// domain sign-in only adds to them. Server-only.
//
// The credential check is the engine's (POST /api/auth/domain, armed
// with -domain-auth): an LDAPS bind as the user plus the role its AD
// groups grant. This module calls it SERVER SIDE, before any session
// exists, with the bridge token like every engine call — it is not on
// the browser's write list (app/api/engine WRITES) because no browser
// ever needs to reach it directly, and a pre-session route there would
// need a principal it cannot have yet.
//
// Who a domain account acts as: "DOMINIO\usuario". The backslash can
// never appear in a users-file name (lib/users.ts NAME_RE), so a
// domain session can never be mistaken for a local account — not by
// the password and two-step routes, not by attribution. The directory
// owns its password and its second step: a role the users file asks a
// second step of (mfa_required) is refused here rather than signed in
// with one factor.

import { mfaRequiredFor, usersFile, type Principal, type Role } from './users'

const ENGINE_URL = process.env.ENGINE_API_URL || 'http://127.0.0.1:7778'
// the engine's own budget tops at 20 s (timeout_ms); room for the reply
const TIMEOUT_MS = 25_000
const USER_RE = /^[\p{L}\p{N}._$ -]{1,64}$/u
const DOMAIN_RE = /^[\p{L}\p{N}._-]{1,32}$/u

export function domainAuthEnabled(): boolean {
  return process.env.CONSOLE_DOMAIN_AUTH === '1' && usersFile() !== ''
}

// domainStamp: domain sessions live while domain sign-in stays on in
// the console; turning it off ends every one of them.
export async function domainStamp(): Promise<string | null> {
  return domainAuthEnabled() ? 'domain' : null
}

// The failure reasons the login page has a message for (lib/login.ts).
export type DomainFailure =
  | 'credenciales' // bad password or unknown user (never told apart)
  | 'formato' // a login name the engine refuses before any wire traffic
  | 'sin_rol' // valid user, no AD group mapped to a console role
  | 'mfa_dominio' // the role requires a second step the directory cannot give here
  | 'bloqueado' // too many failures from this console
  | 'dominio_apagado' // the engine runs without -domain-auth
  | 'dominio' // DC unreachable, TLS refused, search failed
  | 'motor' // the engine did not answer

export type DomainResult = { ok: true; principal: Principal } | { ok: false; reason: DomainFailure }

const isRole = (v: unknown): v is Role => v === 'admin' || v === 'analyst' || v === 'viewer'

// domainPrincipal turns the engine's verdict into who the console
// acts as, or null when the verdict is not something it can sign in.
export function domainPrincipal(body: unknown): Principal | null {
  if (!body || typeof body !== 'object') return null
  const doc = body as Record<string, unknown>
  if (doc.ok !== true || !isRole(doc.role) || typeof doc.user !== 'string' || !USER_RE.test(doc.user)) return null
  const domain = typeof doc.domain === 'string' && DOMAIN_RE.test(doc.domain) ? doc.domain.toUpperCase() : 'DOMINIO'
  return { name: `${domain}\\${doc.user}`, role: doc.role, mode: 'users', source: 'domain' }
}

const BY_STATUS: Record<number, DomainFailure> = {
  400: 'formato',
  401: 'credenciales',
  403: 'sin_rol',
  429: 'bloqueado',
  501: 'dominio_apagado',
  502: 'dominio',
}

export async function domainLogin(user: string, password: string, fetcher: typeof fetch = fetch): Promise<DomainResult> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' }
  const token = process.env.SF_API_TOKEN || ''
  if (token) headers.authorization = `Bearer ${token}`
  let res: Response
  try {
    res = await fetcher(`${ENGINE_URL}/api/auth/domain`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ user, password }),
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return { ok: false, reason: 'motor' }
  }
  if (res.status !== 200) return { ok: false, reason: BY_STATUS[res.status] ?? 'motor' }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { ok: false, reason: 'motor' }
  }
  const principal = domainPrincipal(body)
  if (!principal) return { ok: false, reason: 'motor' }
  if (mfaRequiredFor(principal.role)) return { ok: false, reason: 'mfa_dominio' }
  return { ok: true, principal }
}
