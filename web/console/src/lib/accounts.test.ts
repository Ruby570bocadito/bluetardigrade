import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pbkdf2Sync } from 'node:crypto'
import { accountAction, listAccounts, newPasswordProblem } from './accounts'
import { accountStamp, parseUsers, resetUsersCache, verifyAccount, type Principal } from './users'

let dir = ''
let file = ''
let saved: string | undefined

beforeEach(() => {
  saved = process.env.CONSOLE_USERS_FILE
  dir = mkdtempSync(join(tmpdir(), 'sf-accounts-'))
  file = join(dir, 'console-users.json')
  process.env.CONSOLE_USERS_FILE = file
  resetUsersCache()
})
afterEach(() => {
  if (saved === undefined) delete process.env.CONSOLE_USERS_FILE
  else process.env.CONSOLE_USERS_FILE = saved
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
const stored = () => JSON.parse(readFileSync(file, 'utf8'))
const jefa: Principal = { name: 'jefa', role: 'admin', mode: 'users' }
const team = () => write({ mfa_required: ['admin'], users: [
  entry('jefa', 'admin', 'contraseña-de-jefa', { totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' }),
  entry('luis', 'analyst', 'contraseña-de-luis', { totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', recovery: ['a'.repeat(64)] }),
] })

test('a new account gets a temporary password it must change, and nothing else is touched', async () => {
  team()
  const res = await accountAction(jefa, 'crear', { user: 'Marta', role: 'viewer' })
  if (!res.ok) throw new Error(res.error)
  expect(res.password).toMatch(/^[0-9a-hjkmnp-tv-z]{4}(-[0-9a-hjkmnp-tv-z]{4}){3}$/)
  expect(await verifyAccount('marta', res.password!)).toEqual({ name: 'Marta', role: 'viewer', mode: 'users' })
  const doc = stored()
  expect(doc.mfa_required).toEqual(['admin'])
  expect(doc.users[2]).toMatchObject({ user: 'Marta', role: 'viewer', must_change: true })
  expect(doc.users[2].password).toMatch(/^pbkdf2-sha256\$310000\$/)
  expect(doc.users[1].recovery).toEqual(['a'.repeat(64)])
  expect(JSON.stringify(doc)).not.toContain(res.password!)
  const list = listAccounts()
  if ('error' in list) throw new Error(list.error)
  expect(list.accounts.map((a) => [a.user, a.must_change, a.mfa, a.mfa_required])).toEqual([
    ['jefa', false, true, true], ['luis', false, true, false], ['Marta', true, false, false],
  ])
})

test('names and roles are checked, and a name is taken whatever its case', async () => {
  team()
  expect(await accountAction(jefa, 'crear', { user: 'LUIS', role: 'viewer' })).toMatchObject({ ok: false, error: 'existe', status: 409 })
  expect(await accountAction(jefa, 'crear', { user: 'con espacio', role: 'viewer' })).toMatchObject({ ok: false, error: 'nombre' })
  expect(await accountAction(jefa, 'crear', { user: 'nuevo', role: 'root' })).toMatchObject({ ok: false, error: 'rol' })
  expect(await accountAction(jefa, 'rol', { user: 'luis', role: 7 })).toMatchObject({ ok: false, error: 'rol' })
  expect(await accountAction(jefa, 'borrar-todo', { user: 'luis' })).toMatchObject({ ok: false, error: 'accion' })
  expect(await accountAction(jefa, 'eliminar', { user: 'nadie' })).toMatchObject({ ok: false, error: 'no-existe', status: 404 })
})

test('an administrator never acts on their own account here', async () => {
  team()
  for (const action of ['rol', 'deshabilitar', 'restablecer', 'quitar-mfa', 'eliminar']) {
    expect(await accountAction(jefa, action, { user: 'JEFA', role: 'viewer' })).toMatchObject({ ok: false, error: 'propia', status: 403 })
  }
})

test('every change leaves an enabled administrator', async () => {
  team()
  // an actor that is no longer in the file (removed meanwhile) cannot
  // take the last administrator with it
  const ghost: Principal = { name: 'fantasma', role: 'admin', mode: 'users' }
  for (const [action, role] of [['rol', 'analyst'], ['deshabilitar', undefined], ['eliminar', undefined]] as const) {
    expect(await accountAction(ghost, action, { user: 'jefa', role })).toMatchObject({ ok: false, error: 'ultimo-admin' })
  }
  expect(stored().users[0]).toMatchObject({ user: 'jefa', role: 'admin' })
  expect(stored().users[0].disabled).toBeUndefined()
})

test('disabling ends the sessions and refuses the right password; enabling restores it', async () => {
  team()
  const stamp = await accountStamp('luis')
  expect(stamp).not.toBeNull()
  expect(await accountAction(jefa, 'deshabilitar', { user: 'luis' })).toEqual({ ok: true, user: 'luis' })
  expect(await accountStamp('luis')).toBeNull()
  expect(await verifyAccount('luis', 'contraseña-de-luis')).toBeNull()
  expect(await accountAction(jefa, 'habilitar', { user: 'luis' })).toMatchObject({ ok: true })
  expect(await accountStamp('luis')).toBe(stamp)
  expect(await verifyAccount('luis', 'contraseña-de-luis')).toMatchObject({ name: 'luis' })
})

test('a reset replaces the password, keeps the second step and ends the sessions', async () => {
  team()
  const stamp = await accountStamp('luis')
  const res = await accountAction(jefa, 'restablecer', { user: 'luis' })
  if (!res.ok) throw new Error(res.error)
  expect(await verifyAccount('luis', 'contraseña-de-luis')).toBeNull()
  expect(await verifyAccount('luis', res.password!)).toMatchObject({ name: 'luis' })
  expect(stored().users[1]).toMatchObject({ must_change: true, totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' })
  expect(await accountStamp('luis')).not.toBe(stamp)
})

test('roles change, second steps are removed, accounts are deleted', async () => {
  team()
  expect(await accountAction(jefa, 'rol', { user: 'luis', role: 'viewer' })).toMatchObject({ ok: true })
  expect(await accountAction(jefa, 'quitar-mfa', { user: 'luis' })).toMatchObject({ ok: true })
  expect(stored().users[1]).toMatchObject({ role: 'viewer' })
  expect(stored().users[1].totp).toBeUndefined()
  expect(stored().users[1].recovery).toBeUndefined()
  expect(await accountAction(jefa, 'quitar-mfa', { user: 'luis' })).toMatchObject({ ok: false, error: 'sin-mfa' })
  expect(await accountAction(jefa, 'eliminar', { user: 'Luis' })).toEqual({ ok: true, user: 'luis' })
  expect(stored().users.map((u: { user: string }) => u.user)).toEqual(['jefa'])
})

test('the file rules cover the new flags', () => {
  const base = entry('ana', 'admin', 'x')
  expect(parseUsers(JSON.stringify({ users: [{ ...base, disabled: true, must_change: false }] })).error).toBeUndefined()
  expect(parseUsers(JSON.stringify({ users: [{ ...base, disabled: 'yes' }] })).error).toContain('disabled')
  expect(parseUsers(JSON.stringify({ users: [{ ...base, must_change: 1 }] })).error).toContain('must_change')
})

test('a new password is long enough, typed twice the same, and not the current one', async () => {
  team()
  expect(await newPasswordProblem('luis', 'corta', 'corta')).toBe('corta')
  expect(await newPasswordProblem('luis', 'x'.repeat(1025), 'x'.repeat(1025))).toBe('larga')
  expect(await newPasswordProblem('luis', 'una-contraseña-nueva', 'otra-contraseña-nueva')).toBe('distintas')
  expect(await newPasswordProblem('luis', 'contraseña-de-luis', 'contraseña-de-luis')).toBe('igual')
  expect(await newPasswordProblem('luis', 'una-contraseña-nueva', 'una-contraseña-nueva')).toBeNull()
})
