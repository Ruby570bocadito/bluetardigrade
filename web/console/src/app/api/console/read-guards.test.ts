// The console's own GET handlers share one guard (lib/request-guard,
// readRefused): the pinned Host and no cross-site browser context.

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pbkdf2Sync } from 'node:crypto'
import { readRefused } from '@/lib/request-guard'
import { resetSessions } from '@/lib/sessions'
import { resetUsersCache } from '@/lib/users'
import { GET as accounts } from './accounts/route'
import { GET as audit } from './audit/route'
import { GET as me } from './me/route'
import { GET as hubToken } from '../hub-token/route'

const KEYS = ['CONSOLE_USERS_FILE', 'CONSOLE_ACCESS_TOKEN', 'CONSOLE_AUDIT_FILE', 'CONSOLE_ALLOWED_HOSTS', 'HUB_ACCESS_TOKEN'] as const
const saved: Record<string, string | undefined> = {}
const SALT = Buffer.from('0123456789abcdef')
const AUTH = 'Basic ' + btoa('root:clave-larga-de-root')

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  const dir = mkdtempSync(join(tmpdir(), 'sf-guards-'))
  const file = join(dir, 'console-users.json')
  const password = `pbkdf2-sha256$100000$${SALT.toString('base64url')}$${pbkdf2Sync('clave-larga-de-root', SALT, 100_000, 32, 'sha256').toString('base64url')}`
  writeFileSync(file, JSON.stringify({ users: [{ user: 'root', role: 'admin', password }] }))
  process.env.CONSOLE_USERS_FILE = file
  process.env.HUB_ACCESS_TOKEN = 'hub-secret'
  resetUsersCache()
  resetSessions()
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  resetUsersCache()
})

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request('http://127.0.0.1:3000' + path, { headers: { authorization: AUTH, ...headers } })

const ROUTES: [string, (request: Request) => Promise<Response>][] = [
  ['/api/console/me', me],
  ['/api/console/audit', audit],
  ['/api/console/accounts', accounts],
  ['/api/hub-token', hubToken],
]

for (const [path, handler] of ROUTES) {
  test(`${path} answers the console itself and headerless clients`, async () => {
    expect((await handler(get(path))).status).toBe(200)
    expect((await handler(get(path, { host: 'localhost:3000', 'sec-fetch-site': 'same-origin' }))).status).toBe(200)
  })

  test(`${path} refuses a foreign Host and a cross-site browser context`, async () => {
    // a rebinding page reaches the console under its own name
    expect((await handler(get(path, { host: 'evil.example' }))).status).toBe(403)
    expect((await handler(get(path, { host: 'localhost:3000', 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
    expect((await handler(get(path, { host: 'localhost:3000', origin: 'https://evil.example' }))).status).toBe(403)
    // an allowlisted name is served
    process.env.CONSOLE_ALLOWED_HOSTS = 'soc.example'
    expect((await handler(get(path, { host: 'soc.example' }))).status).toBe(200)
  })

  test(`${path} still asks for the credential first`, async () => {
    const res = await handler(new Request('http://127.0.0.1:3000' + path, { headers: { host: 'evil.example' } }))
    expect(res.status).toBe(401)
  })
}

test('readRefused names the refusal and is not cached', async () => {
  expect(readRefused(new Request('http://127.0.0.1:3000/x'))).toBeNull()
  const res = readRefused(new Request('http://127.0.0.1:3000/x', { headers: { host: 'evil.example' } }))
  expect(res?.status).toBe(403)
  expect(res?.headers.get('cache-control')).toBe('no-store')
  expect(await res?.json()).toEqual({ error: 'host_not_allowed' })
})
