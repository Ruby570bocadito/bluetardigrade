// Frames the console captures for the README (docs/assets/showcase/*.webp):
// each capture sits in a browser window over the sign-in page's night
// navy with its two blue glows and dotted grid, and the hero lays the
// light theme over the dark one. Rendered by Chromium from plain HTML,
// then encoded to WebP with ffmpeg (a third of the PNG's weight).
//
// Run after capture_console.mjs. Env: CONSOLE_TEST_TOOLS,
// CONSOLE_CHROMIUM_PATH.

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../..')
const ASSETS = path.resolve(here, '..')
const OUT = path.join(ASSETS, 'showcase')
const tooling = process.env.CONSOLE_TEST_TOOLS || path.join(repo, 'tools/console-tests')
const { chromium } = createRequire(path.join(tooling, 'package.json'))('playwright')

const dataUri = (file) => 'data:image/png;base64,' + readFileSync(path.join(ASSETS, file)).toString('base64')

const STYLE = `
  * { box-sizing: border-box; margin: 0; }
  body { width: var(--w); height: var(--h); overflow: hidden; display: grid; place-items: center; font: 500 13px/1 "Segoe UI", system-ui, sans-serif;
    background: radial-gradient(70% 60% at 0% 0%, rgba(77,195,255,.22), transparent 62%), radial-gradient(70% 60% at 100% 100%, rgba(47,111,237,.3), transparent 62%), #0b1220; }
  body::before { content: ""; position: fixed; inset: 0; background-image: radial-gradient(rgba(148,163,184,.16) 1px, transparent 1px); background-size: 24px 24px; mask-image: radial-gradient(80% 80% at 50% 50%, #000 40%, transparent 100%); }
  .win { position: relative; border-radius: 14px; overflow: hidden; background: #070b12; border: 1px solid rgba(148,163,184,.22); box-shadow: 0 0 0 1px rgba(0,0,0,.4), 0 40px 80px -30px rgba(0,0,0,.9), 0 0 60px -20px rgba(77,195,255,.25); }
  .bar { height: 38px; display: flex; align-items: center; gap: 8px; padding: 0 14px; background: #0f1726; border-bottom: 1px solid rgba(148,163,184,.14); }
  .dot { width: 11px; height: 11px; border-radius: 50%; background: #33425a; }
  .dot:nth-child(1) { background: #f87171; } .dot:nth-child(2) { background: #fbbf24; } .dot:nth-child(3) { background: #34d399; }
  .url { margin: 0 auto; transform: translateX(-30px); display: flex; align-items: center; gap: 7px; height: 24px; padding: 0 14px; border-radius: 7px; color: #a3b1c6; background: #070b12; border: 1px solid rgba(148,163,184,.14); font-size: 12px; }
  .url svg { opacity: .8; }
  .win img { display: block; width: 100%; }
  .win.light .bar { background: #f8fafc; border-bottom-color: #dbe3ee; } .win.light .url { background: #fff; color: #475569; border-color: #dbe3ee; }
  .win.light { border-color: rgba(203,213,225,.7); }
  .phone { position: relative; width: 300px; padding: 11px; border-radius: 52px; background: linear-gradient(160deg, #2a3446, #0d1320 45%, #1b2333); box-shadow: 0 0 0 1px rgba(148,163,184,.25), 0 50px 90px -30px rgba(0,0,0,.95), 0 0 70px -25px rgba(77,195,255,.35); }
  .phone .screen { overflow: hidden; border-radius: 42px; background: #0b1220; }
  .phone .status { position: relative; height: 40px; display: flex; align-items: center; justify-content: space-between; padding: 6px 30px 0; color: #e8eef7; font: 600 13px/1 "Segoe UI", system-ui, sans-serif; }
  .phone .status i { font-style: normal; letter-spacing: 1px; font-size: 11px; }
  .phone img { display: block; width: 100%; }
  .phone .island { position: absolute; top: 9px; left: 50%; width: 92px; height: 26px; margin-left: -46px; border-radius: 20px; background: #000; }
`
const LOCK = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
const win = (file, query, cls = '', style = '') =>
  `<div class="win ${cls}" style="${style}"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="url">${LOCK}localhost:3000/${query}</span></div><img src="${dataUri(file)}" alt=""></div>`

// file → [capture, address bar suffix]
const FRAMES = {
  panel: ['console-panel.png', ''],
  alertas: ['console-alertas.png', '?view=alertas'],
  seleccion: ['console-seleccion.png', '?view=alertas'],
  incidentes: ['console-incidentes.png', '?view=incidentes'],
  equipos: ['console-equipos.png', '?view=equipos'],
  reglas: ['console-reglas.png', '?view=reglas'],
  cadenas: ['console-cadenas.png', '?view=cadenas'],
  estado: ['console-estado.png', '?view=estado'],
  flujo: ['console-flujo.png', '?view=flujo'],
  respuesta: ['console-respuesta-activa.png', '?view=respuesta'],
  supresiones: ['console-supresiones.png', '?view=supresiones'],
  noc: ['console-noc.png', ''],
  'reglas-light': ['console-reglas-light.png', '?view=reglas'],
  avisos: ['console-avisos.png', '?view=ajustes'],
}

// a phone: a dark bezel with the dynamic-island cut-out around a capture
const phone = (file, style = '') =>
  `<div class="phone" style="${style}"><div class="screen"><div class="status"><span>9:41</span><span class="island"></span><i>5G ▮▮▮</i></div><img src="${dataUri(file)}" alt=""></div></div>`

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.CONSOLE_CHROMIUM_PATH || undefined })
const render = async (name, w, h, body) => {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  await page.setContent(`<!doctype html><html><head><style>${STYLE}</style></head><body style="--w:${w}px;--h:${h}px">${body}</body></html>`)
  await page.waitForLoadState('load')
  const png = path.join(OUT, `.${name}.png`)
  await page.screenshot({ path: png })
  await page.close()
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-c:v', 'libwebp', '-quality', '90', '-compression_level', '6', path.join(OUT, `${name}.webp`)])
  rmSync(png)
  console.log('frame: ' + name)
}
try {
  // hero: the dark panel, the light one laid over its lower right corner
  await render('hero', 1800, 1060, `<div style="position:relative;width:1500px;height:900px">
    ${win('console-panel.png', '', '', 'position:absolute;left:0;top:0;width:1340px')}
    ${win('console-panel-light.png', '', 'light', 'position:absolute;right:0;bottom:-40px;width:760px')}
  </div>`)
  // the phone view: three phones, the middle one raised
  await render('movil', 1600, 980, `<div style="display:flex;align-items:center;gap:56px">
    ${phone('console-movil-equipos.png', 'transform:translateY(24px) rotate(-4deg)')}
    ${phone('console-movil-alertas.png', 'transform:translateY(-12px);width:330px')}
    ${phone('console-movil-claro.png', 'transform:translateY(24px) rotate(4deg)')}
  </div>`)
  for (const [name, [file, query]] of Object.entries(FRAMES)) {
    await render(name, 1600, 1072, win(file, query, name.endsWith('-light') ? 'light' : '', 'width:1440px'))
  }
} finally {
  await browser.close()
}
