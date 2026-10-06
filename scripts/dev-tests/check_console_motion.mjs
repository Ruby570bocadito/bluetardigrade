// Reduced-motion regression of the built console (POL-11). With
// prefers-reduced-motion: reduce emulated, no animation may run
// anywhere on the console except the informational spinners (they
// communicate activity, they do not decorate). The positive control
// runs the same probe WITHOUT the preference and requires motion to
// exist: this proves the check can actually detect animation and is
// not passing vacuously on a broken selector.
//
// CSS keyframes are gated in globals.css (media queries), JS entrance
// animations by useReducedMotion() in every motion/react consumer.
// Build the console first (bun run build). Env:
//   CONSOLE_BROWSER_URL  reuse a running loopback console (127.0.0.1 only)
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const tooling = resolve(process.env.CONSOLE_TEST_TOOLS || join(repo, 'tools/console-tests'))
const requireTools = createRequire(join(tooling, 'package.json'))
const { chromium } = requireTools('playwright')
const external = process.env.CONSOLE_BROWSER_URL
const base = external || 'http://127.0.0.1:3100'
const url = new URL(base)
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
  throw new Error('Motion checks require a loopback HTTP server')
}
let server
let browser
let page
let serverLog = ''

async function startServer() {
  if (!external) {
    server = spawn(
      process.execPath,
      [join(repo, 'web/console/node_modules/next/dist/bin/next'), 'start', '-H', url.hostname, '-p', url.port],
      { cwd: join(repo, 'web/console'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } },
    )
    server.stdout.on('data', (data) => { serverLog = (serverLog + data).slice(-8000) })
    server.stderr.on('data', (data) => { serverLog = (serverLog + data).slice(-8000) })
    server.on('error', (error) => { serverLog += String(error) })
  }
  const end = Date.now() + 45000
  while (Date.now() < end) {
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(2000) })
      if (response.ok) { await response.body?.cancel(); return }
      await response.body?.cancel()
    } catch {}
    if (server?.exitCode !== null && server?.exitCode !== undefined) break
    await new Promise((done) => setTimeout(done, 200))
  }
  throw new Error('Console server did not become ready. Build web/console first.\n' + serverLog)
}

function fail(message) {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

// Snapshot of every animation in the page: play state, keyframes name
// and the class of the element each animation drives.
const snapshot = () => page.evaluate(() =>
  document.getAnimations().map((a) => ({
    playState: a.playState,
    name: a.animationName ?? '',
    target: a.effect?.target?.getAttribute('class') ?? '',
  })),
)

const isSpinner = (a) => a.name === 'spin' || /animate-spin/.test(a.target)

try {
  await startServer()
  browser = await chromium.launch({ headless: true })

  // 1. Reduced motion: the console must be still.
  const reduceContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', locale: 'es-ES' })
  page = await reduceContext.newPage()
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForSelector('.blur-text-word', { timeout: 15000 })

  const bootName = await page.evaluate(() => getComputedStyle(document.querySelector('.blur-text-word')).animationName)
  if (bootName !== 'none') fail(`probe element still animates under reduce (animation-name: ${bootName})`)

  const reduced = await snapshot()
  const running = reduced.filter((a) => a.playState === 'running' || a.playState === 'pending')
  const unruly = running.filter((a) => !isSpinner(a))
  if (unruly.length > 0) {
    fail(`${unruly.length} non-spinner animation(s) running under reduced motion: ${JSON.stringify(unruly.slice(0, 3))}`)
  }
  await reduceContext.close()

  // 2. Positive control: without the preference the same probe MUST
  // carry the blur-text keyframes, i.e. the gate is wired, not absent.
  const motionContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES' })
  page = await motionContext.newPage()
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForSelector('.blur-text-word', { timeout: 15000 })
  const free = await page.evaluate(() => getComputedStyle(document.querySelector('.blur-text-word')).animationName)
  if (free !== 'blur-text-reveal') fail(`positive control failed: expected blur-text-reveal without the preference, got ${free}`)

  console.log('PASS: reduced motion (no animation under reduce; probe animates without it; spinners allowed)')
} finally {
  if (browser) await browser.close()
  if (server) server.kill()
}
