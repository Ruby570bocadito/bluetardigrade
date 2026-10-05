'use client'

// Operations dashboard. Reading order of a SOC shift: what needs triage
// now (hero + lifecycle), how the engine is doing (stat tiles), what the
// sensors see (activity), what was detected (severity, timeline, ATT&CK
// coverage, rules, hosts) and the latest raw rows. Everything reads from
// the real engine stream; when the engine is down every card shows its
// own honest state instead of empty axes.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChartLineUp, Cpu, Crosshair, Flame, Graph, GridFour, ListBullets, Pulse, ShieldWarning, Stack, Waveform } from '@phosphor-icons/react'
import { useEngine } from './engine-provider'
import type { EngineStatus } from '@/hooks/use-engine-stream'
import { KpiRow } from './kpi-row'
import { OperationsOverview } from './operations-overview'
import { ActivityChart, useActivity } from './activity-chart'
import { AlertsView } from './alerts-view'
import { EmptyState, OfflineNotice, SkeletonRows, MonoTag } from './ui-bits'
import { AnimatedItem } from '@/components/reactbits/animated-list'
import { AnimatedContent } from '@/components/reactbits/animated-content'
import { EntityGraphView, GraphLegend, NODE_KIND } from '@/components/charts/entity-graph'
import { HostTacticHeatmap } from '@/components/charts/heatmap'
import { buildEntityGraph } from '@/lib/entity-graph'
import { ChartCard } from '@/components/charts/chart-frame'
import { StackedColumns } from '@/components/charts/stacked-columns'
import { LineChart, type LineSlot } from '@/components/charts/line-chart'
import { BarList, Meter } from '@/components/charts/bars'
import { AttackMatrix } from '@/components/charts/attack-matrix'
import { SEV_COLOR, SeverityIcon } from '@/components/charts/severity'
import { eventDetail, formatTime, type EngineStats, type SfAlert, type Severity } from '@/lib/console-types'
import { eventTypeMix, formatAgo, hostTacticMatrix, lifecycleTacticColumns, SEVERITIES, SEVERITY_LABEL, severityBuckets, severityCounts, tacticCoverage, topCounts, type LifecycleState } from '@/lib/soc-metrics'
import { pushRiskSample, riskSeriesView, RISK_SLOT_MS, RISK_SLOTS, type RiskSample } from '@/lib/risk-history'
import type { TriageTarget } from '@/lib/operations'
import type { SeverityFilter } from '@/lib/url-state'

export type ConsoleView =
  | 'panel' | 'flujo' | 'alertas' | 'incidentes' | 'equipos'
  | 'reglas' | 'cadenas' | 'inteligencia' | 'supresiones' | 'probador'
  | 'respuesta' | 'analista'
export type HuntLens = { q?: string; sev?: SeverityFilter }

const TIMELINE_WINDOW_MS = 60 * 60 * 1000
const TIMELINE_BUCKET_MS = 5 * 60 * 1000

// Triage lifecycle series in workflow order; categorical hues from the
// validated palette (no severity colors: lifecycle is a workflow state,
// not a magnitude).
const LIFECYCLE_SERIES: { key: LifecycleState; label: string; color: string }[] = [
  { key: 'nuevas', label: 'Nuevas', color: 'var(--series-1)' },
  { key: 'reconocidas', label: 'Reconocidas', color: 'var(--series-3)' },
  { key: 'cerradas', label: 'Cerradas', color: 'var(--series-2)' },
]

// Categorical palette order for the risk lines (capped at 4 series).
const RISK_SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)']

/** Same thresholds the engine publishes for hot hosts (A1 weights). */
function riskLevelLabel(score: number) {
  return score >= 20 ? 'crítico' : score >= 5 ? 'elevado' : 'bajo'
}

export function Dashboard({
  onAnalyze,
  onNavigate,
  onTriage,
  onHunt,
  onHost,
}: {
  onAnalyze: (al: SfAlert) => void
  onNavigate: (view: ConsoleView) => void
  onTriage: (target: TriageTarget) => void
  onHunt?: (lens: HuntLens) => void
  /** open the Equipos page of a host (falls back to the alert lens) */
  onHost?: (host: string) => void
}) {
  const hostLens = onHost ?? (onHunt ? (host: string) => onHunt({ q: host }) : undefined)
  const { events, alerts, status, stats } = useEngine()
  const activity = useActivity(events, alerts)
  const down = status === 'down'

  return (
    <div className="space-y-5">
      {down && (
        <OfflineNotice
          title="Motor offline"
          hint="La consola no muestra datos inventados. Arranca el motor (cmd/engine) con su API en 127.0.0.1:7778 y esta pantalla se recupera sola."
        />
      )}

      <AnimatedContent order={0}>
        <OperationsOverview onNavigate={onNavigate} onTriage={onTriage} />
      </AnimatedContent>
      <AnimatedContent order={1}>
        <KpiRow stats={stats} />
      </AnimatedContent>

      <AnimatedContent order={2} className="grid gap-5 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title="Actividad del sensor"
          subtitle="Eventos por intervalo de 5 s en los últimos 4 minutos, con las alertas del periodo en la franja inferior"
          icon={Pulse}
          legend={[
            { key: 'events', label: 'Eventos', color: 'var(--series-1)', shape: 'line' },
            ...SEVERITIES.filter((s) => activity.markers.some((m) => m.color === SEV_COLOR[s])).map((s) => ({
              key: s, label: 'Alerta ' + SEVERITY_LABEL[s].toLowerCase(), color: SEV_COLOR[s],
            })),
          ]}
          table={{
            caption: 'Eventos y alertas por intervalo de 5 segundos',
            columns: ['Intervalo', 'Eventos', 'Alertas'],
            rows: activity.points.slice().reverse().map((p) => [
              formatAgo(activity.now - p.end),
              p.value,
              activity.markers.filter((m) => m.t >= p.start && m.t < p.end).length,
            ]),
          }}
          footer={
            <span className="flex flex-wrap gap-x-4">
              <span>Muestra del búfer del cliente (últimos {events.length} eventos recibidos)</span>
              <span>pico <span className="font-medium tabular-nums text-zinc-300">{activity.peak}</span> por intervalo</span>
              <span>total <span className="font-medium tabular-nums text-zinc-300">{activity.total}</span> en 4 min</span>
            </span>
          }
        >
          {down ? <Unavailable /> : <ActivityChart activity={activity} withMarkers />}
        </ChartCard>

        <SeverityPanel alerts={alerts} down={down} onHunt={onHunt} />
      </AnimatedContent>

      <AnimatedContent order={3} className="grid gap-5 xl:grid-cols-3">
        <InvestigationGraphPanel onHunt={onHunt} onHost={hostLens} />
        <div className="flex min-w-0 flex-col gap-5">
          <HotHostsPanel onHost={hostLens} />
          <TopRulesPanel alerts={alerts} down={down} onHunt={onHunt} />
        </div>
      </AnimatedContent>

      <AnimatedContent order={4} className="grid gap-5 xl:grid-cols-3">
        <TimelinePanel alerts={alerts} down={down} />
        <TelemetryMixPanel down={down} />
      </AnimatedContent>

      <AnimatedContent order={5} className="grid gap-5 xl:grid-cols-3">
        <LifecycleTacticPanel alerts={alerts} down={down} />
        <RiskEvolutionPanel down={down} />
      </AnimatedContent>

      <AnimatedContent order={6}>
        <AttackPanel onHunt={onHunt} />
      </AnimatedContent>

      <AnimatedContent order={7}>
        <HeatmapPanel onHost={hostLens} />
      </AnimatedContent>

      <AnimatedContent order={8}>
        <EngineSummary status={status} />
      </AnimatedContent>

      <AnimatedContent order={9} className="grid gap-5 xl:grid-cols-2">
        <div className="panel min-w-0 px-4 pb-3 pt-3.5">
          <AlertsView compact onAnalyze={onAnalyze} />
        </div>
        <RecentTelemetry onNavigate={onNavigate} />
      </AnimatedContent>
    </div>
  )
}

/**
 * Investigation graph of the received window. Nodes open the alert queue
 * searching for that entity (a destination searches its address).
 */
function InvestigationGraphPanel({ onHunt, onHost }: { onHunt?: (lens: HuntLens) => void; onHost?: (host: string) => void }) {
  const { alerts, events, status } = useEngine()
  const graph = useMemo(() => buildEntityGraph(alerts, events), [alerts, events])
  const degree = (id: string) => graph.edges.filter((e) => e.source === id || e.target === id).length
  return (
    <ChartCard
      className="xl:col-span-2"
      title="Grafo de investigación"
      subtitle="Equipos, usuarios, procesos, detecciones y destinos de red de la ventana. Pulsa un nodo para ver sus alertas"
      icon={Graph}
      table={{
        caption: 'Entidades del grafo de investigación',
        columns: ['Entidad', 'Tipo', 'Conexiones', 'Alertas o eventos'],
        rows: graph.nodes.map((n) => [n.label, NODE_KIND[n.kind].label, degree(n.id), n.weight]),
      }}
      footer={graph.folded > 0 ? `${graph.folded} entidades menos activas quedan fuera del grafo; búscalas en la cola o en el flujo.` : 'Aristas animadas: detecciones críticas abiertas y conexiones de red observadas.'}
    >
      {status === 'down' ? <Unavailable /> : graph.nodes.length === 0 ? (
        <EmptyState icon={Graph} title="Sin entidades todavía" hint="El grafo se dibuja con la primera alerta o conexión de red recibida." />
      ) : (
        <div className="space-y-2">
          <GraphLegend graph={graph} />
          <EntityGraphView
            graph={graph}
            height={430}
            ariaLabel={`Grafo de investigación: ${graph.nodes.length} entidades y ${graph.edges.length} relaciones`}
            onSelect={onHunt ? (node) => (node.kind === 'host' && onHost ? onHost(node.label) : onHunt({ q: node.kind === 'destination' ? node.label.replace(/:\d+$/, '') : node.label })) : undefined}
          />
        </div>
      )}
    </ChartCard>
  )
}

/** Alerts per host and ATT&CK tactic. */
function HeatmapPanel({ onHost }: { onHost?: (host: string) => void }) {
  const { alerts, status } = useEngine()
  const matrix = useMemo(() => hostTacticMatrix(alerts), [alerts])
  return (
    <ChartCard
      title="Equipos por táctica"
      subtitle="Alertas de la ventana por equipo y táctica de ATT&CK"
      icon={GridFour}
    >
      {status === 'down' ? <Unavailable /> : matrix.hosts.length === 0 ? (
        <EmptyState icon={GridFour} title="Sin tácticas observadas" hint="Las alertas con etiqueta de táctica ATT&CK llenan esta matriz." />
      ) : (
        <HostTacticHeatmap matrix={matrix} onHost={onHost} />
      )}
    </ChartCard>
  )
}

function Unavailable() {
  return <EmptyState icon={ChartLineUp} title="Sin conexión con el motor" hint="El gráfico vuelve en cuanto el motor responda; no se dibujan datos antiguos." />
}

/** Alerts per severity in the received window: magnitude by category. */
function SeverityPanel({ alerts, down, onHunt }: { alerts: SfAlert[]; down: boolean; onHunt?: (lens: HuntLens) => void }) {
  const counts = severityCounts(alerts)
  const total = alerts.length
  return (
    <ChartCard
      title="Alertas por severidad"
      subtitle={`Ventana de ${total} alertas recibidas por la consola`}
      icon={ShieldWarning}
      table={{
        caption: 'Alertas por severidad en la ventana recibida',
        columns: ['Severidad', 'Alertas', '% de la ventana'],
        rows: SEVERITIES.map((s) => [SEVERITY_LABEL[s], counts[s], total ? Math.round((counts[s] / total) * 100) + ' %' : '—']),
      }}
    >
      {down ? <Unavailable /> : total === 0 ? (
        <EmptyState icon={ShieldWarning} title="Sin alertas en la ventana" hint="Las detecciones aparecen aquí en cuanto una regla dispara." />
      ) : (
        <BarList
          rows={SEVERITIES.map((s: Severity) => ({
            key: s,
            label: (
              <span className="flex items-center gap-2">
                <SeverityIcon severity={s} size={14} />
                {SEVERITY_LABEL[s]}
              </span>
            ),
            value: counts[s],
            hint: total ? Math.round((counts[s] / total) * 100) + ' %' : undefined,
            color: SEV_COLOR[s],
            onSelect: onHunt && counts[s] > 0 ? () => onHunt({ sev: s }) : undefined,
            selectLabel: `Ver ${counts[s]} alertas de severidad ${SEVERITY_LABEL[s].toLowerCase()}`,
          }))}
        />
      )}
    </ChartCard>
  )
}

/** Detections of the last hour by severity, 5-minute columns. */
function TimelinePanel({ alerts, down }: { alerts: SfAlert[]; down: boolean }) {
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
      title="Detecciones de la última hora"
      subtitle="Alertas por severidad en intervalos de 5 minutos"
      icon={Stack}
      legend={SEVERITIES.map((s, i) => ({ key: s, label: SEVERITY_LABEL[s], color: SEV_COLOR[s], value: counts[i] }))}
      table={{
        caption: 'Alertas por severidad en intervalos de 5 minutos durante la última hora',
        columns: ['Intervalo', ...SEVERITIES.map((s) => SEVERITY_LABEL[s]), 'Total'],
        rows: buckets.slice().reverse().map((b) => [`${clock(b.start)}–${clock(b.end)}`, ...SEVERITIES.map((s) => b.counts[s]), b.total]),
      }}
      footer={`${inWindow} de ${alerts.length} alertas de la ventana caen en la última hora. Las más antiguas siguen en la cola y en el histórico.`}
    >
      {down ? <Unavailable /> : now === null ? <div style={{ height: 176 }} /> : (
        <StackedColumns
          buckets={buckets.map((b) => ({
            key: String(b.start),
            label: clock(b.end),
            detail: `${clock(b.start)} – ${clock(b.end)}`,
            values: b.counts,
          }))}
          series={SEVERITIES.map((s) => ({ key: s, label: SEVERITY_LABEL[s], color: SEV_COLOR[s] }))}
          ariaLabel={`Detecciones de la última hora: ${inWindow} alertas en 12 intervalos de 5 minutos`}
          unit="alertas en total"
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
  const { stats } = useEngine()
  const hot = stats?.hot_hosts ?? []
  const max = hot.reduce((m, h) => Math.max(m, h.score), 0)
  const level = (score: number) =>
    score >= 20
      ? { label: 'crítico', color: 'var(--status-critical)', severity: 'critical' as const }
      : score >= 5
        ? { label: 'elevado', color: 'var(--status-warning)', severity: 'medium' as const }
        : { label: 'bajo', color: 'var(--series-1)', severity: 'low' as const }

  return (
    <ChartCard
      title="Hosts calientes"
      subtitle={`${stats?.risk_hosts_tracked ?? '—'} hosts con riesgo activo · vida media 30 min`}
      icon={Flame}
      table={hot.length ? {
        caption: 'Puntuación de riesgo por host',
        columns: ['Host', 'Puntuación', 'Alertas', 'Nivel'],
        rows: hot.map((h) => [h.host, h.score.toFixed(2), h.alerts, level(h.score).label]),
      } : undefined}
      footer="critical 10 · high 5 · medium 2 · low 1 punto por alerta. Señal de priorización, no un veredicto de compromiso."
    >
      {stats && hot.length === 0 ? (
        <EmptyState icon={Flame} title="Sin riesgo activo" hint="Ningún host acumula riesgo ahora: las puntuaciones decaen solas y solo las alertas recientes las alimentan." />
      ) : !stats ? (
        <EmptyState icon={Flame} title="Sin datos" hint="La puntuación de riesgo llega con la telemetría del motor; sin conexión no se muestra nada." />
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
                <span className="mt-1 block text-[11px] text-zinc-500">{h.alerts} alertas · visto {formatTime(h.last_seen)}</span>
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
                      aria-label={`Abrir la ficha de ${h.host}: riesgo ${lv.label}, ${h.score.toFixed(1)} puntos`}
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

/** ATT&CK coverage: rules loaded and alerts of the window per tactic. */
function AttackPanel({ onHunt }: { onHunt?: (lens: HuntLens) => void }) {
  const { rules, alerts, status } = useEngine()
  const cells = useMemo(() => tacticCoverage(rules, alerts), [rules, alerts])
  const covered = cells.filter((c) => c.rules > 0).length
  return (
    <ChartCard
      title="Cobertura MITRE ATT&CK"
      subtitle={`${covered} de 14 tácticas con reglas cargadas · intensidad = alertas de la ventana`}
      icon={Crosshair}
      table={{
        caption: 'Reglas y alertas por táctica de MITRE ATT&CK',
        columns: ['Táctica', 'Reglas', 'Alertas'],
        rows: cells.map((c) => [c.label, c.rules, c.alerts]),
      }}
    >
      {status === 'down' ? <Unavailable /> : (
        <AttackMatrix cells={cells} onSelect={onHunt ? (cell) => onHunt({ q: 'attack.' + cell.slug }) : undefined} />
      )}
    </ChartCard>
  )
}

function TopRulesPanel({ alerts, down, onHunt }: { alerts: SfAlert[]; down: boolean; onHunt?: (lens: HuntLens) => void }) {
  const ranked = useMemo(() => topCounts(alerts, (a) => a.rule_name, 6), [alerts])
  return (
    <ChartCard
      className="flex-1"
      title="Reglas más activas"
      subtitle={`${ranked.distinct} reglas distintas en la ventana`}
      icon={ListBullets}
      table={{ caption: 'Alertas por regla en la ventana', columns: ['Regla', 'Alertas'], rows: ranked.top.map((r) => [r.key, r.count]) }}
      footer={ranked.rest > 0 ? `${ranked.rest} alertas más en otras reglas.` : undefined}
    >
      {down ? <Unavailable /> : (
        <BarList
          rows={ranked.top.map((r) => ({
            key: r.key, label: r.key, title: r.key, value: r.count,
            onSelect: onHunt ? () => onHunt({ q: r.key }) : undefined,
            selectLabel: `Ver ${r.count} alertas de la regla ${r.key}`,
          }))}
          empty={<EmptyState icon={ListBullets} title="Sin detecciones" hint="El ranking aparece con la primera alerta." />}
        />
      )}
    </ChartCard>
  )
}

function TelemetryMixPanel({ down }: { down: boolean }) {
  const { events } = useEngine()
  const mix = useMemo(() => eventTypeMix(events, 6), [events])
  return (
    <ChartCard
      title="Mezcla de telemetría"
      subtitle={`Tipos de evento en el búfer (${events.length} eventos)`}
      icon={Waveform}
      table={{ caption: 'Eventos por tipo en el búfer del cliente', columns: ['Tipo', 'Eventos'], rows: mix.top.map((r) => [r.key, r.count]) }}
      footer={mix.rest > 0 ? `${mix.rest} eventos más de otros ${mix.distinct - mix.top.length} tipos.` : undefined}
    >
      {down ? <Unavailable /> : (
        <BarList
          color="var(--series-2)"
          rows={mix.top.map((r) => ({ key: r.key, label: <span className="font-mono">{r.key}</span>, value: r.count }))}
          empty={<EmptyState icon={Waveform} title="Sin eventos todavía" hint="Conecta un sensor para ver qué tipos de telemetría llegan." />}
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
  const { columns, total } = useMemo(() => lifecycleTacticColumns(alerts), [alerts])
  const byState = (s: LifecycleState) => columns.reduce((sum, c) => sum + c.values[s], 0)
  const counts = LIFECYCLE_SERIES.map((s) => byState(s.key))
  return (
    <ChartCard
      className="xl:col-span-2"
      title="Ciclo de vida por táctica"
      subtitle="Estado de triage de las alertas de la ventana, agrupadas por táctica ATT&CK"
      icon={ListBullets}
      legend={LIFECYCLE_SERIES.map((s, i) => ({ key: s.key, label: s.label, color: s.color, value: counts[i] }))}
      table={{
        caption: 'Alertas por táctica ATT&CK y estado de triage',
        columns: ['Táctica', 'Nuevas', 'Reconocidas', 'Cerradas', 'Total'],
        rows: columns.map((c) => [c.label, c.values.nuevas, c.values.reconocidas, c.values.cerradas, c.total]),
      }}
      footer={`${counts[0]} alertas nuevas esperan operador. Las alertas sin etiqueta de táctica aparecen como «Sin táctica»; las cerradas salen de la cola pero siguen contadas aquí.`}
    >
      {down ? <Unavailable /> : total === 0 ? (
        <EmptyState icon={ListBullets} title="Sin alertas en la ventana" hint="En cuanto una regla dispare, sus alertas se apilan aquí por táctica y estado de triage." />
      ) : (
        <StackedColumns
          buckets={columns.map((c) => ({ key: c.key, label: c.short, detail: c.label, values: c.values }))}
          series={LIFECYCLE_SERIES.map((s) => ({ key: s.key, label: s.label, color: s.color }))}
          ariaLabel={`Ciclo de vida por táctica: ${total} alertas de la ventana repartidas en ${columns.length} tácticas`}
          unit="alertas en total"
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
  const tableRows = [...view.series, ...view.folded].map((h) => [h.host, h.last.toFixed(2), riskLevelLabel(h.last), h.samples])
  return (
    <ChartCard
      title="Evolución del riesgo por equipo"
      subtitle={`Riesgo decaído del motor, muestra cada ${RISK_SLOT_MS / 1000} s · ventana de ${(RISK_SLOTS * RISK_SLOT_MS) / 60000} min`}
      icon={ChartLineUp}
      legend={series.map((s) => ({ key: s.key, label: s.label, color: s.color, shape: 'line' as const }))}
      table={
        tableRows.length
          ? { caption: 'Riesgo decaído por equipo (última muestra observada)', columns: ['Equipo', 'Último riesgo', 'Nivel', 'Muestras'], rows: tableRows }
          : undefined
      }
      footer={
        (view.folded.length ? `${view.folded.length} equipos más observados quedan fuera del gráfico y están en la tabla. ` : '') +
        'La línea se corta si el motor no publica o el equipo sale del top-5: no se interpola. Muestreo desde la apertura de la consola.'
      }
    >
      {down ? (
        <Unavailable />
      ) : view.series.length === 0 ? (
        <EmptyState
          icon={ChartLineUp}
          title="Sin riesgo observado aún"
          hint="El motor publica el top-5 de riesgo decaído en /api/stats; cuando un equipo entre en la lista, su línea empieza aquí."
        />
      ) : (
        <LineChart
          series={series}
          slots={slots}
          height={196}
          ariaLabel={`Evolución del riesgo por equipo: ${view.series.map((s) => s.host).join(', ')} en ${view.observed} muestras`}
          valueLabel="riesgo"
          formatT={clock}
        />
      )}
    </ChartCard>
  )
}

function RecentTelemetry({ onNavigate }: { onNavigate: (view: ConsoleView) => void }) {
  const { events, status } = useEngine()
  return (
    <section aria-label="Telemetría reciente" className="panel min-w-0 px-4 pb-3 pt-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-medium text-zinc-100">Telemetría reciente</h2>
          <span className="text-xs tabular-nums text-zinc-500">{events.length}</span>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('flujo')}
          className="rounded-sm text-xs text-blue-400 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Ver flujo completo
        </button>
      </div>
      {status === 'connecting' ? (
        <SkeletonRows rows={6} className="border-y border-zinc-800 py-6" />
      ) : status === 'down' ? (
        <EmptyState icon={Waveform} title="Telemetría no disponible" hint="Esperando la reconexión con el motor." />
      ) : events.length === 0 ? (
        <div className="border-y border-zinc-800">
          <EmptyState icon={Waveform} title="Sin eventos todavía" hint="El búfer del cliente se llena en cuanto el motor emite telemetría por /api/stream." />
        </div>
      ) : (
        <ul className="divide-y divide-zinc-800/70 border-y border-zinc-800">
          {events.slice(0, 8).map((ev, i) => (
            <li key={ev.id}>
              {/* AnimatedItem (React Bits): entrada escalonada en la carga
                  inicial; las keys estables evitan re-animar filas visibles. */}
              <AnimatedItem index={i} className="grid grid-cols-[64px_120px_minmax(0,1fr)] items-center gap-3 px-1 py-2 md:grid-cols-[72px_150px_minmax(0,1fr)]">
                <span className="font-mono text-xs tabular-nums text-zinc-500">{formatTime(ev.timestamp)}</span>
                <span className="truncate font-mono text-xs text-blue-300">{ev.type}</span>
                <span className="truncate font-mono text-xs text-zinc-400" title={eventDetail(ev)}>{eventDetail(ev)}</span>
              </AnimatedItem>
            </li>
          ))}
        </ul>
      )}
      <p className="pt-2 text-xs text-zinc-500">Muestra de los últimos 8 eventos del búfer</p>
    </section>
  )
}

/** Pipeline health: identity, counters and rule types. */
function EngineSummary({ status }: { status: EngineStatus }) {
  const { stats, rules, endpoint } = useEngine()

  const statusLine =
    status === 'live'
      ? 'Conectada a la API del motor Go: eventos, alertas y reglas llegan del pipeline real.'
      : status === 'connecting'
        ? 'Consultando la API del motor por primera vez.'
        : 'Sin conexión con la API del motor: no se muestra ningún dato.'
  const ingestIssues = stats ? stats.dropped + stats.ingest_rejected : 0
  const webhookIssues = stats ? stats.webhook_failed + stats.webhook_dropped : 0
  const storeFailures = stats?.store_write_failures ?? 0

  const rows: { label: string; value: React.ReactNode; bad?: boolean }[] = [
    { label: 'Modo', value: stats?.mode ?? (stats ? 'engine' : 'sin datos') },
    { label: 'API', value: endpoint },
    { label: 'Eventos totales', value: stats?.events_total.toLocaleString('es-ES') ?? '—' },
    { label: 'Descartados / rechazados', value: stats ? `${stats.dropped} / ${stats.ingest_rejected}` : '— / —', bad: ingestIssues > 0 },
    { label: 'Webhooks', value: stats ? `${stats.webhook_sent} enviados · ${stats.webhook_failed} fallidos` : '—', bad: webhookIssues > 0 },
    {
      // opt-in SQLite persistence (engine -store): undefined = engine
      // predating the store or hub offline snapshot; said, not guessed.
      label: 'Persistencia',
      value: stats?.store_enabled ? `SQLite · ${stats.store_events} eventos · ${stats.store_alerts} alertas` : stats ? 'sin store (-store off)' : 'sin datos',
    },
    { label: 'Fallos SQLite', value: stats?.store_write_failures ?? '—', bad: storeFailures > 0 },
    { label: 'Reglas cargadas', value: stats ? rules.length : '—' },
  ]

  return (
    <section aria-label="Resumen del motor" className="panel min-w-0">
      <div className="flex flex-wrap items-center gap-2.5 px-4 pt-3.5">
        <span className="icon-tile"><Cpu size={14} aria-hidden /></span>
        <h2 className="text-sm font-medium text-zinc-100">Salud del pipeline</h2>
        <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          <span aria-hidden className={`h-2 w-2 rounded-full ${status === 'live' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-400' : 'bg-red-500'}`} />
          {status === 'live' ? 'en vivo' : status === 'connecting' ? 'conectando' : 'sin conexión'}
        </span>
        <p className="ml-auto hidden max-w-[60ch] truncate text-[11px] text-zinc-500 lg:block">{statusLine}</p>
      </div>
      <dl className="grid grid-cols-2 gap-px p-4 sm:grid-cols-4 xl:grid-cols-8">
        {rows.map((row) => (
          <div key={row.label} className={`min-w-0 rounded-lg px-3 py-2.5 ${row.bad ? 'bg-amber-400/[0.06]' : 'bg-white/[0.02]'}`}>
            <dt className="truncate text-[11px] text-zinc-500" title={row.label}>{row.label}</dt>
            <dd className={`mt-1 truncate font-mono text-xs tabular-nums ${row.bad ? 'text-amber-300' : 'text-zinc-200'}`} title={String(row.value)}>{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] px-4 py-3">
        <span className="mr-1 text-[11px] text-zinc-500">Tipos de evento con reglas</span>
        {(stats?.rules_types ?? []).map((t) => <MonoTag key={t}>{t}</MonoTag>)}
        {(stats?.rules_types ?? []).length === 0 && <span className="text-xs text-zinc-500">sin catálogo todavía</span>}
      </div>
    </section>
  )
}
