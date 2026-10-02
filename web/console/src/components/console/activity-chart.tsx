'use client'

// Event rate over the last 4 minutes, bucketed in 5s windows from the
// client-side event buffer. Bars animate only when the data changes:
// the motion communicates that the feed is alive, nothing else.

import { useEffect, useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { SfEvent } from '@/lib/console-types'
import { activityBuckets, ACTIVITY_BUCKET_MS } from '@/lib/activity'

export function ActivityChart({ events }: { events: SfEvent[] }) {
  const reduce = useReducedMotion()

  // Advance even when the sensor is idle; start after mount to match SSR.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), ACTIVITY_BUCKET_MS)
    return () => clearInterval(timer)
  }, [])
  const buckets = useMemo(() => activityBuckets(events, now ?? 0), [events, now])
  const peak = Math.max(0, ...buckets)
  const max = Math.max(1, peak)
  const total = buckets.reduce((a, b) => a + b, 0)

  return (
    <div>
      <div
        role="img"
        aria-label={`Muestra de actividad en los últimos 4 minutos: ${total} eventos del búfer, máximo ${peak} por intervalo de 5 segundos`}
        className="flex h-28 items-end gap-[3px] border-b border-zinc-800"
      >
        {buckets.map((c, i) => (
          <motion.div
            key={i}
            title={`${c} eventos · hace ${(buckets.length - 1 - i) * 5}s`}
            className="min-w-[3px] flex-1 rounded-t-sm bg-blue-400/80"
            initial={false}
            animate={{
              height: `${c === 0 ? 0 : Math.max(8, (c / max) * 100)}%`,
              opacity: c === 0 ? 0.3 : 0.5 + (c / max) * 0.5,
            }}
            transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 160, damping: 26 }}
          />
        ))}
      </div>
      <div className="flex items-baseline justify-between pt-2">
        <p className="text-xs text-zinc-500">Muestra del búfer · intervalos de 5s · últimos 4 min</p>
        <p className="font-mono text-xs tabular-nums text-zinc-400">
          pico <span className="text-zinc-200">{peak}</span>
        </p>
      </div>
    </div>
  )
}
