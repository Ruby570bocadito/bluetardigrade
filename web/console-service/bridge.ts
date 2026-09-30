// Bridge from the real Go engine's local HTTP API (:7778) into the
// console bus. While the engine is reachable, the hub forwards live
// events and alerts from the SSE stream and polls /api/stats; the
// moment it disappears the hub reports "sin-motor" (no fallback data,
// no simulation). SSE frames are parsed by hand so the same code runs
// on bun and node.

import type { SfEvent, SfAlert, HubStats, RuleMeta, SfSuppression, SfSequence, SfAlertLifecycle, HotHost } from './types'

export type EngineBridgeCallbacks = {
  onEvent: (ev: SfEvent) => void
  onAlert: (al: SfAlert) => void
  onStats: (st: HubStats) => void
  onRules: (rules: RuleMeta[]) => void
  onSuppressions: (entries: SfSuppression[]) => void
  onSequences: (seqs: SfSequence[]) => void
  onLifecycle: (entry: SfAlertLifecycle) => void
  onUp: () => void
  onDown: () => void
}

const RETRY_MS = 3000
const PROBE_TIMEOUT_MS = 1200
// Initial one-shot sync fetches can move up to a full ring buffer of
// events, so they get a larger budget than the liveness probe.
const SYNC_TIMEOUT_MS = 5000
const STATS_POLL_MS = 2000
// Bearer token for the engine API, same env var the engine honors
// (SF_API_TOKEN): when the API is started with -api-token, every /api
// call here must carry it or the bridge would be stuck in 401s. The
// /api/health probe stays open on the engine side, so connectivity
// checks work before this value is even read.
const API_TOKEN = process.env.SF_API_TOKEN || ''

function authHeaders(): Record<string, string> {
  return API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}
}

// Header-phase budget for the SSE stream itself (see establish()).
const STREAM_HEADERS_TIMEOUT_MS = 8000

export type EngineBridgeOptions = {
  /** Engine API root override (tests). Default: ENGINE_API env or 127.0.0.1:7778. */
  engineApi?: string
  /** How many events to replay on connect; matches the hub ring buffer. */
  maxEvents?: number
  /** How many alerts to replay on connect; matches the hub ring buffer. */
  maxAlerts?: number
  /** Retry delay between reconnect attempts (tests use a small value). */
  retryMs?: number
}

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
  private maxEvents: number
  private maxAlerts: number
  private retryMs: number
  private ctrl: AbortController | null = null
  private statsTimer: ReturnType<typeof setInterval> | null = null
  private stopped = false
  // last suppressions / sequences JSON seen, so the hub only re-emits
  // on real changes (both change on 15 s hot-reloads, not every poll).
  // The caches are reset on every (re)connect — see establish().
  private lastSuppressions = ''
  private lastSequences = ''

  constructor(
    private cb: EngineBridgeCallbacks,
    options: EngineBridgeOptions = {},
  ) {
    this.base = options.engineApi ?? process.env.ENGINE_API ?? 'http://127.0.0.1:7778'
    this.maxEvents = options.maxEvents ?? 160
    this.maxAlerts = options.maxAlerts ?? 48
    this.retryMs = options.retryMs ?? RETRY_MS
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
    this.lastSuppressions = ''
    this.lastSequences = ''
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
      await sleep(this.retryMs)
    }
  }

  private async probe(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/api/health`, { signal: shortTimeout(PROBE_TIMEOUT_MS), headers: authHeaders() })
      return res.ok
    } catch {
      return false
    }
  }

  private async establish() {
    if (!(await this.probe())) throw new Error('engine api not reachable')

    // every (re)connect resets the change-only caches: consumers cleared
    // their lists on engine-down (onDown pushes []), so a payload
    // identical to the pre-flap one must STILL be re-emitted after the
    // engine returns — otherwise Cadenas/Supresiones-style consumers
    // would stay empty until the YAML files actually change. The
    // one-shot sync below already re-pulls rules/events/alerts
    // unconditionally; this keeps the polled lists on the same contract.
    this.lastSuppressions = ''
    this.lastSequences = ''

    // one-shot sync of the current state before going live
    const [rules, events, alerts] = await Promise.all([
      this.getJson<unknown[]>(`${this.base}/api/rules`),
      this.getJson<unknown[]>(`${this.base}/api/events?limit=${this.maxEvents}`),
      this.getJson<unknown[]>(`${this.base}/api/alerts?limit=${this.maxAlerts}`),
    ])
    this.cb.onRules(rules.map((r) => mapRule(r as Record<string, unknown>)))
    // API returns newest first; replay oldest first so the ring order holds
    for (let i = events.length - 1; i >= 0; i--) this.cb.onEvent(events[i] as SfEvent)
    for (let i = alerts.length - 1; i >= 0; i--) this.cb.onAlert(mapAlert(alerts[i] as Record<string, unknown>))

    this.ctrl = new AbortController()
    // Bound only the header phase: a server that accepts the request but
    // never flushes headers (or an idle proxy) must not hang the bridge
    // forever. Once headers arrive the race is decided and the signal
    // keeps governing the whole stream lifetime as before.
    const res = await Promise.race([
      fetch(`${this.base}/api/stream`, { signal: this.ctrl.signal, headers: authHeaders() }),
      new Promise<never>((_, reject) => {
        const t = setTimeout(() => reject(new Error('engine stream: no headers')), STREAM_HEADERS_TIMEOUT_MS)
        t.unref?.()
      }),
    ])
    if (!res.ok || !res.body) throw new Error(`stream failed (${res.status})`)

    this.cb.onUp()
    this.pullStats()
    this.statsTimer = setInterval(() => this.pullStats(), STATS_POLL_MS)
    await this.pumpSSE(res.body)
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.statsTimer = null
  }

  private async pullSuppressions() {
    // Best effort: the suppressions view is secondary telemetry. A
    // transient failure here must not flap the engine-up/down state,
    // which only the stats poll and the SSE stream are allowed to touch.
    try {
      const raw = await this.getJson<Record<string, unknown>>(`${this.base}/api/suppressions`)
      const entries = (raw.entries as SfSuppression[]) ?? []
      const json = JSON.stringify(entries)
      if (json === this.lastSuppressions) return
      this.lastSuppressions = json
      this.cb.onSuppressions(entries)
    } catch {
      /* transient; reported like any other stats poll hiccup */
    }
  }

  private async pullSequences() {
    // Same contract as suppressions: secondary telemetry, change-only
    // re-emit, transient failures stay silent. Sequences only change on
    // the engine's 15 s hot-reload of the sequences/ directory.
    try {
      const seqs = await this.getJson<SfSequence[]>(`${this.base}/api/sequences`)
      const json = JSON.stringify(seqs)
      if (json === this.lastSequences) return
      this.lastSequences = json
      this.cb.onSequences(seqs ?? [])
    } catch {
      /* transient */
    }
  }

  private async getJson<T>(url: string, timeoutMs = SYNC_TIMEOUT_MS): Promise<T> {
    const res = await fetch(url, { signal: shortTimeout(timeoutMs), headers: authHeaders() })
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
    await this.pullSuppressions()
    await this.pullSequences()
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
      else if (topic === 'alert_lifecycle') this.cb.onLifecycle(payload as SfAlertLifecycle)
    } catch {
      /* malformed frame: ignore */
    }
  }
}

// ---------------------------------------------------------------- mappers

function mapStats(st: Record<string, unknown>): HubStats {
  return {
    events_total: Number(st.events_total ?? 0),
    alerts_total: Number(st.alerts_total ?? 0),
    by_severity: (st.by_severity as Record<string, number>) ?? {},
    events_per_min: Number(st.events_per_min ?? 0),
    uptime_s: Number(st.uptime_s ?? 0),
    interval_ms: 0,
    mode: 'engine',
    webhook_sent: Number(st.webhook_sent ?? 0),
    webhook_failed: Number(st.webhook_failed ?? 0),
    webhook_dropped: Number(st.webhook_dropped ?? 0),
    suppressions_active: Number(st.suppressions_active ?? 0),
    correlator_states: Number(st.correlator_states ?? 0),
    correlator_sequences: Number(st.correlator_sequences ?? 0),
    correlator_cap: Number(st.correlator_cap ?? 0),
    // optional SQLite persistence (-store): both type contracts declare
    // these as "forwarded by the hub when the engine reports it" —
    // actually forward them
    store_enabled: st.store_enabled === true,
    store_events: Number(st.store_events ?? 0),
    store_alerts: Number(st.store_alerts ?? 0),
    // per-host risk scoring (engine A1): every entry is sanitized —
    // a malformed row (host not a non-empty string, score not a finite
    // number) is dropped here, never forwarded to the console
    risk_hosts_tracked: Number(st.risk_hosts_tracked ?? 0),
    hot_hosts: mapHotHosts(st.hot_hosts),
  }
}

function mapHotHosts(raw: unknown): HotHost[] {
  if (!Array.isArray(raw)) return []
  const out: HotHost[] = []
  for (const e of raw) {
    const h = e as Record<string, unknown>
    if (typeof h.host !== 'string' || h.host === '') continue
    const score = Number(h.score)
    if (!Number.isFinite(score)) continue
    out.push({
      host: h.host,
      score,
      alerts: Number(h.alerts ?? 0),
      last_seen: String(h.last_seen ?? ''),
    })
  }
  return out
}

function mapAlert(a: Record<string, unknown>): SfAlert {
  const severity = String(a.severity ?? 'low')
  const known: SfAlert['severity'][] = ['critical', 'high', 'medium', 'low']
  return {
    // engine-assigned alert id (r6, the lifecycle key); older engines
    // without it fall back to the event+rule synthesized id
    id: a.id ? String(a.id) : `${String(a.event_id)}:${String(a.rule_id)}`,
    timestamp: String(a.timestamp ?? new Date().toISOString()),
    rule_id: String(a.rule_id ?? ''),
    rule_name: String(a.rule_name ?? ''),
    severity: (known.includes(severity as SfAlert['severity']) ? severity : 'low') as SfAlert['severity'],
    host: String(a.host ?? ''),
    user: a.user ? String(a.user) : undefined,
    event_id: String(a.event_id ?? ''),
    event_type: String(a.event_type ?? ''),
    summary: String(a.summary ?? ''),
    message: a.message ? String(a.message) : undefined,
    notify: a.notify === true,
    matched_on: (a.matched_on as string[]) ?? [],
    tags: (a.tags as string[]) ?? [],
    // lifecycle overlay (GET /api/alerts merges it read-side)
    status: isStatus(a.status) ? (a.status as SfAlert['status']) : undefined,
    status_note: a.status_note ? String(a.status_note) : undefined,
    status_by: a.status_by ? String(a.status_by) : undefined,
    status_at: a.status_at ? String(a.status_at) : undefined,
  }
}

function isStatus(v: unknown): boolean {
  return v === 'new' || v === 'acknowledged' || v === 'closed'
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
