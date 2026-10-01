// Browser regressions against the built console. All engine responses and
// SSE frames below are isolated fixtures; no running Go engine is contacted.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const tooling = resolve(process.env.CONSOLE_TEST_TOOLS || join(repo, 'tools/console-tests'))
const requireTools = createRequire(join(tooling, 'package.json'))
const { chromium } = requireTools('playwright')
const external = process.env.CONSOLE_BROWSER_URL
const base = external || 'http://127.0.0.1:3100'
const url = new URL(base)
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Browser checks require a loopback HTTP server')
const captures = join(repo, 'captures/browser-regression')
mkdirSync(captures, { recursive: true })
let server, browser, page
let serverLog = ''
let passed = 0

async function check(name, fn) {
  await fn()
  passed++
  console.log(`PASS: ${name}`)
}

async function startServer() {
  if (!external) {
    server = spawn(process.execPath, [join(repo, 'web/console/node_modules/next/dist/bin/next'), 'start', '-H', url.hostname, '-p', url.port], {
      cwd: join(repo, 'web/console'), stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    })
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

async function engineFixture(page) {
  let reads = 0
  let heldStats = null
  let releaseStats = null
  let forensicReads = 0
  let forensicAvailable = false
  const stamp = new Date().toISOString()
  const alert = { id: '0123456789abcdef', timestamp: stamp, rule_id: 'demo-rule', rule_name: 'Fixture detection', severity: 'critical', host: 'LAB-FIXTURE', event_id: 'fixture-event', event_type: 'process.create', summary: 'Isolated browser regression evidence', matched_on: [], status: 'new' }
  const second = { ...alert, id: 'fedcba9876543210', rule_name: 'Second page detection' }
  const stats = { uptime_s: 100, events_total: 1, alerts_total: 1, events_per_min: 1, dropped: 0, ingest_rejected: 0, by_severity: { critical: 1 }, rules_count: 1, rules_types: ['process.create'], events_buffered: 1, webhook_sent: 0, webhook_failed: 0, webhook_dropped: 0, suppressions_active: 0, correlator_states: 0, correlator_sequences: 0, correlator_cap: 0, risk_hosts_tracked: 0, hot_hosts: [] }
  await page.addInitScript(() => {
    class FixtureSource {
      static OPEN = 1
      readyState = 0
      listeners = new Map()
      constructor() { setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0) }
      addEventListener(topic, fn) { this.listeners.set(topic, fn) }
      close() { this.readyState = 2 }
    }
    window.EventSource = FixtureSource
  })
  await page.route('**/api/engine/**', async (route) => {
    const request = route.request()
    const u = new URL(request.url())
    const path = u.pathname.replace('/api/engine', '')
    let data
    if (path === '/api/stats') { reads++; if (heldStats) await heldStats; data = stats }
    else if (path === '/api/events') data = [{ id: 'fixture-event', timestamp: stamp, type: 'process.create', source: 'simulate', host: 'LAB-FIXTURE', process: { pid: 42, name: 'demo.exe' } }]
    else if (path === '/api/alerts') data = [alert]
    else if (path === '/api/rules') data = [{ id: 'demo-rule', name: 'Fixture rule', severity: 'critical', event_type: 'process.create', tags: [], conditions: [] }]
    else if (path === '/api/sequences') data = []
    else if (path === '/api/suppressions') data = { entries: [] }
    else if (path === '/api/alerts/search') {
      const last = u.searchParams.get('cursor') === 'second'
      data = { items: [last ? second : alert], source: 'sqlite', has_more: !last, next_cursor: last ? '' : 'second', page_cursor: last ? 'second' : 'first', scanned: 1, scan_limited: false }
    } else if (path === '/api/alerts/0123456789abcdef/status' && request.method() === 'POST') {
      const action = request.postDataJSON()
      Object.assign(alert, { status: action.status, status_note: action.note, status_at: new Date().toISOString() })
      data = { alert_id: alert.id, status: action.status, note: action.note, by: action.by, at: alert.status_at }
    } else if (path === '/api/alerts/0123456789abcdef/forensics') {
      forensicReads++
      if (!forensicAvailable) { await route.fulfill({ status: 500, body: '' }); return }
      data = {
        alert: { ...alert, enrich: { parent_name: 'winword.exe' } }, captured_at: stamp, host: 'LAB-FIXTURE', window: '5m before alert',
        timeline: [{ id: 'fixture-event', timestamp: stamp, type: 'file.write', source: 'sysmon', host: 'LAB-FIXTURE',
          file: { path: 'C:\\Users\\Public\\fixture.dll', hashes: { sha256: 'fixture-hash' } }, enrichment: { parent_name: 'winword.exe' } }],
        summary: { events: 1, process_creates: 0, network_connects: 0, file_writes: 1, registry_sets: 0, process_accesses: 0, other: 0, distinct_users: 0, distinct_images: [] },
      }
    } else { await route.fulfill({ status: 404, body: '' }); return }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  return {
    reads: () => reads,
    forensicReads: () => forensicReads,
    enableForensics() { forensicAvailable = true },
    holdStats() { heldStats = new Promise((done) => { releaseStats = done }) },
    releaseStats() { const release = releaseStats; heldStats = releaseStats = null; release?.() },
  }
}

async function waitView(view) {
  await page.waitForFunction((expected) => (new URLSearchParams(location.search).get('view') || 'panel') === expected, view)
}
const focusMain = () => page.locator('#console-main').focus()
const openPalette = () => page.getByRole('button', { name: 'Abrir comandos', exact: true }).click()
const palette = () => page.getByRole('dialog', { name: 'Comandos de la consola' })
const search = () => palette().getByRole('combobox', { name: 'Buscar comandos' })

try {
  await startServer()
  browser = await chromium.launch({ headless: true, executablePath: process.env.CONSOLE_CHROMIUM_PATH })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
  page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  const fixture = await engineFixture(page)
  await page.goto(base + '/?view=flujo&fq=demo&tipo=process.create&custom=keep')
  await waitView('flujo')
  await page.getByRole('textbox', { name: 'Buscar en el flujo de telemetría' }).waitFor()
  assert.deepEqual(errors, [], 'Unexpected runtime errors during reduced-motion hydration')

  await check('Ctrl+K opens the palette with search focus and a valid active option', async () => {
    await focusMain()
    await page.keyboard.press('Control+k')
    await search().waitFor()
    assert.equal(await search().evaluate((input) => document.activeElement === input), true)
    assert.equal(await search().evaluate((input) => Boolean(document.getElementById(input.getAttribute('aria-activedescendant')))), true)
  })
  await check('native dialog traps forward and reverse Tab and restores its opener', async () => {
    await page.keyboard.press('Escape')
    await openPalette()
    await page.keyboard.press('Tab')
    assert.equal(await palette().evaluate((dialog) => dialog.contains(document.activeElement)), true)
    await page.keyboard.press('Shift+Tab')
    assert.equal(await palette().evaluate((dialog) => dialog.contains(document.activeElement)), true)
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('button', { name: 'Abrir comandos', exact: true }).evaluate((button) => document.activeElement === button), true)
  })
  await check('accent-insensitive search and Enter navigate while preserving other URL lenses', async () => {
    await openPalette()
    await search().fill('DETECCION reglas')
    assert.equal(await palette().getByRole('option').count(), 1)
    await page.keyboard.press('Enter')
    await waitView('reglas')
    assert.equal(new URL(page.url()).searchParams.get('custom'), 'keep')
    assert.equal(new URL(page.url()).searchParams.get('fq'), 'demo')
    // URL navigation is synchronous; the shell transfers focus on the
    // next animation frame after closing the command dialog. Wait for
    // that observable behavior, with a bound that still fails on lost focus.
    await page.waitForFunction(() => document.activeElement === document.getElementById('console-main'), undefined, { timeout: 5000 })
    assert.equal(await page.locator('#console-main').evaluate((main) => document.activeElement === main), true)
  })
  await check('unknown commands have no active descendant and Enter has no side effects', async () => {
    await openPalette()
    await search().fill('unavailable-command')
    assert.equal(await palette().getByRole('option').count(), 0)
    assert.equal(await search().getAttribute('aria-activedescendant'), null)
    await page.keyboard.press('Enter')
    await search().waitFor()
    await waitView('reglas')
    await page.keyboard.press('Escape')
  })
  await check('arrow navigation selects a command, and revisiting the current view adds no history entry', async () => {
    await openPalette()
    await search().fill('flujo')
    await page.keyboard.press('Enter')
    await waitView('flujo')
    const length = await page.evaluate(() => history.length)
    await openPalette()
    await page.keyboard.press('ArrowDown')
    assert.equal(await search().getAttribute('aria-activedescendant'), await palette().getByRole('option', { selected: true }).getAttribute('id'))
    await search().fill('flujo')
    await page.keyboard.press('Enter')
    await waitView('flujo')
    assert.equal(await page.evaluate(() => history.length), length)
    await page.goBack()
    await waitView('reglas')
  })
  await check('refresh command uses the shared provider and help handoff keeps one modal', async () => {
    const before = fixture.reads()
    await openPalette()
    await search().fill('recuperar motor')
    await page.waitForFunction(() => document.querySelector('dialog[open] [role="combobox"]')?.getAttribute('aria-activedescendant')?.endsWith('-refresh'))
    fixture.holdStats()
    const request = page.waitForRequest((request) => request.url().endsWith('/api/engine/api/stats'))
    await page.keyboard.press('Enter')
    await request
    assert.ok(fixture.reads() > before)
    await openPalette()
    await search().fill('recuperar motor')
    await page.waitForFunction(() => {
      const input = document.querySelector('dialog[open] [role="combobox"]')
      const id = input?.getAttribute('aria-activedescendant')
      return id?.endsWith('-refresh') && document.getElementById(id)?.getAttribute('aria-disabled') === 'true'
    })
    const heldReads = fixture.reads()
    await page.keyboard.press('Enter')
    await search().waitFor()
    assert.equal(fixture.reads(), heldReads)
    fixture.releaseStats()
    await page.waitForFunction(() => !document.querySelector('[role="option"][aria-disabled="true"]'))
    await page.keyboard.press('Escape')
    await openPalette()
    await search().fill('ayuda teclado')
    await page.keyboard.press('Enter')
    await page.getByRole('dialog', { name: 'Atajos de teclado' }).waitFor()
    assert.equal(await page.locator('dialog[open]').count(), 1)
    await page.keyboard.press('Shift+Tab')
    assert.equal(await page.getByRole('dialog', { name: 'Atajos de teclado' }).evaluate((dialog) => dialog.contains(document.activeElement)), true)
    await page.keyboard.press('Escape')
  })
  await check('typing, composite widgets, composition and consumed events do not trigger navigation', async () => {
    await focusMain()
    await page.keyboard.press('g')
    await page.keyboard.press('f')
    await waitView('flujo')
    const input = page.getByRole('textbox', { name: 'Buscar en el flujo de telemetría' })
    await input.fill('g a ?')
    await input.press('Control+k')
    await waitView('flujo')
    assert.equal(await page.locator('dialog[open]').count(), 0)
    await focusMain()
    await page.keyboard.press('g')
    await input.focus()
    await focusMain()
    await page.keyboard.press('a')
    await waitView('flujo')
    await page.locator('#console-main').evaluate((main) => {
      main.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', isComposing: true, bubbles: true }))
      main.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
      const used = new KeyboardEvent('keydown', { key: 'g', bubbles: true, cancelable: true })
      used.preventDefault()
      main.dispatchEvent(used)
      main.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
      main.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }))
      main.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', repeat: true, bubbles: true }))
      main.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    })
    await waitView('flujo')
    const select = page.getByRole('combobox', { name: 'Filtrar por tipo de evento' })
    await select.focus()
    await page.keyboard.press('g')
    await page.keyboard.press('a')
    await waitView('flujo')
    await page.keyboard.press('Escape')
  })
  await check('dashboard shortcuts open the counted live lens and Back restores the prior investigation', async () => {
    await openPalette()
    await search().fill('panel')
    await page.keyboard.press('Enter')
    await waitView('panel')
    const originalSearch = new URL(page.url()).search
    await page.evaluate(() => {
      const url = new URL(location.href)
      for (const [key, value] of Object.entries({ q: 'obsolete', sev: 'low', estado: 'closed', historial: '1', alert: 'old-id' })) url.searchParams.set(key, value)
      history.replaceState(history.state, '', url)
    })
    const prior = page.url()
    for (const [name, state, severity] of [
      ['Ver críticas sin cerrar', 'open', 'critical'],
      ['Ver alertas nuevas', 'new', null],
      ['Ver alertas reconocidas', 'acknowledged', null],
      ['Ver alertas cerradas', 'closed', null],
    ]) {
      await page.getByRole('button', { name: state === 'open' ? name : new RegExp('^' + name + ':') }).click()
      await waitView('alertas')
      const params = new URL(page.url()).searchParams
      assert.equal(params.get('estado'), state)
      assert.equal(params.get('sev'), severity)
      for (const key of ['q', 'historial', 'alert']) assert.equal(params.get(key), null)
      assert.equal(params.get('custom'), 'keep')
      assert.equal(params.get('fq'), new URLSearchParams(originalSearch).get('fq'))
      await page.waitForFunction(() => document.activeElement?.id === 'console-main')
      if (state === 'open' || state === 'new') await page.getByRole('button', { name: 'Fixture detection', exact: true }).waitFor()
      await page.goBack()
      await waitView('panel')
      assert.equal(page.url(), prior)
    }
    await page.evaluate((search) => history.replaceState(history.state, '', location.pathname + search + location.hash), originalSearch)
    await page.screenshot({ path: join(captures, 'dashboard-triage.png') })
  })
  await check('historical alert paging and POST triage work without an SSE acknowledgement', async () => {
    await openPalette()
    await search().fill('historial')
    await page.keyboard.press('Enter')
    await waitView('alertas')
    await page.getByRole('button', { name: 'Histórico', exact: true }).click()
    await page.getByRole('button', { name: 'Fixture detection', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
    await page.getByRole('button', { name: 'Second page detection', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Anterior', exact: true }).click()
    await page.getByRole('button', { name: 'Fixture detection', exact: true }).click()
    await page.getByRole('button', { name: 'Reconocer', exact: true }).click()
    await page.getByRole('button', { name: 'Cerrar', exact: true }).waitFor()
  })
  await check('forensic retry and real JSON/JSONL downloads preserve the complete frozen evidence', async () => {
    const toggle = page.getByRole('button', { name: 'Línea de tiempo forense', exact: true })
    assert.equal(fixture.forensicReads(), 0, 'Evidence should remain lazy until expanded')
    await toggle.click()
    await page.getByRole('button', { name: 'Reintentar evidencia', exact: true }).waitFor()
    fixture.enableForensics()
    await page.getByRole('button', { name: 'Reintentar evidencia', exact: true }).click()
    const region = page.getByRole('region', { name: 'Línea de tiempo forense' })
    await region.getByRole('button', { name: 'Descargar evidencia JSON', exact: true }).waitFor()
    assert.equal(fixture.forensicReads(), 2)
    const files = []
    for (const format of ['JSON', 'JSONL']) {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        region.getByRole('button', { name: `Descargar evidencia ${format}`, exact: true }).click(),
      ])
      assert.equal(download.suggestedFilename(), `forensic-0123456789abcdef.${format.toLowerCase()}`)
      const stream = await download.createReadStream()
      assert.ok(stream, 'Download must contain readable evidence')
      const parts = []
      for await (const chunk of stream) parts.push(chunk)
      files.push(Buffer.concat(parts).toString('utf8'))
    }
    const json = JSON.parse(files[0])
    const jsonl = files[1].trimEnd().split('\n').map((line) => JSON.parse(line))
    assert.equal(json.alert.enrich.parent_name, 'winword.exe')
    assert.equal(json.timeline[0].file.hashes.sha256, 'fixture-hash')
    assert.deepEqual({ ...jsonl[0].bundle, timeline: jsonl.slice(1).map((row) => row.event) }, json)
    await page.screenshot({ path: join(captures, 'forensic-evidence-desktop.png') })
  })
  await check('desktop palette has no horizontal overflow and captures a labelled fixture view', async () => {
    await openPalette()
    assert.ok(await palette().evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth))
    await page.screenshot({ path: join(captures, 'palette-desktop.png') })
    await page.keyboard.press('Escape')
  })
  await check('mobile viewport opens the palette and backdrop closes it with reduced motion', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openPalette()
    assert.ok(await palette().evaluate((dialog) => dialog.getBoundingClientRect().width <= innerWidth && dialog.scrollWidth <= dialog.clientWidth))
    await search().fill('reglas')
    await page.screenshot({ path: join(captures, 'palette-mobile.png') })
    await page.mouse.click(5, 5)
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
    assert.equal(await page.evaluate(() => document.documentElement.style.overflow), '')
  })
  await check('mobile forensic evidence and exports fit the alert detail', async () => {
    const region = page.getByRole('region', { name: 'Línea de tiempo forense' })
    await region.getByRole('button', { name: 'Descargar evidencia JSONL', exact: true }).waitFor()
    assert.ok(await region.evaluate((node) => node.scrollWidth <= node.clientWidth))
    await page.screenshot({ path: join(captures, 'forensic-evidence-mobile.png') })
  })
  assert.deepEqual(errors, [], 'Unexpected browser runtime errors')
  console.log(`Browser checks: ${passed}/${passed} passed; engine/SSE data are test fixtures.`)
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: join(captures, 'failure.png') }).catch(() => {})
  console.error(error)
  process.exitCode = 1
} finally {
  await browser?.close()
  if (server && server.exitCode === null) {
    server.kill('SIGTERM')
    await Promise.race([new Promise((done) => server.once('exit', done)), new Promise((done) => setTimeout(done, 3000))])
    if (server.exitCode === null) server.kill('SIGKILL')
  }
}
