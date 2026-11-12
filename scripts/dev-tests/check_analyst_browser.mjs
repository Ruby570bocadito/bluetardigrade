// Verify the actual production CSP and Socket.IO handshake together.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const tooling = process.env.CONSOLE_TEST_TOOLS || join(repo, 'tools/console-tests')
const { chromium } = createRequire(join(tooling, 'package.json'))('playwright')
const base = 'http://127.0.0.1:3102'
const children = []
let browser
let logs = ''
function start(command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', data => { logs = (logs + data).slice(-8000) })
  child.stderr.on('data', data => { logs = (logs + data).slice(-8000) })
  child.on('error', error => { logs += String(error) })
  children.push(child)
  return child
}
async function ready(url) {
  const end = Date.now() + 30000
  while (Date.now() < end) {
    try { const res = await fetch(url, { signal: AbortSignal.timeout(1000) }); await res.body?.cancel(); if (res.ok) return } catch {}
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`Server did not start: ${url}\n${logs}`)
}
try {
  start(process.env.BUN_EXE || 'bun', ['index.ts'], join(repo, 'web/console-service'), {
    CONSOLE_SERVICE_PORT: '3003', CONSOLE_CORS_ORIGIN: base, ENGINE_API: 'http://127.0.0.1:1',
    ANALYST_BASE_URL: '', ANALYST_API_KEY: '', ANALYST_MODEL: '',
  })
  start(process.execPath, [join(repo, 'web/console/node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', '3102'], join(repo, 'web/console'), { NEXT_TELEMETRY_DISABLED: '1' })
  await ready('http://127.0.0.1:3003/health')
  await ready(base)
  browser = await chromium.launch({ executablePath: process.env.CONSOLE_CHROMIUM_PATH || process.env.BROWSER_EXE })
  const page = await browser.newPage()
  const cspErrors = []
  page.on('console', message => {
    if (/violates.*Content Security Policy/i.test(message.text())) cspErrors.push(message.text())
  })
  // The hub no longer pushes fleet telemetry to sockets, so the proof of
  // a working channel is the Socket.IO connect packet ("40" + sid) the
  // hub answers over the WebSocket once the handshake is accepted. No
  // console:* telemetry frame may follow it.
  const telemetry = []
  const connected = new Promise((resolveConnected, reject) => {
    const timer = setTimeout(() => reject(new Error('Analyst WebSocket did not complete the Socket.IO handshake with the real hub')), 10000)
    page.on('websocket', socket => socket.on('framereceived', frame => {
      const payload = String(frame.payload)
      if (payload.includes('"console:')) telemetry.push(payload.slice(0, 80))
      if (/^40\{.*"sid"/.test(payload)) { clearTimeout(timer); resolveConnected() }
    }))
  })
  const response = await page.goto(base)
  assert.equal(response.status(), 200)
  await connected
  await new Promise(r => setTimeout(r, 1000))
  assert.deepEqual(telemetry, [], 'the hub must not push fleet telemetry to a socket')
  assert.deepEqual(cspErrors, [])
  console.log('PASS: production browser completes the analyst hub handshake without CSP violations or telemetry frames')
} finally {
  await browser?.close()
  for (const child of children) {
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve))
      child.kill()
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))])
    }
  }
}
