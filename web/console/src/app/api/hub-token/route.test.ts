import { afterEach, beforeEach, expect, test } from 'bun:test'
import { GET } from './route'

const KEYS = ['HUB_ACCESS_TOKEN', 'CONSOLE_ACCESS_TOKEN', 'CONSOLE_ALLOWED_HOSTS'] as const
const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

test('loopback console hands out the hub token, uncached', async () => {
  process.env.HUB_ACCESS_TOKEN = 'hub-secret'
  const res = await GET(new Request('http://127.0.0.1:3000/api/hub-token'))
  expect(res.status).toBe(200)
  expect(res.headers.get('cache-control')).toBe('no-store')
  expect(await res.json()).toEqual({ token: 'hub-secret' })
})

test('the token never leaves through a foreign Host or a cross-site fetch', async () => {
  process.env.HUB_ACCESS_TOKEN = 'hub-secret'
  const attempts: Record<string, string>[] = [{ host: 'evil.example' }, { host: 'localhost:3000', 'sec-fetch-site': 'cross-site' }]
  for (const headers of attempts) {
    const res = await GET(new Request('http://127.0.0.1:3000/api/hub-token', { headers }))
    expect(res.status).toBe(403)
  }
})

test('a gated console demands its own credential first', async () => {
  process.env.HUB_ACCESS_TOKEN = 'hub-secret'
  process.env.CONSOLE_ACCESS_TOKEN = 'console-secret'
  const denied = await GET(new Request('http://127.0.0.1:3000/api/hub-token'))
  expect(denied.status).toBe(401)
  const ok = await GET(new Request('http://127.0.0.1:3000/api/hub-token', { headers: { authorization: 'Basic ' + btoa('ana:console-secret') } }))
  expect(await ok.json()).toEqual({ token: 'hub-secret' })
})

test('an account limited to host groups gets no hub token', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { pbkdf2Sync } = await import('node:crypto')
  const { resetUsersCache } = await import('@/lib/users')
  const salt = Buffer.from('0123456789abcdef')
  const entry = (user: string, groups?: string[]) => ({
    user,
    role: 'analyst',
    password: `pbkdf2-sha256$100000$${salt.toString('base64url')}$${pbkdf2Sync(`clave-de-${user}`, salt, 100_000, 32, 'sha256').toString('base64url')}`,
    ...(groups ? { groups } : {}),
  })
  const file = join(mkdtempSync(join(tmpdir(), 'sf-hub-')), 'users.json')
  writeFileSync(file, JSON.stringify({ users: [entry('ana', ['madrid']), entry('luis')] }))
  const before = process.env.CONSOLE_USERS_FILE
  process.env.CONSOLE_USERS_FILE = file
  process.env.HUB_ACCESS_TOKEN = 'hub-secret'
  resetUsersCache()
  try {
    const as = (user: string) => ({ headers: { authorization: 'Basic ' + btoa(`${user}:clave-de-${user}`) } })
    const scoped = await GET(new Request('http://127.0.0.1:3000/api/hub-token', as('ana')))
    expect(scoped.status).toBe(403)
    expect(await scoped.json()).toMatchObject({ error: 'scoped_account' })
    expect(await (await GET(new Request('http://127.0.0.1:3000/api/hub-token', as('luis')))).json()).toEqual({ token: 'hub-secret' })
  } finally {
    if (before === undefined) delete process.env.CONSOLE_USERS_FILE
    else process.env.CONSOLE_USERS_FILE = before
    resetUsersCache()
  }
})
