'use client'

// Stat tiles of the operations panel (dataviz stat-tile contract): label,
// value, a delta or context line and a sparkline of the /api/stats polls
// kept by the engine provider. Values are proportional sans figures; an
// unavailable metric shows "—" with an accessible "No data", never 0.

import { ActivityIcon, Flame, ShieldCheck, TrendDown, TrendUp, UploadSimple, WebhooksLogo, Siren } from '@phosphor-icons/react'
import { CountUp } from '@/components/reactbits/count-up'
import { GlareHover } from '@/components/reactbits/glare-hover'
import { useStatsHistory } from './engine-provider'
import { useI18n } from './i18n-provider'
import { SpotlightCard } from '@/components/reactbits/spotlight-card'
import { Sparkline } from '@/components/charts/bars'
import { counterDelta, type StatsSample } from '@/lib/soc-metrics'
import type { EngineStats } from '@/lib/console-types'

function Tile({
  label,
  icon: Icon,
  value,
  trend,
  children,
}: {
  label: string
  icon: React.ElementType
  value: number | undefined
  trend?: number[]
  children: React.ReactNode
}) {
  // SpotlightCard (React Bits): el halo solo existe bajo el puntero o con
  // el foco dentro; en reposo es la superficie del panel sin cambios.
  // GlareHover (React Bits): a reflection crosses the tile on hover/focus.
  return (
    <GlareHover className="rounded-[0.875rem]">
    <SpotlightCard className="panel panel-hover min-w-0 px-4 py-3.5">
      <p className="flex items-center gap-2 text-xs text-zinc-400">
        <Icon size={15} aria-hidden className="text-primary" />
        {label}
      </p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <KpiNumber value={value} />
        {trend && <Sparkline values={trend} width={84} height={30} />}
      </div>
      <div className="mt-1.5 min-h-4 truncate text-[11px] text-zinc-500">{children}</div>
    </SpotlightCard>
    </GlareHover>
  )
}

function KpiNumber({ value }: { value: number | undefined }) {
  const { dict } = useI18n()
  const className = 'block text-[26px] font-semibold leading-none tracking-tight text-zinc-50'
  return value === undefined
    ? <span className={className} aria-label={dict.kpi.noData}>—</span>
    : <CountUp to={value} className={className} />
}

function Delta({ value, span: label, pending, flat }: { value: number | null; span: string; pending: string; flat: (label: string) => string }) {
  if (value === null) return <span>{pending}</span>
  if (value === 0) return <span>{flat(label)}</span>
  const Up = value > 0 ? TrendUp : TrendDown
  return (
    <span className="inline-flex items-center gap-1">
      <Up size={12} aria-hidden className={value > 0 ? 'text-orange-300' : 'text-zinc-400'} />
      <span className={value > 0 ? 'font-medium text-orange-200' : 'text-zinc-300'}>{value > 0 ? '+' : ''}{value.toLocaleString('es-ES')}</span>
      {label}
    </span>
  )
}

const pick = (history: StatsSample[], f: (s: StatsSample) => number) => history.map(f)

export function KpiRow({ stats }: { stats: EngineStats | null }) {
  const { dict } = useI18n()
  const history = useStatsHistory()
  const webhookIssues = (stats?.webhook_failed ?? 0) + (stats?.webhook_dropped ?? 0)
  const ingestIssues = (stats?.dropped ?? 0) + (stats?.ingest_rejected ?? 0)
  const top = stats?.hot_hosts?.[0]
  const span = history.length > 1 ? Math.max(1, Math.round((history[history.length - 1].t - history[0].t) / 60_000)) : 0
  const spanLabel = span ? dict.kpi.spanLabel(span) : ''

  return (
    <div aria-label={dict.kpi.sectionAria} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Tile label={dict.kpi.eventsMin} icon={ActivityIcon} value={stats?.events_per_min} trend={pick(history, (s) => s.eventsPerMin)}>
        {stats ? dict.kpi.eventsTotal(stats.events_total.toLocaleString('es-ES'), !!stats.scoped) : dict.kpi.noDataLower}
      </Tile>

      <Tile label={dict.kpi.alerts} icon={Siren} value={stats?.alerts_total} trend={pick(history, (s) => s.alertsTotal)}>
        {!stats ? dict.kpi.noDataLower : <Delta value={counterDelta(history, (s) => s.alertsTotal)} span={spanLabel} pending={dict.kpi.trendPending} flat={dict.kpi.trendFlat} />}
      </Tile>

      <Tile label={dict.kpi.hostsRisk} icon={Flame} value={stats?.risk_hosts_tracked} trend={pick(history, (s) => s.riskHosts)}>
        {top ? <span title={top.host}>{dict.kpi.maxHost(top.host, top.score.toFixed(1))}</span> : stats ? dict.kpi.noRisk : dict.kpi.noDataLower}
      </Tile>

      <Tile label={dict.kpi.rulesActive} icon={ShieldCheck} value={stats?.rules_count}>
        {stats ? dict.kpi.rulesCovered(stats.rules_types.length) : dict.kpi.noDataLower}
      </Tile>

      <Tile label={dict.kpi.buffer} icon={UploadSimple} value={stats?.events_buffered}>
        {!stats ? dict.kpi.noDataLower : ingestIssues > 0 ? <span className="text-orange-300">{dict.kpi.bufferIssues(ingestIssues)}</span> : dict.kpi.bufferOk}
      </Tile>

      <Tile label={dict.kpi.webhookDeliveries} icon={WebhooksLogo} value={stats?.webhook_sent} trend={pick(history, (s) => s.webhookSent)}>
        {!stats ? dict.kpi.noDataLower : webhookIssues > 0 ? <span className="text-orange-300">{dict.kpi.webhookIssues(webhookIssues)}</span> : dict.kpi.webhookOk}
      </Tile>
    </div>
  )
}
