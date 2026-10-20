import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pbkdf2Sync } from 'node:crypto'
import { principalFor } from '@/lib/access'
import { resetChallenges } from '@/lib/challenges'
import { resetMfaMemory } from '@/lib/mfa'
import { resetSessions } from '@/lib/sessions'
import { base32Decode, hotp, totpStep } from '@/lib/totp'
import { resetUsersCache } from '@/lib/users'
import { GET as passwordPageRoute } from '../../../cuenta/contrasena/route'
import { GET as loginPage } from '../../../login/route'
import { POST as login } from '../login/route'
import { POST as changePassword } from '../password/route'
import { GET as list, POST as act } from './route'

const KEYS = ['CONSOLE_USERS_FILE', 'CONSOLE_ACCESS_TOKEN', 'CONSOLE_AUDIT_FILE'] as const
const saved: Record<string, string | undefined> = {}
let dir = ''
let file = ''

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  dir = mkdtempSync(join(tmpdir(), 'sf-accounts-routes-'))
  file = join(dir, 'console-users.json')
  process.env.CONSOLE_AUDIT_FILE = join(dir, 'audit.jsonl')
  resetUsersCache()
  resetSessions()
  resetChallenges()
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
function writeUsers(doc: unknown) {
  writeFileSync(file, JSON.stringify(doc))
  process.env.CONSOLE_USERS_FILE = file
  resetUsersCache()
}
const stored = () => JSON.parse(readFileSync(file, 'utf8')) as { users: Record<string, unknown>[] }
const auditLines = () => readFileSync(process.env.CONSOLE_AUDIT_FILE as string, 'utf8').trim().split('\n').map((l) => JSON.parse(l))

const BASE = 'http://127.0.0.1:3000'
const formHeaders = (cookie = '') => ({ host: '127.0.0.1:3000', origin: BASE, 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) })
const form = (path: string, fields: Record<string, string>, cookie = '') =>
  new Request(BASE + path, { method: 'POST', headers: formHeaders(cookie), body: new URLSearchParams(fields).toString() })
const json = (body: unknown, cookie = '', extra: Record<string, string> = {}) =>
  new Request(BASE + '/api/console/accounts', {
    method: 'POST',
    headers: { host: '127.0.0.1:3000', origin: BASE, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...extra },
    body: JSON.stringify(body),
  })
const get = (path: string, cookie = '') => new Request(BASE + path, { headers: cookie ? { cookie } : {} })

function cookiesOf(res: Response, jar: Record<string, string> = {}): Record<string, string> {
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';')
    const eq = pair.indexOf('=')
    if (/Max-Age=0/.test(line)) delete jar[pair.slice(0, eq)]
    else jar[pair.slice(0, eq)] = pair.slice(eq + 1)
  }
  return jar
}
const send = (jar: Record<string, string>) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
async function signIn(user: string, password: string): Promise<Record<string, string>> {
  return cookiesOf(await login(form('/api/console/login', { user, password })))
}
const team = (extra: Record<string, unknown> = {}) =>
  writeUsers({ users: [entry('jefa', 'admin', 'contraseña-de-jefa'), entry('luis', 'analyst', 'contraseña-de-luis')], ...extra })

describe('/api/console/accounts', () => {
  test('only a signed-in administrator lists and changes accounts', async () => {
    team()
    const admin = await signIn('jefa', 'contraseña-de-jefa')
    const body = await (await list(get('/api/console/accounts', send(admin)))).json()
    expect(body.accounts.map((a: { user: string }) => a.user)).toEqual(['jefa', 'luis'])
    const analyst = await signIn('luis', 'contraseña-de-luis')
    expect((await list(get('/api/console/accounts', send(analyst)))).status).toBe(403)
    expect((await act(json({ action: 'eliminar', user: 'jefa' }, send(analyst)))).status).toBe(403)
    expect((await list(get('/api/console/accounts'))).status).toBe(401)
    // another site cannot drive an administrator's browser
    expect((await act(json({ action: 'crear', user: 'intrusa', role: 'admin' }, send(admin), { origin: 'https://evil.example' }))).status).toBe(403)
    expect(stored().users).toHaveLength(2)
  })

  test('a console without accounts has none to manage', async () => {
    process.env.CONSOLE_ACCESS_TOKEN = 'console-secret'
    const res = await list(get('/api/console/accounts', send(await signIn('marta', 'console-secret'))))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('no_accounts')
  })

  test('actions answer with error codes, and every one is audited with its target', async () => {
    team()
    const admin = await signIn('jefa', 'contraseña-de-jefa')
    const created = await (await act(json({ action: 'crear', user: 'marta', role: 'viewer' }, send(admin)))).json()
    expect(created).toMatchObject({ ok: true, user: 'marta' })
    expect(created.password).toMatch(/^[0-9a-z]{4}(-[0-9a-z]{4}){3}$/)
    const own = await act(json({ action: 'deshabilitar', user: 'jefa' }, send(admin)))
    expect(own.status).toBe(403)
    expect((await own.json()).error).toBe('propia')
    expect(auditLines().slice(-2).map((e) => [e.path, e.outcome, e.target])).toEqual([
      ['/accounts/crear', 'ok', 'marta'], ['/accounts/deshabilitar', 'denied', 'jefa'],
    ])
  })

  test('disabling an account ends its open session at once', async () => {
    team()
    const admin = await signIn('jefa', 'contraseña-de-jefa')
    const analyst = await signIn('luis', 'contraseña-de-luis')
    expect(await principalFor(get('/', send(analyst)))).toMatchObject({ name: 'luis' })
    expect((await act(json({ action: 'deshabilitar', user: 'luis' }, send(admin)))).status).toBe(200)
    expect(await principalFor(get('/', send(analyst)))).toBeNull()
    const again = await login(form('/api/console/login', { user: 'luis', password: 'contraseña-de-luis' }))
    expect(again.headers.get('location')).toBe('/login?error=credenciales&next=%2F')
  })
})

describe('a temporary password is changed before any session', () => {
  test('the new account sets its own password at its first sign-in', async () => {
    team()
    const admin = await signIn('jefa', 'contraseña-de-jefa')
    const { password: temp } = await (await act(json({ action: 'crear', user: 'marta', role: 'viewer' }, send(admin)))).json()
    const first = await login(form('/api/console/login', { user: 'marta', password: temp, next: '/?view=alertas' }))
    expect(first.headers.get('location')).toBe('/login?paso=contrasena&next=%2F%3Fview%3Dalertas')
    const jar = cookiesOf(first)
    expect(Object.keys(jar)).toEqual(['sf_mfa'])
    const page = await (await loginPage(get('/login?paso=contrasena', send(jar)))).text()
    expect(page).toContain('Elige tu contraseña')
    expect(page).toContain('autocomplete="new-password"')
    expect(page).not.toContain('name="current"')

    for (const [fields, error] of [
      [{ new_password: 'corta', repeat: 'corta' }, 'corta'],
      [{ new_password: 'mi-contraseña-propia', repeat: 'otra-cosa-distinta' }, 'distintas'],
      [{ new_password: temp, repeat: temp }, 'igual'],
    ] as const) {
      const res = await login(form('/api/console/login', { step: 'password', ...fields }, send(jar)))
      expect(res.headers.get('location')).toBe(`/login?paso=contrasena&error=${error}&next=%2F%3Fview%3Dalertas`)
    }
    const done = await login(form('/api/console/login', { step: 'password', new_password: 'mi-contraseña-propia', repeat: 'mi-contraseña-propia' }, send(jar)))
    expect(done.headers.get('location')).toBe('/?view=alertas')
    cookiesOf(done, jar)
    expect(Object.keys(jar)).toEqual(['sf_session'])
    expect(await principalFor(get('/', send(jar)))).toMatchObject({ name: 'marta', role: 'viewer' })
    const marta = stored().users.find((u) => u.user === 'marta')!
    expect(marta.must_change).toBeUndefined()
    // the temporary password is gone
    expect((await login(form('/api/console/login', { user: 'marta', password: temp }))).headers.get('location')).toContain('error=credenciales')
    expect(auditLines().filter((e) => e.user === 'marta').map((e) => `${e.path} ${e.outcome}`)).toEqual([
      '/login ok', '/login/contrasena denied', '/login/contrasena denied', '/login/contrasena denied', '/login/contrasena ok',
      // the temporary password tried again
      '/login denied',
    ])
  })

  test('with a second step, the code comes first and the new password after', async () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
    team()
    writeUsers({ users: [entry('jefa', 'admin', 'contraseña-de-jefa'), entry('luis', 'analyst', 'contraseña-temporal', { totp: secret, must_change: true })] })
    const jar = cookiesOf(await login(form('/api/console/login', { user: 'luis', password: 'contraseña-temporal' })))
    const code = await hotp(base32Decode(secret)!, totpStep())
    const afterCode = await login(form('/api/console/login', { step: 'code', code }, send(jar)))
    expect(afterCode.headers.get('location')).toBe('/login?paso=contrasena&next=%2F')
    cookiesOf(afterCode, jar)
    expect(await principalFor(get('/', send(jar)))).toBeNull()
    const done = await login(form('/api/console/login', { step: 'password', new_password: 'contraseña-de-luis', repeat: 'contraseña-de-luis' }, send(jar)))
    expect(done.headers.get('location')).toBe('/')
    expect(await principalFor(get('/', send(cookiesOf(done, jar))))).toMatchObject({ name: 'luis' })
    // the second step stays
    expect(stored().users[1].totp).toBe(secret)
  })
})

describe('/cuenta/contrasena', () => {
  test('a signed-in operator changes their password: the current one first, a fresh session after', async () => {
    team()
    const jar = await signIn('luis', 'contraseña-de-luis')
    const other = await signIn('luis', 'contraseña-de-luis')
    const page = await (await passwordPageRoute(get('/cuenta/contrasena', send(jar)))).text()
    expect(page).toContain('name="current"')
    const wrong = await changePassword(form('/api/console/password', { current: 'mala', new_password: 'contraseña-nueva-luis', repeat: 'contraseña-nueva-luis' }, send(jar)))
    expect(wrong.headers.get('location')).toBe('/cuenta/contrasena?error=actual')
    const same = await changePassword(form('/api/console/password', { current: 'contraseña-de-luis', new_password: 'contraseña-de-luis', repeat: 'contraseña-de-luis' }, send(jar)))
    expect(same.headers.get('location')).toBe('/cuenta/contrasena?error=igual')
    const done = await changePassword(form('/api/console/password', { current: 'contraseña-de-luis', new_password: 'contraseña-nueva-luis', repeat: 'contraseña-nueva-luis' }, send(jar)))
    expect(await done.text()).toContain('Contraseña cambiada')
    cookiesOf(done, jar)
    expect(await principalFor(get('/', send(jar)))).toMatchObject({ name: 'luis' })
    // the other browser is signed out
    expect(await principalFor(get('/', send(other)))).toBeNull()
    expect(await signIn('luis', 'contraseña-nueva-luis')).toHaveProperty('sf_session')
  })

  test('the shared token has no password of its own', async () => {
    process.env.CONSOLE_ACCESS_TOKEN = 'console-secret'
    const jar = await signIn('marta', 'console-secret')
    expect(await (await passwordPageRoute(get('/cuenta/contrasena', send(jar)))).text()).toContain('no hay ninguna que cambiar')
    expect((await changePassword(form('/api/console/password', { current: 'x' }, send(jar)))).status).toBe(400)
  })
})
