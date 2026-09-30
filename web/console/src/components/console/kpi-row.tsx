'use client'

// KPI strip of the operations panel: uptime, event rate, alert total
// with the severity breakdown, rule count and pipeline counters.
// Cockpit density: no card boxes, hairline separators, Geist Mono for
// every number (tabular so live updates do not jitter).

import { ActivityIcon, Flame, MinusCircle, ShieldCheck, Timer, UploadSimple, WebhooksLogo } from '@phosphor-icons/react'
import { AnimatedNumber } from './ui-bits'
import { GradientText } from '@/components/reactbits/gradient-text'
import { SpotlightCard } from '@/components/reactbits/spotlight-card'
import { formatUptime, SEVERITY_STYLE, type EngineStats, type Severity } from '@/lib/console-types'

const SEV_ORDER: Severity[] = ['critical', 'high', 'medium', 'low']

function Kpi({
  label,
  icon: Icon,
  children,
}: {
  label: string
  icon: React.ElementType
  children: React.ReactNode
}) {
  // SpotlightCard (React Bits): el halo esmeralda solo existe bajo el
  // puntero (transparente en reposo), asi que la densidad de cabina y las
  // hairlines del grid no cambian; el foco de teclado tambien lo enciende
  // via focus-within.
  return (
    <SpotlightCard className="min-w-0 px-4 py-3.5 first:pl-0 md:px-5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        <Icon size={12} aria-hidden className="text-zinc-500" />
        {label}
      </p>
      <div className="mt-1.5">{children}</div>
    </SpotlightCard>
  )
}

export function KpiRow({ stats }: { stats: EngineStats | null }) {
  const severity = stats?.by_severity ?? {}
  const webhookIssues = (stats?.webhook_failed ?? 0) + (stats?.webhook_dropped ?? 0)
  const ingestIssues = (stats?.dropped ?? 0) + (stats?.ingest_rejected ?? 0)
  const hot = stats?.hot_hosts
  const top = hot?.[0]

  return (
    <div
      aria-label="Indicadores del motor"
      className="grid grid-cols-2 divide-x divide-y divide-zinc-800 border-y border-zinc-800 md:grid-cols-3 xl:grid-cols-7 xl:divide-y-0"
    >
      <Kpi label="Tiempo activo" icon={Timer}>
        <span className="block truncate font-mono text-xl tabular-nums text-zinc-100">
          {stats ? formatUptime(stats.uptime_s) : '0s'}
        </span>
      </Kpi>

      <Kpi label="Eventos/min" icon={ActivityIcon}>
        <AnimatedNumber
          value={stats?.events_per_min ?? 0}
          className="block font-mono text-xl tabular-nums text-zinc-100"
        />
        <span className="mt-0.5 block font-mono text-[11px] tabular-nums text-zinc-500">
          total {stats?.events_total ?? 0}
        </span>
      </Kpi>

      <Kpi label="Alertas" icon={WebhooksLogo}>
        <AnimatedNumber
          value={stats?.alerts_total ?? 0}
          className="block font-mono text-xl tabular-nums text-zinc-100"
        />
        <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {SEV_ORDER.filter((sev) => (severity[sev] ?? 0) > 0).map((sev) => (
            <span key={sev} className="flex items-center gap-1 font-mono text-[11px] tabular-nums">
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${SEVERITY_STYLE[sev].dot}`} />
              {/* GradientText (React Bits): el critical late en degradado
                  rojo/ámbar mientras exista — urgencia de severidad, no
                  adorno; el resto de severidades quedan estáticas. */}
              {sev === 'critical' ? (
                <GradientText colors={['#fca5a5', '#fb923c', '#f87171', '#fca5a5']} speed={4}>
                  <span className={SEVERITY_STYLE[sev].text}>{severity[sev]}</span>
                </GradientText>
              ) : (
                <span className={SEVERITY_STYLE[sev].text}>{severity[sev]}</span>
              )}
              <span className="text-zinc-500">{sev}</span>
            </span>
          ))}
          {SEV_ORDER.every((sev) => (severity[sev] ?? 0) === 0) && (
            <span className="text-[11px] text-zinc-500">sin detecciones</span>
          )}
        </span>
      </Kpi>

      <Kpi label="Reglas activas" icon={ShieldCheck}>
        <AnimatedNumber
          value={stats?.rules_count ?? 0}
          className="block font-mono text-xl tabular-nums text-zinc-100"
        />
        <span className="mt-0.5 block truncate font-mono text-[11px] text-zinc-500">
          {(stats?.rules_types ?? []).length} tipos de evento
        </span>
      </Kpi>

      <Kpi label="Búfer de eventos" icon={UploadSimple}>
        <AnimatedNumber
          value={stats?.events_buffered ?? 0}
          className="block font-mono text-xl tabular-nums text-zinc-100"
        />
        <span className="mt-0.5 block font-mono text-[11px] tabular-nums text-zinc-500">
          ingest: {ingestIssues > 0 ? <span className="text-orange-400">{ingestIssues} rechazados</span> : 'sin rechazos'}
        </span>
      </Kpi>

      <Kpi label="Webhooks" icon={MinusCircle}>
        <AnimatedNumber
          value={stats?.webhook_sent ?? 0}
          className="block font-mono text-xl tabular-nums text-zinc-100"
        />
        <span className="mt-0.5 block font-mono text-[11px] tabular-nums text-zinc-500">
          {webhookIssues > 0 ? <span className="text-orange-400">{webhookIssues} con fallo</span> : 'sin fallos'}
        </span>
      </Kpi>

      <Kpi label="Riesgo por host" icon={Flame}>
        <AnimatedNumber
          value={stats?.risk_hosts_tracked ?? 0}
          className="block font-mono text-xl tabular-nums text-zinc-100"
        />
        <span className="mt-0.5 block truncate font-mono text-[11px] tabular-nums text-zinc-500">
          {hot && top ? `máx ${top.host} · ${top.score}` : stats ? 'sin riesgo activo' : 'sin datos'}
        </span>
      </Kpi>
    </div>
  )
}
