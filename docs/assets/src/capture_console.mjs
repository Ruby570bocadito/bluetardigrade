// Captures the console screenshots and the search-interaction GIF used
// by the root README. Working source, same spirit as the diagram HTMLs
// in this directory.
//
// Prerequisites:
//   - the stack running: engine (default :7778), console-service (:3003)
//     and the console (production or dev build on :3000)
//   - Node with `playwright-core` and a Chromium binary (resolved from
//     the standard Playwright cache; adjust CHROME_GLOB if yours lives
//     elsewhere, or pass executablePath explicitly)
//
// Usage:  node docs/assets/src/capture_console.mjs
// Output: console-panel.png, console-alertas.png,
//         console-alertas-triaje.png, console-cadenas.png,
//         console-reglas.png, console-supresiones.png
//         and per-frame PNGs in the system temp dir (assemble the GIF
//         from those frames; frames are 2x viewport of `main`).
import { chromium } from 'playwright-core'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// PNGs belong in docs/assets (the directory the README links from);
// the script lives one level below, so anchor ASSETS to its parent
// instead of the script's own directory.
const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FRAMES = fs.mkdtempSync(path.join(os.tmpdir(), 'console-frames-'))

const CHROME_GLOB = '/home/z/.cache/ms-playwright/chromium-*/chrome-linux*/chrome'
const chromePath = execSync(`ls -d ${CHROME_GLOB} 2>/dev/null | tail -1`, {
  encoding: 'utf8',
}).trim()
if (!chromePath) throw new Error('chromium binary not found; set CHROME_GLOB')

const browser = await chromium.launch({ executablePath: chromePath, args: ['--no-sandbox'] })
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
})
const page = await ctx.newPage()

await page.goto('http://localhost:3000', { waitUntil: 'networkidle' })
await page.waitForTimeout(5000) // let the socket fill KPIs and charts

const navOn = (pg) => (name) =>
  pg
    .getByRole('navigation', { name: 'Secciones de la consola' })
    .getByRole('button', { name })
const navBtn = (name) => navOn(page)(name)

// Dashboard: tall viewport so the engine column shows the FULL stack -
// KPIs (risk tile included), sensor activity, engine summary and the
// hot-hosts panel at the bottom (the v0.3-era capture cut it off).
await page.setViewportSize({ width: 1280, height: 1780 })
await page.waitForTimeout(800)
await page.screenshot({ path: path.join(ASSETS, 'console-panel.png') })
console.log('shot: console-panel.png')

// back to the standard viewport for the rest of the tour
await page.setViewportSize({ width: 1280, height: 800 })
await page.waitForTimeout(400)

await navBtn('Alertas').click()
await page.waitForTimeout(1200)

// Expand the first alert: the detail panel carries the rendered rule
// message, matched fields, enrichment and the triage panel (Ciclo de
// vida) - the operator queue the README documents (r6).
const firstRow = page.locator('tbody tr').first()
await firstRow.click()
await page.getByLabel('Detalle de la alerta seleccionada').waitFor({ timeout: 8000 })
await page.waitForTimeout(400)
await page.screenshot({ path: path.join(ASSETS, 'console-alertas.png') })
console.log('shot: console-alertas.png')

// Apply a REAL triage decision end to end (console -> engine proxy ->
// engine POST; the row updates itself through the alert_lifecycle
// stream) and capture the recorded state as a second still. The detail
// panel is ~1050px tall (the grid row stretches to it and the PAGE
// scrolls), so this shot runs on a taller viewport page: chip on the
// row, recorded note and the cerrar/reabrir buttons share one frame
// with no scroll choreography.
const tallPage = await ctx.newPage()
await tallPage.setViewportSize({ width: 1280, height: 1240 })
await tallPage.goto('http://localhost:3000', { waitUntil: 'networkidle' })
await tallPage.waitForTimeout(4000)
await navOn(tallPage)('Alertas').click()
await tallPage.waitForTimeout(1200)
const tallRow = tallPage.locator('tbody tr').first()
await tallRow.click()
await tallPage.getByLabel('Detalle de la alerta seleccionada').waitFor({ timeout: 8000 })
await tallPage.getByLabel('Nota de triaje').fill('visto - investigando con el equipo de TI (INC-4187)')
await tallPage.getByRole('button', { name: 'Reconocer' }).click()
await tallPage.getByText('reconocida', { exact: true }).first().waitFor({ timeout: 8000 })
await tallPage.waitForTimeout(400)
await tallPage.screenshot({ path: path.join(ASSETS, 'console-alertas-triaje.png') })
console.log('shot: console-alertas-triaje.png')
await tallPage.close()

// Close the detail panel so the search GIF stays focused on the queue.
await firstRow.click()
await page.waitForTimeout(300)

const search = page.getByPlaceholder('buscar regla, host, usuario...')
await search.click()
let i = 0
for (const ch of 'lsass') {
  await search.pressSequentially(ch, { delay: 60 })
  await page.waitForTimeout(450)
  await page.locator('main').screenshot({ path: path.join(FRAMES, `f${i++}.png`) })
}
await page.waitForTimeout(600)
await page.locator('main').screenshot({ path: path.join(FRAMES, `f${i}.png`) })
console.log('frames:', FRAMES)

await navBtn('Reglas').click()
await page.waitForTimeout(1200)
await page.screenshot({ path: path.join(ASSETS, 'console-reglas.png') })
console.log('shot: console-reglas.png')

// Kill-chain chains view: the sequences the correlator actually loaded
// (steps, window, tags), with the armed/broken state of each chain.
await navBtn('Cadenas').click()
await page.waitForTimeout(1200)
await page.screenshot({ path: path.join(ASSETS, 'console-cadenas.png') })
console.log('shot: console-cadenas.png')

// Operator suppressions view: renders the live allowlist the engine
// loaded from suppressions.yaml (honest empty state when none armed).
// To capture it populated, arm 1-2 entries in ./suppressions.yaml
// before starting the engine - any entry matching replay traffic
// works, e.g. a rule id from rules/windows/ scoped to host
// LAB-WKS-01 (see suppressions.example.yaml for the format).
await navBtn('Supresiones').click()
await page.waitForTimeout(1200)
await page.screenshot({ path: path.join(ASSETS, 'console-supresiones.png') })
console.log('shot: console-supresiones.png')

await browser.close()
console.log('done')
