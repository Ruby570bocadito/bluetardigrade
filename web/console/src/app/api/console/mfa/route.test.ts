import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pbkdf2Sync } from 'node:crypto'
import { principalFor } from '@/lib/access'
import { resetChallenges } from '@/lib/challenges'
import { hashRecovery, resetMfaMemory } from '@/lib/mfa'
import { resetSessions } from '@/lib/sessions'
import { base32Decode, hotp, newTotpSecret, totpStep } from '@/lib/totp'
import { resetUsersCache } from '@/lib/users'
import { GET as accountPage } from '../../../cuenta/dos-pasos/route'
import { GET as loginPage } from '../../../login/route'
import { POST as login } from '../login/route'
import { GET as me } from '../me/route'
import { POST as mfa } from './route'

const KEYS = ['CONSOLE_USERS_FILE', 'CONSOLE_ACCESS_TOKEN', 'CONSOLE_AUDIT_FILE'] as const
const saved: Record<string, string | undefined> = {}
let dir = ''
let file = ''

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  dir = mkdtempSync(join(tmpdir(), 'sf-mfa-routes-'))
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
const stored = () => JSON.parse(readFileSync(file, 'utf8')) as { users: { user: string; totp?: string; recovery?: string[] }[] }
const auditPaths = () => readFileSync(process.env.CONSOLE_AUDIT_FILE as string, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((e) => `${e.path} ${e.outcome}`)
// codes of the current step and the next one: the window takes both,
// and a step already used by the account is refused
const code = async (secret: string, ahead = 0) => hotp(base32Decode(secret)!, totpStep() + ahead)

const BASE = 'http://127.0.0.1:3000'
const headers = (cookie = '') => ({ host: '127.0.0.1:3000', origin: BASE, 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) })
const post = (path: string, fields: Record<string, string>, cookie = '') =>
  new Request(BASE + path, { method: 'POST', headers: headers(cookie), body: new URLSearchParams(fields).toString() })
const get = (path: string, cookie = '') => new Request(BASE + path, { headers: cookie ? { cookie } : {} })

// a tiny cookie jar: what the browser would send back
function cookiesOf(res: Response, jar: Record<string, string> = {}): Record<string, string> {
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';')
    const eq = pair.indexOf('=')
    const name = pair.slice(0, eq)
    const value = pair.slice(eq + 1)
    if (/Max-Age=0/.test(line)) delete jar[name]
    else jar[name] = value
  }
  return jar
}
const send = (jar: Record<string, string>) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
const secretIn = (html: string) => (/<code class="secret">([A-Z2-7 ]+)<\/code>/.exec(html)?.[1] ?? '').replace(/ /g, '')

describe('sign-in with a second step', () => {
  test('the password alone opens no session: the code does', async () => {
    const secret = newTotpSecret()
    writeUsers({ users: [entry('ana', 'analyst', 'contraseña-de-ana', { totp: secret })] })
    const first = await login(post('/api/console/login', { user: 'ana', password: 'contraseña-de-ana', next: '/?view=alertas' }))
    expect(first.headers.get('location')).toBe('/login?paso=codigo&next=%2F%3Fview%3Dalertas')
    const jar = cookiesOf(first)
    expect(Object.keys(jar)).toEqual(['sf_mfa'])
    expect(first.headers.getSetCookie()[0]).toContain('HttpOnly')
    // the pending sign-in opens nothing
    expect(await principalFor(get('/', send(jar)))).toBeNull()
    const page = await (await loginPage(get('/login?paso=codigo&next=%2F', send(jar)))).text()
    expect(page).toContain('Verificación en dos pasos')
    expect(page).toContain('name="step" value="code"')
    expect(page).not.toContain('<script')

    const wrong = await login(post('/api/console/login', { step: 'code', code: '000000' }, send(jar)))
    expect(wrong.headers.get('location')).toBe('/login?paso=codigo&error=codigo&next=%2F%3Fview%3Dalertas')
    const right = await login(post('/api/console/login', { step: 'code', code: await code(secret) }, send(jar)))
    expect(right.headers.get('location')).toBe('/?view=alertas')
    cookiesOf(right, jar)
    expect(Object.keys(jar)).toEqual(['sf_session'])
    expect(await principalFor(get('/', send(jar)))).toEqual({ name: 'ana', role: 'analyst', mode: 'users' })
    expect(auditPaths()).toEqual(['/login/codigo denied', '/login ok'])
  })

  test('a recovery code signs in once and is audited as such', async () => {
    writeUsers({ users: [entry('ana', 'analyst', 'contraseña-de-ana', { totp: newTotpSecret(), recovery: [await hashRecovery('abcde-fghjk')] })] })
    const jar = cookiesOf(await login(post('/api/console/login', { user: 'ana', password: 'contraseña-de-ana' })))
    const res = await login(post('/api/console/login', { step: 'code', code: 'ABCDE FGHJK' }, send(jar)))
    expect(res.headers.get('location')).toBe('/')
    expect(stored().users[0].recovery).toEqual([])
    expect(auditPaths()).toEqual(['/login/recuperacion ok', '/login ok'])
  })

  test('five wrong codes end the pending sign-in: the password again', async () => {
    writeUsers({ users: [entry('ana', 'analyst', 'contraseña-de-ana', { totp: newTotpSecret() })] })
    const jar = cookiesOf(await login(post('/api/console/login', { user: 'ana', password: 'contraseña-de-ana' })))
    let last: Response | null = null
    for (let i = 0; i < 5; i++) last = await login(post('/api/console/login', { step: 'code', code: '00000' + i }, send(jar)))
    // the fifth wrong code also trips the account's code lockout
    expect(last?.headers.get('location')).toMatch(/^\/login\?error=(caducado|bloqueada)&next=%2F$/)
    const after = await login(post('/api/console/login', { step: 'code', code: '123456' }, send(jar)))
    expect(after.headers.get('location')).toBe('/login?error=caducado&next=%2F')
    const page = await (await loginPage(get('/login?paso=codigo', send(jar)))).text()
    expect(page).toContain('ha caducado')
    // and the locked account cannot open a new pending sign-in either
    const again = await login(post('/api/console/login', { user: 'ana', password: 'contraseña-de-ana' }))
    expect(again.headers.get('location')).toBe('/login?error=bloqueada&next=%2F')
  })

  test('a role that requires it enrolls right after the password, then gets its recovery codes', async () => {
    writeUsers({ mfa_required: ['admin'], users: [entry('jefa', 'admin', 'contraseña-de-jefa')] })
    const first = await login(post('/api/console/login', { user: 'jefa', password: 'contraseña-de-jefa', next: '/?view=equipos' }))
    expect(first.headers.get('location')).toBe('/login?paso=activar&next=%2F%3Fview%3Dequipos')
    const jar = cookiesOf(first)
    const html = await (await loginPage(get('/login?paso=activar', send(jar)))).text()
    expect(html).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(html).toContain('Tu rol (Administrador)')
    const secret = secretIn(html)
    expect(secret).toMatch(/^[A-Z2-7]{32}$/)
    // a reload shows the same secret: the app may have scanned it already
    expect(secretIn(await (await loginPage(get('/login?paso=activar', send(jar)))).text())).toBe(secret)
    // the browser never chooses the secret: only the code travels
    const done = await login(post('/api/console/login', { step: 'enroll', code: await code(secret), secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }, send(jar)))
    expect(done.status).toBe(200)
    const codesPage = await done.text()
    expect(codesPage).toContain('No se volverán a mostrar')
    expect(codesPage).toContain('href="/?view=equipos"')
    expect((codesPage.match(/<li>/g) ?? []).length).toBe(10)
    cookiesOf(done, jar)
    expect(Object.keys(jar)).toEqual(['sf_session'])
    expect(stored().users[0].totp).toBe(secret)
    expect(await principalFor(get('/', send(jar)))).toMatchObject({ name: 'jefa' })
    expect(auditPaths()).toEqual(['/mfa/activar ok', '/login ok'])
  })

  test('a pending enrollment of the session panel does not finish a sign-in', async () => {
    writeUsers({ users: [entry('ana', 'analyst', 'contraseña-de-ana')] })
    const session = cookiesOf(await login(post('/api/console/login', { user: 'ana', password: 'contraseña-de-ana' })))
    const panel = cookiesOf(await accountPage(get('/cuenta/dos-pasos', send(session))), {})
    const res = await login(post('/api/console/login', { step: 'enroll', code: '123456' }, send(panel)))
    expect(res.headers.get('location')).toBe('/login?error=caducado&next=%2F')
  })
})

describe('/cuenta/dos-pasos', () => {
  test('enroll from the session panel: a fresh session, the old cookie retired', async () => {
    writeUsers({ users: [entry('ana', 'analyst', 'contraseña-de-ana')] })
    const jar = cookiesOf(await login(post('/api/console/login', { user: 'ana', password: 'contraseña-de-ana' })))
    const oldSession = jar.sf_session
    const before = await (await me(get('/api/console/me', send(jar)))).json()
    expect(before.mfa).toEqual({ enrolled: false, required: false, recovery_left: 0 })
    const page = await accountPage(get('/cuenta/dos-pasos', send(jar)))
    cookiesOf(page, jar)
    const secret = secretIn(await page.text())
    expect(secretIn(await (await accountPage(get('/cuenta/dos-pasos', send(jar)))).text())).toBe(secret)
    const wrong = await mfa(post('/api/console/mfa', { action: 'activar', code: '000000' }, send(jar)))
    expect(wrong.headers.get('location')).toBe('/cuenta/dos-pasos?error=codigo')
    const done = await mfa(post('/api/console/mfa', { action: 'activar', code: await code(secret) }, send(jar)))
    expect(done.status).toBe(200)
    expect(await done.text()).toContain('Verificación en dos pasos activada')
    cookiesOf(done, jar)
    expect(jar.sf_session).not.toBe(oldSession)
    expect(await principalFor(get('/', `sf_session=${oldSession}`))).toBeNull()
    expect(await principalFor(get('/', send(jar)))).toMatchObject({ name: 'ana' })
    const after = await (await me(get('/api/console/me', send(jar)))).json()
    expect(after.mfa).toEqual({ enrolled: true, required: false, recovery_left: 10 })

    const settings = await (await accountPage(get('/cuenta/dos-pasos', send(jar)))).text()
    expect(settings).toContain('Te quedan <strong>10</strong> códigos')
    const next = await code(secret, 1)
    const fresh = await mfa(post('/api/console/mfa', { action: 'recuperacion', code: next }, send(jar)))
    expect(await fresh.text()).toContain('Los anteriores ya no valen')
    // the same code again: already used, refused
    const off = await mfa(post('/api/console/mfa', { action: 'desactivar', code: next }, send(jar)))
    expect(off.headers.get('location')).toBe('/cuenta/dos-pasos?error=codigo')
    expect(stored().users[0].totp).toBe(secret)
    expect(auditPaths().slice(-4)).toEqual(['/mfa/activar denied', '/mfa/activar ok', '/mfa/recuperacion ok', '/mfa/desactivar denied'])
  })

  test('turning it off signs the operator out; with a required role the next sign-in enrolls again', async () => {
    const secret = newTotpSecret()
    writeUsers({ mfa_required: ['analyst'], users: [entry('ana', 'analyst', 'contraseña-de-ana', { totp: secret, recovery: [await hashRecovery('aaaaa-bbbbb')] })] })
    const jar = cookiesOf(await login(post('/api/console/login', { user: 'ana', password: 'contraseña-de-ana' })))
    cookiesOf(await login(post('/api/console/login', { step: 'code', code: await code(secret) }, send(jar))), jar)
    const page = await (await accountPage(get('/cuenta/dos-pasos', send(jar)))).text()
    expect(page).toContain('Tu rol la exige')
    const off = await mfa(post('/api/console/mfa', { action: 'desactivar', code: 'aaaaa-bbbbb' }, send(jar)))
    expect(off.headers.get('location')).toBe('/login?error=desactivada')
    cookiesOf(off, jar)
    expect(jar.sf_session).toBeUndefined()
    expect(stored().users[0].totp).toBeUndefined()
    const again = await login(post('/api/console/login', { user: 'ana', password: 'contraseña-de-ana' }))
    expect(again.headers.get('location')).toBe('/login?paso=activar&next=%2F')
  })

  test('another site cannot drive it, and the shared token has nothing to enroll', async () => {
    writeUsers({ users: [entry('ana', 'analyst', 'contraseña-de-ana')] })
    const jar = cookiesOf(await login(post('/api/console/login', { user: 'ana', password: 'contraseña-de-ana' })))
    const cross = await mfa(new Request(BASE + '/api/console/mfa', {
      method: 'POST', headers: { ...headers(send(jar)), origin: 'https://evil.example' }, body: 'action=desactivar&code=000000',
    }))
    expect(cross.status).toBe(403)
    delete process.env.CONSOLE_USERS_FILE
    process.env.CONSOLE_ACCESS_TOKEN = 'console-secret'
    const tokenJar = cookiesOf(await login(post('/api/console/login', { user: 'marta', password: 'console-secret' })))
    expect(await (await accountPage(get('/cuenta/dos-pasos', send(tokenJar)))).text()).toContain('Solo las cuentas de la consola')
    expect((await mfa(post('/api/console/mfa', { action: 'activar', code: '1' }, send(tokenJar)))).status).toBe(400)
  })
})
