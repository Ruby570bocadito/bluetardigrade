// HTTP UI for the hub: a self-contained status page and error pages,
// rendered server side from HubState (real data only: engine numbers,
// buffer occupancy, analyst configuration, CORS surface). The page is
// dependency-free HTML + a tiny inline script that re-polls /health
// every few seconds; it follows the design tokens shared with the web
// console: zinc dark surfaces, one emerald accent, Geist + Geist Mono,
// a fixed radius scale, no emojis, no decorative SVGs.

import type { HubState } from './hub-state'

export type StatusRuleRow = { id: string; name: string; severity: string; tactic: string }

export type StatusData = {
  version: string
  host: string
  port: number
  socketPath: string
  transports: string[]
  corsOrigins: string[]
  mode: 'engine' | 'sin-motor'
  hubStartedAtIso: string
  hubUptimeS: number
  engineEndpoint: string
  engineUptimeS: number
  engineLastStatsAgeS: number | null
  eventsTotal: number
  alertsTotal: number
  eventsPerMin: number
  bySeverity: Record<string, number>
  bufferedEvents: number
  bufferedAlerts: number
  maxEvents: number
  maxAlerts: number
  clientsConnected: number
  clientsTotal: number
  analystConfigured: boolean
  analystMissing: string[]
  analystModel: string
  analystBaseUrl: string
  rules: StatusRuleRow[]
  rulesTotal: number
}

export type StatusContext = {
  version: string
  host: string
  port: number
  socketPath: string
  corsOrigins: string[]
}

const RULES_SHOWN = 8

export function buildStatusData(state: HubState, ctx: StatusContext): StatusData {
  const stats = state.stats()
  const now = Date.now()
  return {
    version: ctx.version,
    host: ctx.host,
    port: ctx.port,
    socketPath: ctx.socketPath,
    transports: ['websocket', 'polling'],
    corsOrigins: ctx.corsOrigins,
    mode: state.mode,
    hubStartedAtIso: new Date(state.startedAtMs).toISOString(),
    hubUptimeS: Math.max(0, Math.round((now - state.startedAtMs) / 1000)),
    engineEndpoint: state.engineEndpoint,
    engineUptimeS: stats.uptime_s,
    engineLastStatsAgeS: state.lastStatsAtMs === 0 ? null : Math.max(0, Math.round((now - state.lastStatsAtMs) / 1000)),
    eventsTotal: stats.events_total,
    alertsTotal: stats.alerts_total,
    eventsPerMin: stats.events_per_min,
    bySeverity: stats.by_severity,
    bufferedEvents: state.events.length,
    bufferedAlerts: state.alerts.length,
    maxEvents: 160,
    maxAlerts: 48,
    clientsConnected: state.clientsConnected,
    clientsTotal: state.clientsTotal,
    analystConfigured: state.analystStatus.configured,
    analystMissing: state.analystStatus.missing,
    analystModel: state.analystStatus.model,
    analystBaseUrl: state.analystStatus.baseUrl,
    rules: state.rules.slice(0, RULES_SHOWN).map((r) => ({
      id: r.id,
      name: r.name || r.id,
      severity: r.severity,
      tactic: r.tactic,
    })),
    rulesTotal: state.rules.length,
  }
}

// ------------------------------------------------------------------ helpers

/** Escapes a value for safe interpolation into HTML text or attributes. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function fmtInt(n: number): string {
  return Number.isFinite(n) ? String(n) : '0'
}

function fmtUptime(s: number): string {
  const total = Math.max(0, Math.floor(s || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}

function fmtAge(seconds: number | null): string {
  if (seconds === null) return 'nunca'
  return `hace ${fmtUptime(seconds)}`
}

function fmtClock(iso: string): string {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return iso
  return t.toISOString().replace('T', ' ').replace(/\..+/, ' UTC')
}

const SEV_ORDER = ['critical', 'high', 'medium', 'low'] as const
const SEV_LABEL: Record<string, string> = { critical: 'critica', high: 'alta', medium: 'media', low: 'baja' }

// ------------------------------------------------------------------- pages

export function renderStatusPage(d: StatusData): string {
  const engineUp = d.mode === 'engine'
  const pill = engineUp
    ? `<span id="pill" class="pill ok"><span class="dot"></span>Motor conectado</span>`
    : `<span id="pill" class="pill down"><span class="dot"></span>Motor sin conexion</span>`

  const banner = engineUp
    ? `<div class="banner" id="engine-banner" hidden>El motor de deteccion no responde en <code id="engine-endpoint"></code>. La consola no mostrara datos hasta que vuelva a estar accesible: no hay datos simulados ni de reserva.</div>`
    : `<div class="banner" id="engine-banner">El motor de deteccion no responde en <code>${esc(d.engineEndpoint || 'sin endpoint configurado')}</code>. La consola no mostrara datos hasta que vuelva a estar accesible: no hay datos simulados ni de reserva.</div>`

  const sevChips = SEV_ORDER.map((sev) => {
    const count = Number(d.bySeverity[sev] ?? 0)
    return `<span class="sev sev-${sev}"><i></i>${SEV_LABEL[sev]} <b id="sev-${sev}">${fmtInt(count)}</b></span>`
  }).join('')

  const ruleRows =
    d.rules.length > 0
      ? d.rules
          .map(
            (r) =>
              `<div class="rule"><i class="sevdot sev-${esc(r.severity)}"></i><span class="name" title="${esc(r.id)}">${esc(r.name)}</span><span class="tac">${esc(r.tactic || 'sin tactica')}</span></div>`,
          )
          .join('') +
        (d.rulesTotal > d.rules.length
          ? `<div class="note">Mostrando ${d.rules.length} de ${d.rulesTotal} reglas activas.</div>`
          : '')
      : `<div class="empty">Sin reglas todavia: el motor no ha publicado su conjunto de reglas.</div>`

  const envRows = (['ANALYST_BASE_URL', 'ANALYST_API_KEY', 'ANALYST_MODEL'] as const)
    .map((name) => {
      const missing = d.analystMissing.includes(name)
      return `<li><span>${name}</span><span class="${missing ? 'bad-t' : 'ok-t'}">${missing ? 'falta' : 'ok'}</span></li>`
    })
    .join('')

  const corsRows =
    d.corsOrigins.length > 0
      ? d.corsOrigins.map((o) => `<div class="row"><span class="k">origen permitido</span><span class="v">${esc(o)}</span></div>`).join('')
      : `<div class="empty">Ningun origen configurado</div>`

  const analystState = d.analystConfigured
    ? `<span class="pill ok"><span class="dot"></span>Configurado</span>`
    : `<span class="pill warn"><span class="dot"></span>Sin configurar</span>`

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>console-service / bluetardigrade</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap">
<style>
:root{
  --bg:#09090b; --surface:#18181b; --border:#27272a;
  --text:#f4f4f5; --muted:#a1a1aa; --faint:#71717a;
}
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0}
body{background:var(--bg);color:var(--text);font:400 14px/1.55 'Geist',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}
.mono,.v,.kpi-value,.eyebrow,.banner code{font-family:'Geist Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace}
a{color:#38bdf8;text-decoration:none}
a:hover{text-decoration:underline}
.wrap{max-width:1060px;margin:0 auto;padding:28px 22px 44px}
header.top{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:18px}
.eyebrow{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin-bottom:6px}
h1{font-size:24px;font-weight:600;margin:0;letter-spacing:-.01em}
.head-right{display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.hub-up{font-size:12px;color:var(--faint)}
.pill{display:inline-flex;align-items:center;gap:8px;border:1px solid;border-radius:999px;padding:5px 12px;font-size:12px;font-weight:500}
.dot{width:7px;height:7px;border-radius:999px;background:currentColor}
.pill.ok{color:#34d399;background:rgba(16,185,129,.10);border-color:rgba(16,185,129,.35)}
.pill.down{color:#f87171;background:rgba(239,68,68,.10);border-color:rgba(239,68,68,.35)}
.pill.warn{color:#fbbf24;background:rgba(251,191,36,.10);border-color:rgba(251,191,36,.35)}
.banner{border:1px solid rgba(239,68,68,.35);background:rgba(239,68,68,.07);color:#fca5a5;border-radius:10px;padding:10px 14px;font-size:13px;margin-bottom:18px}
.banner code{font-size:12px;color:#f4f4f5}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:12px}
.kpi{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px}
.kpi-label{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted)}
.kpi-value{font-size:26px;font-weight:500;margin-top:6px;font-variant-numeric:tabular-nums}
.kpi-sub{font-size:12px;color:var(--faint);margin-top:2px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:12px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 18px}
.card h2{margin:0 0 4px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.card .head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:14px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px}
.row:last-child{border-bottom:0}
.row .k{color:var(--muted);flex:none}
.row .v{text-align:right;word-break:break-all}
.muted{color:var(--muted)} .faint{color:var(--faint)} .small{font-size:12px}
.note{font-size:12px;color:var(--faint);margin-top:8px;line-height:1.5}
.env-list{list-style:none;margin:8px 0 0;padding:0;font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:12px}
.env-list li{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px dashed var(--border)}
.env-list li:last-child{border-bottom:0}
.ok-t{color:#34d399} .bad-t{color:#f87171}
.sev{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);border-radius:999px;padding:3px 10px;font-size:12px;margin:6px 6px 0 0;font-family:'Geist Mono',ui-monospace,Menlo,monospace}
.sev i{width:7px;height:7px;border-radius:999px;display:inline-block}
.sev b{font-weight:500;font-variant-numeric:tabular-nums}
.sev-critical{color:#f87171}.sev-critical i{background:#ef4444}
.sev-high{color:#fb923c}.sev-high i{background:#f97316}
.sev-medium{color:#fbbf24}.sev-medium i{background:#fbbf24}
.sev-low{color:#7dd3fc}.sev-low i{background:#38bdf8}
.sevdot{width:8px;height:8px;border-radius:999px;flex:none;display:inline-block}
.rule{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px}
.rule:last-of-type{border-bottom:0}
.rule .name{font-family:'Geist Mono',ui-monospace,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rule .tac{margin-left:auto;color:var(--faint);font-size:12px;flex:none}
.empty{border:1px dashed var(--border);border-radius:10px;padding:14px;font-size:13px;color:var(--muted);text-align:center;margin-top:8px}
footer{margin-top:18px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--faint)}
footer .links span{margin-right:14px}
@media (max-width:640px){.head-right{align-items:flex-start}}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div>
      <div class="eyebrow">bluetardigrade · hub de telemetria</div>
      <h1>console-service</h1>
    </div>
    <div class="head-right">
      ${pill}
      <span class="hub-up mono" id="hub-uptime">activo ${esc(fmtUptime(d.hubUptimeS))}</span>
    </div>
  </header>

  ${banner}

  <section class="kpis" aria-label="indicadores">
    <article class="kpi"><div class="kpi-label">Eventos</div><div class="kpi-value" id="kpi-events">${fmtInt(d.eventsTotal)}</div><div class="kpi-sub">totales del motor</div></article>
    <article class="kpi"><div class="kpi-label">Alertas</div><div class="kpi-value" id="kpi-alerts">${fmtInt(d.alertsTotal)}</div><div class="kpi-sub">totales del motor</div></article>
    <article class="kpi"><div class="kpi-label">Eventos/min</div><div class="kpi-value" id="kpi-epm">${fmtInt(d.eventsPerMin)}</div><div class="kpi-sub">ritmo de ingestión</div></article>
    <article class="kpi"><div class="kpi-label">Consolas</div><div class="kpi-value" id="kpi-clients">${fmtInt(d.clientsConnected)}</div><div class="kpi-sub">${fmtInt(d.clientsTotal)} conexiones desde el arranque</div></article>
  </section>

  <main class="grid">
    <article class="card">
      <div class="head"><h2>Motor de deteccion</h2></div>
      <div class="row"><span class="k">Estado</span><span class="v">${engineUp ? 'conectado' : 'sin conexion'}</span></div>
      <div class="row"><span class="k">Endpoint</span><span class="v" id="engine-endpoint-row">${esc(d.engineEndpoint || 'sin datos')}</span></div>
      <div class="row"><span class="k">Uptime del motor</span><span class="v" id="engine-uptime">${esc(fmtUptime(d.engineUptimeS))}</span></div>
      <div class="row"><span class="k">Ultima respuesta</span><span class="v" id="engine-last">${esc(fmtAge(d.engineLastStatsAgeS))}</span></div>
      <div class="row"><span class="k">Buffer en memoria</span><span class="v">${d.bufferedEvents}/${d.maxEvents} eventos, ${d.bufferedAlerts}/${d.maxAlerts} alertas</span></div>
      <div aria-label="alertas por severidad">${sevChips}</div>
    </article>

    <article class="card">
      <div class="head"><h2>Analista de triage</h2>${analystState}</div>
      <div class="row"><span class="k">Modelo</span><span class="v">${esc(d.analystModel || 'sin datos')}</span></div>
      <div class="row"><span class="k">API base</span><span class="v">${esc(d.analystBaseUrl || 'sin datos')}</span></div>
      <ul class="env-list">${envRows}</ul>
      ${d.analystConfigured ? '' : '<div class="note">Define las variables en el entorno del hub y reiniciarlo. Mientras falte alguna, la consola sigue funcionando y el panel del analista informara del error al pedir un analisis.</div>'}
    </article>

    <article class="card">
      <div class="head"><h2>Reglas activas</h2><span class="v mono small" id="rules-count">${fmtInt(d.rulesTotal)}</span></div>
      ${ruleRows}
    </article>

    <article class="card">
      <div class="head"><h2>Conexion</h2></div>
      <div class="row"><span class="k">Bind</span><span class="v">${esc(d.host)}:${d.port}</span></div>
      <div class="row"><span class="k">Socket.io path</span><span class="v">${esc(d.socketPath)}</span></div>
      <div class="row"><span class="k">Transportes</span><span class="v">${esc(d.transports.join(', '))}</span></div>
      <div class="row"><span class="k">Arranque del hub</span><span class="v">${esc(fmtClock(d.hubStartedAtIso))}</span></div>
      <div class="row" style="border-bottom:0"><span class="k">Origenes CORS</span><span class="v"></span></div>
      ${corsRows}
      <div class="note">Anade origenes con la variable CONSOLE_CORS_ORIGIN (separados por comas). El hub se enlaza a 127.0.0.1 por defecto; exponlo con CONSOLE_HOST solo si la consola vive en otra maquina.</div>
    </article>

    <article class="card">
      <div class="head"><h2>Superficie HTTP</h2></div>
      <div class="row"><span class="k">GET /</span><span class="v">esta pagina de estado</span></div>
      <div class="row"><span class="k">GET /health</span><span class="v">JSON de estado del hub</span></div>
      <div class="row"><span class="k">GET /healthz</span><span class="v">alias de /health</span></div>
      <div class="row"><span class="k">socket.io</span><span class="v">canal en tiempo real en ${esc(d.socketPath)}</span></div>
      <div class="note">La consola web consume los eventos socket.io; esta superficie HTTP es solo para operacion y monitorizacion.</div>
    </article>
  </main>

  <footer>
    <span>version ${esc(d.version)} · datos exclusivamente del motor real: sin simulacion ni valores inventados</span>
    <span class="links mono"><span><a href="/">panel</a></span><span><a href="/health">/health</a></span><span id="stamp" class="faint">actualizado al cargar</span></span>
  </footer>
</div>
<script>
(function () {
  'use strict'
  var $ = function (id) { return document.getElementById(id) }
  var fmtInt = function (n) { return String(Number(n) || 0) }
  var fmtUp = function (s) {
    s = Math.max(0, Math.floor(Number(s) || 0))
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60
    if (h) return h + 'h ' + String(m).padStart(2, '0') + 'm'
    if (m) return m + 'm ' + String(x).padStart(2, '0') + 's'
    return x + 's'
  }
  var fmtAge = function (s) { return s === null || s === undefined ? 'nunca' : 'hace ' + fmtUp(s) }
  var setPill = function (el, cls, text) {
    el.className = 'pill ' + cls
    // Build the pill from DOM nodes, never from a markup string: text
    // stays text even if a future call site forwards live data here
    // (the status page renders engine-supplied values).
    var dot = document.createElement('span')
    dot.className = 'dot'
    el.replaceChildren(dot, document.createTextNode(text))
  }
  function clock() { return new Date().toISOString().slice(11, 19) + ' UTC' }
  async function tick() {
    try {
      var r = await fetch('/health', { cache: 'no-store' })
      if (!r.ok) throw new Error('http ' + r.status)
      var j = await r.json()
      var up = j.engine && j.engine.connected
      setPill($('pill'), up ? 'ok' : 'down', up ? 'Motor conectado' : 'Motor sin conexion')
      var banner = $('engine-banner')
      banner.hidden = !!up
      if (!up) $('engine-endpoint').textContent = (j.engine && j.engine.endpoint) || 'sin endpoint configurado'
      $('hub-uptime').textContent = 'activo ' + fmtUp(j.uptime_s)
      $('kpi-events').textContent = fmtInt(j.engine && j.engine.events_total)
      $('kpi-alerts').textContent = fmtInt(j.engine && j.engine.alerts_total)
      $('kpi-epm').textContent = fmtInt(j.engine && j.engine.events_per_min)
      $('kpi-clients').textContent = fmtInt(j.clients && j.clients.connected)
      $('engine-endpoint-row').textContent = (j.engine && j.engine.endpoint) || 'sin datos'
      $('engine-uptime').textContent = fmtUp(j.engine && j.engine.uptime_s)
      $('engine-last').textContent = fmtAge(j.engine && j.engine.last_stats_age_s)
      var sev = (j.engine && j.engine.by_severity) || {}
      ;['critical', 'high', 'medium', 'low'].forEach(function (k) {
        var el = $('sev-' + k)
        if (el) el.textContent = fmtInt(sev[k])
      })
      if ($('rules-count')) $('rules-count').textContent = fmtInt(j.rules_loaded)
      var stamp = $('stamp')
      stamp.textContent = 'actualizado ' + clock()
      stamp.classList.remove('bad-t')
    } catch (e) {
      var stamp2 = $('stamp')
      stamp2.textContent = 'error al actualizar ' + clock()
      stamp2.classList.add('bad-t')
    }
  }
  setInterval(tick, 3000)
})()
</script>
</body>
</html>`
  return html
}

export function renderNotFound(path: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>404 / console-service</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">
<style>
body{background:#09090b;color:#f4f4f5;font:400 14px/1.55 'Geist',ui-sans-serif,system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.box{max-width:520px;padding:40px 24px;text-align:center}
.code{font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:44px;font-weight:500;color:#34d399;margin:0}
.title{font-size:18px;font-weight:600;margin:10px 0 6px}
.msg{color:#a1a1aa;margin:0 0 22px}
.path{font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:12px;color:#71717a;word-break:break-all}
.links{margin-top:24px;display:flex;gap:18px;justify-content:center;font-size:13px}
a{color:#38bdf8;text-decoration:none}
a:hover{text-decoration:underline}
</style>
</head>
<body>
<div class="box">
  <p class="code">404</p>
  <p class="title">Recurso no encontrado</p>
  <p class="msg">El hub de telemetria no sirve esa ruta. El canal socket.io vive en la raiz y el estado en /health.</p>
  <p class="path">${esc(path)}</p>
  <div class="links"><a href="/">Panel de estado</a><a href="/health">JSON /health</a></div>
</div>
</body>
</html>`
}
