// Per-analyst console accounts (CONSOLE_USERS_FILE). Server-only: the
// proxy, the engine route and the console API routes import it, never a
// client component.
//
// Without a users file nothing changes: the console is open on loopback
// or gated by the shared CONSOLE_ACCESS_TOKEN (lib/access.ts), and
// whoever gets in acts as "admin". With a users file every request
// belongs to a session of one of its accounts (lib/sessions.ts, opened
// at /login) or carries its HTTP Basic credentials, and the account
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
//
// Host groups (F2) add "groups": the engine host groups the account
// sees (names of Ajustes -> Grupos). An account without groups, and any
// administrator, sees every machine; one with groups sees and acts on
// the machines of those groups only (scopeOf, enforced by the engine
// from the X-SF-Scope header route.ts sends).
//
// Two-step sign-in (lib/mfa.ts) adds, per account, "totp" (the base32
// secret of the authenticator app) and "recovery" (SHA-256 of each
// unused recovery code), and at the top level "mfa_required" (the roles
// that must use it). Account management (lib/accounts.ts) adds
// "disabled" (the account cannot sign in) and "must_change" (its next
// sign-in sets a new password first). The console itself writes the
// file for all of these (editUsers / updateAccount).

import { appendFileSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { base32Decode } from './totp'

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
  // the account's host groups (accounts of the users file only)
  groups?: string[]
  // 'domain': a domain account the engine verified (lib/domain-auth.ts).
  // It rides mode 'users' — attributed, audited, signed out with the
  // rest — but has no entry in the users file: its password and second
  // step live in the directory.
  source?: 'domain'
}

type Account = {
  user: string
  role: Role
  // engine host groups the account is limited to ([] = every machine)
  groups: string[]
  iterations: number
  salt: Uint8Array
  hash: Uint8Array
  // base32 TOTP secret, or null without two-step sign-in
  totp: string | null
  // SHA-256 (hex) of each unused recovery code
  recovery: string[]
  disabled: boolean
  // set by an administrator's reset: a new password before any session
  mustChange: boolean
}

type Parsed = { accounts: Account[]; mfaRequired: Role[]; error?: string }

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

const MAX_RECOVERY = 20
const RECOVERY_HASH_RE = /^[0-9a-f]{64}$/
// the engine's group names (internal/hostgroup) and its group cap
export const GROUP_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/
export const MAX_ACCOUNT_GROUPS = 64

// cleanGroups validates a "groups" value: a list of group names (any
// case), returned lowercased and without repeats, or null when invalid.
export function cleanGroups(value: unknown): string[] | null {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > MAX_ACCOUNT_GROUPS) return null
  const out: string[] = []
  for (const raw of value) {
    const name = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
    if (!GROUP_NAME_RE.test(name)) return null
    if (!out.includes(name)) out.push(name)
  }
  return out
}

// principalOf is who an account of the users file acts as (groups only
// when it has some).
export function principalOf(account: { user: string; role: Role; groups: string[] }): Principal {
  return { name: account.user, role: account.role, mode: 'users', ...(account.groups.length ? { groups: account.groups } : {}) }
}

// scopeOf is the list of host groups a principal is limited to, or null
// when it sees every machine: administrators, accounts without groups
// and consoles without accounts.
export function scopeOf(principal: Principal): string[] | null {
  if (principal.mode !== 'users' || principal.role === 'admin' || !principal.groups?.length) return null
  return principal.groups
}

function isRole(value: unknown): value is Role {
  return value === 'admin' || value === 'analyst' || value === 'viewer'
}

// parseUsers validates the whole file: any malformed entry rejects it,
// so a typo never silently drops (or opens) an account.
export function parseUsers(text: string): Parsed {
  const fail = (error: string): Parsed => ({ accounts: [], mfaRequired: [], error })
  let doc: unknown
  try {
    // Notepad and PowerShell 5 (Set-Content -Encoding UTF8) may save a BOM
    doc = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    return fail('el fichero de usuarios no es JSON válido')
  }
  const list = Array.isArray(doc) ? doc : (doc as { users?: unknown })?.users
  if (!Array.isArray(list) || list.length === 0) return fail('el fichero de usuarios no tiene cuentas')
  const required = Array.isArray(doc) ? undefined : (doc as { mfa_required?: unknown })?.mfa_required
  if (required !== undefined && (!Array.isArray(required) || !required.every(isRole))) {
    return fail('mfa_required debe ser una lista de roles (admin, analyst, viewer)')
  }
  const accounts: Account[] = []
  const seen = new Set<string>()
  for (const [i, raw] of list.entries()) {
    const entry = raw as { user?: unknown; role?: unknown; password?: unknown; totp?: unknown; recovery?: unknown; disabled?: unknown; must_change?: unknown; groups?: unknown }
    const user = typeof entry?.user === 'string' ? entry.user.trim() : ''
    if (!NAME_RE.test(user)) return fail(`cuenta ${i + 1}: nombre de usuario inválido`)
    if (seen.has(user.toLowerCase())) return fail(`cuenta ${user}: repetida`)
    seen.add(user.toLowerCase())
    const role = entry.role
    if (!isRole(role)) return fail(`cuenta ${user}: rol inválido (admin, analyst o viewer)`)
    const parts = typeof entry.password === 'string' ? entry.password.split('$') : []
    const iterations = Number(parts[1])
    const salt = parts[2] ? b64url(parts[2]) : null
    const hash = parts[3] ? b64url(parts[3]) : null
    if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256' || !Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS || !salt || salt.length < 16 || !hash || hash.length !== 32) {
      return fail(`cuenta ${user}: contraseña con formato inválido (genera la entrada con scripts/console-user.mjs)`)
    }
    let totp: string | null = null
    if (entry.totp !== undefined && entry.totp !== null) {
      const key = typeof entry.totp === 'string' ? base32Decode(entry.totp) : null
      if (!key || key.length < 16 || key.length > 64) return fail(`cuenta ${user}: secreto de verificación en dos pasos inválido`)
      totp = (entry.totp as string).replace(/[\s=]/g, '').toUpperCase()
    }
    const recovery = entry.recovery ?? []
    if (!Array.isArray(recovery) || recovery.length > MAX_RECOVERY || !recovery.every((h) => typeof h === 'string' && RECOVERY_HASH_RE.test(h))) {
      return fail(`cuenta ${user}: códigos de recuperación inválidos`)
    }
    for (const flag of ['disabled', 'must_change'] as const) {
      if (entry[flag] !== undefined && typeof entry[flag] !== 'boolean') return fail(`cuenta ${user}: ${flag} debe ser true o false`)
    }
    const groups = cleanGroups(entry.groups)
    if (!groups) return fail(`cuenta ${user}: groups debe ser una lista de nombres de grupo (minúsculas, cifras, - y _; hasta ${MAX_ACCOUNT_GROUPS})`)
    accounts.push({ user, role, groups, iterations, salt, hash, totp, recovery: recovery as string[], disabled: entry.disabled === true, mustChange: entry.must_change === true })
  }
  return { accounts, mfaRequired: (required as Role[] | undefined) ?? [] }
}

let cached: (Parsed & { signature: string }) | null = null

// loadAccounts re-reads the file when its size or mtime changed.
export function loadAccounts(): Parsed & { signature: string } {
  const file = usersFile()
  if (!file) return { accounts: [], mfaRequired: [], signature: '' }
  const fail = (error: string, signature: string) => ({ accounts: [], mfaRequired: [], error, signature })
  let signature: string
  try {
    const st = statSync(/*turbopackIgnore: true*/ file)
    if (st.size > MAX_FILE_BYTES) return fail('el fichero de usuarios es demasiado grande', 'big')
    signature = `${st.size}:${st.mtimeMs}`
  } catch {
    return fail('no se puede leer el fichero de usuarios', 'missing')
  }
  if (cached?.signature === signature) return cached
  let text: string
  try {
    text = readFileSync(/*turbopackIgnore: true*/ file, 'utf8')
  } catch {
    return fail('no se puede leer el fichero de usuarios', 'unreadable')
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

// verifyAccount checks one user name and password against the users
// file: the login form and Basic credentials share it, and with it the
// per-account lockout.
export async function verifyAccount(user: string, password: string, now = Date.now()): Promise<Principal | null> {
  const { accounts, error } = loadAccounts()
  if (error || accounts.length === 0) return null
  const account = accounts.find((a) => a.user.toLowerCase() === user.trim().toLowerCase())
  // failures are tracked for real accounts only: invented names cannot
  // grow the table (or flush it to reset a real account's lockout)
  const failKey = account?.user.toLowerCase() ?? ''
  const fails = account ? failures.get(failKey) : undefined
  if (fails && now - fails.since < FAIL_WINDOW_MS && fails.count >= FAIL_LIMIT) return null
  // unknown accounts cost the same derivation as known ones
  const probe = account ?? accounts[0]
  const derived = await pbkdf2(password, probe.salt, probe.iterations)
  if (!account || !sameBytes(derived, account.hash)) {
    if (account) {
      const current = fails && now - fails.since < FAIL_WINDOW_MS ? fails : { count: 0, since: now }
      failures.set(failKey, { count: current.count + 1, since: current.since })
    }
    return null
  }
  // a disabled account answers like a wrong password, without counting
  // a failure against it
  if (account.disabled) return null
  failures.delete(failKey)
  return principalOf(account)
}

// findAccount returns the account as the users file holds it now.
export function findAccount(user: string): Account | null {
  const { accounts, error } = loadAccounts()
  if (error) return null
  return accounts.find((a) => a.user.toLowerCase() === user.trim().toLowerCase()) ?? null
}

// mfaRequiredFor tells whether the file asks this role for a second step.
export function mfaRequiredFor(role: Role): boolean {
  const { mfaRequired, error } = loadAccounts()
  return !error && mfaRequired.includes(role)
}

// accountPrincipal checks Basic credentials against the users file.
// Basic carries no second factor: an account that has two-step sign-in,
// or whose role requires it, cannot use it.
export async function accountPrincipal(header: string | null, now = Date.now()): Promise<Principal | null> {
  const creds = basicCredentials(header)
  if (!creds || !header) return null
  const digest = await headerDigest(header)
  const hit = verified.get(digest)
  if (hit && hit.until > now) return hit.principal
  const principal = await verifyAccount(creds.user, creds.password, now)
  if (!principal) return null
  if (findAccount(principal.name)?.totp || mfaRequiredFor(principal.role)) return null
  if (verified.size >= MAX_VERIFIED) verified.clear()
  verified.set(digest, { principal, until: now + VERIFIED_TTL_MS })
  return principal
}

// accountStamp fingerprints an account as the users file holds it now
// (role, host groups, password hash and two-step secret), or null when
// it is gone, disabled, or the file is broken. A session remembers the
// stamp it was opened with: changing the password, the role, the groups
// or the authenticator, disabling or removing the account, ends it. Spending a recovery code does not. Neither does a
// new mfa_required for an account that already has the second step;
// one that has not loses its sessions and enrolls at the next sign-in.
export async function accountStamp(user: string): Promise<string | null> {
  const account = findAccount(user)
  if (!account) return null
  if (account.disabled) return null
  const second = account.totp ?? (mfaRequiredFor(account.role) ? 'required' : '')
  const encoder = new TextEncoder()
  const groups = [...account.groups].sort().join(',')
  const material = new Uint8Array([...encoder.encode(account.role + '\n' + groups + '\n'), ...account.hash, ...encoder.encode('\n' + second)])
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', material))
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('')
}

export type UsersDoc = Record<string, unknown> & { users: Record<string, unknown>[] }

export function sameUser(entry: unknown, user: string): boolean {
  const name = (entry as { user?: unknown } | null)?.user
  return typeof name === 'string' && name.trim().toLowerCase() === user.trim().toLowerCase()
}

// editUsers rewrites the users file through edit, which changes the
// document in place or returns an error message to abort. Every field it
// does not touch is kept. The result must parse before it replaces the
// file, in one rename, so an edit never leaves the console locked by a
// half-written or invalid file. Returns an error message, or null when
// the file was written. Synchronous on purpose: two requests of this
// process cannot interleave between the read and the rename.
export function editUsers(edit: (doc: UsersDoc) => string | null): string | null {
  const file = usersFile()
  if (!file) return 'no hay fichero de cuentas'
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return 'no se puede leer el fichero de cuentas'
  }
  const doc = (Array.isArray(parsed) ? { users: parsed } : parsed) as UsersDoc | null
  if (!doc || !Array.isArray(doc.users)) return 'el fichero de cuentas no tiene la forma {"users": [...]}'
  const refused = edit(doc)
  if (refused) return refused
  const text = JSON.stringify(doc, null, 2) + '\n'
  if (parseUsers(text).error) return 'el cambio dejaría el fichero de cuentas inválido'
  const tmp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(/*turbopackIgnore: true*/ tmp, text, { mode: 0o600 })
    renameSync(/*turbopackIgnore: true*/ tmp, /*turbopackIgnore: true*/ file)
  } catch {
    return 'no se puede escribir el fichero de cuentas'
  }
  cached = null
  return null
}

// updateAccount edits one account of the users file (see editUsers).
export function updateAccount(user: string, edit: (entry: Record<string, unknown>) => void): string | null {
  return editUsers((doc) => {
    const entry = doc.users.find((e) => sameUser(e, user))
    if (!entry || typeof entry !== 'object') return `no hay ninguna cuenta ${user}`
    edit(entry)
    return null
  })
}

// Same cost as scripts/console-user.mjs, so both tools write equal hashes.
export const PASSWORD_ITERATIONS = 310_000
export const MIN_PASSWORD = 12
export const MAX_PASSWORD = 1024

function toB64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// passwordHash is the stored form of a new password.
export async function passwordHash(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${toB64url(salt)}$${toB64url(await pbkdf2(password, salt, PASSWORD_ITERATIONS))}`
}

// passwordMatches checks a password against an account's current hash
// (the "not the same as before" rule of a password change).
export async function passwordMatches(user: string, password: string): Promise<boolean> {
  const account = findAccount(user)
  return account ? sameBytes(await pbkdf2(password, account.salt, account.iterations), account.hash) : false
}

// temporaryPassword is what an administrator hands over after creating
// an account or resetting its password: 16 characters of Crockford's
// base32 in four groups (80 bits), changed by its owner at first use.
export function temporaryPassword(): string {
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz'
  const chars = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => alphabet[b & 31]).join('')
  return chars.match(/.{4}/g)!.join('-')
}

// ---- attribution and audit ---------------------------------------------------------------

// attribute replaces the sender name of an attributed write with the
// account name. Bodies that are not a JSON object go through untouched
// (the engine rejects them itself).
export function attribute(body: string, principal: Principal): string {
  if (principal.mode !== 'users') return body
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
  // '' for a rejected sign-in: the caller holds no role
  role: Role | ''
  mode: Principal['mode']
  method: string
  path: string
  status: number
  outcome: 'ok' | 'error' | 'denied'
  // the account an administrator acted on (account management)
  target?: string
}

export function auditFile(): string {
  return process.env.CONSOLE_AUDIT_FILE || ''
}

// audit appends one JSON line; a failing disk never blocks the action
// (the engine keeps its own record of triage and incidents).
export function audit(entry: AuditEntry): void {
  const file = auditFile()
  if (!file) return
  try {
    appendFileSync(/*turbopackIgnore: true*/ file, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 })
  } catch {
    // reported by GET /api/console/audit as an unreadable trail
  }
}

const AUDIT_TAIL_BYTES = 512 * 1024

// readAudit returns the newest entries first (at most limit), reading
// only the tail of the file.
export function readAudit(limit: number): { entries: AuditEntry[]; error?: string } {
  const file = auditFile()
  if (!file) return { entries: [] }
  let text: string
  try {
    const buf = readFileSync(/*turbopackIgnore: true*/ file)
    text = buf.subarray(Math.max(0, buf.length - AUDIT_TAIL_BYTES)).toString('utf8')
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
