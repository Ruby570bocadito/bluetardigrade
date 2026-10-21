import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pbkdf2Sync } from 'node:crypto'
import { principalFor } from './access'
import {
  clearedSessionCookie, closeSession, openSession, readSessionCookie, resetSessions,
  sessionCookie, sessionPrincipal, tokenStamp,
} from './sessions'
import { accountStamp, resetUsersCache } from './users'

const KEYS = ['CONSOLE_USERS_FILE', 'CONSOLE_ACCESS_TOKEN', 'CONSOLE_SESSION_IDLE_MINUTES', 'CONSOLE_SESSION_MAX_HOURS'] as const
const saved: Record<string, string | undefined> = {}
let dir = ''

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  dir = mkdtempSync(join(tmpdir(), 'sf-sessions-'))
  resetUsersCache()
  resetSessions()
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const SALT = Buffer.from('0123456789abcdef')
const entry = (user: string, role: string, password: string) => ({
  user,
  role,
  password: `pbkdf2-sha256$100000$${SALT.toString('base64url')}$${pbkdf2Sync(password, SALT, 100_000, 32, 'sha256').toString('base64url')}`,
})
let generation = 0
function writeUsers(users: unknown) {
  // a fresh name each time: the users cache keys on size and mtime
  const file = join(dir, `console-users-${generation++}.json`)
  writeFileSync(file, JSON.stringify({ users }))
  process.env.CONSOLE_USERS_FILE = file
}

const ana = { name: 'ana', role: 'analyst', mode: 'users' } as const
const T0 = 1_000_000_000

test('a session resolves to its principal and slides its idle window', async () => {
  writeUsers([entry('ana', 'analyst', 'contraseña-de-ana')])
  const id = await openSession(ana, (await accountStamp('ana'))!, T0)
  expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(await sessionPrincipal(id, T0 + 20 * 60_000)).toEqual(ana)
  // 20 + 20 minutes: alive, because the last request moved the window
  expect(await sessionPrincipal(id, T0 + 40 * 60_000)).toEqual(ana)
  // 31 idle minutes: gone for good
  expect(await sessionPrincipal(id, T0 + 71 * 60_000)).toBeNull()
  expect(await sessionPrincipal(id, T0 + 41 * 60_000)).toBeNull()
})

test('the absolute lifetime ends a session that never idles', async () => {
  writeUsers([entry('ana', 'analyst', 'contraseña-de-ana')])
  process.env.CONSOLE_SESSION_MAX_HOURS = '1'
  const id = await openSession(ana, (await accountStamp('ana'))!, T0)
  for (let m = 10; m <= 60; m += 10) expect(await sessionPrincipal(id, T0 + m * 60_000)).toEqual(ana)
  expect(await sessionPrincipal(id, T0 + 61 * 60_000)).toBeNull()
})

test('changing the password or the role, or removing the account, ends its sessions', async () => {
  writeUsers([entry('ana', 'analyst', 'contraseña-de-ana'), entry('luis', 'viewer', 'contraseña-de-luis')])
  const a = await openSession(ana, (await accountStamp('ana'))!, T0)
  const l = await openSession({ name: 'luis', role: 'viewer', mode: 'users' }, (await accountStamp('luis'))!, T0)
  writeUsers([entry('ana', 'analyst', 'otra-contraseña-ana'), entry('luis', 'viewer', 'contraseña-de-luis')])
  expect(await sessionPrincipal(a, T0)).toBeNull()
  expect((await sessionPrincipal(l, T0))?.name).toBe('luis')
  writeUsers([entry('luis', 'analyst', 'contraseña-de-luis')])
  expect(await sessionPrincipal(l, T0)).toBeNull()
  const again = await openSession({ name: 'luis', role: 'analyst', mode: 'users' }, (await accountStamp('luis'))!, T0)
  writeUsers([entry('ana', 'analyst', 'contraseña-de-ana')])
  expect(await sessionPrincipal(again, T0)).toBeNull()
})

test('rotating the shared token ends the sessions it opened', async () => {
  process.env.CONSOLE_ACCESS_TOKEN = 'token-uno'
  const id = await openSession({ name: 'marta', role: 'admin', mode: 'token' }, (await tokenStamp())!, T0)
  expect((await sessionPrincipal(id, T0))?.name).toBe('marta')
  process.env.CONSOLE_ACCESS_TOKEN = 'token-dos'
  expect(await sessionPrincipal(id, T0)).toBeNull()
})

test('signing out, malformed ids and unknown ids resolve to nobody', async () => {
  writeUsers([entry('ana', 'analyst', 'contraseña-de-ana')])
  const id = await openSession(ana, (await accountStamp('ana'))!, T0)
  await closeSession(id)
  expect(await sessionPrincipal(id, T0)).toBeNull()
  expect(await sessionPrincipal(undefined, T0)).toBeNull()
  expect(await sessionPrincipal('corto', T0)).toBeNull()
  expect(await sessionPrincipal('A'.repeat(43), T0)).toBeNull()
  expect(await sessionPrincipal(id + '=', T0)).toBeNull()
})

test('the store is bounded: the least recently used session goes first', async () => {
  writeUsers([entry('ana', 'analyst', 'contraseña-de-ana')])
  const stamp = (await accountStamp('ana'))!
  const first = await openSession(ana, stamp, T0)
  const second = await openSession(ana, stamp, T0 + 1)
  for (let i = 0; i < 1022; i++) await openSession(ana, stamp, T0 + 2)
  // touch the first one: the second is now the coldest
  expect(await sessionPrincipal(first, T0 + 3)).toEqual(ana)
  await openSession(ana, stamp, T0 + 4)
  expect(await sessionPrincipal(first, T0 + 5)).toEqual(ana)
  expect(await sessionPrincipal(second, T0 + 5)).toBeNull()
})

test('a session only counts under the configuration that opened it', async () => {
  process.env.CONSOLE_ACCESS_TOKEN = 'tok'
  const id = await openSession({ name: 'marta', role: 'admin', mode: 'token' }, (await tokenStamp())!)
  const withCookie = new Request('http://127.0.0.1:3000/', { headers: { cookie: `otra=1; sf_session=${id}` } })
  expect((await principalFor(withCookie))?.mode).toBe('token')
  // accounts configured afterwards: the token session no longer opens the console
  writeUsers([entry('ana', 'analyst', 'contraseña-de-ana')])
  expect(await principalFor(withCookie)).toBeNull()
})

test('cookies are HttpOnly and SameSite=Strict, Secure only over HTTPS', () => {
  const plain = sessionCookie('abc', false)
  expect(plain).toContain('sf_session=abc')
  expect(plain).toContain('HttpOnly')
  expect(plain).toContain('SameSite=Strict')
  expect(plain).not.toContain('Secure')
  expect(plain).not.toContain('Max-Age')
  expect(sessionCookie('abc', true)).toContain('; Secure')
  expect(clearedSessionCookie(false)).toContain('Max-Age=0')
  expect(readSessionCookie(new Request('http://x/', { headers: { cookie: 'a=1; sf_session=XYZ ; b=2' } }))).toBe('XYZ')
  expect(readSessionCookie(new Request('http://x/', { headers: { cookie: 'xsf_session=1' } }))).toBeUndefined()
})

test('a session carries the account host groups, and changing them ends it', async () => {
  writeUsers([{ ...entry('ana', 'analyst', 'contraseña-de-ana'), groups: ['madrid'] }])
  const scoped = { ...ana, groups: ['madrid'] }
  const id = await openSession(scoped, (await accountStamp('ana'))!, T0)
  expect(await sessionPrincipal(id, T0 + 60_000)).toEqual(scoped)
  writeUsers([{ ...entry('ana', 'analyst', 'contraseña-de-ana'), groups: ['madrid', 'servidores'] }])
  expect(await sessionPrincipal(id, T0 + 2 * 60_000)).toBeNull()
})
