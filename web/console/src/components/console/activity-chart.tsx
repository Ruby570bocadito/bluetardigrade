'use client'

// Event rate over the last 4 minutes, bucketed in 5s windows from the
// client-side event buffer. Bar height animates on update: the motion
// communicates that the feed is alive (state transition), nothing else.

import { useMemo } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { EmptyState } from './ui-bits'
import type { SfEvent } from '@/lib/console-types'

const WINDOW_MS = 4 * 60 * 1000
const BUCKET_MS = 5000
const BUCKETS = WINDOW_MS / BUCKET_MS

export function ActivityChart({ events }: { events: SfEvent[] }) {
  const reduce = useReducedMotion()

  const buckets = useMemo(() => {
    const now = Date.now()
    const out: number[] = new Array(BUCKETS).fill(0)
    let offensive = 0
    for (const ev of events) {
      const t = new Date(ev.timestamp).getTime()
      if (Number.isNaN(t) || now - t > WINDOW_MS) continue
      const idx = BUCKETS - 1 - Math.floor((now - t) / BUCKET_MS)
      if (idx >= 0 && idx < BUCKETS) {
        out[idx]++
        if (ev.process && ev.process.name && ['powershell.exe', 'certutil.exe', 'rundll32.exe'].includes(ev.process.name)) offensive++
      }
    }
    return { counts: out, offensive }
  }, [events])

  const max = Math.max(1, ...buckets.counts)

  return (
    <div>
      <div className="flex h-28 items-end gap-[3px]" role="img" aria-label={`Actividad de eventos en los últimos 4 minutos, máximo ${max} eventos por intervalo`}>
        {buckets.counts.map((c, i) => (
          <motion.div
            key={i}
            className="min-w-[3px] flex-1 rounded-t-[2px] bg-emerald-400/70"
            initial={false}
            animate={{ height: `${Math.max(c === 0 ? 2 : 8, (c / max) * 100)}%`, opacity: c === 0 ? 0.25 : 0.4 + (c / max) * 0.6 }}
            transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 140, damping: 22 }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-baseline justify-between border-t border-white/[0.08] pt-2">
        <p className="text-xs text-zinc-500">Eventos por intervalo de 5s, últimos 4 minutos</p>
        <p className="font-mono text-xs text-zinc-400">pico {max}</p>
      </div>
      {buckets.counts.every((c) => c === 0) && <EmptyState title="Sin actividad registrada todavía" hint="El sensor está arrancando o la cola está vacía" />}
    </div>
  )
}
