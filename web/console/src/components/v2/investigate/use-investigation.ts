'use client'

// The events Investigar works on: the live buffer of the engine stream
// (frozen while paused) or one read of the engine history for the query.
// Either way every token is applied again here, so live and history
// answer exactly the same question.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useEngine } from '@/components/console/engine-provider'
import { engineCall } from '@/lib/engine-writes'
import type { SfEvent } from '@/lib/console-types'
import {
  filterEvents,
  formatQuery,
  historyPath,
  HISTORY_LIMIT,
  type HistoryRange,
  type QueryToken,
  type Source,
} from '@/lib/v2/investigate-model'

/** What the engine stream keeps in memory (hooks/use-engine-stream MAX_EVENTS). */
export const LIVE_MAX = 300

export type Investigation = {
  /** what the source gave, before the query */
  base: SfEvent[]
  /** after every token, newest first */
  events: SfEvent[]
  loading: boolean
  error: string | null
  truncated: boolean
  paused: boolean
  /** live events that arrived while paused and match the query */
  waiting: number
  setPaused: (paused: boolean) => void
  refresh: () => void
}

const newestFirst = (a: SfEvent, b: SfEvent) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0)

export function useInvestigation(tokens: readonly QueryToken[], source: Source, range: HistoryRange): Investigation {
  const { events: live } = useEngine()
  const key = formatQuery(tokens, 'en')
  const [paused, setPausedState] = useState(false)
  const [frozen, setFrozen] = useState<SfEvent[]>([])
  const [history, setHistory] = useState<{ key: string; data: SfEvent[]; truncated: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const setPaused = useCallback(
    (p: boolean) => {
      if (p) setFrozen(live)
      setPausedState(p)
    },
    [live],
  )

  // one read of the history per query, range and explicit refresh
  useEffect(() => {
    if (source !== 'historico') return undefined
    let cancelled = false
    const id = window.setTimeout(async () => {
      setLoading(true)
      setError(null)
      const res = await engineCall<SfEvent[]>('GET', historyPath(tokens, range, Date.now()), undefined, {}, 20000)
      if (cancelled) return
      setLoading(false)
      if (!res.ok) {
        setError(res.error)
        return
      }
      const data = Array.isArray(res.data) ? res.data : []
      setHistory({ key: `${key}|${range}`, data, truncated: data.length >= HISTORY_LIMIT })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
    // tokens travel through `key`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, key, range, nonce])

  const base = useMemo(() => {
    if (source === 'historico') return history?.data ?? []
    return paused ? frozen : live
  }, [source, history, paused, frozen, live])

  const events = useMemo(() => filterEvents(base, tokens).sort(newestFirst), [base, key]) // eslint-disable-line react-hooks/exhaustive-deps

  const waiting = useMemo(() => {
    if (source !== 'vivo' || !paused) return 0
    const seen = new Set(frozen.map((e) => e.id))
    return filterEvents(
      live.filter((e) => !seen.has(e.id)),
      tokens,
    ).length
  }, [source, paused, frozen, live, key]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    base,
    events,
    loading: source === 'historico' && loading,
    error: source === 'historico' ? error : null,
    truncated: source === 'historico' && !!history?.truncated,
    paused: source === 'vivo' && paused,
    waiting,
    setPaused,
    refresh: () => setNonce((n) => n + 1),
  }
}
