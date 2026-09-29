// console-service: real-time telemetry hub for the security-framework web
// console. Runs the built-in simulator by default and switches to the REAL
// Go engine (local API on :7778, see internal/api) the moment it becomes
// reachable; if the engine goes away it falls back to simulation. Served
// over socket.io on port 3003, path '/' so the web console can connect
// same-origin behind a reverse proxy or directly on localhost.

import { createServer } from 'http'
import { Server } from 'socket.io'
import { SimEngine, RULES, type SfEvent, type SfAlert, type SimStats, type RuleMeta } from './sim'
import { EngineBridge } from './bridge'
import { runAnalysis } from './analyst'

const PORT = Number(process.env.PORT || process.env.CONSOLE_SERVICE_PORT || 3003)
const MAX_EVENTS = 160
const MAX_ALERTS = 48

const httpServer = createServer()
const io = new Server(httpServer, {
  // Keep in sync with the console client (socket-provider.tsx)
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// Ring buffers: newest first
const events: SfEvent[] = []
const alerts: SfAlert[] = []

let mode: SimStats['mode'] = 'simulacion'
let activeRules: RuleMeta[] = RULES
let lastStats: SimStats | null = null
const startedAt = new Date()

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

function pushStats(st: SimStats) {
  lastStats = st
  io.emit('console:stats', st)
}

const sim = new SimEngine(pushEvent, pushAlert, pushStats, 1600)
sim.start()

const bridge = new EngineBridge({
  onEvent: pushEvent,
  onAlert: pushAlert,
  onStats: pushStats,
  onRules: (rules) => {
    activeRules = rules
  },
  onUp: () => {
    if (mode === 'engine') return
    mode = 'engine'
    sim.stop()
    console.log(`telemetry source: ENGINE (${bridge.endpoint})`)
  },
  onDown: () => {
    if (mode === 'simulacion') return
    mode = 'simulacion'
    activeRules = RULES
    sim.start()
    console.log('telemetry source: SIMULATION (engine offline)')
  },
})
bridge.start()

function currentStats(): SimStats {
  return lastStats ?? sim.stats()
}

io.on('connection', (socket) => {
  console.log(`console connected: ${socket.id}`)

  const stats = currentStats()
  socket.emit('console:snapshot', {
    events: events.slice(0, 120),
    alerts: alerts.slice(0, MAX_ALERTS),
    rules: activeRules,
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

httpServer.listen(PORT, () => {
  console.log(`console-service (sim + engine bridge) on port ${PORT}`)
})

function shutdown() {
  sim.stop()
  bridge.stop()
  httpServer.close(() => process.exit(0))
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
