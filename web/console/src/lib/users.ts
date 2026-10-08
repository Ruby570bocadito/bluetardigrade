// Per-analyst console accounts (CONSOLE_USERS_FILE). Server-only: the
// proxy, the engine route and the console API routes import it, never a
// client component.
//
// Without a users file nothing changes: the console is open on loopback
// or gated by the shared CONSOLE_ACCESS_TOKEN (lib/access.ts), and
// whoever gets in acts as "admin". With a users file every request
// carries HTTP Basic credentials of one of its accounts, and the account
// decides three things:
//
//   - who: the name the engine records as "by" on triage, incidents and
//     notes (the browser cannot choose it; route.ts overwrites it);
//   - what: the role. viewer reads; analyst also triages, manages
//     incidents, tests rules and edits suppressions; admin also uses
//     active response (which still demands the operator credential);
//   - the audit trail: every write, allowed or refused, is appended to
//     CONSOLE_AUDIT_FILE with the account that sent it.
//
// The file is JSON: {"users": [{"user": "ana", "role": "analyst",
// "password": "pbkdf2-sha256$<iterations>$<salt>$<hash>"}]} (salt and
// hash base64url). scripts/console-user.mjs prints such an entry; no
// plain-text password is ever stored. The file is re-read when it
// changes. A file that is configured but unreadable or empty locks the
// console (fail closed) instead of opening it.

import { appendFileSync, closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'

// The paths come from the operator's environment at run time; the
// turbopackIgnore markers keep the build from tracing the whole project
// for them.

export type Role = 'admin' | 'analyst' | 'viewer'
export const ROLES: Role[] = ['viewer', 'analyst', 'admin']
export const ROLE_LABEL: Record<Role, string> = { admin: 'Administrador', analyst: 'Analista', viewer: 'Lector' }

export type Principal = {
  name: string
  role: Role
  // users: an account of CONSOLE_USERS_FILE; token: the shared
  // CONSOLE_ACCESS_TOKEN; open: loopback without credentials
  mode: 'users' | 'token' | 'open'
}

type Account = { user: string; role: Role; iterations: number; salt: Uint8Array; hash: Uint8Array }

const MIN_ITERATIONS = 100_000
const MAX_ITERATIONS = 5_000_000
const MAX_FILE_BYTES = 256 * 1024
const NAME_RE = /^[\p{L}\p{N}._@-]{1,64}$/u

export function usersFile(): string {
  return process.env.CONSOLE_USERS_FILE || ''
}

export function roleAtLeast(role: Role, needed: Role): boolean {
  return ROLES.indexOf(role) >= ROLES.indexOf(needed)
}

function b64url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(s)) return null
  try {
    return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

// parseUsers validates the whole file: any malformed entry rejects it,
// so a typo never silently drops (or opens) an account.
export function parseUsers(text: string): { accounts: Account[]; error?: string } {
  let doc: unknown
  try {
    // Notepad and PowerShell 5 (Set-Content -Encoding UTF8) may save a BOM
    doc = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    return { accounts: [], error: 'el fichero de usuarios no es JSON válido' }
  }
  const list = Array.isArray(doc) ? doc : (doc as { users?: unknown })?.users
  if (!Array.isArray(list) || list.length === 0) return { accounts: [], error: 'el fichero de usuarios no tiene cuentas' }
  const accounts: Account[] = []
  const seen = new Set<string>()
  for (const [i, raw] of list.entries()) {
    const entry = raw as { user?: unknown; role?: unknown; password?: unknown }
    const user = typeof entry?.user === 'string' ? entry.user.trim() : ''
    if (!NAME_RE.test(user)) return { accounts: [], error: `cuenta ${i + 1}: nombre de usuario inválido` }
    if (seen.has(user.toLowerCase())) return { accounts: [], error: `cuenta ${user}: repetida` }
    seen.add(user.toLowerCase())
    const role = entry.role
    if (role !== 'admin' && role !== 'analyst' && role !== 'viewer') return { accounts: [], error: `cuenta ${user}: rol inválido (admin, analyst o viewer)` }
    const parts = typeof entry.password === 'string' ? entry.password.split('$') : []
    const iterations = Number(parts[1])
    const salt = parts[2] ? b64url(parts[2]) : null
    const hash = parts[3] ? b64url(parts[3]) : null
    if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256' || !Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS || !salt || salt.length < 16 || !hash || hash.length !== 32) {
      return { accounts: [], error: `cuenta ${user}: contraseña con formato inválido (genera la entrada con scripts/console-user.mjs)` }
    }
    accounts.push({ user, role, iterations, salt, hash })
  }
  return { accounts }
}

let cached: { signature: string; accounts: Account[]; error?: string } | null = null

// loadAccounts re-reads the file when its size or mtime changed.
export function loadAccounts(): { accounts: Account[]; error?: string; signature: string } {
  const file = usersFile()
  if (!file) return { accounts: [], signature: '' }
  let signature: string
  try {
    const st = statSync(/*turbopackIgnore: true*/ file)
    if (st.size > MAX_FILE_BYTES) return { accounts: [], error: 'el fichero de usuarios es demasiado grande', signature: 'big' }
    signature = `${st.size}:${st.mtimeMs}`
  } catch {
    return { accounts: [], error: 'no se puede leer el fichero de usuarios', signature: 'missing' }
  }
  if (cached?.signature === signature) return cached
  let text: string
  try {
    text = readFileSync(/*turbopackIgnore: true*/ file, 'utf8')
  } catch {
    return { accounts: [], error: 'no se puede leer el fichero de usuarios', signature: 'unreadable' }
  }
  const parsed = parseUsers(text)
  cached = { signature, ...parsed }
  verified.clear()
  return cached
}

export async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256)
  return new Uint8Array(bits)
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

// Verified credentials, so the key derivation (deliberately slow) runs
// once per account and browser session instead of once per asset. Keyed
// by a digest of the Authorization header, never the header itself.
const VERIFIED_TTL_MS = 10 * 60 * 1000
const MAX_VERIFIED = 512
const verified = new Map<string, { principal: Principal; until: number }>()

// Failed logins per account: past the limit the account is refused
// without checking the password until the window passes.
const FAIL_LIMIT = 10
const FAIL_WINDOW_MS = 5 * 60 * 1000
const failures = new Map<string, { count: number; since: number }>()

async function headerDigest(header: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(header)))
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function basicCredentials(header: string | null): { user: string; password: string } | null {
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
  return sep < 0 ? null : { user: decoded.slice(0, sep), password: decoded.slice(sep + 1) }
}

// accountPrincipal checks Basic credentials against the users file.
export async function accountPrincipal(header: string | null, now = Date.now()): Promise<Principal | null> {
  const { accounts, error } = loadAccounts()
  if (error || accounts.length === 0) return null
  const creds = basicCredentials(header)
  if (!creds || !header) return null
  const digest = await headerDigest(header)
  const hit = verified.get(digest)
  if (hit && hit.until > now) return hit.principal
  const account = accounts.find((a) => a.user.toLowerCase() === creds.user.trim().toLowerCase())
  // failures are tracked for real accounts only: invented names cannot
  // grow the table (or flush it to reset a real account's lockout)
  const failKey = account?.user.toLowerCase() ?? ''
  const fails = account ? failures.get(failKey) : undefined
  if (fails && now - fails.since < FAIL_WINDOW_MS && fails.count >= FAIL_LIMIT) return null
  // unknown accounts cost the same derivation as known ones
  const probe = account ?? accounts[0]
  const derived = await pbkdf2(creds.password, probe.salt, probe.iterations)
  if (!account || !sameBytes(derived, account.hash)) {
    if (account) {
      const current = fails && now - fails.since < FAIL_WINDOW_MS ? fails : { count: 0, since: now }
      failures.set(failKey, { count: current.count + 1, since: current.since })
    }
    return null
  }
  failures.delete(failKey)
  const principal: Principal = { name: account.user, role: account.role, mode: 'users' }
  if (verified.size >= MAX_VERIFIED) verified.clear()
  verified.set(digest, { principal, until: now + VERIFIED_TTL_MS })
  return principal
}

// ---- attribution and audit ---------------------------------------------------------------

// attribute replaces the sender name of an attributed write with the
// account name. Bodies that are not a JSON object go through untouched
// (the engine rejects them itself).
//
// Token mode also overwrites (audit 5.8): the "by" field used to travel
// whatever the BROWSER body carried while the credential was the shared
// token — any console user could attribute their triage to a colleague
// (or to nothing). The principal's name in token mode comes from the
// Basic-auth username of the request, which is the only attribution
// signal that exists there. Open mode keeps the raw body: there is no
// credential to attribute, by design.
export function attribute(body: string, principal: Principal): string {
  if (principal.mode === 'open') return body
  let doc: unknown
  try {
    doc = JSON.parse(body)
  } catch {
    return body
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return body
  return JSON.stringify({ ...(doc as Record<string, unknown>), by: principal.name })
}

export type AuditEntry = {
  at: string
  user: string
  role: Role
  mode: Principal['mode']
  method: string
  path: string
  status: number
  outcome: 'ok' | 'error' | 'denied'
}

export function auditFile(): string {
  return process.env.CONSOLE_AUDIT_FILE || ''
}

// audit appends one JSON line; a failing disk never blocks the action
// (the engine keeps its own record of triage and incidents).
// Techo del fichero de auditoría (sesión 100agentes-2, agente 6, P2):
// espejo del MaxDenialAuditBytes del motor. Sin él, un viewer
// autenticado podía hacer crecer el fichero sin límite (cada write
// auditado suma una línea) y cada GET cargaba el fichero entero.
const AUDIT_MAX_BYTES = 64 * 1024 * 1024
const AUDIT_TAIL_BYTES = 512 * 1024

export function audit(entry: AuditEntry): void {
  const file = auditFile()
  if (!file) return
  try {
    if (statSync(/*turbopackIgnore: true*/ file).size > AUDIT_MAX_BYTES) {
      // El trail está lleno: no crece más (el motor aplica la misma
      // política); los writes siguen funcionando y el trail conserva
      // lo más antiguo en disco.
      return
    }
    appendFileSync(/*turbopackIgnore: true*/ file, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 })
  } catch {
    // reported by GET /api/console/audit as an unreadable trail
  }
}

// readAudit returns the newest entries first (at most limit), reading
// only the tail of the file.
export function readAudit(limit: number): { entries: AuditEntry[]; error?: string } {
  const file = auditFile()
  if (!file) return { entries: [] }
  let text: string
  try {
    // Lectura de la COLA por fd (sesión 100agentes-2, agente 6): el
    // readFileSync entero cargaba el fichero completo en memoria por
    // cada GET — paridad con el gemelo Go (respond/audit_read.go,
    // ventana de 4 MiB).
    const size = statSync(/*turbopackIgnore: true*/ file).size
    const start = Math.max(0, size - AUDIT_TAIL_BYTES)
    const fd = openSync(/*turbopackIgnore: true*/ file, 'r')
    try {
      const buf = Buffer.alloc(size - start)
      const n = readSync(fd, buf, 0, buf.length, start)
      text = buf.subarray(0, n).toString('utf8')
    } finally {
      closeSync(fd)
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return { entries: [] }
    return { entries: [], error: 'no se puede leer el registro de auditoría' }
  }
  const entries: AuditEntry[] = []
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
    const line = lines[i].trim()
    if (!line) continue
    try {
      const e = JSON.parse(line) as AuditEntry
      if (typeof e.at === 'string' && typeof e.user === 'string' && typeof e.path === 'string') entries.push(e)
    } catch {
      // a line cut by the tail window
    }
  }
  return { entries }
}

// test hook: forget cached file contents, verified sessions and failures
export function resetUsersCache(): void {
  cached = null
  verified.clear()
  failures.clear()
}
