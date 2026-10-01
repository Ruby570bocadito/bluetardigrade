// Integration tests for the whole hub: HTTP surface (status page,
// health JSON, 404/405), the socket.io contract the console consumes,
// the analyst pipeline end to end (against a local OpenAI-compatible
// mock) and the real engine bridge lifecycle against a fake engine
// that speaks the Go API (sync + SSE stream + stats poll).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { io as clientIo, type Socket } from 'socket.io-client'
import { createHub, type HubHandle } from './hub'
import type { SfAlert, SfEvent } from './types'

const ANALYST_KEYS = ['ANALYST_BASE_URL', 'ANALYST_API_KEY', 'ANALYST_MODEL'] as const

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function pollUntil(fn: () => boolean | Promise<boolean>, timeoutMs: number, stepMs = 100): Promise<void> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return
    await sleep(stepMs)
  }
  throw new Error(`pollUntil: timeout tras ${timeoutMs}ms`)
}

function waitEvent<T = Record<string, unknown>>(socket: Socket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, on)
      reject(new Error(`timeout esperando el evento ${event}`))
    }, timeoutMs)
    const on = (data: T) => {
      clearTimeout(timer)
      socket.off(event, on)
      resolve(data)
    }
    socket.on(event, on)
  })
}

function connect(base: string): Socket {
  const socket = clientIo(base, { path: '/', transports: ['websocket'], forceNew: true, timeout: 5000 })
  return socket
}

const validAlert: SfAlert = {
  id: 'a1',
  timestamp: '2026-09-30T10:00:00Z',
  rule_id: 'r-lsass',
  rule_name: 'lsass access',
  severity: 'critical',
  host: 'LAB-WKS-01',
  user: 'ana',
  event_id: 'ev-1',
  event_type: 'process.access',
  summary: 'mimikatz sekurlsa::logonpasswords',
  matched_on: ['process.name', 'process.command_line'],
  tags: ['attack.t1003.001'],
}

// ------------------------------------------------------------ LLM mock

let llmCalls = 0
const llmMock = Bun.serve({
  port: 0,
  // Bun buffers stream headers until the first byte and closes idle
  // requests after the default 10 s idleTimeout: without a keepalive
  // the bridge's stream fetch would hang and die. Real SSE servers
  // send comments/heartbeats; the fake engine does the same.
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname !== '/v1/chat/completions') return new Response('nf', { status: 404 })
    llmCalls += 1
    return Response.json({ choices: [{ message: { content: 'analisis de prueba' } }] })
  },
})

// ------------------------------------------------------- fake Go engine

const fakeRule = {
  id: 'r-lsass',
  name: 'lsass access',
  description: 'acceso a LSASS',
  severity: 'critical',
  event_type: 'process.access',
  tags: ['attack.t1003.001', 'attack.credential-access'],
  conditions: [{ field: 'process.name', operator: 'equals', value: 'mimikatz.exe' }],
}

const fakeEvents: SfEvent[] = [
  { id: 'ev-3', timestamp: '2026-09-30T10:00:03Z', type: 'process.create', source: 'sf-sensor (Sysmon real)', host: 'LAB-WKS-01' },
  { id: 'ev-2', timestamp: '2026-09-30T10:00:02Z', type: 'process.create', source: 'sf-sensor (Sysmon real)', host: 'LAB-WKS-01' },
  { id: 'ev-1', timestamp: '2026-09-30T10:00:01Z', type: 'process.access', source: 'sf-sensor (Sysmon real)', host: 'LAB-WKS-01' },
]

const fakeRawAlert = {
  event_id: 'ev-2',
  rule_id: 'r-lsass',
  rule_name: 'lsass access',
  severity: 'critical',
  host: 'LAB-WKS-01',
  user: 'ana',
  event_type: 'process.access',
  summary: 'mimikatz sekurlsa::logonpasswords',
  matched_on: ['process.name'],
  tags: ['attack.t1003.001'],
  notify: true,
  message: 'mensaje del motor',
}

const fakeStats = { events_total: 3, alerts_total: 1, by_severity: { critical: 1 }, events_per_min: 42, uptime_s: 777 }

let pushFrame: ((frame: string) => void) | null = null
let streamOpen = false
const fakeEngine = Bun.serve({
  port: 0,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url)
    switch (url.pathname) {
      case '/api/health':
        return new Response('ok')
      case '/api/rules':
        return Response.json([fakeRule])
      case '/api/events':
        return Response.json(fakeEvents) // engine returns newest first
      case '/api/alerts':
        return Response.json([fakeRawAlert])
      case '/api/stats':
        return Response.json(fakeStats)
      case '/api/stream': {
        streamOpen = true
        const encoder = new TextEncoder()
        let heartbeat: ReturnType<typeof setInterval> | null = null
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            // Headers + first byte immediately, then a heartbeat: the
            // Go engine keeps the stream alive the same way.
            controller.enqueue(encoder.encode(': ping\n\n'))
            pushFrame = (frame: string) => controller.enqueue(encoder.encode(frame))
            heartbeat = setInterval(() => {
              try {
                controller.enqueue(encoder.encode(': ping\n\n'))
              } catch {
                if (heartbeat) clearInterval(heartbeat)
              }
            }, 2000)
          },
          cancel() {
            if (heartbeat) clearInterval(heartbeat)
            streamOpen = false
            pushFrame = null
          },
        })
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
      }
      default:
        return new Response('nf', { status: 404 })
    }
  },
})

// ------------------------------------------------------------ hub A: offline + analyst

describe('hub HTTP surface (engine down)', () => {
  let hub: HubHandle
  let base = ''

  beforeAll(async () => {
    process.env.ANALYST_BASE_URL = `${llmMock.url.origin}/v1`
    process.env.ANALYST_API_KEY = 'sk-test'
    process.env.ANALYST_MODEL = 'test-model'
    hub = createHub({ port: 0, host: '127.0.0.1', quiet: true, engineApi: 'http://127.0.0.1:9' })
    await hub.start()
    base = `http://127.0.0.1:${hub.address()!.port}`
  })

  afterAll(async () => {
    await hub.stop()
    for (const key of ANALYST_KEYS) delete process.env[key]
  })

  test('GET /health reports the degraded offline state with real numbers', async () => {
    const res = await fetch(`${base}/health`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = (await res.json()) as Record<string, any>
    expect(body.service).toBe('console-service')
    expect(body.status).toBe('degraded')
    expect(body.mode).toBe('sin-motor')
    expect(body.engine.connected).toBe(false)
    expect(body.engine.last_stats_age_s).toBeNull()
    expect(body.buffers.max_events).toBe(160)
    expect(body.buffers.events).toBe(0)
    expect(body.analyst.configured).toBe(true)
    expect(body.analyst.model).toBe('test-model')
    expect(JSON.stringify(body)).not.toContain('sk-test')
  })

  test('GET /healthz is an alias of /health', async () => {
    const res = await fetch(`${base}/healthz`)
    expect(res.status).toBe(200)
    expect(((await res.json()) as Record<string, any>).service).toBe('console-service')
  })

  test('GET / serves the status page reflecting the real engine state', async () => {
    const res = await fetch(`${base}/`, { headers: { accept: 'text/html' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    const html = await res.text()
    expect(html).toContain('console-service')
    expect(html).toContain('Motor sin conexion')
    expect(html).toContain('test-model')
    expect(html).not.toContain('\u2014')
  })

  test('unknown paths answer 404 as JSON or HTML depending on Accept', async () => {
    const asJson = await fetch(`${base}/nope`, { headers: { accept: 'application/json' } })
    expect(asJson.status).toBe(404)
    expect(((await asJson.json()) as Record<string, any>).error.code).toBe('not_found')

    const asHtml = await fetch(`${base}/nope`, { headers: { accept: 'text/html' } })
    expect(asHtml.status).toBe(404)
    expect(asHtml.headers.get('content-type')).toContain('text/html')
    expect(await asHtml.text()).toContain('404')
  })

  test('POST /health is rejected with 405 and an Allow header', async () => {
    const res = await fetch(`${base}/health`, { method: 'POST' })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD')
  })

  test('HEAD / returns headers only', async () => {
    const res = await fetch(`${base}/`, { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })

  test('snapshot keeps the exact console contract while offline', async () => {
    const socket = connect(base)
    const snap = await waitEvent<Record<string, unknown>>(socket, 'console:snapshot')
    expect(Object.keys(snap).sort()).toEqual(['alerts', 'events', 'rules', 'sequences', 'started_at', 'stats', 'suppressions'])
    expect((snap.stats as Record<string, unknown>).mode).toBe('sin-motor')
    expect(snap.events).toEqual([])
    expect(snap.rules).toEqual([])
    socket.disconnect()
  })

  test('health counts connected clients', async () => {
    const s1 = connect(base)
    const s2 = connect(base)
    await Promise.all([waitEvent(s1, 'console:snapshot'), waitEvent(s2, 'console:snapshot')])
    let body: Record<string, any> = {}
    const clients = async () =>
      ((await (await fetch(`${base}/health`)).json()) as Record<string, any>).clients.connected as number
    await pollUntil(async () => (await clients()) === 2, 3000)
    s1.disconnect()
    s2.disconnect()
    await pollUntil(async () => (await clients()) === 0, 3000)
  })

  test('analyst:ask validates the payload before doing any work', async () => {
    const socket = connect(base)
    await waitEvent(socket, 'connect')

    const p1 = waitEvent<{ message: string }>(socket, 'analyst:error')
    socket.emit('analyst:ask', {})
    expect((await p1).message).toContain('rule_id')

    const p2 = waitEvent<{ message: string }>(socket, 'analyst:error')
    socket.emit('analyst:ask', { alert: validAlert, question: 'x'.repeat(2001) })
    expect((await p2).message).toContain('2000')

    const p3 = waitEvent<{ message: string }>(socket, 'analyst:error')
    socket.emit('analyst:ask', 'no-soy-un-objeto')
    expect((await p3).message).toContain('Peticion invalida')

    socket.disconnect()
  })

  test('analyst:ask without configuration fails fast naming the env vars', async () => {
    const socket = connect(base)
    await waitEvent(socket, 'connect')
    for (const key of ANALYST_KEYS) delete process.env[key]
    try {
      socket.emit('analyst:ask', { alert: validAlert })
      const err = await waitEvent<{ message: string }>(socket, 'analyst:error')
      expect(err.message).toContain('ANALYST_')
      // no LLM call, no steps shown
      expect(llmCalls).toBe(0)
    } finally {
      // Restore even on failure so the rest of the suite sees config.
      for (const key of ANALYST_KEYS) process.env[key] = { ANALYST_BASE_URL: `${llmMock.url.origin}/v1`, ANALYST_API_KEY: 'sk-test', ANALYST_MODEL: 'test-model' }[key]!
      socket.disconnect()
    }
  })

  test('analyst:ask runs end to end against the configured provider', async () => {
    const socket = connect(base)
    await waitEvent(socket, 'connect')
    const steps: string[] = []
    socket.on('analyst:step', (s: { label: string }) => steps.push(s.label))
    socket.emit('analyst:ask', { alert: validAlert, question: 'como la contengo?' })
    const done = await waitEvent<{ text: string }>(socket, 'analyst:done', 8000)
    expect(done.text).toBe('analisis de prueba')
    expect(steps).toContain('Consultando proveedor de IA')
    socket.disconnect()
  }, 10000)

  test('a single socket cannot open more analyst calls than the cap', async () => {
    const socket = connect(base)
    await waitEvent(socket, 'connect')
    const done: unknown[] = []
    const errors: string[] = []
    socket.on('analyst:done', (d: unknown) => done.push(d))
    socket.on('analyst:error', (e: { message: string }) => errors.push(e.message))
    socket.emit('analyst:ask', { alert: validAlert })
    socket.emit('analyst:ask', { alert: validAlert })
    socket.emit('analyst:ask', { alert: validAlert })
    await pollUntil(() => done.length === 2 && errors.length === 1, 8000)
    expect(errors[0]).toContain('en curso')
    socket.disconnect()
  }, 12000)
})

// ------------------------------------------------- hub B: engine bridge

describe('engine bridge lifecycle', () => {
  let hub: HubHandle
  let base = ''

  beforeAll(async () => {
    hub = createHub({ port: 0, host: '127.0.0.1', quiet: true, engineApi: fakeEngine.url.origin })
    await hub.start()
    base = `http://127.0.0.1:${hub.address()!.port}`
  })

  afterAll(async () => {
    await hub.stop()
  })

  test('attaches to the engine and syncs its real state', async () => {
    await pollUntil(() => hub.state.mode === 'engine', 10000)
    const body = (await (await fetch(`${base}/health`)).json()) as Record<string, any>
    expect(body.status).toBe('ok')
    expect(body.engine.endpoint).toBe(fakeEngine.url.origin)
    expect(body.engine.events_total).toBe(3)
    expect(body.engine.by_severity).toEqual({ critical: 1 })
    expect(body.rules_loaded).toBe(1)
    expect(body.buffers.events).toBe(3)
    expect(body.buffers.alerts).toBe(1)
    expect(body.engine.last_stats_age_s).toBeLessThanOrEqual(3)
  }, 15000)

  test('status page flips to the connected state with engine data', async () => {
    const html = await (await fetch(`${base}/`, { headers: { accept: 'text/html' } })).text()
    expect(html).toContain('Motor conectado')
    expect(html).toContain('lsass access')
    expect(html).toContain('Credential Access')
    expect(html).toContain('4321'.replace('4321', '3')) // events_total 3
  }, 15000)

  test('snapshot delivers synced events, alerts, rules and engine stats', async () => {
    const socket = connect(base)
    const snap = await waitEvent<Record<string, any>>(socket, 'console:snapshot')
    expect(snap.events.map((e: SfEvent) => e.id)).toEqual(['ev-3', 'ev-2', 'ev-1'])
    expect(snap.alerts.length).toBe(1)
    expect(snap.alerts[0].id).toBe('ev-2:r-lsass')
    expect(snap.alerts[0].notify).toBe(true)
    expect(snap.rules.length).toBe(1)
    expect(snap.rules[0].mitre).toBe('T1003.001')
    expect(snap.rules[0].tactic).toBe('Credential Access')
    expect(snap.stats.mode).toBe('engine')
    expect(snap.stats.uptime_s).toBe(777)
    socket.disconnect()
  })

  test('forwards SSE frames as console events and alerts', async () => {
    const socket = connect(base)
    await waitEvent(socket, 'console:snapshot')
    const nextEvent = waitEvent<SfEvent>(socket, 'console:event')
    const nextAlert = waitEvent<Record<string, any>>(socket, 'console:alert')
    pushFrame?.(`event: event\ndata: ${JSON.stringify({ id: 'ev-4', timestamp: '2026-09-30T10:00:04Z', type: 'process.create', source: 'sf-sensor (Sysmon real)', host: 'LAB-WKS-01' })}\n\n`)
    pushFrame?.(`event: alert\ndata: ${JSON.stringify({ ...fakeRawAlert, event_id: 'ev-9' })}\n\n`)
    const ev = await nextEvent
    expect(ev.id).toBe('ev-4')
    const al = await nextAlert
    expect(al.id).toBe('ev-9:r-lsass')
    expect(hub.state.events[0]?.id).toBe('ev-4')
    expect(hub.state.alerts[0]?.id).toBe('ev-9:r-lsass')
    socket.disconnect()
  })

  test('stats polling reaches the console', async () => {
    const socket = connect(base)
    await waitEvent(socket, 'console:snapshot')
    const st = await waitEvent<Record<string, any>>(socket, 'console:stats', 7000)
    expect(st.mode).toBe('engine')
    expect(st.events_per_min).toBe(42)
    socket.disconnect()
  }, 10000)

  test('when the engine dies the hub reports sin-motor, not stale data', async () => {
    const socket = connect(base)
    await waitEvent(socket, 'console:snapshot')
    const downStats = waitEvent<Record<string, any>>(socket, 'console:stats', 10000)
    fakeEngine.stop(true)
    await pollUntil(() => hub.state.mode === 'sin-motor', 9000)
    const body = (await (await fetch(`${base}/health`)).json()) as Record<string, any>
    expect(body.status).toBe('degraded')
    expect(body.engine.events_total).toBe(0)
    const st = await downStats
    expect(st.mode).toBe('sin-motor')
    socket.disconnect()
  }, 15000)
})

afterAll(async () => {
  llmMock.stop(true)
})
