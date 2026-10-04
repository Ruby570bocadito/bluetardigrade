'use client'

// Línea base de procesos de un equipo (engine GET /api/baseline?host=):
// whether the host is still learning, the process names the engine
// treats as normal there, and the never-seen processes it reported. The
// novelties come from the alerts the console holds; clicking one opens
// it. Read-only.

import { useEffect, useState } from 'react'
import { MagnifyingGlass, Sparkle, Timer } from '@phosphor-icons/react'
import { ChartCard } from '@/components/charts/chart-frame'
import { EmptyState } from './ui-bits'
import { formatDateTime, formatTime, type SfAlert } from '@/lib/console-types'
import { BASELINE_RULE_ID, baselineStatus, fetchBaselineHost, filterProcesses, type BaselineHost } from '@/lib/intel'

const POLL_MS = 30_000

export function BaselineCard({ host, alerts, onOpenAlert }: { host: string; alerts: readonly SfAlert[]; onOpenAlert: (id: string) => void }) {
  const [data, setData] = useState<BaselineHost | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    let alive = true
    setData(null)
    setError('')
    const load = async () => {
      const res = await fetchBaselineHost(host)
      if (!alive) return
      if (res.ok && res.data && Array.isArray(res.data.processes)) {
        setData(res.data)
        setError('')
      } else if (!res.ok) {
        setError(res.status === 404 ? 'Este motor no expone /api/baseline: actualízalo para ver la línea base.' : res.error)
      }
    }
    void load()
    const t = setInterval(() => void load(), POLL_MS)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [host])

  const novelties = alerts.filter((a) => a.rule_id === BASELINE_RULE_ID).sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  const { shown, total } = filterProcesses(data?.processes ?? [], query)

  return (
    <ChartCard title="Línea base de procesos" subtitle="Lo que el motor considera normal en este equipo" icon={Timer}>
      {error ? (
        <p role="alert" className="text-xs text-amber-300">{error}</p>
      ) : !data ? (
        <div className="h-16 animate-pulse rounded-lg bg-white/5" />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-zinc-300">{baselineStatus(data)}</p>
          {data.known && (
            <p className="text-[11px] text-zinc-500">
              Aprende desde {data.first_seen ? formatDateTime(data.first_seen) : '—'}
              {data.learning_until ? ` · ${data.learning ? 'hasta' : 'activa desde'} ${formatDateTime(data.learning_until)}` : ''}
              {' · '}{data.processes.length} {data.processes.length === 1 ? 'proceso conocido' : 'procesos conocidos'}
            </p>
          )}

          {novelties.length > 0 && (
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-zinc-300">
                <Sparkle size={12} aria-hidden className="text-amber-300" /> Procesos nuevos en la ventana ({novelties.length})
              </p>
              <ul className="space-y-1">
                {novelties.slice(0, 8).map((a, i) => (
                  <li key={(a.id ?? a.event_id) + i}>
                    <button
                      type="button"
                      onClick={() => a.id && onOpenAlert(a.id)}
                      className="flex w-full items-center gap-2 rounded-md border border-amber-300/15 bg-amber-300/[0.04] px-2 py-1 text-left hover:bg-amber-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="font-mono text-[11px] tabular-nums text-zinc-500">{formatTime(a.timestamp)}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-zinc-200" title={a.summary}>{a.summary}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.known && data.processes.length > 0 ? (
            <div>
              <label className="relative block">
                <span className="sr-only">Filtrar procesos conocidos</span>
                <MagnifyingGlass size={13} aria-hidden className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filtrar procesos conocidos"
                  className="h-8 w-full rounded-md border border-zinc-800 bg-zinc-900 pl-7 pr-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <ul aria-label="Procesos conocidos" className="mt-2 flex max-h-48 flex-wrap gap-1 overflow-y-auto">
                {shown.map((name) => (
                  <li key={name} className="rounded border border-zinc-800 bg-zinc-900/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">{name}</li>
                ))}
              </ul>
              {total > shown.length && <p className="mt-1 text-[10px] text-zinc-600">Se muestran {shown.length} de {total}; filtra para ver el resto.</p>}
              {total === 0 && <p className="mt-1 text-[11px] text-zinc-500">Ningún proceso conocido coincide con «{query}».</p>}
            </div>
          ) : (
            data.known && <EmptyState icon={Timer} title="Sin procesos todavía" hint="La lista se forma con los eventos process.create del sensor." />
          )}
        </div>
      )}
    </ChartCard>
  )
}
