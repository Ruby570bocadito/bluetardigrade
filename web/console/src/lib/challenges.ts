// Pending sign-ins: the state between a correct password and the second
// step (lib/mfa.ts). The browser holds a random id in a short-lived
// HttpOnly cookie, the server what it stands for: whose password was
// right, where the operator was heading, and, while enrolling, the new
// secret the QR code shows (never sent back by the browser, so a page
// cannot swap it). Server-only; in memory on globalThis like the
// sessions, bounded, five minutes and five wrong codes at most.

import type { Role } from './users'

export const CHALLENGE_COOKIE = 'sf_mfa'
const TTL_MS = 5 * 60 * 1000
const MAX_ATTEMPTS = 5
const MAX_CHALLENGES = 256
const ID_RE = /^[A-Za-z0-9_-]{43}$/

export type Challenge = {
  user: string
  role: Role
  // code: the account has an authenticator; enroll: its role requires
  // one and it has none yet; account: a signed-in operator enrolling
  // from the session panel
  kind: 'code' | 'enroll' | 'account'
  secret?: string
  next: string
  created: number
  attempts: number
}

const shared = globalThis as typeof globalThis & { __sfConsoleChallenges?: Map<string, Challenge> }
function store(): Map<string, Challenge> {
  if (!shared.__sfConsoleChallenges) shared.__sfConsoleChallenges = new Map()
  return shared.__sfConsoleChallenges
}

async function sha256Hex(value: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('')
}

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function openChallenge(c: Omit<Challenge, 'created' | 'attempts'>, now = Date.now()): Promise<string> {
  const challenges = store()
  for (const [k, v] of challenges) if (now - v.created > TTL_MS) challenges.delete(k)
  // oldest first out: a flood of half sign-ins cannot grow the map
  while (challenges.size >= MAX_CHALLENGES) challenges.delete(challenges.keys().next().value as string)
  const id = newId()
  challenges.set(await sha256Hex(id), { ...c, created: now, attempts: 0 })
  return id
}

export async function readChallenge(id: string | undefined, now = Date.now()): Promise<Challenge | null> {
  if (!id || !ID_RE.test(id)) return null
  const k = await sha256Hex(id)
  const c = store().get(k)
  if (!c) return null
  if (now - c.created > TTL_MS || c.attempts >= MAX_ATTEMPTS) {
    store().delete(k)
    return null
  }
  return c
}

// failedAttempt counts a wrong code; past the limit the pending sign-in
// is gone and the password must be typed again. Returns whether it is
// still alive.
export async function failedAttempt(id: string | undefined): Promise<boolean> {
  if (!id || !ID_RE.test(id)) return false
  const k = await sha256Hex(id)
  const c = store().get(k)
  if (!c) return false
  c.attempts++
  if (c.attempts >= MAX_ATTEMPTS) {
    store().delete(k)
    return false
  }
  return true
}

export async function closeChallenge(id: string | undefined): Promise<void> {
  if (!id || !ID_RE.test(id)) return
  store().delete(await sha256Hex(id))
}

export function readChallengeCookie(request: Request): string | undefined {
  const header = request.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === CHALLENGE_COOKIE) return part.slice(eq + 1).trim()
  }
  return undefined
}

export function challengeCookie(id: string, secure: boolean): string {
  return `${CHALLENGE_COOKIE}=${id}; Path=/; Max-Age=${TTL_MS / 1000}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`
}

export function clearedChallengeCookie(secure: boolean): string {
  return `${CHALLENGE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`
}

// test hook
export function resetChallenges(): void {
  delete shared.__sfConsoleChallenges
}
