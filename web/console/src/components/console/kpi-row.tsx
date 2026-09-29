'use client'

// KPI strip. Cockpit density: no card boxes, hairline separators,
// mono digits for every number.

import { AnimatedNumber } from './ui-bits'
import { formatUptime } from '@/lib/console-types'
import type { SimStats } from '@/lib/console-types'

export function KpiRow({ stats }: { stats: SimStats | null }) {
  const alertCount = stats?.alerts_total ?? 0
  const critical = stats?.by_severity?.critical ?? 0
  const high = stats?.by_severity?.high ?? 0

  const items: { label: string; node: React.ReactNode }[] = [
    {
      label: 'Eventos procesados',
      node: <AnimatedNumber value={stats?.events_total ?? 0} className="font-mono text-2xl tabular-nums text-zinc-100" />,
    },
    {
      label: 'Alertas generadas',
      node: (
        <span className="flex items-baseline gap-2">
          <AnimatedNumber value={alertCount} className="font-mono text-2xl tabular-nums text-zinc-100" />
          {critical > 0 && <span className="font-mono text-xs text-red-300">{critical} critical</span>}
          {high > 0 && <span className="font-mono text-xs text-orange-300">{high} high</span>}
        </span>
      ),
    },
    {
      label: 'Eventos por minuto',
      node: <AnimatedNumber value={stats?.events_per_min ?? 0} className="font-mono text-2xl tabular-nums text-zinc-100" />,
    },
    {
      label: 'Tiempo activo',
      node: <span className="font-mono text-2xl tabular-nums text-zinc-100">{stats ? formatUptime(stats.uptime_s) : '0s'}</span>,
    },
  ]

  return (
    <div className="grid grid-cols-2 divide-x divide-white/[0.08] border-y border-white/[0.08] md:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="px-4 py-4 first:pl-0 md:px-5">
          <div>{it.node}</div>
          <p className="mt-1 text-xs text-zinc-500">{it.label}</p>
        </div>
      ))}
    </div>
  )
}
