import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pbkdf2Sync } from 'node:crypto'
import { NextRequest } from 'next/server'
import { principalFor } from '@/lib/access'
import { safeNext } from '@/lib/login'
import { resetSessions } from '@/lib/sessions'
import { resetUsersCache } from '@/lib/users'
import { proxy } from '@/proxy'
import { POST as login } from './route'
import { POST as logout } from '../logout/route'
import { GET as loginPage } from '../../../login/route'

const KEYS = ['CONSOLE_USERS_FILE', 'CONSOLE_ACCESS_TOKEN', 'CONSOLE_AUDIT_FILE', 'CONSOLE_ALLOWED_HOSTS'] as const
const saved: Record<string, string | undefined> = {}
let dir = ''

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  dir = mkdtempSync(join(tmpdir(), 'sf-login-'))
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
function withAccounts() {
  const file = join(dir, 'console-users.json')
  writeFileSync(file, JSON.stringify({ users: [entry('ana', 'analyst', 'contraseña-de-ana')] }))
  process.env.CONSOLE_USERS_FILE = file
  process.env.CONSOLE_AUDIT_FILE = join(dir, 'audit.jsonl')
}
const auditLines = () => readFileSync(process.env.CONSOLE_AUDIT_FILE as string, 'utf8').trim().split('\n').map((l) => JSON.parse(l))

const BASE = 'http://127.0.0.1:3000'
function formPost(path: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
  return new Request(BASE + path, {
    method: 'POST',
    headers: { host: '127.0.0.1:3000', origin: BASE, 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(fields).toString(),
  })
}
const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0]
const asBrowser = (cookie: string) => new Request(BASE + '/', { headers: { cookie } })

describe('POST /api/console/login', () => {
  test('a valid account gets a session cookie and goes where it was heading', async () => {
    withAccounts()
    const res = await login(formPost('/api/console/login', { user: 'ana', password: 'contraseña-de-ana', next: '/?view=alertas' }))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/?view=alertas')
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
    expect(await principalFor(asBrowser(cookieOf(res)))).toEqual({ name: 'ana', role: 'analyst', mode: 'users' })
    expect(auditLines().at(-1)).toMatchObject({ user: 'ana', role: 'analyst', path: '/login', outcome: 'ok' })
  })

  test('a wrong password goes back to the form, sets nothing and is audited without a role', async () => {
    withAccounts()
    const res = await login(formPost('/api/console/login', { user: 'ana', password: 'mala', next: '/' }))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/login?error=credenciales&next=%2F')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(auditLines().at(-1)).toMatchObject({ user: 'ana', role: '', path: '/login', outcome: 'denied', status: 401 })
  })

  test('another site cannot sign the browser in', async () => {
    withAccounts()
    const fromElsewhere = await login(formPost('/api/console/login', { user: 'ana', password: 'contraseña-de-ana' }, { origin: 'https://evil.example' }))
    expect(fromElsewhere.headers.get('location')).toContain('error=origen')
    expect(fromElsewhere.headers.get('set-cookie')).toBeNull()
    const rebound = await login(formPost('/api/console/login', { user: 'ana', password: 'contraseña-de-ana' }, { host: 'evil.example', origin: 'http://evil.example' }))
    expect(rebound.headers.get('location')).toContain('error=origen')
    // an opaque origin (sandboxed frame, data: URL) sends null too, but
    // never with Sec-Fetch-Site: same-origin
    for (const site of ['cross-site', 'same-site', 'none', '']) {
      const opaque = await login(formPost('/api/console/login', { user: 'ana', password: 'contraseña-de-ana' }, { origin: 'null', 'sec-fetch-site': site }))
      expect(opaque.headers.get('set-cookie')).toBeNull()
    }
  })

  test("the console's own form signs in: Origin null under no-referrer, Sec-Fetch-Site same-origin", async () => {
    withAccounts()
    const res = await login(formPost('/api/console/login', { user: 'ana', password: 'contraseña-de-ana' }, { origin: 'null', 'sec-fetch-site': 'same-origin' }))
    expect(res.headers.get('location')).toBe('/')
    expect(res.headers.get('set-cookie')).toContain('sf_session=')
  })

  test('the redirect after signing in never leaves the console', async () => {
    withAccounts()
    for (const next of ['//evil.example/x', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)', '/login?next=/']) {
      const res = await login(formPost('/api/console/login', { user: 'ana', password: 'contraseña-de-ana', next }))
      expect(res.headers.get('location')).toBe('/')
    }
    expect(safeNext('/?view=equipos&host=PC-1')).toBe('/?view=equipos&host=PC-1')
    expect(safeNext('/a\u0000b')).toBe('/')
    expect(safeNext('/' + 'x'.repeat(600))).toBe('/')
  })

  test('the shared token signs in as admin under the name the operator typed', async () => {
    process.env.CONSOLE_ACCESS_TOKEN = 'console-secret'
    const res = await login(formPost('/api/console/login', { user: 'marta', password: 'console-secret' }))
    expect(await principalFor(asBrowser(cookieOf(res)))).toEqual({ name: 'marta', role: 'admin', mode: 'token' })
    const bad = await login(formPost('/api/console/login', { user: 'marta', password: 'nope' }))
    expect(bad.headers.get('set-cookie')).toBeNull()
  })

  test('JSON clients get JSON, oversized bodies are refused before parsing', async () => {
    withAccounts()
    const ok = await login(new Request(BASE + '/api/console/login', {
      method: 'POST', headers: { host: '127.0.0.1:3000', 'content-type': 'application/json' },
      body: JSON.stringify({ user: 'ana', password: 'contraseña-de-ana' }),
    }))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ ok: true, name: 'ana', role: 'analyst' })
    const big = await login(new Request(BASE + '/api/console/login', {
      method: 'POST', headers: { host: '127.0.0.1:3000', 'content-type': 'application/json' },
      body: JSON.stringify({ user: 'ana', password: 'x'.repeat(10_000) }),
    }))
    expect(big.status).toBe(401)
  })

  test('a console without credentials has nothing to sign in to', async () => {
    const res = await login(formPost('/api/console/login', { user: 'x', password: 'y', next: '/?view=flujo' }))
    expect(res.headers.get('location')).toBe('/?view=flujo')
    expect(res.headers.get('set-cookie')).toBeNull()
  })
})

describe('POST /api/console/logout', () => {
  test('ends the session, clears the cookie and is audited', async () => {
    withAccounts()
    const cookie = cookieOf(await login(formPost('/api/console/login', { user: 'ana', password: 'contraseña-de-ana' })))
    const res = await logout(new Request(BASE + '/api/console/logout', { method: 'POST', headers: { host: '127.0.0.1:3000', origin: BASE, cookie } }))
    expect(res.headers.get('location')).toBe('/login')
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(await principalFor(asBrowser(cookie))).toBeNull()
    expect(auditLines().at(-1)).toMatchObject({ user: 'ana', path: '/logout', outcome: 'ok' })
    // the session dialog's form posts with Origin null (no-referrer)
    const again = cookieOf(await login(formPost('/api/console/login', { user: 'ana', password: 'contraseña-de-ana' })))
    const fromForm = await logout(new Request(BASE + '/api/console/logout', { method: 'POST', headers: { host: '127.0.0.1:3000', origin: 'null', 'sec-fetch-site': 'same-origin', cookie: again } }))
    expect(fromForm.status).toBe(303)
    expect(await principalFor(asBrowser(again))).toBeNull()
  })

  test('another site cannot sign the operator out', async () => {
    withAccounts()
    const cookie = cookieOf(await login(formPost('/api/console/login', { user: 'ana', password: 'contraseña-de-ana' })))
    const res = await logout(new Request(BASE + '/api/console/logout', { method: 'POST', headers: { host: '127.0.0.1:3000', origin: 'https://evil.example', cookie } }))
    expect(res.status).toBe(403)
    expect((await principalFor(asBrowser(cookie)))?.name).toBe('ana')
  })
})

describe('GET /login', () => {
  test('renders a script-free form and escapes what it reflects', async () => {
    withAccounts()
    const res = await loginPage(new Request(BASE + '/login?next=' + encodeURIComponent('/"><script>alert(1)</script>') + '&error=credenciales'))
    const html = await res.text()
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(html).toContain('action="/api/console/login"')
    expect(html).not.toContain('<script')
    expect(html).toContain('&quot;&gt;&lt;script&gt;')
    expect(html).toContain('Usuario o contraseña incorrectos')
  })

  test('a broken users file explains the lock and disables the form', async () => {
    process.env.CONSOLE_USERS_FILE = join(dir, 'missing.json')
    const html = await (await loginPage(new Request(BASE + '/login'))).text()
    expect(html).toContain('La consola está bloqueada')
    expect(html).toContain('<button type="submit" disabled>')
  })

  test('an open console, or a signed-in caller, goes straight on', async () => {
    expect((await loginPage(new Request(BASE + '/login?next=%2F%3Fview%3Dflujo'))).headers.get('location')).toBe('/?view=flujo')
    withAccounts()
    const cookie = cookieOf(await login(formPost('/api/console/login', { user: 'ana', password: 'contraseña-de-ana' })))
    expect((await loginPage(new Request(BASE + '/login', { headers: { cookie } }))).status).toBe(303)
  })
})

describe('proxy gate', () => {
  const nav = (path: string, headers: Record<string, string> = {}) =>
    new NextRequest(BASE + path, { headers: { accept: 'text/html,application/xhtml+xml', ...headers } })

  test('a page without a session is sent to the sign-in page, keeping its destination', async () => {
    withAccounts()
    const res = await proxy(nav('/?view=equipos'))
    expect(res.status).toBe(303)
    // absolute, as the Next.js proxy requires (a relative Location is a 500 there)
    // (Next.js spells loopback IPs as "localhost" in nextUrl)
    const location = new URL(res.headers.get('location') as string)
    expect(['http://127.0.0.1:3000', 'http://localhost:3000']).toContain(location.origin)
    expect(location.pathname + location.search).toBe('/login?next=' + encodeURIComponent('/?view=equipos'))
  })

  test('API calls and assets get 401 JSON, never a redirect or a Basic prompt', async () => {
    withAccounts()
    for (const path of ['/api/engine/api/alerts', '/_next/static/chunks/app.js']) {
      const res = await proxy(nav(path))
      expect(res.status).toBe(401)
      expect(res.headers.get('www-authenticate')).toBeNull()
    }
  })

  test('the sign-in page and its form target are public; a session opens the rest', async () => {
    withAccounts()
    for (const path of ['/login', '/api/console/login']) expect((await proxy(nav(path))).status).toBe(200)
    const cookie = cookieOf(await login(formPost('/api/console/login', { user: 'ana', password: 'contraseña-de-ana' })))
    const res = await proxy(nav('/', { cookie }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(res.headers.get('strict-transport-security')).toBeNull()
  })

  test('behind a TLS front end every answer, refusals included, carries HSTS', async () => {
    withAccounts()
    const https = { 'x-forwarded-proto': 'https' }
    for (const path of ['/login', '/', '/api/console/me']) {
      expect((await proxy(nav(path, https))).headers.get('strict-transport-security')).toBe('max-age=31536000')
    }
  })
})
