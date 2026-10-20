// Two-step sign-in for console accounts: after the password, a 6-digit
// code from an authenticator app (lib/totp.ts) or one of the account's
// single-use recovery codes. Server-only.
//
// Optional per account; "mfa_required" in the users file makes it
// compulsory for the roles it lists (an account of such a role that has
// not enrolled yet enrolls right after its password). The secret lives
// in the users file next to the password hash: the second step protects
// against a stolen or guessed password, not against a stolen file.
//
// Wrong codes have their own, stricter lockout than passwords (5 per
// account in 15 minutes): with three valid codes at any moment, the
// password alone must not buy unlimited guesses. A code is accepted
// once: a step already used with the account's secret is refused (a
// new secret, after a reset, starts afresh).

import { matchTotp } from './totp'
import { findAccount, mfaRequiredFor, updateAccount } from './users'

const CODE_FAIL_LIMIT = 5
const CODE_FAIL_WINDOW_MS = 15 * 60 * 1000
const RECOVERY_COUNT = 10
// Crockford's base32: no I, L, O or U to misread
const RECOVERY_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

type MfaMemory = { fails: Map<string, { count: number; since: number }>; lastStep: Map<string, number> }
// globalThis, like the sessions: the proxy and the routes are bundled apart
const shared = globalThis as typeof globalThis & { __sfConsoleMfa?: MfaMemory }
function memory(): MfaMemory {
  if (!shared.__sfConsoleMfa) shared.__sfConsoleMfa = { fails: new Map(), lastStep: new Map() }
  return shared.__sfConsoleMfa
}

export type MfaState = { enrolled: boolean; required: boolean; recoveryLeft: number }

export function mfaState(user: string): MfaState | null {
  const account = findAccount(user)
  if (!account) return null
  return { enrolled: account.totp !== null, required: mfaRequiredFor(account.role), recoveryLeft: account.recovery.length }
}

export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_COUNT }, () => {
    const bytes = crypto.getRandomValues(new Uint8Array(10))
    const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b & 31]).join('')
    return `${chars.slice(0, 5)}-${chars.slice(5)}`
  })
}

// what a person types back: any case, spaces or dashes, and the letters
// Crockford's alphabet reads as digits
function normalizeRecovery(input: string): string {
  return input.toLowerCase().replace(/[\s-]/g, '').replace(/o/g, '0').replace(/[il]/g, '1')
}

export async function hashRecovery(code: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('recovery\n' + normalizeRecovery(code))))
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('')
}

function key(user: string): string {
  return user.trim().toLowerCase()
}

export function codeLocked(user: string, now = Date.now()): boolean {
  const f = memory().fails.get(key(user))
  return Boolean(f && now - f.since < CODE_FAIL_WINDOW_MS && f.count >= CODE_FAIL_LIMIT)
}

function noteFailure(user: string, now: number) {
  const fails = memory().fails
  const f = fails.get(key(user))
  const current = f && now - f.since < CODE_FAIL_WINDOW_MS ? f : { count: 0, since: now }
  fails.set(key(user), { count: current.count + 1, since: current.since })
}

export type StepResult =
  | { ok: true; usedRecovery: boolean; recoveryLeft: number }
  | { ok: false; reason: 'bloqueada' | 'codigo' | 'escritura' }

// checkTotp accepts a code of this secret once per step and account.
async function checkTotp(user: string, secret: string, code: string, now: number): Promise<boolean> {
  const step = await matchTotp(secret, code, now)
  if (step === null) return false
  const used = `${key(user)}\n${secret}`
  const last = memory().lastStep.get(used)
  if (last !== undefined && step <= last) return false
  memory().lastStep.set(used, step)
  return true
}

// verifySecondStep checks a code from the authenticator app or, failing
// that, a recovery code, which it then strikes from the users file.
export async function verifySecondStep(user: string, input: string, now = Date.now()): Promise<StepResult> {
  if (codeLocked(user, now)) return { ok: false, reason: 'bloqueada' }
  const account = findAccount(user)
  if (!account?.totp) return { ok: false, reason: 'codigo' }
  const typed = input.trim().slice(0, 64)
  if (/^\d{3}\s?\d{3}$/.test(typed)) {
    if (await checkTotp(user, account.totp, typed, now)) {
      memory().fails.delete(key(user))
      return { ok: true, usedRecovery: false, recoveryLeft: account.recovery.length }
    }
  } else if (typed) {
    const hash = await hashRecovery(typed)
    if (account.recovery.includes(hash)) {
      const left = account.recovery.filter((h) => h !== hash)
      const error = updateAccount(user, (entry) => { entry.recovery = left })
      if (error) return { ok: false, reason: 'escritura' }
      memory().fails.delete(key(user))
      return { ok: true, usedRecovery: true, recoveryLeft: left.length }
    }
  }
  noteFailure(user, now)
  return { ok: false, reason: codeLocked(user, now) ? 'bloqueada' : 'codigo' }
}

export type EnrollResult = { ok: true; codes: string[] } | { ok: false; reason: 'bloqueada' | 'codigo' | 'escritura' }

// enroll stores a new secret once the operator proves the app holds it
// (a code of the new secret), with a fresh set of recovery codes, shown
// once in plain text and stored hashed.
export async function enroll(user: string, secret: string, code: string, now = Date.now()): Promise<EnrollResult> {
  if (codeLocked(user, now)) return { ok: false, reason: 'bloqueada' }
  if (!(await checkTotp(user, secret, code, now))) {
    noteFailure(user, now)
    return { ok: false, reason: codeLocked(user, now) ? 'bloqueada' : 'codigo' }
  }
  const codes = newRecoveryCodes()
  const hashes = await Promise.all(codes.map(hashRecovery))
  const error = updateAccount(user, (entry) => {
    entry.totp = secret
    entry.recovery = hashes
  })
  if (error) return { ok: false, reason: 'escritura' }
  memory().fails.delete(key(user))
  return { ok: true, codes }
}

// regenerateRecovery replaces the recovery codes, against a current code.
export async function regenerateRecovery(user: string, code: string, now = Date.now()): Promise<EnrollResult> {
  const step = await verifySecondStep(user, code, now)
  if (!step.ok) return step
  const codes = newRecoveryCodes()
  const hashes = await Promise.all(codes.map(hashRecovery))
  const error = updateAccount(user, (entry) => { entry.recovery = hashes })
  return error ? { ok: false, reason: 'escritura' } : { ok: true, codes }
}

// disable removes the second step, against a current code. With a role
// that requires it, the next sign-in enrolls again: that is how an
// operator moves to a new phone.
export async function disable(user: string, code: string, now = Date.now()): Promise<{ ok: true } | { ok: false; reason: 'bloqueada' | 'codigo' | 'escritura' }> {
  const step = await verifySecondStep(user, code, now)
  if (!step.ok) return step
  const error = updateAccount(user, (entry) => {
    delete entry.totp
    delete entry.recovery
  })
  if (error) return { ok: false, reason: 'escritura' }
  return { ok: true }
}

// test hook
export function resetMfaMemory(): void {
  delete shared.__sfConsoleMfa
}
