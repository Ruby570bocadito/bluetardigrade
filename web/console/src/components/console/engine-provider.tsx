'use client'

// Single shared instance of the engine stream (SSE + REST polling) for
// the whole console tree. One connection per page, never one per view.

import { createContext, useContext, type ReactNode } from 'react'
import { useEngineStream, type EngineState } from '@/hooks/use-engine-stream'

const Ctx = createContext<EngineState | null>(null)

export function EngineProvider({ children }: { children: ReactNode }) {
  const state = useEngineStream()
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>
}

export function useEngine(): EngineState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useEngine debe usarse dentro de EngineProvider')
  return ctx
}
