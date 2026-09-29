'use client'

// Live event stream. Rows enter with a blur-fade (feedback for the new
// telemetry), the stream can be paused for inspection. Dense rows with
// hairlines, mono metadata, no card boxes.

import { useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ActivityIcon as Activity, Pause } from '@phosphor-icons/react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
  const [paused, setPaused] = useState(false)
  const [frozen, setFrozen] = useState<typeof events>([])

  const source = paused ? frozen : events

  const visible = useMemo(() => {
    const list = typeFilter === 'all' ? source : source.filter((e) => e.type === typeFilter)
    return list.slice(0, 60)
  }, [source, typeFilter])

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
          {status !== 'live' && visible.length === 0 ? (
            <div className="px-4 py-8">
              <SkeletonRows rows={6} />
            </div>
          ) : visible.length === 0 ? (
            <EmptyState title="Esperando eventos del sensor" hint="Ajusta el filtro o reanuda el flujo si está pausado" />
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
