'use client'

// Live channel to the console-service (socket.io).
// Holds the rolling state every view reads from: events, alerts, stats, rules.

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import type { Socket } from 'socket.io-client'
import { io } from 'socket.io-client'
import type { SfAlert, SfEvent, RuleMeta, SimStats, ConsoleSnapshot, SfSuppression, SfSequence } from '@/lib/console-types'

export type ConnStatus = 'connecting' | 'live' | 'down'

type ConsoleState = {
  status: ConnStatus
  events: SfEvent[]
  alerts: SfAlert[]
  rules: RuleMeta[]
  suppressions: SfSuppression[]
  sequences: SfSequence[]
  stats: SimStats | null
  startedAt: string | null
  getSocket: () => Socket | null
}

const Ctx = createContext<ConsoleState | null>(null)

const MAX_EVENTS = 160
const MAX_ALERTS = 48

// Resolves the console-service endpoint:
//   1. NEXT_PUBLIC_CONSOLE_URL when set (e.g. http://lab-host:3003)
//   2. http://localhost:3003 when developing on this machine
//   3. same origin (reverse proxy in front of console-service, path '/')
function consoleServiceUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_CONSOLE_URL
  if (explicit) return explicit
  if (typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) {
    return 'http://localhost:3003'
  }
  return '/?XTransformPort=3003'
}

export function ConsoleProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<ConnStatus>('connecting')
  const [events, setEvents] = useState<SfEvent[]>([])
  const [alerts, setAlerts] = useState<SfAlert[]>([])
  const [rules, setRules] = useState<RuleMeta[]>([])
  const [suppressions, setSuppressions] = useState<SfSuppression[]>([])
  const [sequences, setSequences] = useState<SfSequence[]>([])
  const [stats, setStats] = useState<SimStats | null>(null)
  const [startedAt, setStartedAt] = useState<string | null>(null)
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    const socket = io(consoleServiceUrl(), {
      // keep in sync with the socket.io server path (console-service)
      path: '/',
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 12,
      reconnectionDelay: 1200,
      timeout: 10000,
    })
    socketRef.current = socket

    socket.on('connect', () => setStatus('live'))
    socket.on('disconnect', () => setStatus('down'))
    socket.on('connect_error', () => setStatus('down'))

    socket.on('console:snapshot', (snap: ConsoleSnapshot) => {
      setEvents(snap.events ?? [])
      setAlerts(snap.alerts ?? [])
      setRules(snap.rules ?? [])
      setSuppressions(snap.suppressions ?? [])
      setSequences(snap.sequences ?? [])
      setStats(snap.stats ?? null)
      setStartedAt(snap.started_at ?? null)
      setStatus('live')
    })
    socket.on('console:event', (ev: SfEvent) => {
      setEvents((prev) => {
        const next = [ev, ...prev]
        return next.length > MAX_EVENTS ? next.slice(0, MAX_EVENTS) : next
      })
    })
    socket.on('console:alert', (al: SfAlert) => {
      setAlerts((prev) => {
        const next = [al, ...prev]
        return next.length > MAX_ALERTS ? next.slice(0, MAX_ALERTS) : next
      })
    })
    socket.on('console:stats', (st: SimStats) => setStats(st))
    socket.on('console:suppressions', (entries: SfSuppression[]) => setSuppressions(entries ?? []))
    socket.on('console:sequences', (seqs: SfSequence[]) => setSequences(seqs ?? []))

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [])

  const getSocket = useCallback(() => socketRef.current, [])

  return (
    <Ctx.Provider value={{ status, events, alerts, rules, suppressions, sequences, stats, startedAt, getSocket }}>
      {children}
    </Ctx.Provider>
  )
}

export function useConsole(): ConsoleState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useConsole debe usarse dentro de ConsoleProvider')
  return ctx
}
