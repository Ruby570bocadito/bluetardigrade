'use client'

// Shared incident list for the shell badge, the alert actions ("añadir a
// incidente") and the Incidentes view. Polled every 5 s and refreshed
// right after each local change; an engine without the incidents API
// (older build) reports `available: false` instead of an empty list.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { listIncidents, type Incident } from '@/lib/engine-writes'

export type IncidentsState = {
  incidents: Incident[]
  persistent: boolean
  available: boolean
  loaded: boolean
  refresh: () => Promise<void>
  /** Insert or replace one incident from a write response. */
  upsert: (incident: Incident) => void
}

const fallback: IncidentsState = {
  incidents: [],
  persistent: false,
  available: false,
  loaded: false,
  refresh: async () => {},
  upsert: () => {},
}

const Ctx = createContext<IncidentsState>(fallback)

const POLL_MS = 5000

export function IncidentsProvider({ children }: { children: ReactNode }) {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [persistent, setPersistent] = useState(false)
  const [available, setAvailable] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    const res = await listIncidents()
    if (!alive.current) return
    setLoaded(true)
    if (res.ok) {
      setIncidents(res.data.incidents ?? [])
      setPersistent(Boolean(res.data.persistent))
      setAvailable(true)
    } else if (res.status === 404 || res.status === 405) {
      setAvailable(false)
      setIncidents([])
    }
    // transport errors keep the last list (the engine status chip says why)
  }, [])

  const upsert = useCallback((incident: Incident) => {
    setIncidents((prev) => [incident, ...prev.filter((i) => i.id !== incident.id)])
  }, [])

  useEffect(() => {
    alive.current = true
    void refresh()
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => {
      alive.current = false
      clearInterval(timer)
    }
  }, [refresh])

  return <Ctx.Provider value={{ incidents, persistent, available, loaded, refresh, upsert }}>{children}</Ctx.Provider>
}

export function useIncidents(): IncidentsState {
  return useContext(Ctx)
}
