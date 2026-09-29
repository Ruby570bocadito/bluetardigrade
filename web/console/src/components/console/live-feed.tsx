'use client'

// Live telemetry stream. Rows enter with a short fade (feedback for new
// events, skipped while paused), the stream can be frozen for
// inspection and the whole buffer exports as JSONL/CSV. The type filter
// is derived from the types the engine actually delivered: no hardcoded
// inventories anywhere.

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ActivityIcon, MagnifyingGlass, Pause, Play } from '@phosphor-icons/react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useEngine } from './engine-provider'
import { EmptyState, LiveAnnouncer, SectionHeader, SkeletonRows } from './ui-bits'
import { ExportButtons } from './export-menu'
import { eventDetail, formatTime, type SfEvent } from '@/lib/console-types'

export function LiveFeed() {
  const { events, status } = useEngine()
  const reduce = useReducedMotion()
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [paused, setPaused] = useState(false)
  const [frozen, setFrozen] = useState<SfEvent[]>([])
  const [announcement, setAnnouncement] = useState('')
  const knownTop = useRef<string | null>(null)

  const source = paused ? frozen : events

  // Screen readers get one polite line per batch, not one per row.
  useEffect(() => {
    if (paused) return
    const top = events[0]
    if (!top) return
    if (knownTop.current === null) {
      knownTop.current = top.id
      return
    }
    if (knownTop.current !== top.id) {
      knownTop.current = top.id
      setAnnouncement(`Evento nuevo: ${top.type} en ${top.host}`)
    }
  }, [events, paused])

  const types = useMemo(() => {
    const set = new Set<string>()
    for (const ev of events.slice(0, 160)) set.add(ev.type)
    return [...set].sort()
  }, [events])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = source.filter((e) => {
      if (typeFilter !== 'all' && e.type !== typeFilter) return false
      if (!q) return true
      const haystack = [
        e.type, e.host, e.user ?? '', eventDetail(e),
        e.process ? `pid ${e.process.pid}` : '',
        e.network?.destination_ip ?? '', e.network?.domain ?? '',
      ].join(' ').toLowerCase()
      return haystack.includes(q)
    })
    return list.slice(0, 80)
  }, [source, typeFilter, query])

  const togglePause = (on: boolean) => {
    if (on) setFrozen(events)
    setPaused(on)
  }

  return (
    <section aria-label="Flujo de eventos en vivo">
      <SectionHeader
        title="Flujo de telemetría"
        count={visible.length}
        hint={paused ? 'pausado para inspección' : undefined}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <MagnifyingGlass
                size={13}
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setQuery('')
                }}
                placeholder="buscar en el flujo..."
                aria-label="Buscar en el flujo de telemetría"
                className="h-8 w-[200px] rounded-md border-zinc-800 bg-zinc-900 pl-7 font-mono text-xs text-zinc-200 placeholder:text-zinc-500"
              />
            </div>
            <label className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-400">
              {paused ? <Play size={13} aria-hidden className="text-emerald-400" /> : <Pause size={13} aria-hidden />}
              <span className="hidden sm:inline">{paused ? 'Reanudar' : 'Pausar'}</span>
              <Switch checked={paused} onCheckedChange={togglePause} aria-label="Pausar flujo en vivo" />
            </label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 w-[180px] rounded-md border-zinc-800 bg-zinc-900 font-mono text-xs" aria-label="Filtrar por tipo de evento">
                <SelectValue placeholder="Tipo de evento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">todos los tipos</SelectItem>
                {types.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ExportButtons kind="events" />
          </div>
        }
      />

      <div className="overflow-hidden rounded-lg border border-zinc-800">
        <div className="max-h-[64vh] overflow-y-auto">
          {status !== 'live' && source.length === 0 ? (
            <div className="px-4 py-8">
              <SkeletonRows rows={8} />
            </div>
          ) : source.length === 0 ? (
            <EmptyState
              icon={ActivityIcon}
              title="Esperando eventos del sensor"
              hint="Sin telemetría en el búfer. Arranca el motor (cmd/engine) y un sensor (sf-sensor o cmd/devsensor) para ver el flujo en directo."
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={MagnifyingGlass}
              title="Sin resultados"
              hint="Ningún evento coincide con la búsqueda o el filtro actual"
            />
          ) : (
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">Flujo de eventos en vivo: hora, tipo, detalle, proceso y equipo</caption>
              <thead className="sticky top-0 z-10">
                <tr className="bg-zinc-950/95">
                  <th scope="col" className="border-b border-zinc-800 py-2 pl-4 pr-3 text-[11px] font-medium uppercase tracking-wider text-zinc-500">Hora</th>
                  <th scope="col" className="border-b border-zinc-800 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">Tipo</th>
                  <th scope="col" className="border-b border-zinc-800 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">Detalle</th>
                  <th scope="col" className="hidden border-b border-zinc-800 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500 md:table-cell">PID</th>
                  <th scope="col" className="hidden border-b border-zinc-800 px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-zinc-500 md:table-cell">Equipo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {visible.map((ev) => (
                  <motion.tr
                    key={ev.id}
                    initial={reduce || paused ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                  >
                    <td className="whitespace-nowrap py-2 pl-4 pr-3 font-mono text-xs tabular-nums text-zinc-500">
                      {formatTime(ev.timestamp)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-emerald-400">
                      {ev.type}
                    </td>
                    <td className="max-w-0 px-3 py-2">
                      <span className="block truncate font-mono text-xs text-zinc-300" title={eventDetail(ev)}>
                        {eventDetail(ev)}
                      </span>
                    </td>
                    <td className="hidden px-3 py-2 font-mono text-xs tabular-nums text-zinc-500 md:table-cell">
                      {ev.process ? ev.process.pid : ''}
                    </td>
                    <td className="hidden max-w-[160px] truncate px-3 py-2 text-right font-mono text-xs text-zinc-500 md:table-cell">
                      {ev.host}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="flex items-center gap-1.5 border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-500">
          <ActivityIcon size={12} aria-hidden />
          Ventana mostrada: {visible.length} eventos de {source.length} en el búfer del cliente. El búfer completo vive en el motor.
        </p>
      </div>
      <LiveAnnouncer message={announcement} />
    </section>
  )
}
