// Sign-in regressions in a real browser against the production build:
// a gated console sends the browser to /login and back to where it was
// going, a wrong password stays on the form, the session cookie is
// HttpOnly + SameSite=Strict, the console signs its operator out, and a
// session ended on the server (password changed) sends the open console
// back to /login on its next poll. The engine is not running: the
// console's engine calls fail as they would with the engine down, which
// must not be mistaken for an ended session.
//
// Build the console first (bun run build). Env:
//   CONSOLE_TEST_TOOLS     where playwright is installed (tools/console-tests)
//   CONSOLE_CHROMIUM_PATH  or BROWSER_EXE: a Chromium to use instead of
//                          playwright's own download
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const tooling = resolve(process.env.CONSOLE_TEST_TOOLS || join(repo, 'tools/console-tests'))
const { chromium } = createRequire(join(tooling, 'package.json'))('playwright')
const base = 'http://127.0.0.1:3104'
const dir = mkdtempSync(join(tmpdir(), 'sf-login-browser-'))
const usersFile = join(dir, 'console-users.json')
const auditFile = join(dir, 'audit.jsonl')
let server, browser
let serverLog = ''
let passed = 0

function account(user, role, password) {
  const salt = randomBytes(16)
  const hash = pbkdf2Sync(password, salt, 100_000, 32, 'sha256')
  return { user, role, password: `pbkdf2-sha256$100000$${salt.toString('base64url')}$${hash.toString('base64url')}` }
}
const writeUsers = (password) => writeFileSync(usersFile, JSON.stringify({ users: [account('ana', 'admin', password)] }))

async function check(name, fn) {
  await fn()
  passed++
  console.log(`PASS: ${name}`)
}

async function startServer() {
  server = spawn(process.execPath, [join(repo, 'web/console/node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', '3104'], {
    cwd: join(repo, 'web/console'),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, NEXT_TELEMETRY_DISABLED: '1',
      CONSOLE_USERS_FILE: usersFile, CONSOLE_AUDIT_FILE: auditFile, CONSOLE_ACCESS_TOKEN: '',
      ENGINE_API: 'http://127.0.0.1:1',
    },
  })
  server.stdout.on('data', (data) => { serverLog = (serverLog + data).slice(-8000) })
  server.stderr.on('data', (data) => { serverLog = (serverLog + data).slice(-8000) })
  server.on('error', (error) => { serverLog += String(error) })
  const end = Date.now() + 45000
  while (Date.now() < end) {
    try {
      const res = await fetch(base + '/login', { signal: AbortSignal.timeout(2000) })
      await res.body?.cancel()
      if (res.ok) return
    } catch {}
    if (server.exitCode !== null) break
    await new Promise((done) => setTimeout(done, 200))
  }
  throw new Error('Console server did not become ready. Build web/console first.\n' + serverLog)
}

async function signIn(page, password) {
  await page.getByLabel('Usuario').fill('ana')
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
}

try {
  writeUsers('una-contraseña-larga')
  await startServer()
  browser = await chromium.launch({ headless: true, executablePath: process.env.CONSOLE_CHROMIUM_PATH || process.env.BROWSER_EXE })
  const context = await browser.newContext()
  const page = await context.newPage()
  const cspErrors = []
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) cspErrors.push(message.text())
  })

  await check('a console page without a session lands on the sign-in form, keeping its destination', async () => {
    const loginRequests = []
    const listener = (request) => loginRequests.push(new URL(request.url()).pathname)
    page.on('request', listener)
    await page.goto(base + '/?view=equipos')
    page.off('request', listener)
    const url = new URL(page.url())
    assert.equal(url.pathname, '/login')
    assert.equal(url.searchParams.get('next'), '/?view=equipos')
    await page.getByRole('heading', { name: 'Iniciar sesión' }).waitFor()
    // the page loads nothing from behind the gate (no bundle, no API)
    assert.deepEqual(loginRequests.filter((p) => p !== '/' && p !== '/login'), [])
    assert.equal(await page.locator('script').count(), 0)
  })

  await check('a wrong password stays on the form and says why', async () => {
    await signIn(page, 'no-es-esta')
    await page.getByRole('alert').filter({ hasText: 'Usuario o contraseña incorrectos' }).waitFor()
    assert.equal(new URL(page.url()).searchParams.get('next'), '/?view=equipos')
    assert.equal((await context.cookies()).length, 0)
  })

  await check('the right password opens the console where the operator was going', async () => {
    await signIn(page, 'una-contraseña-larga')
    await page.waitForURL(base + '/?view=equipos')
    await page.getByRole('button', { name: /^Sesión: ana/ }).waitFor({ timeout: 15000 })
    const [cookie] = await context.cookies()
    assert.equal(cookie.name, 'sf_session')
    assert.equal(cookie.httpOnly, true)
    assert.equal(cookie.sameSite, 'Strict')
    assert.equal(cookie.expires, -1, 'a browser-session cookie: closing the browser ends it')
  })

  await check('signing out from the session dialog ends the session', async () => {
    await page.getByRole('button', { name: /^Sesión: ana/ }).click()
    await page.getByRole('button', { name: 'Cerrar sesión' }).click()
    await page.waitForURL(base + '/login')
    await page.goto(base + '/')
    assert.equal(new URL(page.url()).pathname, '/login')
    const res = await page.request.get(base + '/api/console/me')
    assert.equal(res.status(), 401)
  })

  await check('a session ended on the server sends the open console back to the form', async () => {
    await signIn(page, 'una-contraseña-larga')
    await page.waitForURL(base + '/')
    await page.getByRole('button', { name: /^Sesión: ana/ }).waitFor({ timeout: 15000 })
    // a password change ends every session of the account; the next
    // engine poll (every few seconds) is refused and redirects
    writeUsers('otra-contraseña-larga')
    await page.waitForURL((u) => u.pathname === '/login' && u.searchParams.get('error') === 'sesion', { timeout: 20000 })
    await page.getByRole('alert').filter({ hasText: 'Tu sesión ha terminado' }).waitFor()
  })

  await check('the sign-in page and the console raise no CSP violation; every attempt is audited', async () => {
    assert.deepEqual(cspErrors, [])
    const audit = readFileSync(auditFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    const sessions = audit.filter((e) => e.path === '/login' || e.path === '/logout').map((e) => `${e.path} ${e.outcome}`)
    assert.deepEqual(sessions, ['/login denied', '/login ok', '/logout ok', '/login ok'])
  })

  console.log(`${passed} login browser checks passed`)
} catch (error) {
  console.error(serverLog)
  throw error
} finally {
  await browser?.close()
  if (server && server.exitCode === null) {
    const exited = new Promise((done) => server.once('exit', done))
    server.kill()
    await Promise.race([exited, new Promise((done) => setTimeout(done, 3000))])
  }
  rmSync(dir, { recursive: true, force: true })
}
