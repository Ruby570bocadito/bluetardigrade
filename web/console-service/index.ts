// console-service: real-time telemetry hub for the security-framework web
// console. It forwards ONLY real data from the Go engine (local API on
// :7778, see internal/api) over socket.io on port 3003, path '/'. There is
// no simulator in this service: if the engine is unreachable the console
// is told so and shows nothing, instead of inventing data.

import { createServer } from 'http'
import { Server } from 'socket.io'
import type { SfEvent, SfAlert, HubStats, RuleMeta, SfSuppression } from './types'
import { EngineBridge } from './bridge'
import { runAnalysis } from './analyst'

const PORT = Number(process.env.PORT || process.env.CONSOLE_SERVICE_PORT || 3003)
// Bind to loopback by default: the hub carries every event and alert of
// the local engine (users, hosts, command lines) and no bundled
// deployment needs it reachable from other machines. Serving a console
// that lives on another host is opt-in:
//   CONSOLE_HOST=0.0.0.0  plus the origins allowed via CONSOLE_CORS_ORIGIN.
const HOST = process.env.CONSOLE_HOST || '127.0.0.1'
// CORS allowlist. With origin '*' any website the analyst browses could
// open a cross-origin socket to the hub and silently read the whole
// telemetry feed, so only the local console origins are accepted by
// default; extra ones (a lab host serving the UI) via env, comma separated.
const CORS_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  ...(process.env.CONSOLE_CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean),
]
const MAX_EVENTS = 160
const MAX_ALERTS = 48

const httpServer = createServer()
const io = new Server(httpServer, {
  // Keep in sync with the console client (socket-provider.tsx)
  path: '/',
  cors: { origin: CORS_ORIGINS, methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// Ring buffers: newest first. They only ever hold engine data.
const events: SfEvent[] = []
const alerts: SfAlert[] = []

let mode: HubStats['mode'] = 'sin-motor'
let activeRules: RuleMeta[] = []
let activeSuppressions: SfSuppression[] = []
let lastStats: HubStats | null = null
const startedAt = new Date()

function offlineStats(): HubStats {
  return {
    events_total: 0,
    alerts_total: 0,
    by_severity: {},
    events_per_min: 0,
    uptime_s: 0,
    interval_ms: 0,
    mode: 'sin-motor',
    webhook_sent: 0,
    webhook_failed: 0,
    webhook_dropped: 0,
    suppressions_active: 0,
  }
}

function pushEvent(ev: SfEvent) {
  events.unshift(ev)
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS
  io.emit('console:event', ev)
}

function pushAlert(al: SfAlert) {
  alerts.unshift(al)
  if (alerts.length > MAX_ALERTS) alerts.length = MAX_ALERTS
  io.emit('console:alert', al)
}

function pushStats(st: HubStats) {
  lastStats = st
  io.emit('console:stats', st)
}

// Suppressions change rarely (file edit + hot reload), so the hub only
// forwards them when the payload actually differs: no socket churn every
// 2 s poll. onDown clears them - with the engine gone there is nothing
// honest to display, same policy as events/alerts.
function pushSuppressions(entries: SfSuppression[]) {
  activeSuppressions = entries
  io.emit('console:suppressions', entries)
}

const bridge = new EngineBridge({
  onEvent: pushEvent,
  onAlert: pushAlert,
  onStats: pushStats,
  onRules: (rules) => {
    activeRules = rules
  },
  onSuppressions: pushSuppressions,
  onUp: () => {
    if (mode === 'engine') return
    mode = 'engine'
    console.log(`telemetry source: ENGINE (${bridge.endpoint})`)
  },
  onDown: () => {
    if (mode === 'sin-motor') return
    mode = 'sin-motor'
    lastStats = null
    activeRules = []
    if (activeSuppressions.length > 0) pushSuppressions([])
    pushStats(offlineStats())
    console.log('telemetry source: NONE (engine offline - console shows no data)')
  },
})
bridge.start()

function currentStats(): HubStats {
  return lastStats ?? offlineStats()
}

io.on('connection', (socket) => {
  console.log(`console connected: ${socket.id}`)

  const stats = currentStats()
  socket.emit('console:snapshot', {
    events: events.slice(0, 120),
    alerts: alerts.slice(0, MAX_ALERTS),
    rules: activeRules,
    suppressions: activeSuppressions,
    stats,
    started_at: new Date(Date.now() - stats.uptime_s * 1000).toISOString(),
  })

  socket.on('analyst:ask', async (payload: { alert: SfAlert; question?: string }) => {
    const alert = payload?.alert
    if (!alert?.rule_id) {
      socket.emit('analyst:error', { message: 'Alerta invalida: falta rule_id' })
      return
    }
    const rule = activeRules.find((r) => r.id === alert.rule_id)
    const ev = events.find((e) => e.id === alert.event_id)
    const emit = {
      step: (s: { label: string; state: 'run' | 'done' }) => socket.emit('analyst:step', s),
      delta: (text: string) => socket.emit('analyst:delta', { text }),
    }
    try {
      const text = await runAnalysis(alert, rule, ev, emit, payload.question)
      socket.emit('analyst:done', { text })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'error desconocido del analista'
      console.error(`analyst error (${socket.id}): ${message}`)
      socket.emit('analyst:error', { message })
    }
  })

  socket.on('disconnect', () => {
    console.log(`console disconnected: ${socket.id}`)
  })

  socket.on('error', (error) => {
    console.error(`socket error (${socket.id}):`, error)
  })
})

httpServer.listen(PORT, HOST, () => {
  console.log(`console-service (engine bridge only, no simulator) on ${HOST}:${PORT}`)
  if (process.env.SF_API_TOKEN) {
    console.log('engine bridge: SF_API_TOKEN set - /api/* calls carry the bearer token')
  }
})

function shutdown() {
  bridge.stop()
  httpServer.close(() => process.exit(0))
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
