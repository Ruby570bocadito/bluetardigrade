// Bridge from the real Go engine's local HTTP API (:7778) into the
// console bus. While the engine is reachable, the hub forwards live
// events and alerts from the SSE stream and polls /api/stats; the
// moment it disappears, the caller restarts the simulator. SSE frames
// are parsed by hand so the same code runs on bun and node.

import type { SfEvent, SfAlert, SimStats, RuleMeta } from './sim'

export type EngineBridgeCallbacks = {
  onEvent: (ev: SfEvent) => void
  onAlert: (al: SfAlert) => void
  onStats: (st: SimStats) => void
  onRules: (rules: RuleMeta[]) => void
  onUp: () => void
  onDown: () => void
}

const RETRY_MS = 3000
const PROBE_TIMEOUT_MS = 1200
const STATS_POLL_MS = 2000

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function shortTimeout(ms: number): AbortSignal {
  // AbortSignal.timeout is missing in some runtimes; fall back manually
  const c = new AbortController()
  setTimeout(() => c.abort(), ms)
  return c.signal
}

export class EngineBridge {
  private base: string
  private ctrl: AbortController | null = null
  private statsTimer: ReturnType<typeof setInterval> | null = null
  private stopped = false

  constructor(private cb: EngineBridgeCallbacks) {
    this.base = process.env.ENGINE_API || 'http://127.0.0.1:7778'
  }

  get endpoint(): string {
    return this.base
  }

  stop() {
    this.stopped = true
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.statsTimer = null
    this.ctrl?.abort()
    this.ctrl = null
  }

  /** Connects, subscribes and keeps retrying until stop(). Never throws. */
  async start() {
    this.stopped = false
    while (!this.stopped) {
      try {
        await this.establish()
      } catch {
        /* probe/stream failure: fall through to retry */
      }
      if (this.stopped) break
      this.cb.onDown()
      await sleep(RETRY_MS)
    }
  }

  private async probe(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/api/health`, { signal: shortTimeout(PROBE_TIMEOUT_MS) })
      return res.ok
    } catch {
      return false
    }
  }

  private async establish() {
    if (!(await this.probe())) throw new Error('engine api not reachable')

    // one-shot sync of the current state before going live
    const [rules, events, alerts] = await Promise.all([
      this.getJson<unknown[]>(`${this.base}/api/rules`),
      this.getJson<unknown[]>(`${this.base}/api/events?limit=160`),
      this.getJson<unknown[]>(`${this.base}/api/alerts?limit=48`),
    ])
    this.cb.onRules(rules.map(mapRule))
    // API returns newest first; replay oldest first so the ring order holds
    for (let i = events.length - 1; i >= 0; i--) this.cb.onEvent(events[i] as SfEvent)
    for (let i = alerts.length - 1; i >= 0; i--) this.cb.onAlert(mapAlert(alerts[i]))

    this.ctrl = new AbortController()
    const res = await fetch(`${this.base}/api/stream`, { signal: this.ctrl.signal })
    if (!res.ok || !res.body) throw new Error(`stream failed (${res.status})`)

    this.cb.onUp()
    this.pullStats()
    this.statsTimer = setInterval(() => this.pullStats(), STATS_POLL_MS)
    await this.pumpSSE(res.body)
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.statsTimer = null
  }

  private async getJson<T>(url: string): Promise<T> {
    const res = await fetch(url, { signal: shortTimeout(PROBE_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`${url} -> ${res.status}`)
    return (await res.json()) as T
  }

  private async pullStats() {
    try {
      const st = await this.getJson<Record<string, unknown>>(`${this.base}/api/stats`)
      this.cb.onStats(mapStats(st))
    } catch {
      /* transient; the SSE stream will signal a real disconnection */
    }
  }

  private async pumpSSE(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        this.handleFrame(frame)
      }
    }
    throw new Error('sse stream closed')
  }

  private handleFrame(frame: string) {
    let topic = ''
    let data = ''
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) topic = line.slice(6).trim()
      else if (line.startsWith('data:')) data += line.slice(5).trim()
    }
    if (!topic || !data) return
    try {
      const payload = JSON.parse(data)
      if (topic === 'event') this.cb.onEvent(payload as SfEvent)
      else if (topic === 'alert') this.cb.onAlert(mapAlert(payload))
    } catch {
      /* malformed frame: ignore */
    }
  }
}

// ---------------------------------------------------------------- mappers

function mapStats(st: Record<string, unknown>): SimStats {
  return {
    events_total: Number(st.events_total ?? 0),
    alerts_total: Number(st.alerts_total ?? 0),
    by_severity: (st.by_severity as Record<string, number>) ?? {},
    events_per_min: Number(st.events_per_min ?? 0),
    uptime_s: Number(st.uptime_s ?? 0),
    interval_ms: 0,
    mode: 'engine',
  }
}

function mapAlert(a: Record<string, unknown>): SfAlert {
  const severity = String(a.severity ?? 'low')
  const known: SfAlert['severity'][] = ['critical', 'high', 'medium', 'low']
  return {
    // engine alerts have no id of their own: event + rule is unique
    id: `${String(a.event_id)}:${String(a.rule_id)}`,
    timestamp: String(a.timestamp ?? new Date().toISOString()),
    rule_id: String(a.rule_id ?? ''),
    rule_name: String(a.rule_name ?? ''),
    severity: (known.includes(severity as SfAlert['severity']) ? severity : 'low') as SfAlert['severity'],
    host: String(a.host ?? ''),
    user: a.user ? String(a.user) : undefined,
    event_id: String(a.event_id ?? ''),
    event_type: String(a.event_type ?? ''),
    summary: String(a.summary ?? ''),
    matched_on: (a.matched_on as string[]) ?? [],
    tags: (a.tags as string[]) ?? [],
  }
}

function mapRule(r: Record<string, unknown>): RuleMeta {
  const tags = (r.tags as string[]) ?? []
  const mitreTag = tags.find((t) => /^attack\.t\d/.test(t))
  const tacticTag = tags.find((t) => /^attack\./.test(t) && !/^attack\.t\d/.test(t))
  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    description: String(r.description ?? ''),
    severity: (r.severity as RuleMeta['severity']) ?? 'low',
    event_type: String(r.event_type ?? ''),
    mitre: mitreTag ? mitreTag.replace('attack.', '').toUpperCase() : '',
    tactic: tacticTag
      ? tacticTag
          .replace('attack.', '')
          .split('-')
          .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
          .join(' ')
      : '',
    tags,
    conditions: ((r.conditions as RuleMeta['conditions']) ?? []).map((c) => ({
      field: String(c.field),
      operator: String(c.operator),
      value: c.value as string | string[],
    })),
  }
}
