// console-service hub: assembly of the telemetry bus and the HTTP
// status surface. createHub() wires the engine bridge into socket.io,
// serves the status page / health JSON through an engine.io middleware
// (socket.io is mounted at path '/', so every plain HTTP request is
// intercepted by engine.io first; the middleware is the documented
// extension point to answer those) and keeps the exact event contract
// the web console already consumes.

import { createHash, timingSafeEqual } from 'crypto'
import http from 'http'
import { Server } from 'socket.io'
import pkg from './package.json'
import { EngineBridge } from './bridge'
import { runAnalysis, runIncidentAnalysis, validateIncidentPayload } from './analyst'
import { HubState, MAX_EVENTS, MAX_ALERTS } from './hub-state'
import { buildStatusData, renderNotFound, renderStatusPage, esc } from './http-ui'
import { createRateLimiter, createSlotLimiter } from './limiter'
import { logLine, logError } from './log'
import type { HubHealth, SfAlert, SfEvent, SfAlertLifecycle } from './types'

export const HUB_VERSION: string = pkg.version
const SOCKET_PATH = '/'
const BASE_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000']
const MAX_QUESTION_LENGTH = 2000
const MAX_ANALYST_CONCURRENT = 2
// Per-connection and hub-wide budgets protect the provider API key.
// Reconnecting must not reset the shared rate or concurrency allowance.
const MAX_ANALYST_PER_MINUTE = 10

export type HubOptions = {
  /** Listen port; 0 picks an ephemeral port (tests). Default: PORT env or 3003. */
  port?: number
  /** Bind address. Default: CONSOLE_HOST env or 127.0.0.1. */
  host?: string
  /** Engine API root override (tests). Default: ENGINE_API env or 127.0.0.1:7778. */
  engineApi?: string
  /** Env-like record for CORS and analyst status (tests). */
  env?: Record<string, string | undefined>
  /** Suppress the startup banner (tests). */
  quiet?: boolean
}

const LOOPBACK_BINDS = new Set(['127.0.0.1', '::1', 'localhost'])

/** True when a hub bound to host is reachable from other machines. */
export function bindsBeyondLoopback(host: string): boolean {
  return !LOOPBACK_BINDS.has(host.trim().toLowerCase().replace(/^\[|\]$/g, ''))
}

/** Constant-time token check over fixed-length digests. */
export function hubTokenMatches(supplied: unknown, expected: string): boolean {
  if (typeof supplied !== 'string') return false
  const a = createHash('sha256').update(supplied).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export type HubHandle = {
  io: Server
  state: HubState
  httpServer: http.Server
  start(): Promise<void>
  stop(): Promise<void>
  /** Listen address once started, null before. */
  address(): { host: string; port: number } | null
}

type EngineRequest = http.IncomingMessage & { _query?: Record<string, string> }

export function createHub(opts: HubOptions = {}): HubHandle {
  const env = opts.env ?? process.env
  const port = opts.port ?? Number(env.PORT || env.CONSOLE_SERVICE_PORT || 3003)
  const host = opts.host ?? (env.CONSOLE_HOST || '127.0.0.1')
  // CORS allowlist: any website could otherwise open a cross-origin
  // socket to the hub and silently read the whole telemetry feed.
  const corsOrigins = [
    ...BASE_ORIGINS,
    ...(env.CONSOLE_CORS_ORIGIN || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ]

  // HUB_ACCESS_TOKEN: the Origin allowlist below only binds browsers —
  // any other client can send whatever Origin it likes and read the
  // whole telemetry feed or spend the analyst's provider budget. With a
  // token every socket must present it (the console fetches it from its
  // own authenticated /api/hub-token route). Binding beyond loopback
  // without one is refused at start() unless the operator declares an
  // authenticating front end (HUB_ALLOW_UNAUTHENTICATED=1).
  const accessToken = env.HUB_ACCESS_TOKEN || ''
  const exposedWithoutToken = bindsBeyondLoopback(host) && !accessToken && env.HUB_ALLOW_UNAUTHENTICATED !== '1'

  const state = new HubState(env)
  const httpServer = createHttpServer()
  const io = new Server(httpServer, {
    // Keep in sync with the console client (socket-provider.tsx)
    path: SOCKET_PATH,
    cors: { origin: corsOrigins, methods: ['GET', 'POST'] },
    // CORS alone does not gate WebSocket upgrades. Reject browser origins
    // before any transport can receive telemetry or submit analyst work.
    allowRequest: (req, done) => {
      const origin = req.headers.origin
      done(null, origin === undefined || corsOrigins.includes(origin))
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  })

  if (accessToken) {
    io.use((socket, next) => {
      if (hubTokenMatches((socket.handshake.auth as { token?: unknown } | undefined)?.token, accessToken)) return next()
      const err = new Error('hub_auth_required') as Error & { data?: unknown }
      err.data = { hint: 'El hub exige HUB_ACCESS_TOKEN: la consola lo obtiene de /api/hub-token.' }
      next(err)
    })
  }

  // Plain HTTP surface. engine.io claims every URL under its path
  // (here: '/', i.e. all of them), so the only supported way to answer
  // non-socket.io requests on the same port is this engine middleware.
  // Real socket.io traffic always carries the EIO query parameter and
  // is delegated back with next(); everything else is served here.
  io.engine.use((rawReq: unknown, rawRes: unknown, next: (err?: unknown) => void) => {
    const req = rawReq as EngineRequest
    if (req._query && typeof req._query.EIO === 'string') return next()
    // Raw websocket upgrades without the handshake query: let engine.io
    // reject them the way it always has.
    if (req.headers.upgrade) return next()
    const res = rawRes as http.ServerResponse
    try {
      routeHttp(req, res)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logError(`http handler error on ${req.method ?? '?'} ${req.url ?? '/'}: ${message}`)
      if (!res.headersSent) sendJson(res, 500, { error: { code: 'internal_error', message: 'Error interno del hub' } })
      else res.end()
    }
  })

  function routeHttp(req: http.IncomingMessage, res: http.ServerResponse) {
    const method = (req.method ?? 'GET').toUpperCase()
    const url = new URL(req.url ?? '/', 'http://hub.local')
    const pathname = url.pathname
    const accept = String(req.headers.accept ?? '')
    const headOnly = method === 'HEAD'

    if (method !== 'GET' && method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD')
      sendJson(res, 405, {
        error: { code: 'method_not_allowed', message: `Metodo ${method} no permitido en ${pathname}` },
      })
      return
    }
    if (pathname === '/' || pathname === '/index.html') {
      const data = buildStatusData(state, { version: HUB_VERSION, host, port: listenPort(), socketPath: SOCKET_PATH, corsOrigins })
      sendHtml(res, 200, renderStatusPage(data), headOnly)
      return
    }
    if (pathname === '/health' || pathname === '/healthz') {
      sendJson(res, 200, state.health(HUB_VERSION), headOnly)
      return
    }
    if (pathname === '/favicon.ico') {
      // No favicon on purpose; answer without content to keep logs clean.
      res.writeHead(204, securityHeaders())
      res.end()
      return
    }
    if (accept.includes('text/html')) sendHtml(res, 404, renderNotFound(pathname), headOnly)
    else
      sendJson(res, 404, {
        error: { code: 'not_found', message: `Ruta no encontrada: ${pathname}`, hint: 'GET / panel de estado, GET /health JSON' },
      })
  }

  // ------------------------------------------------------------ sockets

  const globalSlots = createSlotLimiter(MAX_ANALYST_CONCURRENT)
  const globalRate = createRateLimiter(MAX_ANALYST_PER_MINUTE, 60_000)
  io.on('connection', (socket) => {
    state.incClients()
    logLine(`consola conectada: ${socket.id} (${state.clientsConnected} activas)`)

    socket.emit('console:snapshot', state.snapshot())

    // One limiter set per connection: the analyst panel cannot open
    // parallel LLM calls beyond the cap (slots) nor exceed the rolling
    // request budget (rate) from a single socket. Both the single-alert
    // and the incident pipeline share this budget.
    const limiter = createSlotLimiter(MAX_ANALYST_CONCURRENT)
    const analystRate = createRateLimiter(MAX_ANALYST_PER_MINUTE, 60_000)

    // Acquires the four gates in the same order the error messages
    // promise them; releases everything it took on any failure so a
    // rejected request never leaks budget.
    const acquireAnalystBudget = (socket: { emit: (event: string, data: unknown) => void }): boolean => {
      if (!analystRate.tryTake()) {
        socket.emit('analyst:error', {
          message: `Limite de ${MAX_ANALYST_PER_MINUTE} analisis por minuto en esta conexion; espera unos segundos antes de reintentar`,
        })
        return false
      }
      if (!limiter.tryAcquire()) {
        socket.emit('analyst:error', {
          message: `Ya hay ${MAX_ANALYST_CONCURRENT} analisis en curso en esta conexion; espera a que terminen`,
        })
        return false
      }
      if (!globalSlots.tryAcquire()) {
        limiter.release()
        socket.emit('analyst:error', { message: 'El hub ya tiene dos analisis en curso; espera a que terminen' })
        return false
      }
      if (!globalRate.tryTake()) {
        globalSlots.release()
        limiter.release()
        socket.emit('analyst:error', { message: 'Limite global de diez analisis por minuto; espera antes de reintentar' })
        return false
      }
      return true
    }

    socket.on('analyst:ask', async (payload: unknown) => {
      state.analystAsks += 1

      if (typeof payload !== 'object' || payload === null) {
        socket.emit('analyst:error', { message: 'Peticion invalida: se esperaba un objeto con la alerta a analizar' })
        return
      }
      const sent = (payload as { alert?: unknown }).alert as SfAlert | undefined
      // The hub's own copy (fed by the engine) is authoritative: the
      // panel only names WHICH alert to analyze. The client copy is the
      // fallback for alerts already rotated out of the hub ring (paged
      // history), still validated below.
      const known = typeof sent?.id === 'string' && sent.id ? state.alerts.find((a) => a.id === sent.id) : undefined
      const alert = known ?? sent
      if (typeof alert?.rule_id !== 'string' || alert.rule_id.trim() === '') {
        socket.emit('analyst:error', { message: 'Alerta invalida: falta rule_id' })
        return
      }
      const question = (payload as { question?: unknown }).question
      if (question !== undefined && (typeof question !== 'string' || question.length > MAX_QUESTION_LENGTH)) {
        socket.emit('analyst:error', { message: `Pregunta invalida: maximo ${MAX_QUESTION_LENGTH} caracteres` })
        return
      }
      if (!acquireAnalystBudget(socket)) return

      const rule = state.rules.find((r) => r.id === alert.rule_id)
      const ev = state.events.find((e) => e.id === alert.event_id)
      const emit = {
        step: (s: { label: string; state: 'run' | 'done' }) => socket.emit('analyst:step', s),
        delta: (text: string) => socket.emit('analyst:delta', { text }),
      }
      try {
        const text = await runAnalysis(alert, rule, ev, emit, typeof question === 'string' ? question : undefined)
        socket.emit('analyst:done', { text })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'error desconocido del analista'
        logError(`analyst error (${socket.id}): ${message}`)
        socket.emit('analyst:error', { message })
      } finally {
        globalSlots.release()
        limiter.release()
      }
    })

    socket.on('analyst:ask-incident', async (payload: unknown) => {
      state.analystAsks += 1

      const validated = validateIncidentPayload(payload)
      if (!validated.ok) {
        socket.emit('analyst:error', { message: validated.error })
        return
      }
      // The hub's own copy wins per alert (same policy as analyst:ask):
      // the panel names which alerts to analyze; the engine-fed ring
      // supplies the authoritative fields when they are still buffered.
      const incidentAlerts = validated.value.alerts.map((a) => {
        const known = typeof a.id === 'string' && a.id ? state.alerts.find((x) => x.id === a.id) : undefined
        return known ?? a
      })
      if (!acquireAnalystBudget(socket)) return

      const ruleIds = new Set(incidentAlerts.map((a) => a.rule_id))
      const rules = state.rules.filter((r) => ruleIds.has(r.id))
      const emit = {
        step: (s: { label: string; state: 'run' | 'done' }) => socket.emit('analyst:step', s),
        delta: (text: string) => socket.emit('analyst:delta', { text }),
      }
      try {
        const text = await runIncidentAnalysis({ ...validated.value, alerts: incidentAlerts }, rules, emit)
        socket.emit('analyst:done', { text })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'error desconocido del analista'
        logError(`analyst incident error (${socket.id}): ${message}`)
        socket.emit('analyst:error', { message })
      } finally {
        globalSlots.release()
        limiter.release()
      }
    })

    socket.on('disconnect', () => {
      state.decClients()
      logLine(`consola desconectada: ${socket.id} (${state.clientsConnected} activas)`)
    })

    socket.on('error', (error) => {
      logError(`socket error (${socket.id}): ${String(error)}`)
    })
  })

  // ------------------------------------------------------------- bridge

  const bridge = new EngineBridge(
    {
      onEvent: (ev: SfEvent) => {
        state.recordEvent(ev)
        io.emit('console:event', ev)
      },
      onAlert: (al: SfAlert) => {
        state.recordAlert(al)
        io.emit('console:alert', al)
      },
      onLifecycle: (entry: SfAlertLifecycle) => {
        // triage decisions ride the same ring patch + re-emit contract
        // as alerts; the raw entry is the whole frame payload
        state.applyLifecycle(entry)
        io.emit('console:alert_lifecycle', entry)
      },
      onStats: (st) => {
        state.setStats(st)
        io.emit('console:stats', st)
      },
      onRules: (rules) => {
        state.setRules(rules)
        logLine(`reglas activas recibidas del motor: ${rules.length}`)
      },
      onSuppressions: (entries) => {
        state.setSuppressions(entries)
        io.emit('console:suppressions', entries)
      },
      onSequences: (seqs) => {
        state.setSequences(seqs)
        io.emit('console:sequences', seqs)
      },
      onUp: () => {
        const wasDown = state.mode !== 'engine'
        state.setUp(bridge.endpoint)
        if (wasDown) logLine(`telemetria: MOTOR conectado (${bridge.endpoint})`)
      },
      onDown: () => {
        if (state.mode === 'sin-motor') return
        state.setDown()
        io.emit('console:stats', state.stats())
        logLine('telemetria: MOTOR caido; la consola no mostrara datos hasta que vuelva')
      },
    },
    { engineApi: opts.engineApi, maxEvents: MAX_EVENTS, maxAlerts: MAX_ALERTS },
  )

  // ------------------------------------------------------------ startup

  let stopping = false

  async function start(): Promise<void> {
    if (exposedWithoutToken) {
      throw new Error(
        `console-service: CONSOLE_HOST=${host} expone el hub fuera de loopback sin HUB_ACCESS_TOKEN; ` +
          'define HUB_ACCESS_TOKEN (y el mismo valor en la consola) o HUB_ALLOW_UNAUTHENTICATED=1 si un proxy inverso ya autentica',
      )
    }
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => reject(err)
      httpServer.once('error', onError)
      httpServer.listen(port, host, () => {
        httpServer.off('error', onError)
        resolve()
      })
    })
    bridge.start()
    if (!opts.quiet) printBanner()
  }

  async function stop(): Promise<void> {
    if (stopping) return
    stopping = true
    bridge.stop()
    // Force-close live console sockets first: io.close() waits for every
    // connection otherwise, and a hung client must never delay shutdown.
    io.disconnectSockets(true)
    await new Promise<void>((resolve) => {
      const guard = setTimeout(() => resolve(), 2500)
      guard.unref?.()
      io.close(() => {
        clearTimeout(guard)
        resolve()
      })
    })
  }

  function listenPort(): number {
    const addr = httpServer.address()
    return typeof addr === 'object' && addr !== null ? addr.port : port
  }

  function printBanner() {
    const row = (key: string, value: string) => logLine(`  ${key.padEnd(11)}${value}`)
    logLine(`console-service v${HUB_VERSION} (hub de telemetria, sin simulador)`)
    row('hub', `http://${host}:${listenPort()} (panel / y estado /health)`)
    row('socket.io', `path '${SOCKET_PATH}' con CORS de ${corsOrigins.length} origenes`)
    row('acceso', accessToken ? 'token HUB_ACCESS_TOKEN exigido a cada socket' : 'sin token (solo loopback)')
    row('motor', `${bridge.endpoint} (reintento periodico si esta caido)`)
    const analyst = state.analystStatus
    row(
      'analista',
      analyst.configured
        ? `configurado: modelo ${analyst.model} en ${analyst.baseUrl}`
        : `sin configurar: faltan ${analyst.missing.join(', ')}`,
    )
    row('retencion', `${MAX_EVENTS} eventos y ${MAX_ALERTS} alertas en memoria`)
  }

  return {
    io,
    state,
    httpServer,
    start,
    stop,
    address() {
      const addr = httpServer.address()
      if (typeof addr !== 'object' || addr === null) return null
      return { host, port: addr.port }
    },
  }
}

// ---------------------------------------------------------- http helpers

function securityHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  }
}

function sendJson(res: http.ServerResponse, status: number, body: HubHealth | Record<string, unknown>, headOnly = false) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    ...securityHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(headOnly ? undefined : payload)
}

function sendHtml(res: http.ServerResponse, status: number, html: string, headOnly = false) {
  res.writeHead(status, {
    ...securityHeaders(),
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; connect-src 'self'",
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
  })
  res.end(headOnly ? undefined : html)
}

function createHttpServer(): http.Server {
  const server = http.createServer((req, res) => {
    // Only reachable for requests engine.io does not claim; today that
    // cannot happen (path '/'), but keep a sane guard just in case the
    // mount path changes in the future.
    res.writeHead(404, securityHeaders())
    res.end('not found')
  })
  // A stuck client must never pin the hub: drop idle sockets.
  server.headersTimeout = 10_000
  server.requestTimeout = 15_000
  return server
}

// esc is re-exported for tests of handler-level HTML escaping.
export { esc }
