'use client'

// Event rate over the last 4 minutes, bucketed in 5s windows from the
// client-side event buffer, with the alerts of the same window on a
// marker rail under the plot (same time axis, no second scale).

import { useEffect, useMemo, useState } from 'react'
import type { SfAlert, SfEvent } from '@/lib/console-types'
import { activityBuckets, ACTIVITY_BUCKET_MS, ACTIVITY_WINDOW_MS } from '@/lib/activity'
import { AreaChart, type AreaPoint, type RailMarker } from '@/components/charts/area-chart'
import { SEV_COLOR } from '@/components/charts/severity'
import { formatAgo } from '@/lib/soc-metrics'
import { formatTime, SEVERITY_STYLE } from '@/lib/console-types'

const NO_ALERTS: SfAlert[] = []

export function useActivity(events: SfEvent[], alerts: SfAlert[] = NO_ALERTS) {
  // Advance even when the sensor is idle; start after mount to match SSR.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), ACTIVITY_BUCKET_MS)
    return () => clearInterval(timer)
  }, [])
  return useMemo(() => {
    const at = now ?? 0
    const counts = activityBuckets(events, at)
    const n = counts.length
    const points: AreaPoint[] = counts.map((value, i) => ({
      start: at - (n - i) * ACTIVITY_BUCKET_MS,
      end: at - (n - i - 1) * ACTIVITY_BUCKET_MS,
      value,
    }))
    const markers: RailMarker[] = alerts
      .filter((a) => {
        const age = at - Date.parse(a.timestamp)
        return Number.isFinite(age) && age >= 0 && age < ACTIVITY_WINDOW_MS
      })
      .slice(0, 60)
      .map((a, i) => ({
        key: (a.id ?? a.timestamp + a.rule_id) + ':' + i,
        t: Date.parse(a.timestamp),
        color: SEV_COLOR[a.severity] ?? SEV_COLOR.low,
        label: a.rule_name,
        detail: `${SEVERITY_STYLE[a.severity]?.label ?? a.severity} · ${a.host} · ${formatTime(a.timestamp)}`,
      }))
    const peak = Math.max(0, ...counts)
    const total = counts.reduce((a, b) => a + b, 0)
    return { now: at, points, markers, peak, total }
  }, [events, alerts, now])
}

export type Activity = ReturnType<typeof useActivity>

export function ActivityChart({ activity, withMarkers = false, height = 196 }: { activity: Activity; withMarkers?: boolean; height?: number }) {
  const { now, points, markers, peak, total } = activity
  return (
    <AreaChart
      points={points}
      now={now}
      height={height}
      ariaLabel={`Muestra de actividad en los últimos 4 minutos: ${total} eventos del búfer, máximo ${peak} por intervalo de 5 segundos`}
      valueLabel="eventos"
      formatX={(p) => (now - p.end < 1000 ? 'ahora' : formatAgo(now - p.end).replace('hace ', '-'))}
      markers={withMarkers ? markers : undefined}
    />
  )
}
