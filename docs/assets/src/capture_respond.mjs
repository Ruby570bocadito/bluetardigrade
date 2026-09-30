// Captures the "Respuesta activa" (active response) console view with
// REAL audit data: an armed engine whose audit queue was populated by
// live kills and denials (see the 02-B round that added this script —
// the lab recipe is documented in the acta; nothing in the shots is
// fabricated).
//
// Companion of capture_console.mjs (same house style, separate file so
// the two tours never step on each other's nav state).
//
// Prerequisites:
//   - the engine running ARMED on :19118 (lab: -allow-kill,
//     -respond-operators, -respond-audit) with the audit queue already
//     populated: executed kills, denials of every class and at least
//     one followup pair (pre-signal executed + followup denied sharing
//     the same action_id — the F1 case)
//   - the console production build serving :3000 with
//     ENGINE_API_URL + SF_API_TOKEN pointing at that engine
//   - Node with `playwright-core` resolvable from this file and a
//     Chromium binary in the standard Playwright cache
//
// Usage:  node docs/assets/src/capture_respond.mjs
// Output: console-respuesta-activa.png (full queue, all classes,
//         followup on top), console-respuesta-filtro.png (followups
//         filter active with the honest window count)
import { chromium } from 'playwright-core'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const CHROME_GLOB = '/home/z/.cache/ms-playwright/chromium-*/chrome-linux*/chrome'
const chromePath = execSync(`ls -d ${CHROME_GLOB} 2>/dev/null | tail -1`, {
  encoding: 'utf8',
}).trim()
if (!chromePath) throw new Error('chromium binary not found; set CHROME_GLOB')

const browser = await chromium.launch({ executablePath: chromePath, args: ['--no-sandbox'] })
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 1240 },
  deviceScaleFactor: 2,
})
const page = await ctx.newPage()

await page.goto('http://localhost:3000', { waitUntil: 'networkidle' })
await page.waitForTimeout(5000) // let the socket fill KPIs and the stream settle

const navOn = (pg) => (name) =>
  pg
    .getByRole('navigation', { name: 'Secciones de la consola' })
    .getByRole('button', { name })
const navBtn = (name) => navOn(page)(name)

// ---- shot 1: the full view, unfiltered ------------------------------
// The queue arrives newest-first: the followup line (the pre-signal
// executed + followup denied pair that shares one action_id — the F1
// case) sits on top with its badge; executed pidfd kills and every
// denial class below.
await navBtn('Respuesta activa').click()
await page.waitForTimeout(2500) // state + audit poll cycle
await page.screenshot({ path: path.join(ASSETS, 'console-respuesta-activa.png') })
console.log('shot: console-respuesta-activa.png')

// ---- shot 2: the followups filter -----------------------------------
// The class filter (19h25 wave) with its honest window count: one real
// followup record of the visible window, "de N en la ventana" hint on.
const kind = page.getByLabel('Filtrar la cola del audit por clase de intento')
await kind.click()
await page.getByRole('option', { name: 'followups' }).click()
await page.waitForTimeout(800)
await page.screenshot({ path: path.join(ASSETS, 'console-respuesta-filtro.png') })
console.log('shot: console-respuesta-filtro.png')

// leave the view as we found it (filter is component state, the page
// closes anyway — this is for anyone running the tour twice)
await kind.click()
await page.getByRole('option', { name: 'todas' }).click()

await browser.close()
console.log('done')
