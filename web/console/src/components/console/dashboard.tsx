'use client'

// Operations dashboard: KPI strip, live rate chart, latest alerts and
// latest telemetry in one glance.

import { useConsole } from './socket-provider'
import { KpiRow } from './kpi-row'
import { ActivityChart } from './activity-chart'
import { AlertsView } from './alerts-view'
import { SectionHeader, SkeletonRows } from './ui-bits'
import { AnimatedItem } from '@/components/reactbits/animated-list'
import { eventDetail, formatTime, type SfAlert } from '@/lib/console-types'

export function Dashboard({ onAnalyze }: { onAnalyze: (al: SfAlert) => void }) {
  const { events, stats, status } = useConsole()

  return (
    <div className="space-y-8">
      <KpiRow stats={stats} />

      <section aria-label="Actividad del sensor">
        <SectionHeader title="Actividad del sensor" />
        <ActivityChart events={events} />
      </section>

      <div className="grid gap-8 xl:grid-cols-2">
        <AlertsView compact onAnalyze={onAnalyze} />

        <section aria-label="Telemetría reciente">
          <SectionHeader title="Telemetría reciente" count={events.length} />
          {status !== 'live' && events.length === 0 ? (
            <SkeletonRows rows={5} />
          ) : (
            <ul className="divide-y divide-white/[0.06] border-y border-white/[0.08]">
              {events.slice(0, 8).map((ev, i) => (
                <li key={ev.id}>
                  {/* AnimatedItem (React Bits): entrada escalonada en la carga
                      inicial; las keys estables evitan re-animar filas ya
                      visibles cuando llega un evento nuevo. */}
                  <AnimatedItem
                    index={i}
                    className="grid grid-cols-[64px_120px_1fr] items-center gap-3 px-1 py-2 md:grid-cols-[76px_140px_1fr]"
                  >
                    <span className="font-mono text-xs text-zinc-500">{formatTime(ev.timestamp)}</span>
                    <span className="truncate font-mono text-xs text-emerald-300/90">{ev.type}</span>
                    <span className="truncate font-mono text-xs text-zinc-400" title={eventDetail(ev)}>
                      {eventDetail(ev)}
                    </span>
                  </AnimatedItem>
                </li>
              ))}
            </ul>
          )}
          <p className="pt-2 text-xs text-zinc-600">Muestra de los últimos 8 eventos del búfer</p>
        </section>
      </div>
    </div>
  )
}
