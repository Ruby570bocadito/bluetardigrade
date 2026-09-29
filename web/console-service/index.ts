// console-service: real-time telemetry hub for the security-framework web
// console. Simulates the sensor -> engine pipeline (NDJSON events, YAML rule
// evaluation, alert raising) and serves it over socket.io on port 3003.
// Path stays '/' so the web console can connect same-origin behind a
// reverse proxy (or hit it directly on localhost:3003).

import { createServer } from 'http'
import { Server } from 'socket.io'
import { SimEngine, RULES, type SfEvent, type SfAlert, type SimStats } from './sim'
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

const engine = new SimEngine(
  (ev) => {
    events.unshift(ev)
    if (events.length > MAX_EVENTS) events.length = MAX_EVENTS
    io.emit('console:event', ev)
  },
  (al) => {
    alerts.unshift(al)
    if (alerts.length > MAX_ALERTS) alerts.length = MAX_ALERTS
    io.emit('console:alert', al)
  },
  (st) => io.emit('console:stats', st),
  1600,
)

engine.start()

io.on('connection', (socket) => {
  console.log(`console connected: ${socket.id}`)

  const stats: SimStats = engine.stats()
  socket.emit('console:snapshot', {
    events: events.slice(0, 120),
    alerts: alerts.slice(0, MAX_ALERTS),
    rules: RULES,
    stats,
    started_at: new Date(Date.now() - stats.uptime_s * 1000).toISOString(),
  })

  socket.on('analyst:ask', async (payload: { alert: SfAlert; question?: string }) => {
    const alert = payload?.alert
    if (!alert?.rule_id) {
      socket.emit('analyst:error', { message: 'Alerta invalida: falta rule_id' })
      return
    }
    const rule = RULES.find((r) => r.id === alert.rule_id)
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
  console.log(`console-service (simulated telemetry + analyst) on port ${PORT}`)
})

process.on('SIGTERM', () => {
  engine.stop()
  httpServer.close(() => process.exit(0))
})

process.on('SIGINT', () => {
  engine.stop()
  httpServer.close(() => process.exit(0))
})
