'use client'

// One shared, bounded SSE + REST connection. The engine owns all
// counters; snapshots merge with frames received during resync.
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  EngineStats, RuleMeta, SfAlert, SfAlertLifecycle, SfEvent,
  SfRespondAudit, SfRespondState, SfSequence, SfSuppression,
} from '@/lib/console-types'
import { severityOf } from '@/lib/console-types'
import {
  alertKey, engineDisplayEndpoint, mergeNewest, prependLive,
  readEngineJson, readOptionalEngineJson, settledBatch,
} from '@/lib/engine-client'

export type EngineStatus = 'connecting' | 'live' | 'down'
export type StreamStatus = 'connecting' | 'live' | 'retrying' | 'down'

export type EngineState = {
  status: EngineStatus
  streamStatus: StreamStatus
  lastSyncAt: number | null
  refreshing: boolean
  refresh: () => void
  events: SfEvent[]
  alerts: SfAlert[]
  rules: RuleMeta[]
  suppressions: SfSuppression[]
  sequences: SfSequence[]
  respondState: SfRespondState | null
  respondAudit: SfRespondAudit | null
  auditLimit: 100 | 500
  setAuditLimit: (n: 100 | 500) => void
  stats: EngineStats | null
  endpoint: string
}

const STATS_POLL_MS = 2000
const REBOOT_DELAY_MS = 3000
const MAX_EVENTS = 300
const MAX_ALERTS = 128

function engineApiBase(): string {
  return process.env.NEXT_PUBLIC_ENGINE_API || '/api/engine'
}

function mapAlert(raw: Record<string, unknown>): SfAlert {
  const tags = Array.isArray(raw.tags) ? (raw.tags as string[]) : []
  const matched = Array.isArray(raw.matched_on) ? (raw.matched_on as string[]) : []
  const status = raw.status
  return {
    id: raw.id ? String(raw.id) : undefined,
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
    status: status === 'new' || status === 'acknowledged' || status === 'closed' ? status : undefined,
    status_note: raw.status_note ? String(raw.status_note) : undefined,
    status_by: raw.status_by ? String(raw.status_by) : undefined,
    status_at: raw.status_at ? String(raw.status_at) : undefined,
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
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('connecting')
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [events, setEvents] = useState<SfEvent[]>([])
  const [alerts, setAlerts] = useState<SfAlert[]>([])
  const [rules, setRules] = useState<RuleMeta[]>([])
  const [suppressions, setSuppressions] = useState<SfSuppression[]>([])
  const [sequences, setSequences] = useState<SfSequence[]>([])
  const [respondState, setRespondState] = useState<SfRespondState | null>(null)
  const [respondAudit, setRespondAudit] = useState<SfRespondAudit | null>(null)
  const [auditLimit, setAuditLimitState] = useState<100 | 500>(100)
  const [stats, setStats] = useState<EngineStats | null>(null)
  const [endpoint] = useState(() => engineDisplayEndpoint(engineApiBase()))
  const auditLimitRef = useRef<100 | 500>(100)
  const refreshRef = useRef<(() => void) | null>(null)
  const refresh = useCallback(() => refreshRef.current?.(), [])

  function setAuditLimit(n: 100 | 500): void {
    auditLimitRef.current = n
    setAuditLimitState(n)
  }

  useEffect(() => {
    let disposed = false
    let offline = true
    let failures = 0
    let lastUptime: number | null = null
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let es: EventSource | null = null
    let syncPending: Promise<boolean> | null = null
    let syncEvents: SfEvent[] = []
    let syncAlerts: SfAlert[] = []
    let syncLifecycle: SfAlertLifecycle[] = []
    const ctrl = new AbortController()
    const base = engineApiBase()
    const getJson = <T,>(path: string) => readEngineJson<T>(base, path, ctrl.signal)
    const optional = <T,>(path: string) => readOptionalEngineJson<T>(base, path, ctrl.signal)

    function clearTelemetry() {
      setStats(null)
      setEvents([])
      setAlerts([])
      setRules([])
      setSuppressions([])
      setSequences([])
      setRespondState(null)
      setRespondAudit(null)
    }

    function markDown() {
      if (disposed) return
      offline = true
      setStatus('down')
      setStreamStatus('down')
      clearTelemetry()
    }

    function applyLifecycle(list: SfAlert[], entry: SfAlertLifecycle): SfAlert[] {
      return list.map((a) => a.id === entry.alert_id
        ? { ...a, status: entry.status, status_note: entry.note, status_by: entry.by, status_at: entry.at }
        : a)
    }

    async function performSync(): Promise<boolean> {
      setRefreshing(true)
      syncEvents = []
      syncAlerts = []
      syncLifecycle = []
      try {
        const [rs, evs, als, st, sup, seq, response, audit] = await settledBatch([
          getJson<Record<string, unknown>[]>('/api/rules'),
          getJson<SfEvent[]>('/api/events?limit=' + MAX_EVENTS),
          getJson<Record<string, unknown>[]>('/api/alerts?limit=' + MAX_ALERTS),
          getJson<EngineStats>('/api/stats'),
          optional<{ entries?: SfSuppression[] }>('/api/suppressions'),
          optional<SfSequence[]>('/api/sequences'),
          optional<SfRespondState>('/api/respond/state'),
          optional<SfRespondAudit>('/api/respond/audit?limit=' + auditLimitRef.current),
        ])
        if (disposed) return false
        const receivedEvents = [...syncEvents]
        const receivedAlerts = [...syncAlerts]
        const decisions = [...syncLifecycle]
        setEvents(mergeNewest(receivedEvents, evs, (e) => e.id, MAX_EVENTS))
        // REST includes the lifecycle overlay; raw alert frames do not.
        // A duplicate received during sync must not erase that decision.
        let merged = mergeNewest(als.map(mapAlert), receivedAlerts, alertKey, MAX_ALERTS)
        for (const decision of decisions) merged = applyLifecycle(merged, decision)
        setAlerts(merged)
        setRules(rs.map(mapRule))
        setStats(st)
        if (sup !== undefined) setSuppressions(sup?.entries ?? [])
        if (seq !== undefined) setSequences(seq ?? [])
        if (response !== undefined) setRespondState(response)
        if (audit !== undefined) setRespondAudit(audit)
        lastUptime = st.uptime_s
        failures = 0
        offline = false
        setStatus('live')
        setLastSyncAt(Date.now())
        if (es) setStreamStatus(es.readyState === EventSource.OPEN ? 'live' : 'retrying')
        return true
      } catch {
        return false
      } finally {
        if (!disposed) setRefreshing(false)
      }
    }

    // Initial handshake, SSE reconnect and manual refresh share one
    // in-flight snapshot, preventing out-of-order full-sync overwrites.
    function syncAll(): Promise<boolean> {
      if (syncPending) return syncPending
      syncPending = performSync().finally(() => { syncPending = null })
      return syncPending
    }
    refreshRef.current = () => { void syncAll().then((ok) => { if (!ok) markDown() }) }

    async function poll() {
      try {
        if (syncPending) {
          await syncPending
          return
        }
        const [st, rs, sup, seq, response, audit] = await settledBatch([
          getJson<EngineStats>('/api/stats'),
          getJson<Record<string, unknown>[]>('/api/rules'),
          optional<{ entries?: SfSuppression[] }>('/api/suppressions'),
          optional<SfSequence[]>('/api/sequences'),
          optional<SfRespondState>('/api/respond/state'),
          optional<SfRespondAudit>('/api/respond/audit?limit=' + auditLimitRef.current),
        ])
        if (disposed) return
        if (syncPending) {
          await syncPending
          return
        }
        const restarted = lastUptime !== null && st.uptime_s < lastUptime
        if (offline || restarted) {
          if (restarted) clearTelemetry()
          if (!(await syncAll())) throw new Error('resync failed')
          return
        }
        setStats(st)
        setRules(rs.map(mapRule)) // hot reload also refreshes the catalogue
        if (sup !== undefined) setSuppressions(sup?.entries ?? [])
        if (seq !== undefined) setSequences(seq ?? [])
        if (response !== undefined) setRespondState(response)
        if (audit !== undefined) setRespondAudit(audit)
        lastUptime = st.uptime_s
        failures = 0
        setStatus('live')
        setLastSyncAt(Date.now())
      } catch {
        if (++failures >= 2) markDown()
      } finally {
        // Schedule AFTER completion: slow requests never overlap polls.
        if (!disposed) pollTimer = setTimeout(() => { void poll() }, STATS_POLL_MS)
      }
    }

    function startStream() {
      es = new EventSource(base + '/api/stream')
      es.addEventListener('event', (frame: MessageEvent<string>) => {
        if (disposed || (offline && !syncPending)) return
        try {
          const ev = JSON.parse(frame.data) as SfEvent
          if (!ev || typeof ev.id !== 'string' || typeof ev.timestamp !== 'string') return
          if (syncPending) syncEvents = [ev, ...syncEvents].slice(0, MAX_EVENTS)
          if (!offline) setEvents((prev) => prependLive(ev, prev, (e) => e.id, MAX_EVENTS))
        } catch { /* malformed frame */ }
      })
      es.addEventListener('alert', (frame: MessageEvent<string>) => {
        if (disposed || (offline && !syncPending)) return
        try {
          const raw = JSON.parse(frame.data) as Record<string, unknown>
          if (!raw || typeof raw.rule_id !== 'string' || typeof raw.timestamp !== 'string') return
          const al = mapAlert(raw)
          if (syncPending) syncAlerts = [al, ...syncAlerts].slice(0, MAX_ALERTS)
          if (!offline) setAlerts((prev) => prependLive(al, prev, alertKey, MAX_ALERTS))
          // Stats stay authoritative: SSE replay must not inflate totals.
        } catch { /* malformed frame */ }
      })
      es.addEventListener('alert_lifecycle', (frame: MessageEvent<string>) => {
        if (disposed || (offline && !syncPending)) return
        try {
          const entry = JSON.parse(frame.data) as SfAlertLifecycle
          if (!entry || !['new', 'acknowledged', 'closed'].includes(entry.status)) return
          if (syncPending) syncLifecycle = [...syncLifecycle, entry].slice(-MAX_ALERTS)
          if (!offline) setAlerts((prev) => applyLifecycle(prev, entry))
        } catch { /* malformed frame */ }
      })
      es.onopen = () => {
        if (disposed) return
        setStreamStatus('live')
        void syncAll() // repair gaps on every browser-side reconnect
      }
      es.onerror = () => {
        if (!disposed) setStreamStatus(offline ? 'down' : 'retrying')
      }
    }

    async function boot() {
      if (disposed) return
      if (!(await syncAll())) {
        markDown()
        if (!disposed) retryTimer = setTimeout(() => { void boot() }, REBOOT_DELAY_MS)
        return
      }
      if (disposed) return
      startStream()
      pollTimer = setTimeout(() => { void poll() }, STATS_POLL_MS)
    }
    void boot()

    return () => {
      disposed = true
      refreshRef.current = null
      ctrl.abort()
      es?.close()
      if (pollTimer) clearTimeout(pollTimer)
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [])

  return {
    status, streamStatus, lastSyncAt, refreshing, refresh,
    events, alerts, rules, suppressions, sequences, respondState,
    respondAudit, auditLimit, setAuditLimit, stats, endpoint,
  }
}
