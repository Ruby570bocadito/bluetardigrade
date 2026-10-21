'use client'

// Operations dashboard. Reading order of a SOC shift: what needs triage
// now (hero + lifecycle), how the engine is doing (stat tiles), what the
// sensors see (activity), what was detected (severity, timeline, ATT&CK
// coverage, rules, hosts) and the latest raw rows. Everything reads from
// the real engine stream; when the engine is down every card shows its
// own honest state instead of empty axes.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDots, ChartLineUp, ChartPie, Cpu, Crosshair, Desktop, FlowArrow, Flame, Graph, GridFour, ListBullets, Pulse, ShieldWarning, SquaresFour, Stack, Waveform } from '@phosphor-icons/react'
import { useEngine } from './engine-provider'
import { useI18n } from './i18n-provider'
import type { EngineStatus } from '@/hooks/use-engine-stream'
import { KpiRow } from './kpi-row'
import { OperationsOverview } from './operations-overview'
import { ActivityChart, useActivity } from './activity-chart'
import { AlertsView } from './alerts-view'
import { EmptyState, OfflineNotice, SkeletonRows, MonoTag } from './ui-bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeadRow, TableHeader, TableRow } from '@/components/ui/table'
import { AnimatedItem } from '@/components/reactbits/animated-list'
import { AnimatedContent } from '@/components/reactbits/animated-content'
import { EntityGraphView, GraphLegend } from '@/components/charts/entity-graph'
import { ConsoleTablist } from './ui-tabs'
import { HostTacticHeatmap } from '@/components/charts/heatmap'
import { WeekHourHeatmap } from '@/components/charts/week-hour-heatmap'
import { buildEntityGraph } from '@/lib/entity-graph'
import { ChartCard } from '@/components/charts/chart-frame'
import { StackedColumns } from '@/components/charts/stacked-columns'
import { LineChart, type LineSlot } from '@/components/charts/line-chart'
import { DonutChart } from '@/components/charts/donut'
import { TriageFlowChart } from '@/components/charts/triage-flow'
import { buildDonut, isOtherSlice } from '@/lib/donut'
import { buildTriageFlow } from '@/lib/triage-flow'
import { useFleet } from './fleet-provider'
import { BarList, Meter } from '@/components/charts/bars'
import { AttackMatrix } from '@/components/charts/attack-matrix'
import { SEV_COLOR, SeverityIcon } from '@/components/charts/severity'
import { eventDetail, formatTime, type EngineStats, type SfAlert, type Severity } from '@/lib/console-types'
import { engineApiBase, readEngineJson } from '@/lib/engine-client'
import { weekHourGrid, weekHourTableRows, weekStart, WEEK_HOUR_DAYS } from '@/lib/alert-heatmap'
import { eventTypeMix, hostTacticMatrix, lifecycleTacticColumns, SEVERITIES, severityBuckets, severityCounts, tacticCoverage, topCounts, alertTactic, ATTACK_TACTICS, type LifecycleState } from '@/lib/soc-metrics'
import { pushRiskSample, riskSeriesView, RISK_SLOT_MS, RISK_SLOTS, type RiskSample } from '@/lib/risk-history'
import { pushOperatorState, currentSearch, dashboardTabFromParam, writeDashboardTabToSearch, DASHBOARD_TABS, type DashboardTab, type SeverityFilter } from '@/lib/url-state'
import { scenarioCountsByTactic, fetchScenarioSurface, type ScenarioView } from '@/lib/simulation'
import type { TriageTarget } from '@/lib/operations'

export type ConsoleView =
  | 'panel' | 'estado' | 'flujo' | 'alertas' | 'incidentes' | 'equipos' | 'directorio' | 'informes'
  | 'reglas' | 'cadenas' | 'inteligencia' | 'supresiones' | 'probador' | 'ruido' | 'simulacion'
  | 'respuesta' | 'analista' | 'ajustes'
export type HuntLens = { q?: string; sev?: SeverityFilter }

const TAB_ICONS: Record<DashboardTab, React.ElementType> = { resumen: SquaresFour, deteccion: ShieldWarning, actividad: Pulse }

const TIMELINE_WINDOW_MS = 60 * 60 * 1000
const TIMELINE_BUCKET_MS = 5 * 60 * 1000

// Triage lifecycle series in workflow order; categorical hues from the
// validated palette (no severity colors: lifecycle is a workflow state,
// not a magnitude). Labels travel in the dictionary (panel.lifecycle).
const LIFECYCLE_SERIES: { key: LifecycleState; color: string }[] = [
  { key: 'nuevas', color: 'var(--series-1)' },
  { key: 'reconocidas', color: 'var(--series-3)' },
  { key: 'cerradas', color: 'var(--series-2)' },
]

// Categorical palette order for the risk lines (capped at 4 series).
const RISK_SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)']

// VIZ-1 — the validated categorical palette: four named slices plus the
// muted «Otros». More named hues would need new tokens (Pulimiento B).

/** Same thresholds the engine publishes for hot hosts (A1 weights); the
 * level word travels in the dictionary (panel.risk.levels). */
function riskLevel(score: number): 'critical' | 'elevated' | 'low' {
  return score >= 20 ? 'critical' : score >= 5 ? 'elevated' : 'low'
}

export function Dashboard({
  onAnalyze,
  onNavigate,
  onTriage,
  onHunt,
  onHost,
  onScenarioTactic,
}: {
  onAnalyze: (al: SfAlert) => void
  onNavigate: (view: ConsoleView) => void
  onTriage: (target: TriageTarget) => void
  onHunt?: (lens: HuntLens) => void
  /** open the Equipos page of a host (falls back to the alert lens) */
  onHost?: (host: string) => void
  /** open the Validación view filtered by an ATT&CK tactic (SIM-3 click-through) */
  onScenarioTactic?: (slug: string) => void
}) {
  const { dict } = useI18n()
  const hostLens = onHost ?? (onHunt ? (host: string) => onHunt({ q: host }) : undefined)
  const { events, alerts, status, stats } = useEngine()
  const activity = useActivity(events, alerts)
  const down = status === 'down'

  // The panel's section is operator state in the URL (?pestana=): a
  // refresh or a shared link lands on the same tab, never a resummed
  // wall of charts. Read after mount so the pre-rendered HTML matches
  // the default and hydration stays quiet; popstate re-syncs.
  const [tab, setTabState] = useState<DashboardTab>('resumen')
  useEffect(() => {
    const read = () => setTabState(dashboardTabFromParam(new URLSearchParams(currentSearch()).get('pestana')))
    read()
    window.addEventListener('popstate', read)
    return () => window.removeEventListener('popstate', read)
  }, [])
  const setTab = (next: DashboardTab) => {
    setTabState(next)
    pushOperatorState((search) => writeDashboardTabToSearch(search, next))
  }

  return (
    <div className="space-y-5">
      {down && <OfflineNotice title={dict.panel.offlineTitle} hint={dict.panel.offlineHint} />}

      <DashboardTabs tab={tab} onTab={setTab} />

      {tab === 'resumen' && (
        <>
          {/* Reading order of a shift: what needs triage now, how the
              engine is doing, and the shape of what came in. */}
          <AnimatedContent order={0}>
            <OperationsOverview onNavigate={onNavigate} onTriage={onTriage} />
          </AnimatedContent>
          <AnimatedContent order={1}>
            <KpiRow stats={stats} />
          </AnimatedContent>
          {/* items-start: each panel hugs its content. Without it the
              grid stretches the shorter panel and leaves a dead area
              inside the card (Pulimiento B, ronda del acento zinc). */}
          <AnimatedContent order={2} className="grid items-start gap-5 xl:grid-cols-2">
            <div className="panel min-w-0 px-4 pb-3 pt-3.5">
              <AlertsView compact onAnalyze={onAnalyze} />
            </div>
            <EngineSummary status={status} />
          </AnimatedContent>
          <AnimatedContent order={3} className="grid gap-5 xl:grid-cols-3">
            <SeverityPanel alerts={alerts} down={down} onHunt={onHunt} />
            <SourceDonutPanel alerts={alerts} down={down} />
            <FleetDonutPanel />
          </AnimatedContent>
        </>
      )}

      {tab === 'deteccion' && (
        <>
          {/* What was detected and how the detection stack stands:
              coverage and scenario validation first, then composition,
              timeline and where triage work piles up. */}
          <AnimatedContent order={0}>
            <AttackPanel onHunt={onHunt} onScenarioTactic={onScenarioTactic} />
          </AnimatedContent>
          <AnimatedContent order={1} className="grid gap-5 xl:grid-cols-3">
            <TimelinePanel alerts={alerts} down={down} />
            <TopRulesPanel alerts={alerts} down={down} onHunt={onHunt} />
          </AnimatedContent>
          <AnimatedContent order={2} className="grid gap-5 xl:grid-cols-3">
            <LifecycleTacticPanel alerts={alerts} down={down} />
            <TacticDonutPanel alerts={alerts} down={down} />
          </AnimatedContent>
          <AnimatedContent order={3}>
            <TriageFlowPanel alerts={alerts} down={down} />
          </AnimatedContent>
        </>
      )}

      {tab === 'actividad' && (
        <>
          {/* What the sensors see: volume, entity relationships, per-host
              spread and when the load lands on the week. */}
          <AnimatedContent order={0}>
            <ActivityCard activity={activity} eventsCount={events.length} down={down} />
          </AnimatedContent>
          <AnimatedContent order={1} className="grid gap-5 xl:grid-cols-3">
            <InvestigationGraphPanel onHunt={onHunt} onHost={hostLens} />
            <div className="flex min-w-0 flex-col gap-5">
              <HotHostsPanel onHost={hostLens} />
            </div>
          </AnimatedContent>
          <AnimatedContent order={2} className="grid gap-5 xl:grid-cols-3">
            <RiskEvolutionPanel down={down} />
            <HeatmapPanel onHost={hostLens} />
            <TelemetryMixPanel down={down} />
          </AnimatedContent>
          <AnimatedContent order={3}>
            <AlertHeatmapPanel down={down} />
          </AnimatedContent>
          <AnimatedContent order={4}>
            <RecentTelemetry onNavigate={onNavigate} />
          </AnimatedContent>
        </>
      )}
    </div>
  )
}

/** Section tabs of the Panel: one reading per tab, nothing stacked.
 * Uses the shared tab kit (Pulimiento B, POL-7): same look and the same
 * roving-tabindex keyboard pattern as the Detección tablist. */
function DashboardTabs({ tab, onTab }: { tab: DashboardTab; onTab: (tab: DashboardTab) => void }) {
  const { dict } = useI18n()
  const tabs = DASHBOARD_TABS.map((id) => ({ id, label: dict.panel.tabs[id], icon: TAB_ICONS[id] }))
  return <ConsoleTablist idPrefix="panel" ariaLabel={dict.panel.tabsAria} tabs={tabs} value={tab} onSelect={onTab} />
}

/** Sensor activity of the received window (full-width card of the
 * Equipos y actividad tab). */
function ActivityCard({ activity, eventsCount, down }: { activity: ReturnType<typeof useActivity>; eventsCount: number; down: boolean }) {
  const { dict } = useI18n()
  const ago = (ms: number) => {
    if (ms < 1000) return dict.panel.ago.now
    const s = Math.round(ms / 1000)
    if (s < 60) return dict.panel.ago.s(s)
    const m = Math.round(s / 60)
    if (m < 60) return dict.panel.ago.m(m)
    return dict.panel.ago.h(Math.round(m / 60))
  }
  return (
    <ChartCard
      title={dict.panel.activity.title}
      subtitle={dict.panel.activity.subtitle}
      icon={Pulse}
      legend={[
        { key: 'events', label: dict.panel.activity.legendEvents, color: 'var(--series-1)', shape: 'line' },
        ...SEVERITIES.filter((s) => activity.markers.some((m) => m.color === SEV_COLOR[s])).map((s) => ({
          key: s, label: dict.panel.activity.legendAlert(dict.panel.sevLower[s]), color: SEV_COLOR[s],
        })),
      ]}
      table={{
        caption: dict.panel.activity.tableCaption,
        columns: [dict.panel.activity.colInterval, dict.panel.activity.colEvents, dict.panel.activity.colAlerts],
        rows: activity.points.slice().reverse().map((p) => [
          ago(activity.now - p.end),
          p.value,
          activity.markers.filter((m) => m.t >= p.start && m.t < p.end).length,
        ]),
      }}
      footer={
        <span className="flex flex-wrap gap-x-4">
          <span>{dict.panel.activity.bufferA}{eventsCount}{dict.panel.activity.bufferB}</span>
          <span>{dict.panel.activity.peakA}<span className="font-medium tabular-nums text-zinc-300">{activity.peak}</span>{dict.panel.activity.peakB}</span>
          <span>{dict.panel.activity.totalA}<span className="font-medium tabular-nums text-zinc-300">{activity.total}</span>{dict.panel.activity.totalB}</span>
        </span>
      }
    >
      {down ? <Unavailable /> : <ActivityChart activity={activity} withMarkers />}
    </ChartCard>
  )
}

/**
 * Investigation graph of the received window. Nodes open the alert queue
 * searching for that entity (a destination searches its address).
 */
function InvestigationGraphPanel({ onHunt, onHost }: { onHunt?: (lens: HuntLens) => void; onHost?: (host: string) => void }) {
  const { dict } = useI18n()
  const { alerts, events, status } = useEngine()
  const graph = useMemo(() => buildEntityGraph(alerts, events), [alerts, events])
  const degree = (id: string) => graph.edges.filter((e) => e.source === id || e.target === id).length
  return (
    <ChartCard
      className="xl:col-span-2"
      title={dict.panel.graph.title}
      subtitle={dict.panel.graph.subtitle}
      icon={Graph}
      table={{
        caption: dict.panel.graph.tableCaption,
        columns: [dict.panel.graph.colEntity, dict.panel.graph.colType, dict.panel.graph.colConnections, dict.panel.graph.colWeight],
        rows: graph.nodes.map((n) => [n.label, dict.charts.graph.kinds[n.kind], degree(n.id), n.weight]),
      }}
      footer={graph.folded > 0 ? dict.panel.graph.footerFolded(graph.folded) : dict.panel.graph.footerPlain}
    >
      {status === 'down' ? <Unavailable /> : graph.nodes.length === 0 ? (
        <EmptyState icon={Graph} title={dict.panel.graph.emptyTitle} hint={dict.panel.graph.emptyHint} />
      ) : (
        <div className="space-y-2">
          <GraphLegend graph={graph} />
          <EntityGraphView
            graph={graph}
            live
            height={430}
            ariaLabel={dict.panel.graph.aria(graph.nodes.length, graph.edges.length)}
            onSelect={onHunt ? (node) => (node.kind === 'host' && onHost ? onHost(node.label) : onHunt({ q: node.kind === 'destination' ? node.label.replace(/:\d+$/, '') : node.label })) : undefined}
          />
        </div>
      )}
    </ChartCard>
  )
}

/** Alerts per host and ATT&CK tactic. */
function HeatmapPanel({ onHost }: { onHost?: (host: string) => void }) {
  const { dict } = useI18n()
  const { alerts, status } = useEngine()
  const matrix = useMemo(() => hostTacticMatrix(alerts), [alerts])
  return (
    <ChartCard
      title={dict.panel.heat.title}
      subtitle={dict.panel.heat.subtitle}
      icon={GridFour}
    >
      {status === 'down' ? <Unavailable /> : matrix.hosts.length === 0 ? (
        <EmptyState icon={GridFour} title={dict.panel.heat.emptyTitle} hint={dict.panel.heat.emptyHint} />
      ) : (
        <HostTacticHeatmap matrix={matrix} onHost={onHost} />
      )}
    </ChartCard>
  )
}

function Unavailable() {
  const { dict } = useI18n()
  return <EmptyState icon={ChartLineUp} title={dict.panel.unavailableTitle} hint={dict.panel.unavailableHint} />
}

/** Alerts per severity in the received window: magnitude by category. */
function SeverityPanel({ alerts, down, onHunt }: { alerts: SfAlert[]; down: boolean; onHunt?: (lens: HuntLens) => void }) {
  const { dict } = useI18n()
  const counts = severityCounts(alerts)
  const total = alerts.length
  return (
    <ChartCard
      title={dict.panel.severity.title}
      subtitle={dict.panel.severity.subtitle(total)}
      icon={ShieldWarning}
      table={{
        caption: dict.panel.severity.tableCaption,
        columns: [dict.panel.severity.colSeverity, dict.panel.severity.colAlerts, dict.panel.severity.colShare],
        rows: SEVERITIES.map((s) => [dict.panel.sevLabels[s], counts[s], total ? Math.round((counts[s] / total) * 100) + ' %' : '—']),
      }}
    >
      {down ? <Unavailable /> : total === 0 ? (
        <EmptyState icon={ShieldWarning} title={dict.panel.severity.emptyTitle} hint={dict.panel.severity.emptyHint} />
      ) : (
        <BarList
          rows={SEVERITIES.map((s: Severity) => ({
            key: s,
            label: (
              <span className="flex items-center gap-2">
                <SeverityIcon severity={s} size={14} />
                {dict.panel.sevLabels[s]}
              </span>
            ),
            value: counts[s],
            hint: total ? Math.round((counts[s] / total) * 100) + ' %' : undefined,
            color: SEV_COLOR[s],
            onSelect: onHunt && counts[s] > 0 ? () => onHunt({ sev: s }) : undefined,
            selectLabel: dict.panel.severity.selectLabel(counts[s], dict.panel.sevLower[s]),
          }))}
        />
      )}
    </ChartCard>
  )
}

/** VIZ-1 — palette handed to the donuts: named slices take the four
 * validated categorical hues in order, the folded «Otros» takes the
 * muted token. */
function donutColors(model: ReturnType<typeof buildDonut>): Record<string, string> {
  const out: Record<string, string> = {}
  let named = 0
  for (const slice of model.slices) {
    out[slice.key] = isOtherSlice(slice) ? 'var(--series-other)' : RISK_SERIES_COLORS[named++ % RISK_SERIES_COLORS.length]
  }
  return out
}

function donutLegend(model: ReturnType<typeof buildDonut>, colors: Record<string, string>) {
  return model.slices.map((s) => ({ key: s.key, label: s.label, color: colors[s.key], value: s.value }))
}

function donutTable(model: ReturnType<typeof buildDonut>, caption: string, kind: string, alertsCol: string, shareCol: string) {
  return {
    caption,
    columns: [kind, alertsCol, shareCol],
    rows: model.entries.map((e) => [e.label, e.value, model.total ? Math.round((e.value / model.total) * 100) + ' %' : '—']),
  }
}

/** VIZ-1 — donut of the received window per ATT&CK tactic (≤ 4 named
 * slices + «Otros»; the exact unfolded breakdown lives in the table). */
function TacticDonutPanel({ alerts, down }: { alerts: SfAlert[]; down: boolean }) {
  const { dict } = useI18n()
  const model = useMemo(() => {
    const counts = new Map<string, number>()
    for (const alert of alerts) {
      const slug = alertTactic(alert)
      const key = slug ?? '__sin-tactica'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return buildDonut([...counts.entries()].map(([key, value]) => {
      const tactic = ATTACK_TACTICS.find((t) => t.slug === key)
      return { key, label: tactic ? tactic.short : dict.panel.sinTactica, value }
    }))
  }, [alerts, dict])
  const colors = donutColors(model)
  return (
    <ChartCard
      title={dict.panel.donutTactic.title}
      subtitle={dict.panel.donutTactic.subtitle(alerts.length)}
      icon={ChartPie}
      legend={donutLegend(model, colors)}
      table={donutTable(model, dict.panel.donutTactic.tableCaption, dict.panel.donutTactic.colKind, dict.panel.severity.colAlerts, dict.panel.severity.colShare)}
      footer={model.fold ? dict.panel.donutTactic.footerFold(model.fold.count, model.fold.value) : undefined}
    >
      {down ? <Unavailable /> : model.total === 0 ? (
        <EmptyState icon={ChartPie} title={dict.panel.donutTactic.emptyTitle} hint={dict.panel.donutTactic.emptyHint} />
      ) : (
        <DonutChart model={model} colors={colors} unit={dict.panel.unitAlerts} ariaLabel={dict.panel.donutTactic.aria(model.total, model.entries.length)} />
      )}
    </ChartCard>
  )
}

/** VIZ-1 — donut of the received window per declared source. */
function SourceDonutPanel({ alerts, down }: { alerts: SfAlert[]; down: boolean }) {
  const { dict } = useI18n()
  const model = useMemo(() => {
    const counts = new Map<string, number>()
    for (const alert of alerts) {
      const key = alert.source?.trim() || '__sin-fuente'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return buildDonut([...counts.entries()].map(([key, value]) => ({ key, label: key === '__sin-fuente' ? dict.panel.sinFuente : key, value })))
  }, [alerts, dict])
  const colors = donutColors(model)
  return (
    <ChartCard
      title={dict.panel.donutSource.title}
      subtitle={dict.panel.donutSource.subtitle(alerts.length)}
      icon={ChartPie}
      legend={donutLegend(model, colors)}
      table={donutTable(model, dict.panel.donutSource.tableCaption, dict.panel.donutSource.colKind, dict.panel.severity.colAlerts, dict.panel.severity.colShare)}
      footer={model.fold ? dict.panel.donutSource.footerFold(model.fold.count, model.fold.value) : dict.panel.donutSource.footerPlain}
    >
      {down ? <Unavailable /> : model.total === 0 ? (
        <EmptyState icon={ChartPie} title={dict.panel.donutSource.emptyTitle} hint={dict.panel.donutSource.emptyHint} />
      ) : (
        <DonutChart model={model} colors={colors} unit={dict.panel.unitAlerts} ariaLabel={dict.panel.donutSource.aria(model.total, model.entries.length)} />
      )}
    </ChartCard>
  )
}

/** VIZ-1 — donut of the machine inventory by connection state, from
 * the engine fleet endpoint the Equipos view already polls. */
function FleetDonutPanel() {
  const { dict } = useI18n()
  const { fleet, available, loaded } = useFleet()
  const model = useMemo(() => fleet
    ? buildDonut([
      { key: 'online', label: dict.panel.donutFleet.online, value: fleet.online },
      { key: 'silent', label: dict.panel.donutFleet.silent, value: fleet.silent },
      { key: 'idle', label: dict.panel.donutFleet.idle, value: fleet.idle },
    ])
    : null, [fleet, dict])
  const colors: Record<string, string> = { online: 'var(--series-2)', silent: 'var(--sev-critical)', idle: 'var(--series-other)' }
  return (
    <ChartCard
      title={dict.panel.donutFleet.title}
      subtitle={fleet ? dict.panel.donutFleet.subtitleHosts(fleet.hosts.length) : dict.panel.donutFleet.subtitleApi}
      icon={Desktop}
      legend={model ? donutLegend(model, colors) : undefined}
      table={model ? {
        caption: dict.panel.donutFleet.tableCaption,
        columns: [dict.panel.donutFleet.colState, dict.panel.donutFleet.colHosts, dict.panel.donutFleet.colShare],
        rows: model.entries.map((e) => [e.label, e.value, model.total ? Math.round((e.value / model.total) * 100) + ' %' : '—']),
      } : undefined}
      footer={dict.panel.donutFleet.footer}
    >
      {!loaded ? (
        <SkeletonRows rows={3} />
      ) : !available || !model || model.total === 0 ? (
        <EmptyState icon={Desktop} title={dict.panel.donutFleet.emptyTitle} hint={dict.panel.donutFleet.emptyHint} />
      ) : (
        <DonutChart model={model} colors={colors} unit={dict.panel.unitHosts} ariaLabel={dict.panel.donutFleet.aria(model.total)} />
      )}
    </ChartCard>
  )
}

/** VIZ-3 — triage flow: declared source → ATT&CK tactic → triage state,
 * over the alert window the console already received. The engine only
 * publishes three lifecycle states, so no false-positive band is drawn;
 * the footer says so instead of inventing data. */
function TriageFlowPanel({ alerts, down }: { alerts: SfAlert[]; down: boolean }) {
  const { dict } = useI18n()
  const model = useMemo(() => buildTriageFlow(alerts), [alerts])
  const series = LIFECYCLE_SERIES.map((s) => ({ key: s.key, label: dict.panel.lifecycle[s.key], color: s.color }))
  return (
    <ChartCard
      title={dict.panel.triageFlow.title}
      subtitle={dict.panel.triageFlow.subtitle}
      icon={FlowArrow}
      legend={series.map((s) => ({ key: s.key, label: s.label, color: s.color, shape: 'rect' as const }))}
      table={{
        caption: dict.panel.triageFlow.tableCaption,
        columns: [dict.panel.triageFlow.colSource, dict.panel.triageFlow.colTactic, dict.panel.triageFlow.colState, dict.panel.triageFlow.colAlerts],
        rows: model.triples.map((t) => [t.source, t.tactic, t.state, t.value]),
      }}
      footer={
        <span className="flex flex-wrap gap-x-4">
          <span>{dict.panel.triageFlow.bufferA}{dict.panel.triageFlow.received(model.total)}{model.foldedSources ? dict.panel.triageFlow.foldSources(model.foldedSources) : ''}{model.foldedTactics ? dict.panel.triageFlow.foldTactics(model.foldedTactics) : ''}{dict.panel.triageFlow.bufferB}</span>
          <span>{dict.panel.triageFlow.statesNote}</span>
        </span>
      }
    >
      {down ? <Unavailable /> : model.total === 0 ? (
        <EmptyState icon={FlowArrow} title={dict.panel.triageFlow.emptyTitle} hint={dict.panel.triageFlow.emptyHint} />
      ) : model.states.filter((st) => st.value > 0).length < 2 ? (
        <EmptyState
          icon={FlowArrow}
          title={dict.panel.triageFlow.singleTitle(model.total, model.states.find((st) => st.value > 0)?.label ?? dict.panel.lifecycle.nuevas)}
          hint={dict.panel.triageFlow.singleHint}
        />
      ) : (
        <TriageFlowChart model={model} unit={dict.panel.unitAlerts} ariaLabel={dict.panel.triageFlow.aria(model.total, model.sources.length, model.tactics.length, model.states.filter((s) => s.value > 0).length)} />
      )}
    </ChartCard>
  )
}

/** Detections of the last hour by severity, 5-minute columns. */
function TimelinePanel({ alerts, down }: { alerts: SfAlert[]; down: boolean }) {
  const { dict } = useI18n()
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const buckets = useMemo(() => severityBuckets(alerts, now ?? 0, TIMELINE_WINDOW_MS, TIMELINE_BUCKET_MS), [alerts, now])
  const inWindow = buckets.reduce((sum, b) => sum + b.total, 0)
  const counts = SEVERITIES.map((s) => buckets.reduce((sum, b) => sum + b.counts[s], 0))
  const clock = (t: number) => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false })
  return (
    <ChartCard
      className="xl:col-span-2"
      title={dict.panel.timeline.title}
      subtitle={dict.panel.timeline.subtitle}
      icon={Stack}
      legend={SEVERITIES.map((s, i) => ({ key: s, label: dict.panel.sevLabels[s], color: SEV_COLOR[s], value: counts[i] }))}
      table={{
        caption: dict.panel.timeline.tableCaption,
        columns: [dict.panel.timeline.colInterval, ...SEVERITIES.map((s) => dict.panel.sevLabels[s]), dict.panel.timeline.colTotal],
        rows: buckets.slice().reverse().map((b) => [`${clock(b.start)}–${clock(b.end)}`, ...SEVERITIES.map((s) => b.counts[s]), b.total]),
      }}
      footer={dict.panel.timeline.footer(inWindow, alerts.length)}
    >
      {down ? <Unavailable /> : now === null ? <div style={{ height: 176 }} /> : (
        <StackedColumns
          buckets={buckets.map((b) => ({
            key: String(b.start),
            label: clock(b.end),
            detail: `${clock(b.start)} – ${clock(b.end)}`,
            values: b.counts,
          }))}
          series={SEVERITIES.map((s) => ({ key: s, label: dict.panel.sevLabels[s], color: SEV_COLOR[s] }))}
          ariaLabel={dict.panel.timeline.aria(inWindow)}
          unit={dict.panel.unitTotal}
        />
      )}
    </ChartCard>
  )
}

/**
 * Hot hosts (engine A1): decayed per-host risk, highest first. The score
 * models what the engine SAW, not the operator's triage, so it cools down
 * on its own (30 min half-life). Meter state against the published
 * weights (critical alert = 10 points): >= 20 critical, >= 5 elevated.
 */
function HotHostsPanel({ onHost }: { onHost?: (host: string) => void }) {
  const { dict } = useI18n()
  const { stats } = useEngine()
  const hot = stats?.hot_hosts ?? []
  const max = hot.reduce((m, h) => Math.max(m, h.score), 0)
  const level = (score: number) =>
    score >= 20
      ? { label: dict.panel.hot.levels.critical, color: 'var(--status-critical)', severity: 'critical' as const }
      : score >= 5
        ? { label: dict.panel.hot.levels.elevated, color: 'var(--status-warning)', severity: 'medium' as const }
        : { label: dict.panel.hot.levels.low, color: 'var(--series-1)', severity: 'low' as const }

  return (
    <ChartCard
      title={dict.panel.hot.title}
      subtitle={dict.panel.hot.subtitle(String(stats?.risk_hosts_tracked ?? '—'))}
      icon={Flame}
      table={hot.length ? {
        caption: dict.panel.hot.tableCaption,
        columns: [dict.panel.hot.colHost, dict.panel.hot.colScore, dict.panel.hot.colAlerts, dict.panel.hot.colLevel],
        rows: hot.map((h) => [h.host, h.score.toFixed(2), h.alerts, level(h.score).label]),
      } : undefined}
      footer={dict.panel.hot.footer}
    >
      {stats && hot.length === 0 ? (
        <EmptyState icon={Flame} title={dict.panel.hot.emptyTitle} hint={dict.panel.hot.emptyHint} />
      ) : !stats ? (
        <EmptyState icon={Flame} title={dict.panel.hot.noDataTitle} hint={dict.panel.hot.noDataHint} />
      ) : (
        <ul className="space-y-1">
          {hot.map((h, i) => {
            const lv = level(h.score)
            const body = (
              <>
                <span className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200" title={h.host}>{h.host}</span>
                  <span className="flex items-center gap-1 text-[11px] text-zinc-400">
                    <SeverityIcon severity={lv.severity} size={12} />
                    {lv.label}
                  </span>
                  <span className="w-12 text-right text-xs font-semibold tabular-nums text-zinc-50">{h.score.toFixed(1)}</span>
                </span>
                <Meter className="mt-1.5" value={h.score} max={max} color={lv.color} />
                <span className="mt-1 block text-[11px] text-zinc-500">{dict.panel.hot.seen(h.alerts, formatTime(h.last_seen))}</span>
              </>
            )
            return (
              <li key={h.host}>
                {/* AnimatedItem (React Bits): entrada escalonada; keys estables por host */}
                <AnimatedItem index={i}>
                  {onHost ? (
                    <button
                      type="button"
                      onClick={() => onHost(h.host)}
                      aria-label={dict.panel.hot.openAria(h.host, lv.label, h.score.toFixed(1))}
                      className="block w-full rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-zinc-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="px-1.5 py-1.5">{body}</div>
                  )}
                </AnimatedItem>
              </li>
            )
          })}
        </ul>
      )}
    </ChartCard>
  )
}

/**
 * ATT&CK coverage (SIM-3): rules loaded, alerts of the window and — when
 * the engine serves its scenario library (`-scenarios`) — how many lab
 * scenarios validate each tactic. A validated cell opens the Validación
 * view filtered by tactic; the rest keep the alert hunt click-through.
 */
function AttackPanel({ onHunt, onScenarioTactic }: { onHunt?: (lens: HuntLens) => void; onScenarioTactic?: (slug: string) => void }) {
  const { dict } = useI18n()
  const { rules, alerts, status, sequences } = useEngine()
  const cells = useMemo(() => tacticCoverage(rules, alerts), [rules, alerts])
  // the library lives on disk and reloads on every engine call: fetched
  // once per mount, mapped against the CURRENT rules and sequences
  const [scenarios, setScenarios] = useState<ScenarioView[] | 'off' | null>(null)
  useEffect(() => {
    let alive = true
    fetchScenarioSurface().then((surface) => {
      if (!alive) return
      setScenarios(surface.state === 'armed' ? surface.library.scenarios : 'off')
    })
    return () => {
      alive = false
    }
  }, [])
  const validation = useMemo(
    () => (scenarios && scenarios !== 'off' ? scenarioCountsByTactic(scenarios, rules, sequences) : null),
    [scenarios, rules, sequences],
  )
  const validatedTactics = validation ? [...validation.values()].filter((n) => n > 0).length : 0
  const validatedScenarios = validation ? [...validation.values()].reduce((sum, n) => sum + n, 0) : 0
  return (
    <ChartCard
      title={dict.panel.attack.title}
      subtitle={dict.panel.attack.subtitle(coveredOf(cells), validation ? dict.panel.attack.subtitleValidated(validatedScenarios, validatedTactics) : '')}
      icon={Crosshair}
      table={{
        caption: dict.panel.attack.tableCaption,
        columns: [dict.panel.attack.colTactic, dict.panel.attack.colRules, dict.panel.attack.colAlerts, dict.panel.attack.colScenarios],
        rows: cells.map((c) => [c.label, c.rules, c.alerts, validation?.get(c.slug) ?? 0]),
      }}
      footer={
        validation
          ? dict.panel.attack.footerValidated
          : scenarios === 'off'
            ? dict.panel.attack.footerOff
            : undefined
      }
    >
      {status === 'down' ? <Unavailable /> : (
        <AttackMatrix
          cells={cells}
          validations={validation ?? undefined}
          onSelect={onHunt ? (cell) => onHunt({ q: 'attack.' + cell.slug }) : undefined}
          onSelectValidated={onScenarioTactic ? (cell) => onScenarioTactic(cell.slug) : undefined}
        />
      )}
    </ChartCard>
  )
}

/** Tactics carrying at least one loaded rule. */
function coveredOf(cells: ReturnType<typeof tacticCoverage>): number {
  return cells.filter((c) => c.rules > 0).length
}

function TopRulesPanel({ alerts, down, onHunt }: { alerts: SfAlert[]; down: boolean; onHunt?: (lens: HuntLens) => void }) {
  const { dict } = useI18n()
  const ranked = useMemo(() => topCounts(alerts, (a) => a.rule_name, 6), [alerts])
  return (
    <ChartCard
      className="flex-1"
      title={dict.panel.topRules.title}
      subtitle={dict.panel.topRules.subtitle(ranked.distinct)}
      icon={ListBullets}
      table={{ caption: dict.panel.topRules.tableCaption, columns: [dict.panel.topRules.colRule, dict.panel.topRules.colAlerts], rows: ranked.top.map((r) => [r.key, r.count]) }}
      footer={ranked.rest > 0 ? dict.panel.topRules.footer(ranked.rest) : undefined}
    >
      {down ? <Unavailable /> : (
        <BarList
          rows={ranked.top.map((r) => ({
            key: r.key, label: r.key, title: r.key, value: r.count,
            onSelect: onHunt ? () => onHunt({ q: r.key }) : undefined,
            selectLabel: dict.panel.topRules.selectLabel(r.count, r.key),
          }))}
          empty={<EmptyState icon={ListBullets} title={dict.panel.topRules.emptyTitle} hint={dict.panel.topRules.emptyHint} />}
        />
      )}
    </ChartCard>
  )
}

function TelemetryMixPanel({ down }: { down: boolean }) {
  const { dict } = useI18n()
  const { events } = useEngine()
  const mix = useMemo(() => eventTypeMix(events, 6), [events])
  return (
    <ChartCard
      title={dict.panel.mix.title}
      subtitle={dict.panel.mix.subtitle(events.length)}
      icon={Waveform}
      table={{ caption: dict.panel.mix.tableCaption, columns: [dict.panel.mix.colType, dict.panel.mix.colEvents], rows: mix.top.map((r) => [r.key, r.count]) }}
      footer={mix.rest > 0 ? dict.panel.mix.footer(mix.rest, mix.distinct - mix.top.length) : undefined}
    >
      {down ? <Unavailable /> : (
        <BarList
          color="var(--series-2)"
          rows={mix.top.map((r) => ({ key: r.key, label: <span className="font-mono">{r.key}</span>, value: r.count }))}
          empty={<EmptyState icon={Waveform} title={dict.panel.mix.emptyTitle} hint={dict.panel.mix.emptyHint} />}
        />
      )}
    </ChartCard>
  )
}

/**
 * Triage lifecycle per ATT&CK tactic: where unhandled work piles up in
 * the kill chain. Read with the heatmap above it (hosts x tactic) and
 * the timeline (when): this one answers "what is still open".
 */
function LifecycleTacticPanel({ alerts, down }: { alerts: SfAlert[]; down: boolean }) {
  const { dict } = useI18n()
  const { columns, total } = useMemo(() => lifecycleTacticColumns(alerts), [alerts])
  const byState = (s: LifecycleState) => columns.reduce((sum, c) => sum + c.values[s], 0)
  const counts = LIFECYCLE_SERIES.map((s) => byState(s.key))
  const series = LIFECYCLE_SERIES.map((s) => ({ key: s.key, label: dict.panel.lifecycle[s.key], color: s.color }))
  return (
    <ChartCard
      className="xl:col-span-2"
      title={dict.panel.lifecycleTactic.title}
      subtitle={dict.panel.lifecycleTactic.subtitle}
      icon={ListBullets}
      legend={series.map((s, i) => ({ key: s.key, label: s.label, color: s.color, value: counts[i] }))}
      table={{
        caption: dict.panel.lifecycleTactic.tableCaption,
        columns: [dict.panel.lifecycleTactic.colTactic, dict.panel.lifecycle.nuevas, dict.panel.lifecycle.reconocidas, dict.panel.lifecycle.cerradas, dict.panel.timeline.colTotal],
        rows: columns.map((c) => [c.label, c.values.nuevas, c.values.reconocidas, c.values.cerradas, c.total]),
      }}
      footer={dict.panel.lifecycleTactic.footer(counts[0])}
    >
      {down ? <Unavailable /> : total === 0 ? (
        <EmptyState icon={ListBullets} title={dict.panel.lifecycleTactic.emptyTitle} hint={dict.panel.lifecycleTactic.emptyHint} />
      ) : (
        <StackedColumns
          buckets={columns.map((c) => ({ key: c.key, label: c.short, detail: c.label, values: c.values }))}
          series={series}
          ariaLabel={dict.panel.lifecycleTactic.aria(total, columns.length)}
          unit={dict.panel.unitTotal}
        />
      )}
    </ChartCard>
  )
}

/**
 * Sample the engine's hot-hosts list on a fixed 10 s grid (stats poll
 * every 2 s; one sample per slot). `down` records gaps instead of
 * pinning the last reading: no invented continuity.
 */
function useRiskHistory(stats: EngineStats | null, down: boolean): RiskSample[] {
  const [history, setHistory] = useState<RiskSample[]>([])
  const lastApplied = useRef(0)
  useEffect(() => {
    // before the first stats reply there is nothing to record: taking the
    // slot then showed "no risk" next to Hosts calientes for 10 s
    if (!stats && !down) return
    const now = Date.now()
    if (lastApplied.current && now - lastApplied.current < RISK_SLOT_MS) return
    lastApplied.current = now
    const hot = stats && !down ? stats.hot_hosts ?? [] : []
    setHistory((prev) => pushRiskSample(prev, hot, now))
  }, [stats, down])
  return history
}

/**
 * Per-host decayed risk over the last 10 minutes, drawn from real
 * engine snapshots (top-5 in /api/stats). Lines break when the engine
 * is down or a host leaves the top-5: not observed is not cold.
 */
function RiskEvolutionPanel({ down }: { down: boolean }) {
  const { dict } = useI18n()
  const { stats, status } = useEngine()
  const history = useRiskHistory(stats, status === 'down')
  const view = useMemo(() => riskSeriesView(history), [history])
  const series = view.series.map((s, i) => ({ key: s.host, label: s.host, color: RISK_SERIES_COLORS[i] }))
  const slots: LineSlot[] = useMemo(
    () =>
      history.map((s) => ({
        t: s.t,
        values: Object.fromEntries(view.series.map((h) => [h.host, s.ok ? s.values[h.host] ?? null : null])),
      })),
    [history, view.series],
  )
  const clock = (t: number) => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false })
  const tableRows = [...view.series, ...view.folded].map((h) => [h.host, h.last.toFixed(2), dict.panel.risk.levels[riskLevel(h.last)], h.samples])
  return (
    <ChartCard
      title={dict.panel.risk.title}
      subtitle={dict.panel.risk.subtitle(RISK_SLOT_MS / 1000, (RISK_SLOTS * RISK_SLOT_MS) / 60000)}
      icon={ChartLineUp}
      legend={series.map((s) => ({ key: s.key, label: s.label, color: s.color, shape: 'line' as const }))}
      table={
        tableRows.length
          ? { caption: dict.panel.risk.tableCaption, columns: [dict.panel.risk.colHost, dict.panel.risk.colLast, dict.panel.risk.colLevel, dict.panel.risk.colSamples], rows: tableRows }
          : undefined
      }
      footer={
        (view.folded.length ? dict.panel.risk.footerFolded(view.folded.length) : '') +
        dict.panel.risk.footerPlain
      }
    >
      {down ? (
        <Unavailable />
      ) : view.series.length === 0 ? (
        <EmptyState
          icon={ChartLineUp}
          title={dict.panel.risk.emptyTitle}
          hint={dict.panel.risk.emptyHint}
        />
      ) : (
        <LineChart
          series={series}
          slots={slots}
          height={196}
          ariaLabel={dict.panel.risk.aria(view.series.map((s) => s.host).join(', '), view.observed)}
          valueLabel={dict.panel.risk.valueLabel}
          formatT={clock}
        />
      )}
    </ChartCard>
  )
}

const HEATMAP_ALERT_LIMIT = 1000
const HEATMAP_REFRESH_MS = 5 * 60 * 1000

type AlertWindowFetch = {
  loading: boolean
  error: boolean
  alerts: { timestamp: string }[]
  fetchedAt: number | null
  /** the reply hit the API limit: there may be more alerts than fit here */
  truncated: boolean
}

/**
 * VIZ-2 fetch: one bounded request for the whole heatmap window,
 * separate from the shared live triage buffer (MAX_ALERTS is not a week
 * of history). `since` is the exact local-midnight window the chart
 * draws, so what leaves the engine is what lands on the grid. Slow
 * self-refresh plus a manual reload; a failed fetch is an error state,
 * never a fabricated empty week.
 */
function useAlertWindow(down: boolean): AlertWindowFetch & { reload: () => void } {
  const [snapshot, setSnapshot] = useState<AlertWindowFetch>({ loading: true, error: false, alerts: [], fetchedAt: null, truncated: false })
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((value) => value + 1), [])
  useEffect(() => {
    if (down) {
      setSnapshot({ loading: false, error: true, alerts: [], fetchedAt: null, truncated: false })
      return
    }
    let disposed = false
    const ctrl = new AbortController()
    const since = new Date(weekStart(Date.now(), WEEK_HOUR_DAYS)).toISOString()
    setSnapshot((prev) => ({ ...prev, loading: true, error: false }))
    readEngineJson<unknown>(engineApiBase(), `/api/alerts?since=${encodeURIComponent(since)}&limit=${HEATMAP_ALERT_LIMIT}`, ctrl.signal)
      .then((raw) => {
        if (disposed) return
        const items = Array.isArray(raw) ? raw : []
        const alerts = items
          .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && typeof (item as { timestamp?: unknown }).timestamp === 'string')
          .map((item) => ({ timestamp: (item as { timestamp: string }).timestamp }))
        setSnapshot({ loading: false, error: false, alerts, fetchedAt: Date.now(), truncated: alerts.length >= HEATMAP_ALERT_LIMIT })
      })
      .catch(() => {
        if (disposed || ctrl.signal.aborted) return
        setSnapshot({ loading: false, error: true, alerts: [], fetchedAt: null, truncated: false })
      })
    const timer = setTimeout(() => setTick((value) => value + 1), HEATMAP_REFRESH_MS)
    return () => {
      disposed = true
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [down, tick])
  return { ...snapshot, reload }
}

/** Browser IANA zone for the footer declaration (defensive fallback). */
function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'hora local del navegador'
  } catch {
    return 'hora local del navegador'
  }
}

/**
 * VIZ-2 — alert load on a weekday × hour grid of the last 7 local days:
 * when the fleet squeezes, to size shifts and maintenance windows. The
 * footer declares the exact window, the limit behaviour and the timezone;
 * nothing is interpolated or invented.
 */
function AlertHeatmapPanel({ down }: { down: boolean }) {
  const { dict } = useI18n()
  const windowFetch = useAlertWindow(down)
  const [timeZone] = useState(localTimeZone)
  const grid = useMemo(
    () => weekHourGrid(windowFetch.alerts, { now: windowFetch.fetchedAt ?? Date.now(), days: WEEK_HOUR_DAYS }),
    [windowFetch.alerts, windowFetch.fetchedAt],
  )
  const table =
    windowFetch.fetchedAt && grid.total > 0
      ? {
          caption: dict.panel.weekHeat.tableCaption,
          columns: [dict.panel.weekHeat.colDay, '00-05', '06-11', '12-17', '18-23', dict.panel.timeline.colTotal],
          rows: weekHourTableRows(grid, dict.charts.week.daysLong, dict.panel.timeline.colTotal),
        }
      : undefined
  const fetchedClock = windowFetch.fetchedAt
    ? new Date(windowFetch.fetchedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false })
    : null
  return (
    <ChartCard
      title={dict.panel.weekHeat.title}
      subtitle={dict.panel.weekHeat.subtitle}
      icon={CalendarDots}
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-[11px] text-zinc-400 hover:text-zinc-100"
          onClick={windowFetch.reload}
          disabled={windowFetch.loading}
        >
          {dict.panel.weekHeat.reload}
        </Button>
      }
      table={table}
      footer={
        <span className="flex flex-wrap gap-x-4">
          <span>{dict.panel.weekHeat.footerWindow(WEEK_HOUR_DAYS, timeZone)}</span>
          <span><span className="font-medium tabular-nums text-zinc-300">{grid.total}</span>{dict.panel.weekHeat.totalSuffix}</span>
          {windowFetch.truncated && <span className="text-zinc-400">{dict.panel.weekHeat.footerTruncated(HEATMAP_ALERT_LIMIT)}</span>}
          {grid.unreadable > 0 && <span>{dict.panel.weekHeat.footerUnreadable(grid.unreadable)}</span>}
          {fetchedClock && <span>{dict.panel.weekHeat.footerFetched(fetchedClock)}</span>}
        </span>
      }
    >
      {down || windowFetch.error ? (
        <Unavailable />
      ) : windowFetch.loading && !windowFetch.fetchedAt ? (
        <SkeletonRows rows={4} />
      ) : grid.total === 0 ? (
        <EmptyState
          icon={CalendarDots}
          title={dict.panel.weekHeat.emptyTitle}
          hint={dict.panel.weekHeat.emptyHint}
        />
      ) : (
        <WeekHourHeatmap grid={grid} />
      )}
    </ChartCard>
  )
}

function RecentTelemetry({ onNavigate }: { onNavigate: (view: ConsoleView) => void }) {
  const { dict } = useI18n()
  const { events, status } = useEngine()
  return (
    <section aria-label={dict.panel.recent.sectionAria} className="panel min-w-0 px-4 pb-3 pt-3.5">
      {/* Misma cabecera que el resto de paneles manuales del panel
          (icon-tile + título + contador); el enlace vive a la derecha. */}
      <div className="flex flex-wrap items-center gap-2.5 pb-3">
        <span className="icon-tile"><Waveform size={14} aria-hidden /></span>
        <h2 className="text-sm font-medium text-zinc-100">{dict.panel.recent.title}</h2>
        <span className="font-mono text-xs tabular-nums text-zinc-500">{events.length}</span>
        <Button
          variant="link"
          size="sm"
          className="ml-auto h-auto px-0 py-0 text-xs"
          onClick={() => onNavigate('flujo')}
        >
          {dict.panel.recent.openFeed}
        </Button>
      </div>
      {status === 'connecting' ? (
        <SkeletonRows rows={6} className="border-y border-zinc-800 py-6" />
      ) : status === 'down' ? (
        <EmptyState icon={Waveform} title={dict.panel.recent.downTitle} hint={dict.panel.recent.downHint} />
      ) : events.length === 0 ? (
        <EmptyState icon={Waveform} title={dict.panel.recent.emptyTitle} hint={dict.panel.recent.emptyHint} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-800">
          {/* Primera tabla del panel sobre la primitiva compartida (POL-7
              fase B): superficie, caption sr-only, cabecera compacta y filas
              con hairline salen del kit; aquí solo columnas y densidad. Las
              filas dejan la entrada escalonada de AnimatedItem: un motion.div
              no puede envolver un <tr> sin romper el DOM de tabla. */}
          <Table>
            <TableCaption>{dict.panel.recent.tableCaption}</TableCaption>
            <TableHeader>
              <TableHeadRow>
                <TableHead compact className="w-20">{dict.panel.recent.colTime}</TableHead>
                <TableHead compact className="w-40">{dict.panel.recent.colType}</TableHead>
                <TableHead compact>{dict.panel.recent.colDetail}</TableHead>
              </TableHeadRow>
            </TableHeader>
            <TableBody>
              {events.slice(0, 8).map((ev) => (
                <TableRow key={ev.id}>
                  <TableCell compact className="w-20 whitespace-nowrap font-mono text-xs tabular-nums text-zinc-500">{formatTime(ev.timestamp)}</TableCell>
                  <TableCell compact className="w-40 max-w-40 truncate font-mono text-xs text-primary-link" title={ev.type}>{ev.type}</TableCell>
                  <TableCell compact className="max-w-0 truncate font-mono text-xs text-zinc-400" title={eventDetail(ev)}>{eventDetail(ev)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="pt-2 text-xs text-zinc-500">{dict.panel.recent.footerSample}</p>
    </section>
  )
}

/** Pipeline health: identity, counters and rule types. */
function EngineSummary({ status }: { status: EngineStatus }) {
  const { dict } = useI18n()
  const { stats, rules, endpoint } = useEngine()

  const statusLine =
    status === 'live'
      ? dict.panel.engine.statusLive
      : status === 'connecting'
        ? dict.panel.engine.statusConnecting
        : dict.panel.engine.statusDown
  const ingestIssues = stats ? stats.dropped + stats.ingest_rejected : 0
  const webhookIssues = stats ? stats.webhook_failed + stats.webhook_dropped : 0
  const storeFailures = stats?.store_write_failures ?? 0

  const rows: { label: string; value: React.ReactNode; bad?: boolean }[] = [
    { label: dict.panel.engine.labels.mode, value: stats?.mode ?? (stats ? 'engine' : dict.panel.engine.noStats) },
    { label: dict.panel.engine.labels.api, value: endpoint },
    { label: dict.panel.engine.labels.events, value: stats?.events_total.toLocaleString('es-ES') ?? '—' },
    { label: dict.panel.engine.labels.dropped, value: stats ? `${stats.dropped} / ${stats.ingest_rejected}` : '— / —', bad: ingestIssues > 0 },
    { label: dict.panel.engine.labels.webhooks, value: stats ? dict.panel.engine.webhooksValue(stats.webhook_sent, stats.webhook_failed) : '—', bad: webhookIssues > 0 },
    {
      // opt-in SQLite persistence (engine -store): undefined = engine
      // predating the store or hub offline snapshot; said, not guessed.
      label: dict.panel.engine.labels.persistence,
      value: stats?.store_enabled ? dict.panel.engine.storeValue(stats.store_events ?? 0, stats.store_alerts ?? 0) : stats ? dict.panel.engine.storeOff : dict.panel.engine.noStats,
    },
    { label: dict.panel.engine.labels.storeFailures, value: stats?.store_write_failures ?? '—', bad: storeFailures > 0 },
    { label: dict.panel.engine.labels.rules, value: stats ? rules.length : '—' },
  ]

  return (
    <section aria-label={dict.panel.engine.sectionAria} className="panel min-w-0">
      <div className="flex flex-wrap items-center gap-2.5 px-4 pt-3.5">
        <span className="icon-tile"><Cpu size={14} aria-hidden /></span>
        <h2 className="text-sm font-medium text-zinc-100">{dict.panel.engine.title}</h2>
        {/* Estado de conexión como insignia del kit (POL-7): la forma es la
            píldora compartida y el color semántico viaja en className (dato,
            no variante), igual que hace SeverityBadge con la severidad. */}
        <Badge
          variant="neutral"
          className={status === 'live' ? 'text-emerald-300' : status === 'connecting' ? 'text-amber-300' : 'text-red-300'}
        >
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${status === 'live' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-400' : 'bg-red-500'}`} />
          {status === 'live' ? dict.panel.engine.badgeLive : status === 'connecting' ? dict.panel.engine.badgeConnecting : dict.panel.engine.badgeDown}
        </Badge>
        <p className="ml-auto hidden max-w-[60ch] truncate text-[11px] text-zinc-500 lg:block">{statusLine}</p>
      </div>
      {/* Hoja de especificación: 2×4 dentro de la tarjeta (antes 8 columnas
          apretadas en la mitad de la pantalla), etiqueta en micro-mayúsculas
          como las cabeceras de tabla y marcador ámbar a la izquierda cuando
          la fila pide atención (descartes, webhooks fallidos, SQLite). */}
      <dl className="grid grid-cols-2 gap-2 p-4 pt-3 sm:grid-cols-4">
        {rows.map((row) => (
          <div
            key={row.label}
            className={`min-w-0 rounded-md border-l-2 px-3 py-2 ${row.bad ? 'border-l-amber-400/60 bg-amber-400/[0.06]' : 'border-l-transparent bg-white/[0.02]'}`}
          >
            <dt className="text-[10px] uppercase leading-tight tracking-wide text-zinc-500" title={row.label}>{row.label}</dt>
            <dd className={`mt-1 truncate font-mono text-xs tabular-nums ${row.bad ? 'text-amber-300' : 'text-zinc-200'}`} title={String(row.value)}>{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] px-4 py-3">
        <span className="mr-1 text-[11px] text-zinc-500">{dict.panel.engine.rulesTypesLabel}</span>
        {(stats?.rules_types ?? []).map((t) => <MonoTag key={t}>{t}</MonoTag>)}
        {(stats?.rules_types ?? []).length === 0 && <span className="text-xs text-zinc-500">{dict.panel.engine.noCatalog}</span>}
      </div>
    </section>
  )
}
