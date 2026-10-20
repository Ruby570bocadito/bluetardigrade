// Console access control (CONSOLE_ACCESS_TOKEN, CONSOLE_USERS_FILE).
//
// Per-analyst accounts are optional (lib/users.ts): with
// CONSOLE_USERS_FILE set, only its accounts get in, each with its role,
// and the rest of this note describes the gate without them.
//
// Without accounts, whoever reaches the console reaches every event
// the engine holds, because the engine proxy injects SF_API_TOKEN on
// their behalf. Host pinning (route.ts) only stops browsers tricked by
// DNS rebinding: any non-browser client that can open a socket to the
// console can send `Host: localhost`. The real boundaries are therefore
// (1) binding to loopback (the default in package.json and the Windows
// launchers) and (2) this token whenever the console is reachable
// beyond loopback.
//
// With accounts or CONSOLE_ACCESS_TOKEN set, every request — pages,
// assets and the engine proxy — must belong to a signed-in session
// (lib/sessions.ts, opened by the login page) or carry HTTP Basic
// credentials. Browsers use the login page: the 401 below no longer
// asks for Basic, so the native prompt never appears. Basic stays for
// scripts and curl, with the same per-account lockout. Either way the
// credential crosses the wire at sign-in, so terminate TLS in front of
// the console when it leaves the machine.

import { readSessionCookie, sessionPrincipal } from './sessions'
import { accountPrincipal, basicCredentials, loadAccounts, usersFile, type Principal } from './users'

const encoder = new TextEncoder()

export function accessToken(): string {
  return process.env.CONSOLE_ACCESS_TOKEN || ''
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

// Constant-time comparison over fixed-length digests, so neither the
// length nor the content of the token leaks through response timing.
export async function tokenEquals(supplied: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(supplied), digest(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

// basicPassword extracts the password of an `Authorization: Basic`
// header, or null when the header is missing or malformed.
export function basicPassword(header: string | null): string | null {
  if (!header) return null
  const match = /^basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header)
  if (!match) return null
  let decoded: string
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0)))
  } catch {
    return null
  }
  const sep = decoded.indexOf(':')
  return sep < 0 ? null : decoded.slice(sep + 1)
}

// principalFor resolves who sends the request, or null when it may not
// reach the console. With accounts configured only they get in (the
// shared token does not bypass attribution); without them the shared
// token, or the bind address alone, decides, and the caller acts as
// admin like before accounts existed.
export async function principalFor(request: Request): Promise<Principal | null> {
  const users = usersFile()
  const token = accessToken()
  if (!users && !token) return { name: 'local', role: 'admin', mode: 'open' }
  // a session opened under the configuration in force (accounts, or the
  // shared token when there are none)
  const session = await sessionPrincipal(readSessionCookie(request))
  if (session && session.mode === (users ? 'users' : 'token')) return session
  const header = request.headers.get('authorization')
  if (users) return accountPrincipal(header)
  const supplied = basicPassword(header)
  if (supplied === null || !(await tokenEquals(supplied, token))) return null
  const user = basicCredentials(header)?.user.trim().slice(0, 64)
  return { name: user || 'operador', role: 'admin', mode: 'token' }
}

// authorized reports whether the request may reach the console. With
// no token and no accounts access is governed by the bind address alone.
export async function authorized(request: Request): Promise<boolean> {
  return (await principalFor(request)) !== null
}

// lockedReason explains why nobody can sign in (a configured but broken
// users file), or '' when the login can work.
export function lockedReason(): string {
  if (!usersFile()) return ''
  const { error } = loadAccounts()
  return error ? `La consola está bloqueada: ${error} (CONSOLE_USERS_FILE). Corrige el fichero; se relee solo.` : ''
}

function unauthorizedHint(): string {
  return lockedReason() || 'Inicia sesión en /login. Los scripts pueden enviar credenciales HTTP Basic.'
}

export function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({
      error: 'console_auth_required',
      hint: unauthorizedHint(),
    }),
    {
      status: 401,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  )
}
