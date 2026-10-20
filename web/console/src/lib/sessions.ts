// Console sessions: the login page (app/login) trades a user name and
// password, or the shared CONSOLE_ACCESS_TOKEN, for a random session id
// in an HttpOnly cookie, so the browser never holds the credential
// itself and the operator can sign out. Server-only.
//
// The store lives in memory on globalThis: Next.js bundles the request
// proxy and the route handlers separately, and a module-level Map would
// give each bundle its own store. A console restart signs everyone out,
// which is the safe direction. The cookie value is never stored: the
// map is keyed by its SHA-256, so a heap dump does not hand out live
// sessions.
//
// A session ends when it sits idle (CONSOLE_SESSION_IDLE_MINUTES,
// default 30), reaches its absolute lifetime (CONSOLE_SESSION_MAX_HOURS,
// default 12), the operator signs out, or the credential that opened it
// changes: a new password or role in the users file, a removed account
// or a rotated shared token.

import { accountStamp, type Principal, type Role } from './users'

export const SESSION_COOKIE = 'sf_session'

type Session = {
  name: string
  role: Role
  mode: 'users' | 'token'
  stamp: string
  created: number
  lastSeen: number
}

const MAX_SESSIONS = 1024
const ID_RE = /^[A-Za-z0-9_-]{43}$/

const shared = globalThis as typeof globalThis & { __sfConsoleSessions?: Map<string, Session> }

function store(): Map<string, Session> {
  if (!shared.__sfConsoleSessions) shared.__sfConsoleSessions = new Map()
  return shared.__sfConsoleSessions
}

function minutesFromEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback
}

export function sessionLimits(): { idleMs: number; maxMs: number } {
  return {
    idleMs: minutesFromEnv('CONSOLE_SESSION_IDLE_MINUTES', 30, 5, 24 * 60) * 60_000,
    maxMs: minutesFromEnv('CONSOLE_SESSION_MAX_HOURS', 12, 1, 7 * 24) * 3_600_000,
  }
}

async function sha256Hex(value: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('')
}

// tokenStamp fingerprints the shared token in force, so rotating it ends
// the sessions it opened.
export async function tokenStamp(): Promise<string | null> {
  const token = process.env.CONSOLE_ACCESS_TOKEN || ''
  return token ? sha256Hex('token\n' + token) : null
}

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function expired(s: Session, now: number): boolean {
  const { idleMs, maxMs } = sessionLimits()
  return now - s.lastSeen > idleMs || now - s.created > maxMs
}

// openSession records a signed-in principal and returns the cookie value.
export async function openSession(principal: Principal, stamp: string, now = Date.now()): Promise<string> {
  if (principal.mode === 'open') throw new Error('a console without credentials has no sessions')
  const sessions = store()
  for (const [k, s] of sessions) if (expired(s, now)) sessions.delete(k)
  while (sessions.size >= MAX_SESSIONS) {
    let oldest: string | null = null
    let oldestSeen = Infinity
    for (const [k, s] of sessions) if (s.lastSeen < oldestSeen) { oldest = k; oldestSeen = s.lastSeen }
    if (oldest === null) break
    sessions.delete(oldest)
  }
  const id = newId()
  sessions.set(await sha256Hex(id), { name: principal.name, role: principal.role, mode: principal.mode, stamp, created: now, lastSeen: now })
  return id
}

// sessionPrincipal resolves a cookie value to its principal, sliding the
// idle window, or null when the session is unknown, expired or opened
// with a credential that has since changed.
export async function sessionPrincipal(id: string | undefined, now = Date.now()): Promise<Principal | null> {
  if (!id || !ID_RE.test(id)) return null
  const key = await sha256Hex(id)
  const sessions = store()
  const s = sessions.get(key)
  if (!s) return null
  if (expired(s, now)) {
    sessions.delete(key)
    return null
  }
  const current = s.mode === 'users' ? await accountStamp(s.name) : await tokenStamp()
  if (current !== s.stamp) {
    sessions.delete(key)
    return null
  }
  s.lastSeen = now
  return { name: s.name, role: s.role, mode: s.mode }
}

export async function closeSession(id: string | undefined): Promise<void> {
  if (!id || !ID_RE.test(id)) return
  store().delete(await sha256Hex(id))
}

export function readSessionCookie(request: Request): string | undefined {
  const header = request.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim()
  }
  return undefined
}

// No Max-Age: the cookie dies with the browser; the server-side limits
// above end it sooner. Secure only over HTTPS: the default console is
// plain HTTP on loopback, where a Secure cookie would never be stored.
export function sessionCookie(id: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`
}

export function clearedSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`
}

export function requestIsHttps(request: Request): boolean {
  if (request.headers.get('x-forwarded-proto')?.split(',')[0].trim().toLowerCase() === 'https') return true
  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}

// test hook
export function resetSessions(): void {
  store().clear()
}
