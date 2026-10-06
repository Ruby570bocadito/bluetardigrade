// Content-Security-Policy regression of the built console: the access
// proxy (web/console/src/proxy.ts) must mint a per-request nonce, the
// served HTML must carry it on EVERY script tag (including the inline
// theme boot), and script-src must never fall back to 'unsafe-inline'
// in production. Runs against the production build (next start), same
// server discipline as check_console_browser.mjs; no browser needed,
// so it is cheap enough for every CI run.
//
// Build the console first (bun run build). Env:
//   CONSOLE_BROWSER_URL  reuse a running loopback console (127.0.0.1 only)
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const external = process.env.CONSOLE_BROWSER_URL
const base = external || 'http://127.0.0.1:3100'
const url = new URL(base)
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
  throw new Error('CSP checks require a loopback HTTP server')
}
let server
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

function stopServer() {
  if (server) server.kill()
}

function directive(policy, name) {
  return policy.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `)) || ''
}

function fail(message) {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

try {
  await startServer()

  // Two consecutive requests: the nonce must exist and must rotate, or
  // the policy collapses back to a reusable (spoofable) value.
  const first = await fetch(base)
  const policyA = first.headers.get('content-security-policy') || ''
  const htmlA = await first.text()
  const second = await fetch(base)
  const policyB = second.headers.get('content-security-policy') || ''
  await second.body?.cancel()

  if (!policyA) fail('no Content-Security-Policy header on / (proxy not applied?)')
  const scriptA = directive(policyA, 'script-src')
  if (!scriptA.includes("'nonce-")) fail(`script-src has no nonce (got: ${scriptA})`)
  if (!scriptA.includes("'strict-dynamic'")) fail(`script-src lacks 'strict-dynamic' (got: ${scriptA})`)
  if (scriptA.includes("'unsafe-inline'")) {
    fail(`script-src still allows 'unsafe-inline' - is this the production build? (got: ${scriptA})`)
  }
  if (!directive(policyA, 'style-src').includes("'unsafe-inline'")) {
    fail('style-src lost its inline allowance: Tailwind inline styles and reactbits keyframes would break')
  }
  if (!directive(policyA, 'frame-ancestors').includes("'none'")) fail('frame-ancestors none missing')
  const headerNonce = scriptA.match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1]
  if (!headerNonce) fail('nonce source could not be parsed from script-src')

  const scriptTags = htmlA.match(/<script\b[^>]*>/g) || []
  if (scriptTags.length === 0) fail('no script tags found in the served HTML')
  const unsigned = scriptTags.filter((tag) => !/nonce="/.test(tag))
  if (unsigned.length > 0) fail(`${unsigned.length}/${scriptTags.length} script tags render without a nonce: ${unsigned[0].slice(0, 120)}`)
  const htmlNonces = [...new Set([...htmlA.matchAll(/nonce="([^"]*)"/g)].map((match) => match[1]))]
  if (htmlNonces.length !== 1) fail(`expected exactly one nonce value across the HTML, got ${htmlNonces.length}`)
  if (htmlNonces[0] !== headerNonce) fail('the nonce signed into the HTML does not match the enforced policy header')
  const bootIndex = htmlA.indexOf('bt-theme')
  if (bootIndex === -1) fail('the theme boot script is missing from the served HTML')
  const tagStart = htmlA.lastIndexOf('<script', bootIndex)
  const bootTag = tagStart === -1 ? null : htmlA.slice(tagStart, htmlA.indexOf('>', tagStart) + 1)
  if (!bootTag || !/nonce="/.test(bootTag)) {
    fail('the inline theme boot script has no nonce (layout must read x-nonce from the proxy headers)')
  }

  const nonceB = directive(policyB, 'script-src').match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1]
  if (!nonceB || nonceB === headerNonce) fail('nonce did not rotate between requests')

  console.log(`PASS: CSP nonce (${scriptTags.length} script tags signed, nonce rotates per request)`)
} finally {
  stopServer()
}
