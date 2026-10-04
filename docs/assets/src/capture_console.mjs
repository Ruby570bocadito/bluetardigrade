// Captures the console screenshots used by the root README
// (docs/assets/console-*.png) from a RUNNING console. Nothing here
// fabricates data: point it at a console wired to a real engine.
//
// Lab recipe used for the committed set (loopback only):
//   1. go build -o <lab>/engine ./cmd/engine
//      go build -o <lab>/scenario ./scripts/dev-tests/scenario
//   2. engine run -addr 127.0.0.1:17777 -api 127.0.0.1:17778 -rules rules
//      -sequences sequences -beacons beacons.yaml -thresholds thresholds.yaml
//      -suppressions <file> -store <db> -lifecycle <file> -api-token <t>
//      -allow-kill -respond-operators <v2 file> -respond-audit <file>
//      (relative paths, and the engine started under
//      `unshare -r -u` with `hostname LAB-SOC-01`, so no local path or
//      machine name reaches a screenshot)
//   3. feed it with the scenario in a loop (plus -beacon / -burst rounds)
//      and a few POST /api/respond/kill attempts (executed and denied);
//   4. cd web/console && bun run build && ENGINE_API_URL=http://127.0.0.1:17778
//      SF_API_TOKEN=<t> bun run start
//   5. create at least one incident from the alert queue (select alerts,
//      "Añadir a incidente"), then run node docs/assets/src/capture_console.mjs
//
// Scenario events carry source=simulate, so the console labels the window
// as demo in the header: the captures keep that label on purpose.
//
// Env: CONSOLE_URL (default http://127.0.0.1:3000), CONSOLE_TEST_TOOLS
// (directory with playwright, default tools/console-tests).

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../..')
const ASSETS = path.resolve(here, '..')
const tooling = process.env.CONSOLE_TEST_TOOLS || path.join(repo, 'tools/console-tests')
const { chromium } = createRequire(path.join(tooling, 'package.json'))('playwright')
const base = (process.env.CONSOLE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')

const SHOTS = [
  { file: 'console-panel.png', query: '', height: 1500 },
  { file: 'console-flujo.png', query: '?view=flujo', height: 1000 },
  { file: 'console-alertas.png', query: '?view=alertas', height: 1000, selectFirst: true },
  { file: 'console-seleccion.png', query: '?view=alertas', height: 900, pickRows: 3 },
  { file: 'console-incidentes.png', query: '?view=incidentes', height: 1300 },
  { file: 'console-equipos.png', query: '?view=equipos', height: 1500 },
  { file: 'console-reglas.png', query: '?view=reglas', height: 1000 },
  { file: 'console-cadenas.png', query: '?view=cadenas', height: 1000 },
  { file: 'console-supresiones.png', query: '?view=supresiones', height: 700 },
  { file: 'console-respuesta-activa.png', query: '?view=respuesta', height: 1100 },
  { file: 'console-noc.png', query: '', height: 900, nocSlide: 1 },
]

const browser = await chromium.launch({ headless: true })
try {
  for (const shot of SHOTS) {
    const page = await browser.newPage({ viewport: { width: 1440, height: shot.height }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
    await page.goto(base + '/' + shot.query)
    await page.locator('#console-main').waitFor()
    // let the first poll, the SSE snapshot and the stats history land
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
    if (shot.nocSlide !== undefined) {
      await page.getByRole('button', { name: 'Abrir modo NOC' }).click()
      const noc = page.getByRole('dialog', { name: 'Modo NOC' })
      await noc.waitFor()
      for (let i = 0; i < shot.nocSlide; i++) await noc.getByRole('button', { name: 'Pantalla siguiente' }).click()
      await page.waitForTimeout(2500)
    }
    await page.screenshot({ path: path.join(ASSETS, shot.file) })
    console.log('shot: ' + shot.file)
    await page.close()
  }
} finally {
  await browser.close()
}
