'use client'

// Socket.io channel to web/console-service, used ONLY by the AI analyst
// view (ask/step/delta/done/error). Telemetry no longer flows through
// this bus: events, alerts, rules and stats come straight from the
// engine API via use-engine-stream. If console-service is not running
// the rest of the console keeps working; the analyst view shows a real
// offline state.

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import type { Socket } from 'socket.io-client'
import { io } from 'socket.io-client'

export type AnalystConnStatus = 'connecting' | 'live' | 'down'

type AnalystState = {
  status: AnalystConnStatus
  getSocket: () => Socket | null
}

const Ctx = createContext<AnalystState | null>(null)

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

export function AnalystProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AnalystConnStatus>('connecting')
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    const socket = io(consoleServiceUrl(), {
      // keep in sync with the socket.io server path (console-service)
      path: '/',
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1500,
      timeout: 8000,
    })
    socketRef.current = socket

    socket.on('connect', () => setStatus('live'))
    socket.on('disconnect', () => setStatus('down'))
    socket.on('connect_error', () => setStatus('down'))

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [])

  const getSocket = useCallback(() => socketRef.current, [])

  return <Ctx.Provider value={{ status, getSocket }}>{children}</Ctx.Provider>
}

export function useAnalystChannel(): AnalystState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAnalystChannel debe usarse dentro de AnalystProvider')
  return ctx
}
