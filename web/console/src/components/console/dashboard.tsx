'use client'

// Operations dashboard: KPI strip, live rate chart, engine summary and
// the two windows an analyst glances at first (latest alerts, latest
// telemetry). Everything reads from the real engine stream; when the
// engine is down every panel shows its own honest state.

import { Cpu, MagnifyingGlass, Waveform } from '@phosphor-icons/react'
import { useEngine } from './engine-provider'
import type { EngineStatus } from '@/hooks/use-engine-stream'
import { KpiRow } from './kpi-row'
import { ActivityChart } from './activity-chart'
import { AlertsView } from './alerts-view'
import { EmptyState, OfflineNotice, SectionHeader, SkeletonRows, MonoTag } from './ui-bits'
import { AnimatedItem } from '@/components/reactbits/animated-list'
import { eventDetail, formatTime, type SfAlert } from '@/lib/console-types'

export type ConsoleView = 'panel' | 'flujo' | 'alertas' | 'reglas' | 'cadenas' | 'supresiones' | 'analista'

export function Dashboard({
  onAnalyze,
  onNavigate,
}: {
  onAnalyze: (al: SfAlert) => void
  onNavigate: (view: ConsoleView) => void
}) {
  const { events, status, stats } = useEngine()

  return (
    <div className="space-y-6">
      {status === 'down' && (
        <OfflineNotice
          title="Motor offline"
          hint="La consola no muestra datos inventados. Arranca el motor (cmd/engine) con su API en 127.0.0.1:7778 y esta pantalla se recupera sola."
        />
      )}

      <KpiRow stats={stats} />

      <div className="grid gap-6 xl:grid-cols-3">
        <section aria-label="Actividad del sensor" className="min-w-0 xl:col-span-2">
          <SectionHeader title="Actividad del sensor" hint="ventana de 4 minutos" />
          <div className="rounded-lg border border-zinc-800 px-4 pb-3 pt-4">
            <ActivityChart events={events} />
          </div>
        </section>

        <section aria-label="Resumen del motor" className="min-w-0">
          <SectionHeader title="Motor de detección" />
          <EngineSummary status={status} />
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <AlertsView compact onAnalyze={onAnalyze} />

        <section aria-label="Telemetría reciente" className="min-w-0">
          <SectionHeader
            title="Telemetría reciente"
            count={events.length}
            action={
              <button
                type="button"
                onClick={() => onNavigate('flujo')}
                className="rounded-sm text-xs text-emerald-400 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Ver flujo completo
              </button>
            }
          />
          {status !== 'live' && events.length === 0 ? (
            <SkeletonRows rows={6} className="border-y border-zinc-800 py-6" />
          ) : events.length === 0 ? (
            <div className="border-y border-zinc-800">
              <EmptyState
                icon={Waveform}
                title="Sin eventos todavía"
                hint="El búfer del cliente se llena en cuanto el motor emite telemetría por /api/stream."
              />
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800/80 border-y border-zinc-800">
              {events.slice(0, 8).map((ev, i) => (
                <li key={ev.id}>
                  {/* AnimatedItem (React Bits): entrada escalonada en la carga
                      inicial; las keys estables evitan re-animar filas ya
                      visibles cuando llega un evento nuevo. */}
                  <AnimatedItem
                    index={i}
                    className="grid grid-cols-[64px_120px_minmax(0,1fr)] items-center gap-3 px-1 py-2 md:grid-cols-[76px_140px_minmax(0,1fr)]"
                  >
                    <span className="font-mono text-xs tabular-nums text-zinc-500">{formatTime(ev.timestamp)}</span>
                    <span className="truncate font-mono text-xs text-emerald-400">{ev.type}</span>
                    <span className="truncate font-mono text-xs text-zinc-400" title={eventDetail(ev)}>
                      {eventDetail(ev)}
                    </span>
                  </AnimatedItem>
                </li>
              ))}
            </ul>
          )}
          <p className="pt-2 text-xs text-zinc-500">Muestra de los últimos 8 eventos del búfer</p>
        </section>
      </div>
    </div>
  )
}

/** Engine summary card: identity, counters and rule types. */
function EngineSummary({ status }: { status: EngineStatus }) {
  const { stats, rules, endpoint } = useEngine()

  const statusLine =
    status === 'live'
      ? 'Conectada a la API del motor Go: eventos, alertas y reglas llegan del pipeline real.'
      : status === 'connecting'
        ? 'Consultando la API del motor por primera vez.'
        : 'Sin conexión con la API del motor: no se muestra ningún dato.'

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: 'Modo', value: <span className="font-mono text-xs text-zinc-300">{stats?.mode ?? (stats ? 'engine' : 'sin datos')}</span> },
    { label: 'API', value: <span className="font-mono text-xs text-zinc-300">{endpoint}</span> },
    {
      label: 'Eventos totales',
      value: <span className="font-mono text-xs tabular-nums text-zinc-300">{stats?.events_total ?? 0}</span>,
    },
    {
      label: 'Descartados / rechazados',
      value: (
        <span className="font-mono text-xs tabular-nums text-zinc-300">
          {stats?.dropped ?? 0} / {stats?.ingest_rejected ?? 0}
        </span>
      ),
    },
    {
      label: 'Webhooks',
      value: (
        <span className="font-mono text-xs tabular-nums text-zinc-300">
          {stats?.webhook_sent ?? 0} enviados · {stats?.webhook_failed ?? 0} fallidos
        </span>
      ),
    },
    { label: 'Reglas cargadas', value: <span className="font-mono text-xs tabular-nums text-zinc-300">{rules.length}</span> },
  ]

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40">
      <div className="flex items-center gap-2.5 border-b border-zinc-800 px-4 py-3">
        <Cpu size={16} aria-hidden className="text-emerald-500" />
        <span className="text-sm text-zinc-200">sf-engine</span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-zinc-500">
          <span
            aria-hidden
            className={`h-2 w-2 rounded-full ${status === 'live' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-400' : 'bg-red-500'}`}
          />
          {status === 'live' ? 'en vivo' : status === 'connecting' ? 'conectando' : 'sin conexión'}
        </span>
      </div>
      <dl className="divide-y divide-zinc-800/70 px-4">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4 py-2">
            <dt className="text-xs text-zinc-500">{row.label}</dt>
            <dd className="min-w-0 truncate text-right">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-zinc-800 px-4 py-3">
        <p className="text-[10px] uppercase tracking-wider text-zinc-500">Tipos de evento con reglas</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(stats?.rules_types ?? []).map((t) => (
            <MonoTag key={t}>{t}</MonoTag>
          ))}
          {(stats?.rules_types ?? []).length === 0 && (
            <span className="flex items-center gap-1.5 text-xs text-zinc-500">
              <MagnifyingGlass size={12} aria-hidden />
              sin catálogo todavía
            </span>
          )}
        </div>
      </div>
      <p className="border-t border-zinc-800 px-4 py-2.5 text-[11px] leading-relaxed text-zinc-500">{statusLine}</p>
    </div>
  )
}
