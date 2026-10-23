// Records the README demo clips (docs/assets/demo/*.webm, converted to
// GIF and MP4 by make_media.sh): one short, captioned walk through each
// part of the console, driven like an operator would — a visible
// pointer moves and clicks, the keyboard opens the command palette.
//
// The engine is the contract-true fixture set (fixtures.mjs, LAB-* hosts,
// source=simulate): the console labels the window as demo data, and
// nothing in the clips is product telemetry. The sign-in clip needs a
// second console started with accounts (CONSOLE_LOGIN_URL, an account
// demo / demo-de-la-consola, CONSOLE_DOMAIN_AUTH=1).
//
// Env: CONSOLE_URL (default http://127.0.0.1:3000), CONSOLE_LOGIN_URL,
// CONSOLE_TEST_TOOLS, CONSOLE_CHROMIUM_PATH, DEMO_OUT (default
// docs/assets/demo/raw), DEMO_ONLY (comma-separated clip names).

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { fixtureEngine } from './fixtures.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../..')
const tooling = process.env.CONSOLE_TEST_TOOLS || path.join(repo, 'tools/console-tests')
const { chromium } = createRequire(path.join(tooling, 'package.json'))('playwright')
const base = (process.env.CONSOLE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')
const loginBase = (process.env.CONSOLE_LOGIN_URL || '').replace(/\/$/, '')
const OUT = process.env.DEMO_OUT || path.join(here, '..', 'demo', 'raw')
const ONLY = (process.env.DEMO_ONLY || '').split(',').filter(Boolean)
const SIZE = { width: 1440, height: 900 }
// the phone clips: a 390 x 844 phone
const PHONE = { width: 390, height: 844 }
const PHONE_CLIPS = new Set(['mobile'])

// The pointer and the caption are drawn into the page: a recorded video
// has no cursor of its own.
const OVERLAY = () => {
  const install = () => {
    if (document.getElementById('demo-pointer')) return
    const style = document.createElement('style')
    style.textContent = `
      #demo-pointer { position: fixed; z-index: 2147483647; left: 0; top: 0; width: 22px; height: 22px; pointer-events: none; transform: translate(-3px, -2px); transition: transform .05s linear; filter: drop-shadow(0 2px 4px rgba(0,0,0,.5)); }
      #demo-pointer.down::after { content: ""; position: absolute; left: -11px; top: -11px; width: 26px; height: 26px; border-radius: 50%; border: 2px solid #4dc3ff; animation: demo-ripple .45s ease-out forwards; }
      @keyframes demo-ripple { from { opacity: 1; transform: scale(.4); } to { opacity: 0; transform: scale(1.6); } }
      #demo-caption { position: fixed; z-index: 2147483646; left: 50%; bottom: var(--demo-caption-bottom, 26px); transform: translateX(-50%); max-width: 88vw; width: max-content; padding: 10px 18px 10px 14px; border-radius: 999px; display: flex; align-items: center; gap: 10px; font: 600 var(--demo-caption-size, 15px)/1.3 "Segoe UI", system-ui, sans-serif; color: #e8eef7; background: rgba(11, 18, 32, .92); border: 1px solid rgba(77, 195, 255, .35); box-shadow: 0 18px 40px -16px rgba(0,0,0,.8); backdrop-filter: blur(8px); pointer-events: none; transition: opacity .25s; }
      #demo-caption b { display: inline-grid; place-items: center; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 999px; font-size: 12px; color: #06101f; background: linear-gradient(180deg, #4dc3ff, #2f6fed); }
      #demo-caption:empty { opacity: 0; }
      html.demo-touch #demo-pointer svg { display: none; }
      html.demo-touch #demo-pointer { width: 34px; height: 34px; border-radius: 50%; background: rgba(255,255,255,.22); border: 2px solid rgba(255,255,255,.75); transform: translate(-17px, -17px); }
      html.demo-touch #demo-pointer.down::after { left: -6px; top: -6px; width: 42px; height: 42px; }`
    document.head.appendChild(style)
    const p = document.createElement('div')
    p.id = 'demo-pointer'
    p.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15 11.5-6.6.9 4 7.3-2.7 1.4-4-7.4L4 20z" fill="#fff" stroke="#0b1220" stroke-width="1.4" stroke-linejoin="round"/></svg>'
    document.body.appendChild(p)
    const c = document.createElement('div')
    c.id = 'demo-caption'
    document.body.appendChild(c)
    document.addEventListener('mousemove', (e) => { p.style.left = e.clientX + 'px'; p.style.top = e.clientY + 'px' }, true)
    document.addEventListener('mousedown', () => { p.classList.remove('down'); void p.offsetWidth; p.classList.add('down') }, true)
    // a modal <dialog> sits in the top layer, above any z-index: while
    // one is open the pointer and the caption ride inside it
    new MutationObserver(() => {
      const host = [...document.querySelectorAll('dialog[open]')].pop() ?? document.body
      if (p.parentElement !== host) { host.appendChild(p); host.appendChild(c) }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install)
  else install()
}

async function caption(page, step, text) {
  await page.evaluate(([s, t]) => {
    const c = document.getElementById('demo-caption')
    if (c) c.innerHTML = t ? `<b>${s}</b>${t}` : ''
  }, [step, text])
}

let pointer = { x: SIZE.width / 2, y: SIZE.height / 2 }
async function moveTo(page, x, y, steps = 24) {
  await page.mouse.move(x, y, { steps })
  pointer = { x, y }
}
// clickOn glides the pointer to the element's centre, then clicks it.
async function clickOn(page, locator, { pause = 350 } = {}) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  if (!box) throw new Error('element without a box')
  await moveTo(page, box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(pause)
  await page.mouse.down()
  await page.mouse.up()
}
async function scrollBy(page, dy, steps = 12) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy / steps)
    await page.waitForTimeout(40)
  }
}
const nav = (page, label) => page.locator('aside nav button').filter({ hasText: new RegExp(`^${label}`) }).first()

// readyAt marks when the clip's first screen has its data: the
// recording before it (blank page, «conectando») is trimmed by
// make_media.sh from trim.json.
let readyAt = 0
async function open(page, query = '', theme = 'dark') {
  await page.addInitScript(([t]) => localStorage.setItem('bt-theme', t), [theme])
  await page.goto(base + '/' + query)
  await page.locator('#console-main').waitFor()
  await page.waitForTimeout(2500)
  const vp = page.viewportSize() ?? SIZE
  await moveTo(page, vp.width * 0.62, vp.height * 0.55, 1)
  readyAt = Date.now()
}

// the phone: a finger instead of an arrow, captions above the tab bar
async function phoneLook(page) {
  await page.evaluate(() => {
    document.documentElement.classList.add('demo-touch')
    document.documentElement.style.setProperty('--demo-caption-bottom', '92px')
    document.documentElement.style.setProperty('--demo-caption-size', '13px')
  })
}

const CLIPS = {
  // 1. the first screen of a shift: what needs attention, then the queue
  triage: async (page) => {
    await open(page)
    await caption(page, 1, 'El panel resume lo que necesita atención ahora')
    await page.waitForTimeout(2200)
    await scrollBy(page, 420)
    await page.waitForTimeout(1600)
    await scrollBy(page, -420)
    await caption(page, 2, 'De ahí, a la cola de alertas')
    await clickOn(page, page.getByRole('button', { name: /Abrir cola de alertas/ }).first())
    await page.waitForTimeout(1800)
    await caption(page, 3, 'Cada alerta abre su detalle, su grafo y sus acciones')
    await clickOn(page, page.locator('table tbody tr button').first())
    await page.waitForTimeout(2600)
    await caption(page, 4, 'Varias a la vez: reconocer, cerrar, a un incidente…')
    const boxes = page.getByRole('checkbox', { name: /^Seleccionar .+\(/ })
    for (let i = 0; i < 3; i++) await clickOn(page, boxes.nth(i), { pause: 200 })
    await page.waitForTimeout(2800)
  },
  // 2. a case: alerts, hosts, graph and the timeline of what was done
  incidents: async (page) => {
    await open(page, '?view=incidentes')
    await caption(page, 1, 'Los incidentes agrupan alertas de varios equipos')
    await page.waitForTimeout(2000)
    await caption(page, 2, 'Estado, responsable, grafo y línea de tiempo del caso')
    await scrollBy(page, 380)
    await page.waitForTimeout(2600)
    await scrollBy(page, -380)
    await caption(page, 3, 'Y su informe, en Markdown o imprimible')
    await moveTo(page, ...(await center(page.getByRole('button', { name: /Informe imprimible/ }).first())))
    await page.waitForTimeout(2200)
  },
  // 3. the fleet: who is online, who went silent, each host's page
  hosts: async (page) => {
    await open(page, '?view=equipos')
    await caption(page, 1, 'Toda la flota: en línea, sin señal o inactiva')
    await page.waitForTimeout(2000)
    await caption(page, 2, 'La ficha del equipo: riesgo, sensor y conexión')
    await clickOn(page, page.locator('button').filter({ hasText: 'LAB-WKS-01' }).first())
    await page.waitForTimeout(1800)
    await caption(page, 3, 'Árbol de procesos, grafo y línea de tiempo del equipo')
    await scrollBy(page, 900, 18)
    await page.waitForTimeout(2600)
  },
  // 4. detection engineering: coverage, kill chains, the rule tester
  detection: async (page) => {
    await open(page, '?view=reglas')
    await caption(page, 1, 'Reglas YAML con su cobertura MITRE ATT&CK')
    await page.waitForTimeout(2400)
    await caption(page, 2, 'Cadenas de ataque dibujadas paso a paso')
    await clickOn(page, page.getByRole('tab', { name: /Cadenas/ }).first())
    await page.waitForTimeout(2600)
    await caption(page, 3, 'Supresiones con su motivo y caducidad')
    await clickOn(page, page.getByRole('tab', { name: /Supresiones/ }).first())
    await page.waitForTimeout(2200)
    await caption(page, 4, 'Y un probador que pasa un evento por las reglas vivas')
    await clickOn(page, page.getByRole('tab', { name: /Probador/ }).first())
    await page.waitForTimeout(2600)
  },
  // 5. live telemetry and platform health
  telemetry: async (page) => {
    await open(page, '?view=flujo')
    await caption(page, 1, 'La telemetría en vivo, con filtros y exportación')
    await page.waitForTimeout(2600)
    await caption(page, 2, 'El estado de la plataforma: motor, ingesta y entrega')
    await clickOn(page, nav(page, 'Estado'))
    await page.waitForTimeout(2200)
    await scrollBy(page, 500)
    await page.waitForTimeout(2000)
  },
  // 6. active response: armed surface and its audit
  respond: async (page) => {
    await open(page, '?view=respuesta')
    await caption(page, 1, 'Respuesta activa: apagada hasta que la armas')
    await page.waitForTimeout(2400)
    await caption(page, 2, 'Cada intento, ejecutado o denegado, queda auditado')
    await scrollBy(page, 520)
    await page.waitForTimeout(2800)
  },
  // 7. keyboard, palette, themes and the NOC wall
  navigation: async (page) => {
    await open(page)
    await caption(page, 1, 'Ctrl+K: cualquier vista o acción desde el teclado')
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(700)
    await page.keyboard.type('equipos', { delay: 120 })
    await page.waitForTimeout(900)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1800)
    await caption(page, 2, 'Tema claro u oscuro, a tu gusto')
    // the toggle cycles dark -> system -> light (or the reverse): click
    // until the page is light
    for (let i = 0; i < 3; i++) {
      if (await page.evaluate(() => document.documentElement.classList.contains('light'))) break
      await clickOn(page, page.getByRole('button', { name: /^Cambiar a (tema|seguir)/ }).first(), { pause: 250 })
      await page.waitForTimeout(500)
    }
    await page.waitForTimeout(2200)
    await caption(page, 3, 'Modo NOC para el monitor de la sala')
    await clickOn(page, page.getByRole('button', { name: 'Abrir modo NOC' }))
    await page.waitForTimeout(4200)
  },
  // 9. notifications to mail, chat and phone (Ajustes -> Avisos externos)
  notify: async (page) => {
    await open(page, '?view=ajustes')
    const panel = page.locator('.panel', { hasText: 'Avisos externos: correo' })
    await panel.evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 96, behavior: 'smooth' }))
    await page.waitForTimeout(900)
    await caption(page, 1, 'Avisos al correo, a Telegram, a Slack o al móvil con ntfy')
    await page.waitForTimeout(2400)
    await caption(page, 2, 'Cada canal con su gravedad mínima, aplicado sin reiniciar el motor')
    await clickOn(page, panel.locator('select').first())
    await page.waitForTimeout(1600)
    await page.keyboard.press('Escape')
    await caption(page, 3, '«Enviar prueba» y la respuesta del canal')
    await clickOn(page, panel.getByRole('button', { name: /Enviar un mensaje de prueba al canal guardia-movil/ }))
    await page.waitForTimeout(2400)
    await caption(page, 4, 'Añadir un canal es un clic')
    await clickOn(page, panel.getByRole('button', { name: /^Slack$/ }))
    await page.waitForTimeout(800)
    await scrollBy(page, 260)
    await page.waitForTimeout(2200)
  },
  // 10. on call from the phone (app/movil, installable)
  mobile: async (page) => {
    await open(page, 'movil')
    await phoneLook(page)
    await caption(page, 1, 'La guardia desde el móvil')
    await page.waitForTimeout(2000)
    await caption(page, 2, 'Solo lo crítico, o todo')
    await clickOn(page, page.getByRole('button', { name: /^Críticas/ }))
    await page.waitForTimeout(1600)
    await caption(page, 3, 'Cerrar desde la tarjeta')
    await clickOn(page, page.getByRole('button', { name: /^Cerrar: / }).first())
    await page.waitForTimeout(1800)
    await caption(page, 4, 'Incidentes abiertos')
    await clickOn(page, page.getByRole('navigation', { name: 'Secciones de la vista móvil' }).getByRole('button', { name: /Incidentes/ }))
    await page.waitForTimeout(1800)
    await caption(page, 5, 'Equipos: primero los que no dan señal')
    await clickOn(page, page.getByRole('navigation', { name: 'Secciones de la vista móvil' }).getByRole('button', { name: /Equipos/ }))
    await page.waitForTimeout(2600)
  },
  // 8. sign-in: local or domain account
  login: async (page) => {
    if (!loginBase) throw new Error('CONSOLE_LOGIN_URL is not set')
    await page.addInitScript(() => localStorage.setItem('bt-theme', 'dark'))
    await page.goto(loginBase + '/login')
    await page.waitForTimeout(800)
    await moveTo(page, 1000, 520, 1)
    readyAt = Date.now()
    await caption(page, 1, 'Cuentas locales o del dominio, con verificación en dos pasos')
    await clickOn(page, page.locator('label[for="realm-dominio"]'))
    await page.waitForTimeout(1400)
    await clickOn(page, page.locator('label[for="realm-local"]'))
    await clickOn(page, page.locator('#user'))
    await page.keyboard.type('demo', { delay: 110 })
    await clickOn(page, page.locator('#password'))
    await page.keyboard.type('demo-de-la-consola', { delay: 60 })
    await caption(page, 2, 'Sesión con cookie segura; cada acceso queda auditado')
    await clickOn(page, page.locator('button[type=submit]'))
    await page.locator('#console-main').waitFor()
    await page.waitForTimeout(3000)
  },
}

async function center(locator) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  return [box.x + box.width / 2, box.y + box.height / 2]
}

mkdirSync(OUT, { recursive: true })
// re-recording a few clips (DEMO_ONLY) keeps the others' trims
let trim = {}
try { trim = JSON.parse(readFileSync(path.join(OUT, 'trim.json'), 'utf8')) } catch {}
const browser = await chromium.launch({ headless: true, executablePath: process.env.CONSOLE_CHROMIUM_PATH || undefined })
try {
  for (const [name, run] of Object.entries(CLIPS)) {
    if (ONLY.length && !ONLY.includes(name)) continue
    const tmp = path.join(OUT, '.tmp-' + name)
    rmSync(tmp, { recursive: true, force: true })
    const phone = PHONE_CLIPS.has(name)
    const viewport = phone ? PHONE : SIZE
    // the recorder never upscales: a phone clip is recorded at the phone's own size
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone, locale: 'es-ES', colorScheme: 'dark', recordVideo: { dir: tmp, size: viewport } })
    const startedAt = Date.now()
    readyAt = startedAt
    const page = await context.newPage()
    await page.addInitScript(OVERLAY)
    await fixtureEngine()(page)
    try {
      await run(page)
      await caption(page, '', '')
      await page.waitForTimeout(400)
    } catch (err) {
      console.error(`clip ${name}: ${err.message}`)
    }
    await context.close()
    const [video] = readdirSync(tmp)
    renameSync(path.join(tmp, video), path.join(OUT, name + '.webm'))
    rmSync(tmp, { recursive: true, force: true })
    trim[name] = Math.max(0, (readyAt - startedAt) / 1000 - 0.2)
    console.log('clip: ' + name)
  }
  writeFileSync(path.join(OUT, 'trim.json'), JSON.stringify(trim, null, 2) + '\n')
} finally {
  await browser.close()
}
