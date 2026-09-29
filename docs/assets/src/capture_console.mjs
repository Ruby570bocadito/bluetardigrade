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
// Output: console-panel.png, console-alertas.png, console-reglas.png
//         and per-frame PNGs in the system temp dir (assemble the GIF
//         from those frames; frames are 2x viewport of `main`).
import { chromium } from 'playwright-core'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ASSETS = path.dirname(fileURLToPath(import.meta.url))
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

const navBtn = (name) =>
  page
    .getByRole('navigation', { name: 'Secciones de la consola' })
    .getByRole('button', { name })

await page.screenshot({ path: path.join(ASSETS, 'console-panel.png') })
console.log('shot: console-panel.png')

await navBtn('Alertas').click()
await page.waitForTimeout(1200)
await page.screenshot({ path: path.join(ASSETS, 'console-alertas.png') })
console.log('shot: console-alertas.png')

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

await browser.close()
console.log('done')
