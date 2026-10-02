'use client'

// Single shared instance of the engine stream (SSE + REST polling) for
// the whole console tree. One connection per page, never one per view.
// The provider also keeps the short /api/stats history the stat tiles
// chart: it lives here so switching views does not reset the trends.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useEngineStream, type EngineState } from '@/hooks/use-engine-stream'
import { pushSample, sampleOf, type StatsSample } from '@/lib/soc-metrics'

const Ctx = createContext<EngineState | null>(null)
const HistoryCtx = createContext<StatsSample[]>([])

export function EngineProvider({ children }: { children: ReactNode }) {
  const state = useEngineStream()
  const [history, setHistory] = useState<StatsSample[]>([])
  const { stats } = state
  useEffect(() => {
    // An outage clears the trend: a sparkline never bridges a gap.
    setHistory((previous) => (stats ? pushSample(previous, sampleOf(stats, Date.now())) : []))
  }, [stats])
  return (
    <Ctx.Provider value={state}>
      <HistoryCtx.Provider value={history}>{children}</HistoryCtx.Provider>
    </Ctx.Provider>
  )
}

export function useEngine(): EngineState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useEngine debe usarse dentro de EngineProvider')
  return ctx
}

/** Recent /api/stats samples, oldest first (empty while the engine is down). */
export function useStatsHistory(): StatsSample[] {
  return useContext(HistoryCtx)
}
