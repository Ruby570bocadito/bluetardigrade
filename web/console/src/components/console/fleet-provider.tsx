'use client'

// Shared machine inventory (engine GET /api/fleet) for the Equipos view
// and the sidebar badge of silent sensors, with the enrollment state
// (GET /api/enroll: tokens and machines waiting for approval). Polled
// every 10 s; an engine without the endpoint (older build) reports
// `available: false`.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { fetchFleet, type FleetPayload } from '@/lib/fleet'
import { fetchEnroll, type EnrollState } from '@/lib/enroll'

export type FleetState = {
  fleet: FleetPayload | null
  available: boolean
  loaded: boolean
  /** enrollment state; null while unknown or on an engine without it */
  enroll: EnrollState | null
  refresh: () => Promise<void>
}

const fallback: FleetState = { fleet: null, available: false, loaded: false, enroll: null, refresh: async () => {} }
const Ctx = createContext<FleetState>(fallback)
const POLL_MS = 10_000

export function FleetProvider({ children }: { children: ReactNode }) {
  const [fleet, setFleet] = useState<FleetPayload | null>(null)
  const [available, setAvailable] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [enroll, setEnroll] = useState<EnrollState | null>(null)
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    const [res, enr] = await Promise.all([fetchFleet(), fetchEnroll()])
    if (!alive.current) return
    if (enr.ok && enr.data && Array.isArray(enr.data.hosts)) setEnroll(enr.data)
    else if (!enr.ok && (enr.status === 404 || enr.status === 405 || enr.status === 0)) setEnroll(null)
    setLoaded(true)
    if (res.ok && res.data && Array.isArray(res.data.hosts)) {
      setFleet(res.data)
      setAvailable(true)
    } else if (!res.ok && (res.status === 404 || res.status === 405)) {
      setFleet(null)
      setAvailable(false)
    } else if (!res.ok && res.status === 0) {
      // engine unreachable: an inventory from before the outage would lie
      setFleet(null)
    }
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

  return <Ctx.Provider value={{ fleet, available, loaded, enroll, refresh }}>{children}</Ctx.Provider>
}

export function useFleet(): FleetState {
  return useContext(Ctx)
}
