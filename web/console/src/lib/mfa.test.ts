import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pbkdf2Sync } from 'node:crypto'
import { codeLocked, disable, enroll, hashRecovery, mfaState, regenerateRecovery, resetMfaMemory, verifySecondStep } from './mfa'
import { base32Decode, hotp, newTotpSecret, totpStep } from './totp'
import { accountPrincipal, accountStamp, findAccount, loadAccounts, parseUsers, resetUsersCache, updateAccount } from './users'

const KEYS = ['CONSOLE_USERS_FILE'] as const
const saved: Record<string, string | undefined> = {}
let dir = ''
let file = ''

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  dir = mkdtempSync(join(tmpdir(), 'sf-mfa-'))
  file = join(dir, 'console-users.json')
  process.env.CONSOLE_USERS_FILE = file
  resetUsersCache()
  resetMfaMemory()
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const SALT = Buffer.from('0123456789abcdef')
const entry = (user: string, role: string, password: string, extra: Record<string, unknown> = {}) => ({
  user,
  role,
  password: `pbkdf2-sha256$100000$${SALT.toString('base64url')}$${pbkdf2Sync(password, SALT, 100_000, 32, 'sha256').toString('base64url')}`,
  ...extra,
})
function write(doc: unknown) {
  writeFileSync(file, JSON.stringify(doc))
  resetUsersCache()
}
const codeAt = async (secret: string, now: number, delta = 0) => hotp(base32Decode(secret)!, totpStep(now) + delta)
const basic = (user: string, password: string) => 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64')
const T0 = 1_800_000_000_000

test('the users file accepts the two-step fields and rejects malformed ones', () => {
  const secret = newTotpSecret()
  const ok = parseUsers(JSON.stringify({ mfa_required: ['admin'], users: [entry('ana', 'admin', 'pw-ana-largo', { totp: secret, recovery: ['a'.repeat(64)] })] }))
  expect(ok.error).toBeUndefined()
  expect(ok.mfaRequired).toEqual(['admin'])
  expect(ok.accounts[0].totp).toBe(secret)
  for (const [doc, message] of [
    [{ mfa_required: ['root'], users: [entry('ana', 'admin', 'x')] }, 'mfa_required'],
    [{ mfa_required: 'admin', users: [entry('ana', 'admin', 'x')] }, 'mfa_required'],
    [{ users: [entry('ana', 'admin', 'x', { totp: 'no base32!' })] }, 'secreto'],
    [{ users: [entry('ana', 'admin', 'x', { totp: 'ABCDEFGH' })] }, 'secreto'],
    [{ users: [entry('ana', 'admin', 'x', { recovery: ['abc'] })] }, 'recuperación'],
    [{ users: [entry('ana', 'admin', 'x', { recovery: Array(21).fill('a'.repeat(64)) })] }, 'recuperación'],
  ] as const) {
    expect(parseUsers(JSON.stringify(doc)).error).toContain(message)
  }
})

test('enrolling needs a code of the new secret, stores it with hashed recovery codes and changes the stamp', async () => {
  write({ users: [entry('ana', 'analyst', 'pw-ana-largo', { note: 'campo ajeno' }), entry('luis', 'viewer', 'pw-luis-largo')] })
  const before = await accountStamp('ana')
  const secret = newTotpSecret()
  expect(await enroll('ana', secret, '000000', T0)).toEqual({ ok: false, reason: 'codigo' })
  const res = await enroll('ana', secret, await codeAt(secret, T0), T0)
  if (!res.ok) throw new Error('enroll failed')
  expect(res.codes).toHaveLength(10)
  for (const c of res.codes) expect(c).toMatch(/^[0-9a-hjkmnp-tv-z]{5}-[0-9a-hjkmnp-tv-z]{5}$/)
  const stored = JSON.parse(readFileSync(file, 'utf8'))
  const ana = stored.users.find((u: { user: string }) => u.user === 'ana')
  expect(ana.totp).toBe(secret)
  expect(ana.recovery).toEqual(await Promise.all(res.codes.map(hashRecovery)))
  expect(JSON.stringify(stored)).not.toContain(res.codes[0])
  // everything else is kept as it was
  expect(ana.note).toBe('campo ajeno')
  expect(stored.users[1].user).toBe('luis')
  expect(mfaState('ana')).toEqual({ enrolled: true, required: false, recoveryLeft: 10 })
  expect(await accountStamp('ana')).not.toBe(before)
})

test('a code works once, in its window; recovery codes work once and are struck from the file', async () => {
  const secret = newTotpSecret()
  const recovery = ['abcde-12345', 'fghjk-67890']
  write({ users: [entry('ana', 'analyst', 'pw-ana-largo', { totp: secret, recovery: await Promise.all(recovery.map(hashRecovery)) })] })
  const code = await codeAt(secret, T0)
  expect(await verifySecondStep('ana', code, T0)).toMatchObject({ ok: true, usedRecovery: false })
  // replayed in the same 30 seconds: refused
  expect(await verifySecondStep('ana', code, T0 + 1000)).toMatchObject({ ok: false, reason: 'codigo' })
  expect(await verifySecondStep('ana', await codeAt(secret, T0 + 30_000), T0 + 30_000)).toMatchObject({ ok: true })
  // typed loosely: upper case, spaces, the letter O for zero
  const stamp = await accountStamp('ana')
  expect(await verifySecondStep('ana', ' ABCDE 12345 ', T0 + 60_000)).toEqual({ ok: true, usedRecovery: true, recoveryLeft: 1 })
  expect(await verifySecondStep('ana', 'abcde-12345', T0 + 60_000)).toMatchObject({ ok: false })
  expect(await verifySecondStep('ana', 'FGHJK-6789O', T0 + 60_000)).toEqual({ ok: true, usedRecovery: true, recoveryLeft: 0 })
  expect(findAccount('ana')?.recovery).toEqual([])
  // spending recovery codes keeps the session alive
  expect(await accountStamp('ana')).toBe(stamp)
})

test('a new secret is not held back by the codes of the old one', async () => {
  const old = newTotpSecret()
  write({ users: [entry('ana', 'analyst', 'pw-ana-largo', { totp: old })] })
  expect(await verifySecondStep('ana', await codeAt(old, T0), T0)).toMatchObject({ ok: true })
  // reset from the terminal (another process) and enrolled again at once
  const fresh = newTotpSecret()
  write({ users: [entry('ana', 'analyst', 'pw-ana-largo')] })
  expect(await enroll('ana', fresh, await codeAt(fresh, T0), T0)).toMatchObject({ ok: true })
})

test('five wrong codes lock the second step for fifteen minutes, right codes included', async () => {
  const secret = newTotpSecret()
  write({ users: [entry('ana', 'analyst', 'pw-ana-largo', { totp: secret })] })
  for (let i = 0; i < 4; i++) expect(await verifySecondStep('ana', '000000', T0)).toMatchObject({ reason: 'codigo' })
  expect(await verifySecondStep('ana', 'zzzzz-zzzzz', T0)).toMatchObject({ reason: 'bloqueada' })
  expect(codeLocked('ana', T0)).toBe(true)
  expect(await verifySecondStep('ana', await codeAt(secret, T0 + 60_000), T0 + 60_000)).toMatchObject({ reason: 'bloqueada' })
  const later = T0 + 16 * 60_000
  expect(await verifySecondStep('ana', await codeAt(secret, later), later)).toMatchObject({ ok: true })
})

test('new recovery codes and disabling need a current code', async () => {
  const secret = newTotpSecret()
  write({ mfa_required: ['admin'], users: [entry('ana', 'admin', 'pw-ana-largo', { totp: secret, recovery: [await hashRecovery('aaaaa-bbbbb')] })] })
  expect(await regenerateRecovery('ana', '000000', T0)).toMatchObject({ ok: false })
  const fresh = await regenerateRecovery('ana', await codeAt(secret, T0), T0)
  if (!fresh.ok) throw new Error('regenerate failed')
  expect(findAccount('ana')?.recovery).toEqual(await Promise.all(fresh.codes.map(hashRecovery)))
  // the old code is gone with the old set
  expect(await disable('ana', 'aaaaa-bbbbb', T0 + 30_000)).toMatchObject({ ok: false })
  expect(await disable('ana', fresh.codes[3], T0 + 30_000)).toEqual({ ok: true })
  expect(findAccount('ana')).toMatchObject({ totp: null, recovery: [] })
  // the role still requires it: the next sign-in enrolls again
  expect(mfaState('ana')).toEqual({ enrolled: false, required: true, recoveryLeft: 0 })
})

test('HTTP Basic is refused for accounts with a second step or a role that requires one', async () => {
  write({ mfa_required: ['admin'], users: [
    entry('ana', 'analyst', 'pw-ana-largo', { totp: newTotpSecret() }),
    entry('jefa', 'admin', 'pw-jefa-largo'),
    entry('luis', 'viewer', 'pw-luis-largo'),
  ] })
  expect(await accountPrincipal(basic('ana', 'pw-ana-largo'))).toBeNull()
  expect(await accountPrincipal(basic('jefa', 'pw-jefa-largo'))).toBeNull()
  expect(await accountPrincipal(basic('luis', 'pw-luis-largo'))).toMatchObject({ name: 'luis', role: 'viewer' })
})

test('updateAccount never writes a file the console would refuse', () => {
  write({ users: [entry('ana', 'analyst', 'pw-ana-largo')] })
  const before = readFileSync(file, 'utf8')
  expect(updateAccount('ana', (e) => { e.role = 'root' })).toContain('inválido')
  expect(updateAccount('nadie', () => {})).toContain('nadie')
  expect(readFileSync(file, 'utf8')).toBe(before)
  expect(loadAccounts().error).toBeUndefined()
})
