// Captures the console screenshots used by the root README
// (docs/assets/console-*.png). Two modes:
//
// 1. REAL ENGINE (default). Nothing fabricates data: point it at a
//    console wired to a running engine.
//
//    Lab recipe used for past committed sets (loopback only):
//      1. go build -o <lab>/engine ./cmd/engine
//         go build -o <lab>/scenario ./scripts/dev-tests/scenario
//      2. engine run -addr 127.0.0.1:17777 -api 127.0.0.1:17778 -rules rules
//         -sequences sequences -beacons beacons.yaml -thresholds thresholds.yaml
//         -suppressions <file> -store <db> -lifecycle <file> -api-token <t>
//         -allow-kill -respond-operators <v2 file> -respond-audit <file>
//         (relative paths, and the engine started under
//         `unshare -r -u` with `hostname LAB-SOC-01`, so no local path or
//         machine name reaches a screenshot)
//      3. feed it with the scenario in a loop (plus -beacon / -burst rounds)
//         and a few POST /api/respond/kill attempts (executed and denied);
//      4. cd web/console && bun run build && ENGINE_API_URL=http://127.0.0.1:17778
//         SF_API_TOKEN=<t> bun run start
//      5. create at least one incident from the alert queue (select alerts,
//         "Añadir a incidente"), then run this script.
//
// 2. FIXTURES (`CONSOLE_CAPTURE_FIXTURES=1`, fixtures.mjs). Same route-interception
//    approach as scripts/dev-tests/check_console_browser.mjs: the engine
//    responses are contract-true fixtures (OpenAPI shapes), LAB-* hosts,
//    source=simulate, so the console itself labels the window as demo
//    data. Exists so the capture set stays reproducible on hosts without
//    the Go toolchain.
//
// Scenario events and fixtures carry source=simulate, so the console
// labels the window as demo in the header: the captures keep that label
// on purpose.
//
// Env: CONSOLE_URL (default http://127.0.0.1:3000), CONSOLE_TEST_TOOLS
// (directory with playwright, default tools/console-tests),
// CONSOLE_CAPTURE_FIXTURES=1, CONSOLE_CHROMIUM_PATH, CAPTURE_ONLY (comma-
// separated file names without .png, to retake a few). The fixtures live in
// fixtures.mjs, shared with record_demo.mjs.

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { fixtureEngine } from './fixtures.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../..')
const ASSETS = path.resolve(here, '..')
const tooling = process.env.CONSOLE_TEST_TOOLS || path.join(repo, 'tools/console-tests')
const { chromium } = createRequire(path.join(tooling, 'package.json'))('playwright')
const base = (process.env.CONSOLE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')
const FIXTURES = process.env.CONSOLE_CAPTURE_FIXTURES === '1'

// ------------------------------------------------------------------ shots
const ONLY = (process.env.CAPTURE_ONLY || '').split(',').filter(Boolean)
const SHOTS = [
  { file: 'console-panel.png', query: '', height: 1000 },
  { file: 'console-panel-light.png', query: '', height: 1000, theme: 'light' },
  { file: 'console-estado.png', query: '?view=estado', height: 1000 },
  { file: 'console-flujo.png', query: '?view=flujo', height: 1000 },
  { file: 'console-alertas.png', query: '?view=alertas', height: 1000, selectFirst: true },
  { file: 'console-seleccion.png', query: '?view=alertas', height: 1000, pickRows: 3 },
  { file: 'console-incidentes.png', query: '?view=incidentes', height: 1000 },
  { file: 'console-equipos.png', query: '?view=equipos', height: 1000 },
  { file: 'console-reglas.png', query: '?view=reglas', height: 1000 },
  { file: 'console-reglas-light.png', query: '?view=reglas', height: 1000, theme: 'light' },
  { file: 'console-cadenas.png', query: '?view=cadenas', height: 1000 },
  { file: 'console-supresiones.png', query: '?view=supresiones', height: 1000 },
  { file: 'console-respuesta-activa.png', query: '?view=respuesta', height: 1000 },
  { file: 'console-noc.png', query: '', height: 1000, noc: true },
  // Ajustes -> Avisos externos, scrolled to its panel
  { file: 'console-avisos.png', query: '?view=ajustes', height: 1000, scrollTo: 'Avisos externos: correo' },
  // the phone view (app/movil) on a 390 x 844 phone
  { file: 'console-movil-alertas.png', path: 'movil', phone: true },
  { file: 'console-movil-incidentes.png', path: 'movil', phone: true, tab: 'Incidentes' },
  { file: 'console-movil-equipos.png', path: 'movil', phone: true, tab: 'Equipos' },
  { file: 'console-movil-claro.png', path: 'movil', phone: true, theme: 'light' },
]

// CONSOLE_CHROMIUM_PATH: a Chromium to use instead of playwright's own download
const browser = await chromium.launch({ headless: true, executablePath: process.env.CONSOLE_CHROMIUM_PATH || undefined })
try {
  for (const shot of SHOTS) {
    if (ONLY.length && !ONLY.includes(shot.file.replace(/\.png$/, ''))) continue
    const viewport = shot.phone ? { width: 390, height: 844 } : { width: 1600, height: shot.height }
    const page = await browser.newPage({ viewport, deviceScaleFactor: shot.phone ? 3 : 2, isMobile: !!shot.phone, hasTouch: !!shot.phone, reducedMotion: 'reduce', locale: 'es-ES' })
    if (FIXTURES) await fixtureEngine()(page)
    await page.addInitScript(([theme]) => localStorage.setItem('bt-theme', theme ?? 'dark'), [shot.theme])
    await page.goto(base + '/' + (shot.path ?? shot.query))
    await page.locator('#console-main').waitFor()
    // let the first poll, the snapshot and the chart layouts land
    await page.waitForTimeout(5000)
    if (shot.selectFirst) {
      await page.locator('table tbody tr button').first().click()
      await page.getByRole('complementary', { name: 'Detalle de la alerta seleccionada' }).waitFor()
      await page.waitForTimeout(500)
    }
    if (shot.pickRows) {
      const boxes = page.getByRole('checkbox', { name: /^Seleccionar .+\(/ })
      for (let i = 0; i < shot.pickRows; i++) await boxes.nth(i).check()
      await page.getByRole('region', { name: 'Acciones sobre la selección' }).waitFor()
    }
    if (shot.tab) {
      await page.getByRole('navigation', { name: 'Secciones de la vista móvil' }).getByRole('button', { name: shot.tab }).click()
      await page.waitForTimeout(800)
    }
    if (shot.scrollTo) {
      // below the sticky header (about 80 px)
      await page.locator('.panel', { hasText: shot.scrollTo }).evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 96))
      await page.waitForTimeout(800)
    }
    if (shot.noc) {
      await page.getByRole('button', { name: 'Abrir modo NOC' }).click()
      await page.getByRole('dialog', { name: 'Modo NOC' }).waitFor()
      await page.waitForTimeout(2500)
    }
    await page.screenshot({ path: path.join(ASSETS, shot.file) })
    console.log('shot: ' + shot.file)
    await page.close()
  }
} finally {
  await browser.close()
}
