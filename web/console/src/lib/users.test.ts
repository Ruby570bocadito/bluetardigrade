import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pbkdf2Sync } from 'node:crypto'
import { principalFor } from './access'
import { accountPrincipal, attribute, audit, parseUsers, readAudit, resetUsersCache, roleAtLeast } from './users'

const KEYS = ['CONSOLE_USERS_FILE', 'CONSOLE_AUDIT_FILE', 'CONSOLE_ACCESS_TOKEN'] as const
const saved: Record<string, string | undefined> = {}
let dir = ''

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  dir = mkdtempSync(join(tmpdir(), 'sf-users-'))
  resetUsersCache()
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
const basic = (user: string, password: string) => 'Basic ' + btoa(String.fromCharCode(...new TextEncoder().encode(`${user}:${password}`)))

function writeUsers(users: unknown) {
  const file = join(dir, 'console-users.json')
  writeFileSync(file, JSON.stringify(users))
  process.env.CONSOLE_USERS_FILE = file
  return file
}

test('parseUsers accepts valid accounts and rejects the whole file on any bad entry', () => {
  expect(parseUsers(JSON.stringify({ users: [entry('ana', 'analyst', 'x'.repeat(12))] })).accounts).toHaveLength(1)
  expect(parseUsers(JSON.stringify([entry('ana', 'analyst', 'p'), entry('ANA', 'viewer', 'q')])).error).toContain('repetida')
  expect(parseUsers(JSON.stringify({ users: [entry('ana', 'root', 'p')] })).error).toContain('rol')
  expect(parseUsers(JSON.stringify({ users: [{ user: 'ana', role: 'viewer', password: 'plain' }] })).error).toContain('formato')
  expect(parseUsers(JSON.stringify({ users: [{ ...entry('ana', 'viewer', 'p'), password: 'pbkdf2-sha256$10$AAAAAAAAAAAAAAAAAAAAAA$' + 'A'.repeat(43) }] })).error).toContain('formato')
  expect(parseUsers(JSON.stringify({ users: [entry('a b', 'viewer', 'p')] })).error).toContain('nombre')
  expect(parseUsers('{').error).toContain('JSON')
  expect(parseUsers('{"users":[]}').error).toContain('no tiene cuentas')
})

test('accounts authenticate by password and carry their role', async () => {
  writeUsers({ users: [entry('ana', 'analyst', 'contraseña-de-ana'), entry('luis', 'viewer', 'contraseña-de-luis')] })
  expect(await accountPrincipal(basic('ana', 'contraseña-de-ana'))).toEqual({ name: 'ana', role: 'analyst', mode: 'users' })
  expect(await accountPrincipal(basic('ANA', 'contraseña-de-ana'))).toEqual({ name: 'ana', role: 'analyst', mode: 'users' })
  expect(await accountPrincipal(basic('ana', 'contraseña-de-luis'))).toBeNull()
  expect(await accountPrincipal(basic('nadie', 'x'))).toBeNull()
  expect(await accountPrincipal(null)).toBeNull()
  expect((await accountPrincipal(basic('luis', 'contraseña-de-luis')))?.role).toBe('viewer')
})

test('with accounts the shared token no longer opens the console', async () => {
  writeUsers({ users: [entry('ana', 'admin', 'contraseña-de-ana')] })
  process.env.CONSOLE_ACCESS_TOKEN = 'tok'
  expect(await principalFor(new Request('http://127.0.0.1:3000/', { headers: { authorization: basic('x', 'tok') } }))).toBeNull()
  expect((await principalFor(new Request('http://127.0.0.1:3000/', { headers: { authorization: basic('ana', 'contraseña-de-ana') } })))?.mode).toBe('users')
})

test('without accounts the console behaves as before: open admin or token admin', async () => {
  expect(await principalFor(new Request('http://127.0.0.1:3000/'))).toEqual({ name: 'local', role: 'admin', mode: 'open' })
  process.env.CONSOLE_ACCESS_TOKEN = 'tok'
  expect(await principalFor(new Request('http://127.0.0.1:3000/'))).toBeNull()
  expect(await principalFor(new Request('http://127.0.0.1:3000/', { headers: { authorization: basic('marta', 'tok') } }))).toEqual({ name: 'marta', role: 'admin', mode: 'token' })
})

test('a configured but broken users file locks the console', async () => {
  process.env.CONSOLE_USERS_FILE = join(dir, 'missing.json')
  expect(await principalFor(new Request('http://127.0.0.1:3000/'))).toBeNull()
  const file = writeUsers({ users: [] })
  expect(await principalFor(new Request('http://127.0.0.1:3000/', { headers: { authorization: basic('ana', 'x') } }))).toBeNull()
  writeFileSync(file, JSON.stringify({ users: [entry('ana', 'viewer', 'contraseña-de-ana')] }) + ' ')
  expect((await accountPrincipal(basic('ana', 'contraseña-de-ana')))?.name).toBe('ana')
})

test('repeated failures lock the account for a while', async () => {
  writeUsers({ users: [entry('ana', 'analyst', 'contraseña-de-ana')] })
  const t0 = 1_000_000
  for (let i = 0; i < 10; i++) expect(await accountPrincipal(basic('ana', `mala-${i}`), t0)).toBeNull()
  expect(await accountPrincipal(basic('ana', 'contraseña-de-ana'), t0 + 1000)).toBeNull()
  expect((await accountPrincipal(basic('ana', 'contraseña-de-ana'), t0 + 6 * 60 * 1000))?.name).toBe('ana')
})

test('roles are ordered viewer < analyst < admin', () => {
  expect(roleAtLeast('admin', 'analyst')).toBe(true)
  expect(roleAtLeast('analyst', 'analyst')).toBe(true)
  expect(roleAtLeast('viewer', 'analyst')).toBe(false)
  expect(roleAtLeast('analyst', 'admin')).toBe(false)
})

test('attribution overwrites "by" only for accounts and only on JSON objects', () => {
  const ana = { name: 'ana', role: 'analyst' as const, mode: 'users' as const }
  expect(JSON.parse(attribute('{"status":"closed","by":"consola"}', ana))).toEqual({ status: 'closed', by: 'ana' })
  expect(JSON.parse(attribute('{"text":"nota"}', ana))).toEqual({ text: 'nota', by: 'ana' })
  expect(attribute('[1]', ana)).toBe('[1]')
  expect(attribute('no json', ana)).toBe('no json')
  expect(attribute('{"by":"consola"}', { name: 'local', role: 'admin', mode: 'open' })).toBe('{"by":"consola"}')
})

test('the audit trail appends lines and reads newest first', () => {
  expect(readAudit(10)).toEqual({ entries: [] })
  const file = join(dir, 'audit.jsonl')
  process.env.CONSOLE_AUDIT_FILE = file
  expect(readAudit(10)).toEqual({ entries: [] })
  for (const [i, status] of [200, 403, 500].entries()) {
    audit({ at: `2026-10-04T10:0${i}:00Z`, user: 'ana', role: 'analyst', mode: 'users', method: 'POST', path: '/api/incidents', status, outcome: status === 403 ? 'denied' : status < 400 ? 'ok' : 'error' })
  }
  expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(3)
  const { entries } = readAudit(2)
  expect(entries.map((e) => e.status)).toEqual([500, 403])
  expect(entries[1].outcome).toBe('denied')
})
