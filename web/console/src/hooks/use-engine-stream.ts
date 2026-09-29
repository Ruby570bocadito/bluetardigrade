'use client'

// Live channel to the Go engine's local API (internal/api, :7778).
//
//   - /api/stream   SSE: pushes every new event and alert as it happens
//   - /api/stats    polled every 2s (uptime, counters, severity breakdown)
//   - /api/events, /api/alerts, /api/rules   one-shot sync and gap fill
//
// All requests go through the same-origin proxy route (src/app/api/engine)
// so the engine needs no CORS configuration. Liveness is decided by the
// stats poll: if the engine stops answering, the console drops to a real
// "offline" state and never invents data.

import { useEffect, useRef, useState } from 'react'
import type { EngineStats, RuleMeta, SfAlert, SfEvent, SfSequence, SfSuppression } from '@/lib/console-types'
import { severityOf } from '@/lib/console-types'

export type EngineStatus = 'connecting' | 'live' | 'down'

export type EngineState = {
  status: EngineStatus
  events: SfEvent[]
  alerts: SfAlert[]
  rules: RuleMeta[]
  suppressions: SfSuppression[]
  sequences: SfSequence[]
  stats: EngineStats | null
  endpoint: string
}

const STATS_POLL_MS = 2000
const REBOOT_DELAY_MS = 3000
const MAX_EVENTS = 300
const MAX_ALERTS = 128

// Same-origin proxy by default; NEXT_PUBLIC_ENGINE_API allows a direct
// URL (only useful when the engine itself serves CORS).
function engineApiBase(): string {
  return process.env.NEXT_PUBLIC_ENGINE_API || '/api/engine'
}

function engineDisplayEndpoint(): string {
  return (process.env.ENGINE_API_URL || '127.0.0.1:7778').replace(/^https?:\/\//, '')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// The engine does not assign ids to alerts: event_id + rule_id is the
// key. A monotonic counter keeps React keys unique even if the engine
// ever replays the same pair.
let alertSeq = 0
function mapAlert(raw: Record<string, unknown>): SfAlert {
  alertSeq += 1
  const tags = Array.isArray(raw.tags) ? (raw.tags as string[]) : []
  const matched = Array.isArray(raw.matched_on) ? (raw.matched_on as string[]) : []
  return {
    timestamp: String(raw.timestamp ?? ''),
    rule_id: String(raw.rule_id ?? ''),
    rule_name: String(raw.rule_name ?? ''),
    severity: severityOf(typeof raw.severity === 'string' ? raw.severity : undefined),
    host: String(raw.host ?? ''),
    user: raw.user ? String(raw.user) : undefined,
    event_id: String(raw.event_id ?? ''),
    event_type: String(raw.event_type ?? ''),
    summary: String(raw.summary ?? ''),
    message: raw.message ? String(raw.message) : undefined,
    notify: raw.notify === true,
    matched_on: matched,
    tags,
    actions: Array.isArray(raw.actions) ? (raw.actions as string[]) : undefined,
    enrichment: (raw.enrichment as Record<string, string>) ?? undefined,
  }
}

function mapRule(raw: Record<string, unknown>): RuleMeta {
  const tags = Array.isArray(raw.tags) ? (raw.tags as string[]) : []
  const conditions = Array.isArray(raw.conditions) ? (raw.conditions as RuleMeta['conditions']) : []
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    description: String(raw.description ?? ''),
    severity: severityOf(typeof raw.severity === 'string' ? raw.severity : undefined),
    event_type: String(raw.event_type ?? ''),
    mitre: String(raw.mitre ?? ''),
    tactic: String(raw.tactic ?? ''),
    tags,
    conditions: conditions.map((c) => ({
      field: String(c.field ?? ''),
      operator: String(c.operator ?? ''),
      value: c.value as string | string[],
    })),
  }
}

export function useEngineStream(): EngineState {
  const [status, setStatus] = useState<EngineStatus>('connecting')
  const [events, setEvents] = useState<SfEvent[]>([])
  const [alerts, setAlerts] = useState<SfAlert[]>([])
  const [rules, setRules] = useState<RuleMeta[]>([])
  const [suppressions, setSuppressions] = useState<SfSuppression[]>([])
  const [sequences, setSequences] = useState<SfSequence[]>([])
  const [stats, setStats] = useState<EngineStats | null>(null)
  const [endpoint] = useState(engineDisplayEndpoint)
  const failures = useRef(0)

  useEffect(() => {
    let disposed = false
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let es: EventSource | null = null
    const ctrl = new AbortController()
    const base = engineApiBase()

    async function getJson<T>(path: string): Promise<T> {
      const res = await fetch(`${base}${path}`, { signal: ctrl.signal, cache: 'no-store' })
      if (!res.ok) throw new Error(`${path} -> ${res.status}`)
      return (await res.json()) as T
    }

    // Full sync of the engine rings; false means the engine is unreachable.
    async function syncAll(): Promise<boolean> {
      try {
        const [ruleList, eventList, alertList, statsPayload, suppressionPayload, sequencePayload] = await Promise.all([
          getJson<Record<string, unknown>[]>('/api/rules'),
          getJson<Record<string, unknown>[]>('/api/events?limit=160'),
          getJson<Record<string, unknown>[]>('/api/alerts?limit=100'),
          getJson<EngineStats>('/api/stats'),
          // {active, entries} per internal/api suppressPayload; [] if the
          // engine predates the endpoint (suppressions view simply empties)
          getJson<{ active?: number; entries?: SfSuppression[] }>('/api/suppressions').catch(() => null),
          // kill-chain sequences; [] on engines without the endpoint
          getJson<SfSequence[]>('/api/sequences').catch(() => null),
        ])
        if (disposed) return true
        setRules(ruleList.map(mapRule))
        // REST answers newest first; the UI expects newest first too
        setEvents(eventList.slice(0, MAX_EVENTS) as SfEvent[])
        setAlerts(alertList.map(mapAlert).slice(0, MAX_ALERTS))
        setStats(statsPayload)
        setSuppressions(Array.isArray(suppressionPayload?.entries) ? suppressionPayload.entries : [])
        setSequences(Array.isArray(sequencePayload) ? sequencePayload : [])
        failures.current = 0
        setStatus('live')
        return true
      } catch {
        return false
      }
    }

    // Liveness watchdog: while this poll gets answers the console is live.
    function startPolling() {
      if (pollTimer) return
      pollTimer = setInterval(async () => {
        try {
          const [st, sup, seq] = await Promise.all([
            getJson<EngineStats>('/api/stats'),
            getJson<{ active?: number; entries?: SfSuppression[] }>('/api/suppressions').catch(() => null),
            getJson<SfSequence[]>('/api/sequences').catch(() => null),
          ])
          if (disposed) return
          setStats(st)
          if (sup && Array.isArray(sup.entries)) setSuppressions(sup.entries)
          if (Array.isArray(seq)) setSequences(seq)
          failures.current = 0
          setStatus('live')
        } catch {
          failures.current += 1
          if (failures.current >= 2 && !disposed) {
            setStatus('down')
            setStats(null)
            setSuppressions([]) // honest empty state: no engine, no data
            setSequences([])
          }
        }
      }, STATS_POLL_MS)
    }

    function startStream() {
      es = new EventSource(`${base}/api/stream`)
      const onFrame = (topic: 'event' | 'alert') => (e: MessageEvent<string>) => {
        try {
          const payload = JSON.parse(e.data) as Record<string, unknown>
          if (topic === 'event') {
            const ev = payload as unknown as SfEvent
            setEvents((prev) => {
              if (prev.some((x) => x.id === ev.id)) return prev
              const next = [ev, ...prev]
              return next.length > MAX_EVENTS ? next.slice(0, MAX_EVENTS) : next
            })
          } else {
            const al = mapAlert(payload)
            setAlerts((prev) => {
              const next = [al, ...prev]
              return next.length > MAX_ALERTS ? next.slice(0, MAX_ALERTS) : next
            })
            // keep the counters moving between stats polls
            setStats((prev) =>
              prev
                ? {
                    ...prev,
                    alerts_total: prev.alerts_total + 1,
                    by_severity: { ...prev.by_severity, [al.severity]: (prev.by_severity[al.severity] ?? 0) + 1 },
                  }
                : prev,
            )
          }
        } catch {
          /* malformed frame: ignore */
        }
      }
      es.addEventListener('event', onFrame('event'))
      es.addEventListener('alert', onFrame('alert'))
      es.onopen = () => {
        // first open or browser-side reconnect: fill any gap in the rings
        void syncAll()
      }
      es.onerror = () => {
        /* EventSource retries on its own; the poller owns the status */
      }
    }

    async function boot() {
      // Keep retrying the handshake until the engine answers for real.
      for (;;) {
        if (disposed) return
        const ok = await syncAll()
        if (disposed) return
        if (ok) break
        setStatus('down')
        setStats(null)
        await sleep(REBOOT_DELAY_MS)
      }
      startStream()
      startPolling()
    }

    void boot()

    return () => {
      disposed = true
      ctrl.abort()
      es?.close()
      if (pollTimer) clearInterval(pollTimer)
    }
  }, [])

  return { status, events, alerts, rules, suppressions, sequences, stats, endpoint }
}
