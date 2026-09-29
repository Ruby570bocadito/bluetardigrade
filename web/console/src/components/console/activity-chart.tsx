'use client'

// Event rate over the last 4 minutes, bucketed in 5s windows from the
// client-side event buffer. Bars animate only when the data changes:
// the motion communicates that the feed is alive, nothing else.

import { useMemo } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { SfEvent } from '@/lib/console-types'

const WINDOW_MS = 4 * 60 * 1000
const BUCKET_MS = 5000
const BUCKETS = WINDOW_MS / BUCKET_MS

export function ActivityChart({ events }: { events: SfEvent[] }) {
  const reduce = useReducedMotion()

  const buckets = useMemo(() => {
    const now = Date.now()
    const out: number[] = new Array(BUCKETS).fill(0)
    for (const ev of events) {
      const t = new Date(ev.timestamp).getTime()
      if (Number.isNaN(t) || now - t > WINDOW_MS) continue
      const idx = BUCKETS - 1 - Math.floor((now - t) / BUCKET_MS)
      if (idx >= 0 && idx < BUCKETS) out[idx]++
    }
    return out
  }, [events])

  const max = Math.max(1, ...buckets)
  const total = buckets.reduce((a, b) => a + b, 0)

  return (
    <div>
      <div
        role="img"
        aria-label={`Actividad de eventos en los últimos 4 minutos: ${total} eventos, máximo ${max} por intervalo de 5 segundos`}
        className="flex h-28 items-end gap-[3px] border-b border-zinc-800"
      >
        {buckets.map((c, i) => (
          <motion.div
            key={i}
            className="min-w-[3px] flex-1 rounded-t-sm bg-emerald-500/80"
            initial={false}
            animate={{
              height: `${Math.max(c === 0 ? 2 : 8, (c / max) * 100)}%`,
              opacity: c === 0 ? 0.3 : 0.5 + (c / max) * 0.5,
            }}
            transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 160, damping: 26 }}
          />
        ))}
      </div>
      <div className="flex items-baseline justify-between pt-2">
        <p className="text-xs text-zinc-500">Eventos por intervalo de 5s, últimos 4 minutos</p>
        <p className="font-mono text-xs tabular-nums text-zinc-400">
          pico <span className="text-zinc-200">{max}</span>
        </p>
      </div>
    </div>
  )
}
