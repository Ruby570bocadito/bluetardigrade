'use client'

// Live event stream. Rows enter with a blur-fade (feedback for the new
// telemetry), the stream can be paused for inspection. Dense rows with
// hairlines, mono metadata, no card boxes.

import { useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ActivityIcon as Activity, MagnifyingGlass, Pause } from '@phosphor-icons/react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useConsole } from './socket-provider'
import { EmptyState, SectionHeader, SkeletonRows } from './ui-bits'
import { eventDetail, formatTime } from '@/lib/console-types'

const TYPE_LABELS: Record<string, string> = {
  'process.create': 'process.create',
  'process.terminate': 'process.terminate',
  'network.connect': 'network.connect',
  'file.write': 'file.write',
  'image.load': 'image.load',
  'registry.set': 'registry.set',
}

export function LiveFeed() {
  const { events, status } = useConsole()
  const reduce = useReducedMotion()
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [paused, setPaused] = useState(false)
  const [frozen, setFrozen] = useState<typeof events>([])

  const source = paused ? frozen : events

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
    return list.slice(0, 60)
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
        action={
          <div className="flex items-center gap-4">
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
                className="h-8 w-[190px] border-white/10 bg-transparent pl-7 font-mono text-xs text-zinc-200 placeholder:text-zinc-600"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <Pause size={14} aria-hidden />
              <span className="hidden sm:inline">Pausar</span>
              <Switch checked={paused} onCheckedChange={togglePause} aria-label="Pausar flujo en vivo" />
            </label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 w-[190px] font-mono text-xs" aria-label="Filtrar por tipo de evento">
                <SelectValue placeholder="Tipo de evento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">todos los tipos</SelectItem>
                {Object.keys(TYPE_LABELS).map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      <div className="overflow-hidden border border-white/[0.08]">
        <div className="max-h-[62vh] overflow-y-auto">
          {status !== 'live' && source.length === 0 ? (
            <div className="px-4 py-8">
              <SkeletonRows rows={6} />
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              title={source.length === 0 ? 'Esperando eventos del sensor' : 'Sin resultados'}
              hint={
                source.length === 0
                  ? 'Ajusta el filtro o reanuda el flujo si está pausado'
                  : 'Ningún evento coincide con la búsqueda o el filtro actual'
              }
            />
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {visible.map((ev) => (
                <motion.li
                  key={ev.id}
                  initial={reduce ? false : { opacity: 0, y: -6, filter: 'blur(3px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  className="grid grid-cols-[64px_130px_1fr_auto] items-center gap-3 px-4 py-2.5 md:grid-cols-[76px_150px_1fr_90px_110px]"
                >
                  <span className="font-mono text-xs text-zinc-500">{formatTime(ev.timestamp)}</span>
                  <span className="truncate font-mono text-xs text-emerald-300/90">{ev.type}</span>
                  <span className="truncate font-mono text-xs text-zinc-300" title={eventDetail(ev)}>
                    {eventDetail(ev)}
                  </span>
                  <span className="hidden truncate font-mono text-xs text-zinc-500 md:inline">{ev.process ? `pid ${ev.process.pid}` : ''}</span>
                  <span className="hidden truncate text-right font-mono text-xs text-zinc-500 md:inline">{ev.host}</span>
                </motion.li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-zinc-600">
        <Activity size={12} aria-hidden />
        Ventana mostrada: 60 eventos. El búfer completo vive en el motor.
      </p>
    </section>
  )
}
