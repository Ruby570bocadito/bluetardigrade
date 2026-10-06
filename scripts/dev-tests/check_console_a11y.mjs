// Accessibility regression of the built console (POL-8): axe-core with
// the WCAG 2.x ruleset over the console views, in dark and light themes,
// against contract-true engine fixtures (same interception approach as
// check_console_browser.mjs; no running Go engine is contacted).
//
// Optional tooling lives outside the application dependency graph; its
// manifest (exact versions + bun.lock) is committed in tools/console-tests:
//   cd tools/console-tests && bun install
//   cd tools/console-tests && bunx playwright install chromium
// Build the console first (bun run build). Env:
//   CONSOLE_BROWSER_URL  reuse a running loopback console (127.0.0.1 only)
//   CONSOLE_A11Y_TAGS    axe tags to enforce (default: wcag2a,wcag2aa,wcag21a,wcag21aa)
//   CONSOLE_A11Y_STRICT  also fail on needs-review results when =1
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { spawn } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')
const tooling = resolve(process.env.CONSOLE_TEST_TOOLS || join(repo, 'tools/console-tests'))
const requireTools = createRequire(join(tooling, 'package.json'))
const { chromium } = requireTools('playwright')
const axeSource = readFileSync(requireTools.resolve('axe-core/axe.min.js'), 'utf8')
const external = process.env.CONSOLE_BROWSER_URL
const base = external || 'http://127.0.0.1:3100'
const url = new URL(base)
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
  throw new Error('Accessibility checks require a loopback HTTP server')
}
const TAGS = (process.env.CONSOLE_A11Y_TAGS || 'wcag2a,wcag2aa,wcag21a,wcag21aa').split(',').map((t) => t.trim())
const STRICT = process.env.CONSOLE_A11Y_STRICT === '1'
const dump = process.env.CONSOLE_A11Y_DUMP
import { appendFileSync, writeFileSync } from 'node:fs'

// ---------------------------------------------------------------- fixtures
// Engine API shapes per docs/api/openapi.yaml, hosts LAB-*, source
// simulate: enough breadth to render every view with real UI (strips,
// tables, charts, badges) instead of empty states alone.
function fixtureEngine(page) {
  const now = Date.now()
  const iso = (msAgo) => new Date(now - msAgo).toISOString()
  const MIN = 60_000
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR
  const HOSTS = ['LAB-WKS-01', 'LAB-WKS-07', 'LAB-SRV-DC01', 'LAB-SRV-FILE', 'LAB-WKS-12']
  const USERS = ['LAB\\jmartin', 'LAB\\svc_backup', 'LAB\\admin.p', 'LAB\\mlopez']
  let seq = 0
  const alert = (over) => {
    seq++
    return {
      id: String(seq).padStart(16, '0'),
      timestamp: iso(seq * 11 * MIN),
      rule_id: `rule-${seq}`,
      rule_name: `Detección de laboratorio ${seq}`,
      severity: ['critical', 'high', 'medium', 'low'][seq % 4],
      host: HOSTS[seq % HOSTS.length],
      user: USERS[seq % USERS.length],
      event_id: `ev-${seq}`,
      event_type: 'process.create',
      summary: `Evidencia de laboratorio ${seq} sobre ${HOSTS[seq % HOSTS.length]}`,
      source: 'sysmon',
      matched_on: [],
      status: seq % 3 === 0 ? 'acknowledged' : 'new',
      ...over,
      tags: ['attack.t1059', 'attack.execution'],
    }
  }
  const alerts = Array.from({ length: 12 }, () => alert({}))
  const events = Array.from({ length: 18 }, (_, i) => ({
    id: `evt-${1000 + i}`,
    timestamp: iso(i * 8 * 1000),
    type: ['process.create', 'net.connect', 'file.write', 'registry.set', 'dns.query'][i % 5],
    source: 'sysmon',
    host: HOSTS[i % HOSTS.length],
    process: { pid: 4000 + i, name: 'cmd.exe', command_line: 'cmd.exe /c whoami' },
    network: { protocol: 'tcp', source_ip: '10.10.1.24', destination_ip: '93.184.216.34', destination_port: 443 },
    file: { path: 'C:\\Users\\Public\\lab.dll', extension: '.dll', size_bytes: 148_000 },
  }))
  const data = {
    '/api/stats': {
      uptime_s: 2 * DAY + 3200, events_total: 412_000, alerts_total: alerts.length, events_per_min: 180,
      dropped: 0, ingest_rejected: 0, by_severity: { critical: 3, high: 3, medium: 3, low: 3 },
      rules_count: 114, rules_types: ['process.create', 'file.write', 'net.connect'], events_buffered: 512,
      webhook_sent: 12, webhook_failed: 0, webhook_dropped: 0, suppressions_active: 1,
      correlator_states: 8, correlator_sequences: 13, correlator_cap: 8192,
      risk_hosts_tracked: 3,
      hot_hosts: [{ host: 'LAB-WKS-01', score: 18.5, alerts: 4, last_seen: iso(MIN) }],
      store_enabled: true, store_events: 380_000, store_alerts: alerts.length, store_write_failures: 0,
    },
    '/api/events': events,
    '/api/alerts': alerts,
    '/api/rules': [
      { id: 'rule-1', name: 'Detección de laboratorio 1', severity: 'critical', event_type: 'process.create', mitre: 'T1059', tactic: 'execution', tags: ['attack.t1059', 'attack.execution'], conditions: [] },
      { id: 'rule-2', name: 'Detección de laboratorio 2', severity: 'medium', event_type: 'file.write', mitre: 'T1027', tactic: 'defense-evasion', tags: ['attack.t1027', 'attack.defense-evasion'], conditions: [] },
    ],
    '/api/sequences': [
      { id: 'seq-1', name: 'Campaña de laboratorio', description: 'Dos pasos sobre la misma máquina.', severity: 'high', window_seconds: 600, tags: ['attack.t1059'], steps: ['Detección de laboratorio 1', 'Detección de laboratorio 2'], scope: 'host' },
    ],
    '/api/suppressions': { entries: [{ rule_id: 'rule-2', host: 'LAB-WKS-07', reason: 'Ventana de inventario de laboratorio', expires: new Date(now + DAY).toISOString() }] },
    '/api/fleet': {
      enabled: true,
      hosts: HOSTS.map((host, i) => ({
        host, status: i === 4 ? 'silent' : 'online', first_seen: iso(3 * DAY), last_seen: iso((i + 1) * MIN),
        events: 40_000 - i, events_last_5m: 60 - i, sources: ['etw'], peers: [`10.10.1.${20 + i}:7777`],
        identity: `lab-${i}`, sensor: { kind: 'etw-rust', version: '0.9.2', os: 'Windows 11 Pro', capture: 'procesos, red', run_mode: 'servicio de Windows', interval_s: 60, uptime_s: DAY, spooled: 0, dropped: 0, last_heartbeat: iso(MIN) },
      })),
      online: 4, silent: 1, idle: 0, heartbeat_grace_min_s: 600,
    },
    '/api/enroll': {
      enabled: true, hint: 'alta por token activa', pending: 1, active: 4, usable_tokens: 1, writes: true,
      tokens: [{ id: 'tok-1', label: 'Laboratorio', max_uses: 5, uses: 2, created_at: iso(DAY), expires_at: new Date(now + DAY).toISOString(), created_by: 'consola', status: 'active' }],
      hosts: [{ name: 'LAB-WKS-12', host: 'LAB-WKS-12', state: 'pending', token_id: 'tok-1', peer: '10.10.1.40', enrolled_at: iso(30 * MIN), last_attempt: iso(30 * MIN) }],
    },
    '/api/settings/ad': {
      server: 'LAB-SRV-DC01', port: 636, start_tls: false, base_dn: 'DC=lab,DC=local',
      ca_file: 'C:\\ProgramData\\bluetardigrade\\ad-ca.pem', ca_file_present: true,
      bind_dn: 'CN=bt-reader,OU=svc,DC=lab,DC=local', password_file: 'C:\\ProgramData\\bluetardigrade\\ad.secret', password_stored: true,
      interval_seconds: 900, include_ous: ['OU=people,DC=lab,DC=local'], exclude_ous: [], max_objects: 20000, page_size: 500,
      inactive_days: 45, krbtgt_max_age_days: 180, work_start: '08:00', work_end: '18:00', work_days: [1, 2, 3, 4, 5],
      reload_pending: false,
    },
    '/api/incidents': {
      persistent: true,
      incidents: [{
        id: 'inc-lab', title: 'Incidente de laboratorio', summary: 'Caso de prueba de accesibilidad.', severity: 'high', status: 'investigating',
        owner: 'a.rios', hosts: ['LAB-WKS-01'], alert_ids: [alerts[0].id],
        timeline: [{ at: iso(HOUR), by: 'consola', action: 'created', detail: 'Creado desde la cola de alertas' }],
        created_at: iso(HOUR), updated_at: iso(MIN),
      }],
    },
    '/api/respond/state': {
      armed: true, signal: 'SIGKILL', operators_count: 2, protected_count: 2,
      audit_path: 'C:\\ProgramData\\bluetardigrade\\respond-audit.jsonl', audit_size: 4096, audit_ceiling: 67_108_864,
    },
    '/api/respond/audit': {
      skipped: 0, truncated: false,
      records: [{ ts: iso(30 * MIN), action_id: 'act-1', decision: 'executed', pid: 6612, process_name: 'dumpme.exe', resolved_name: 'C:\\Users\\Public\\dumpme.exe', operator: 'a.rios', reason: 'Prueba de laboratorio', host: 'LAB-WKS-01', signal: 'SIGKILL', mechanism: 'pidfd', source: 'api' }],
    },
  }
  return page.route('**/api/engine/**', async (route) => {
    const u = new URL(route.request().url())
    const path = u.pathname.replace('/api/engine', '')
    const payload = data[path.split('?')[0]]
    if (!payload) { await route.fulfill({ status: 404, body: '' }); return }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
  })
}

// ------------------------------------------------------------------- run
const VIEWS = [
  { view: 'panel', theme: 'dark' }, { view: 'panel', theme: 'light' },
  { view: 'estado', theme: 'dark' }, { view: 'estado', theme: 'light' },
  { view: 'flujo', theme: 'dark' },
  { view: 'alertas', theme: 'dark' }, { view: 'alertas', theme: 'light' },
  { view: 'incidentes', theme: 'dark' },
  { view: 'equipos', theme: 'dark' }, { view: 'equipos', theme: 'light' },
  { view: 'reglas', theme: 'dark' }, { view: 'reglas', theme: 'light' },
  { view: 'cadenas', theme: 'dark' },
  { view: 'inteligencia', theme: 'dark' },
  { view: 'supresiones', theme: 'dark' },
  { view: 'probador', theme: 'dark' },
  { view: 'respuesta', theme: 'dark' },
  { view: 'analista', theme: 'dark' },
  { view: 'ajustes', theme: 'dark' }, { view: 'ajustes', theme: 'light' },
]

let server
let browser
let passed = 0
const failures = []
if (dump) writeFileSync(dump, '')
try {
  if (!external) {
    server = spawn(process.execPath, [join(repo, 'web/console/node_modules/next/dist/bin/next'), 'start', '-H', url.hostname, '-p', url.port], {
      cwd: join(repo, 'web/console'), windowsHide: true, stdio: 'ignore',
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    })
    const end = Date.now() + 45_000
    for (;;) {
      try { const r = await fetch(base, { signal: AbortSignal.timeout(2000) }); if (r.ok) { await r.body?.cancel(); break } } catch {}
      if (server?.exitCode != null) throw new Error('Console server exited early')
      await new Promise((d) => setTimeout(d, 250))
      if (Date.now() > end) throw new Error('Console server did not become ready. Build web/console first.')
    }
  }
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', locale: 'es-ES' })
  const page = await context.newPage()
  await fixtureEngine(page)
  // axe-core must be re-injected after every navigation: addScriptTag
  // only lives in the current document
  await page.addInitScript(axeSource)

  for (const { view, theme } of VIEWS) {
    await page.addInitScript(([t]) => localStorage.setItem('bt-theme', t), [theme])
    await page.goto(`${base}/?view=${view}`, { waitUntil: 'networkidle' })
    await page.waitForFunction((v) => (new URLSearchParams(location.search).get('view') || 'panel') === v, view, { timeout: 15_000 })
    // let the first poll and the chart layouts land
    await page.waitForTimeout(2500)
    const result = await page.evaluate(async ([tags, strict]) => {
      const r = await window.axe.run(document, { runOnly: { type: 'tags', values: tags } })
      if (!strict) r.incomplete = []
      return { violations: r.violations, incomplete: r.incomplete }
    }, [TAGS, STRICT])
    const label = `${view}/${theme}`
    if (dump) appendFileSync(dump, JSON.stringify({ label, violations: result.violations }, null, 2) + '\n')
    const issues = [
      ...result.violations.map((v) => `${v.id}(${v.impact}): ${v.nodes.length}x — ${v.help}`),
      ...(STRICT ? result.incomplete.map((v) => `revisar ${v.id}: ${v.nodes.length}x — ${v.help}`) : []),
    ]
    if (issues.length === 0) {
      passed++
      console.log(`PASS: ${label}`)
    } else {
      failures.push(`${label}:\n  ${issues.join('\n  ')}`)
      console.log(`FAIL: ${label} — ${issues.length} hallazgo(s)`)
    }
  }
  await browser.close()
  browser = undefined
} finally {
  if (browser) await browser.close().catch(() => {})
  server?.kill('SIGTERM')
}

console.log(`\nA11y checks (${TAGS.join(', ')}${STRICT ? ', strict' : ''}): ${passed}/${passed + failures.length} views clean`)
if (failures.length > 0) {
  console.error('\nHallazgos axe:')
  for (const f of failures) console.error(`- ${f}`)
  process.exit(1)
}
