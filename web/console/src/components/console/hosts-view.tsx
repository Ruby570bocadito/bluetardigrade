'use client'

// Equipos: one page per endpoint, the way EDR consoles present a host.
// The index merges every host the console has seen (alerts, telemetry
// and the engine's risk scores); the host page shows its risk, alerts,
// a live process tree built from the received telemetry, the entity
// graph, network destinations and a single timeline of events and
// alerts. The open host is part of the URL (?host=).

import { useEffect, useMemo, useState } from 'react'
import { ArrowSquareOut, Desktop, FolderPlus, Gear, Globe, Lightning, MagnifyingGlass, TreeStructure, UserCircle } from '@phosphor-icons/react'
import { useEngine } from './engine-provider'
import { useIncidents } from './incidents-provider'
import { useFleet } from './fleet-provider'
import { EnrollDialog, FleetStatusPill, FleetSummary, SensorCard } from './fleet-parts'
import { BaselineCard } from './baseline-card'
import { PendingHosts } from './enroll-parts'
import type { FleetHost, FleetStatus } from '@/lib/fleet'
import { EmptyState, SeverityBadge, StatTile } from './ui-bits'
import { AnimatedItem } from '@/components/reactbits/animated-list'
import { ChartCard } from '@/components/charts/chart-frame'
import { BarList, Meter } from '@/components/charts/bars'
import { EntityGraphView, GraphLegend } from '@/components/charts/entity-graph'
import { ProcessTree } from '@/components/charts/process-tree'
import { SeverityIcon } from '@/components/charts/severity'
import { buildEntityGraph, buildProcessTree } from '@/lib/entity-graph'
import { createIncident } from '@/lib/engine-writes'
import { topCounts, SEVERITY_LABEL } from '@/lib/soc-metrics'
import { alertKey } from '@/lib/engine-client'
import { eventDetail, formatTime, type Severity, type SfAlert, type SfEvent } from '@/lib/console-types'
import { currentSearch, readLensState, replaceOperatorState, writeHostToSearch } from '@/lib/url-state'

type HostRow = { host: string; score: number; alerts: number; critical: number; events: number; lastSeen: string; fleet?: FleetHost }

const RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }

export function riskLevel(score: number) {
  return score >= 20
    ? { label: 'crítico', color: 'var(--status-critical)', severity: 'critical' as const }
    : score >= 5
      ? { label: 'elevado', color: 'var(--status-warning)', severity: 'medium' as const }
      : { label: 'bajo', color: 'var(--series-1)', severity: 'low' as const }
}

function useHostIndex(): HostRow[] {
  const { alerts, events, stats } = useEngine()
  const { fleet } = useFleet()
  return useMemo(() => {
    const rows = new Map<string, HostRow>()
    const row = (host: string) => {
      const key = host.toLowerCase()
      let r = rows.get(key)
      if (!r) {
        r = { host, score: 0, alerts: 0, critical: 0, events: 0, lastSeen: '' }
        rows.set(key, r)
      }
      return r
    }
    for (const a of alerts) {
      if (!a.host) continue
      const r = row(a.host)
      r.alerts++
      if (a.severity === 'critical') r.critical++
      if (a.timestamp > r.lastSeen) r.lastSeen = a.timestamp
    }
    for (const e of events) {
      if (!e.host) continue
      const r = row(e.host)
      r.events++
      if (e.timestamp > r.lastSeen) r.lastSeen = e.timestamp
    }
    for (const h of stats?.hot_hosts ?? []) {
      const r = row(h.host)
      r.score = h.score
      if (h.last_seen > r.lastSeen) r.lastSeen = h.last_seen
    }
    // machines the engine's inventory knows, even with nothing in the
    // console buffers (a silent sensor is exactly that case)
    for (const f of fleet?.hosts ?? []) {
      const r = row(f.host)
      r.fleet = f
      if (f.last_seen > r.lastSeen) r.lastSeen = f.last_seen
    }
    const silentFirst = (r: HostRow) => (r.fleet?.status === 'silent' ? 0 : 1)
    return [...rows.values()].sort((a, b) => silentFirst(a) - silentFirst(b) || b.score - a.score || b.alerts - a.alerts || a.host.localeCompare(b.host))
  }, [alerts, events, stats, fleet])
}

export function HostsView({ onHunt, onOpenAlert, onOpenIncident }: {
  onHunt: (q: string) => void
  onOpenAlert: (alertId: string) => void
  onOpenIncident: (id: string) => void
}) {
  const rows = useHostIndex()
  const { status } = useEngine()
  const [selected, setSelectedState] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | FleetStatus>('all')
  const [enrolling, setEnrolling] = useState(false)

  useEffect(() => {
    const apply = () => setSelectedState(readLensState(currentSearch()).host)
    apply()
    window.addEventListener('popstate', apply)
    return () => window.removeEventListener('popstate', apply)
  }, [])
  const select = (host: string) => {
    setSelectedState(host)
    replaceOperatorState((search) => writeHostToSearch(search, host))
  }

  const visible = rows.filter((r) => r.host.toLowerCase().includes(query.trim().toLowerCase()) && (statusFilter === 'all' || r.fleet?.status === statusFilter))
  // Without a ?host= lens the riskiest host opens (the index is sorted by
  // risk), so the page is never an empty frame; the URL stays untouched
  // until the analyst picks a host.
  const current = rows.find((r) => r.host.toLowerCase() === selected.toLowerCase()) ?? (selected ? { host: selected, score: 0, alerts: 0, critical: 0, events: 0, lastSeen: '' } : rows[0] ?? null)
  const maxScore = Math.max(1, ...rows.map((r) => r.score))

  return (
    <div className="space-y-4">
    <FleetSummary onEnroll={() => setEnrolling(true)} />
    <PendingHosts />
    {enrolling && <EnrollDialog onClose={() => setEnrolling(false)} />}
    <section aria-label="Equipos" className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
      <div className="panel flex min-w-0 flex-col overflow-hidden">
        <div className="panel-head justify-between">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-medium text-zinc-100">Equipos</h2>
            <span className="text-xs tabular-nums text-zinc-500">{rows.length}</span>
          </div>
          <div className="relative">
            <MagnifyingGlass size={13} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar equipo" placeholder="buscar equipo"
              className="h-8 w-40 rounded-md border border-zinc-800 bg-zinc-900 pl-7 pr-2 text-xs text-zinc-200 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </div>
        </div>
        <div role="group" aria-label="Filtrar equipos por estado" className="flex gap-1 border-b border-white/[0.05] px-3 py-2">
          {([['all', 'Todos'], ['online', 'En línea'], ['silent', 'Sin señal'], ['idle', 'Inactivos']] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}
              className={`rounded-md px-2.5 py-1 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${statusFilter === value ? 'bg-primary-tint/15 text-primary-soft' : 'text-zinc-400 hover:text-zinc-100'}`}>
              {label}
            </button>
          ))}
        </div>
        {visible.length === 0 ? (
          <EmptyState icon={Desktop} title={status === 'down' ? 'Motor sin conexión' : 'Ningún equipo todavía'} hint="Los equipos aparecen con su primera telemetría o alerta." />
        ) : (
          <ul className="max-h-[72vh] divide-y divide-white/[0.05] overflow-y-auto">
            {visible.map((r, i) => {
              const lv = riskLevel(r.score)
              const active = current?.host.toLowerCase() === r.host.toLowerCase()
              return (
                <li key={r.host}>
                  <AnimatedItem index={i}>
                    <button type="button" onClick={() => select(r.host)} aria-current={active ? 'true' : undefined}
                      className={`block w-full px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${active ? 'bg-primary-tint/[0.08]' : 'hover:bg-white/[0.03]'}`}>
                      <span className="flex items-center gap-2">
                        <Desktop size={15} aria-hidden className="text-primary" />
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-100">{r.host}</span>
                        <FleetStatusPill host={r.fleet} />
                        {r.score > 0 && (
                          <span className="flex items-center gap-1 text-[11px] text-zinc-400">
                            <SeverityIcon severity={lv.severity} size={11} />
                            {r.score.toFixed(1)}
                          </span>
                        )}
                      </span>
                      <Meter className="mt-2" value={r.score} max={maxScore} color={lv.color} />
                      <span className="mt-1.5 block text-[11px] text-zinc-500">
                        {r.alerts} alertas{r.critical ? ` (${r.critical} críticas)` : ''} · {r.events} eventos{r.lastSeen ? ` · ${formatTime(r.lastSeen)}` : ''}
                      </span>
                    </button>
                  </AnimatedItem>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {current ? (
        <HostPage key={current.host} row={current} onHunt={onHunt} onOpenAlert={onOpenAlert} onOpenIncident={onOpenIncident} />
      ) : (
        <div className="panel">
          <EmptyState icon={Desktop} title="Selecciona un equipo" hint="Verás su riesgo, sus alertas, el árbol de procesos en vivo, sus conexiones y la línea de tiempo." />
        </div>
      )}
    </section>
    </div>
  )
}

function HostPage({ row, onHunt, onOpenAlert, onOpenIncident }: {
  row: HostRow
  onHunt: (q: string) => void
  onOpenAlert: (alertId: string) => void
  onOpenIncident: (id: string) => void
}) {
  const { alerts, events } = useEngine()
  const { upsert } = useIncidents()
  const [message, setMessage] = useState('')
  const hostKey = row.host.toLowerCase()
  const hostAlerts = useMemo(() => alerts.filter((a) => a.host?.toLowerCase() === hostKey), [alerts, hostKey])
  const hostEvents = useMemo(() => events.filter((e) => e.host?.toLowerCase() === hostKey), [events, hostKey])
  const tree = useMemo(() => buildProcessTree(hostEvents), [hostEvents])
  const graph = useMemo(() => buildEntityGraph(hostAlerts, hostEvents), [hostAlerts, hostEvents])
  const destinations = useMemo(() => topCounts(hostEvents.filter((e) => e.type === 'network.connect'), (e) => {
    const h = e.network?.domain || e.network?.destination_ip
    return h ? (e.network?.destination_port ? `${h}:${e.network.destination_port}` : h) : null
  }, 6), [hostEvents])
  const users = new Set([...hostAlerts.map((a) => a.user), ...hostEvents.map((e) => e.user)].filter(Boolean))
  const processes = new Set(hostEvents.filter((e) => e.process?.name).map((e) => e.process!.name.toLowerCase()))
  const lv = riskLevel(row.score)
  const worst = hostAlerts.reduce<Severity | null>((w, a) => (w === null || RANK[a.severity] > RANK[w] ? a.severity : w), null)

  const timeline = useMemo(() => {
    const items: ({ kind: 'alert'; at: string; alert: SfAlert } | { kind: 'event'; at: string; event: SfEvent })[] = [
      ...hostAlerts.map((alert) => ({ kind: 'alert' as const, at: alert.timestamp, alert })),
      ...hostEvents.map((event) => ({ kind: 'event' as const, at: event.timestamp, event })),
    ]
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60)
  }, [hostAlerts, hostEvents])

  async function openIncident() {
    const ids = hostAlerts.map((a) => a.id).filter((id): id is string => Boolean(id))
    const res = await createIncident({
      title: `Actividad sospechosa en ${row.host}`,
      severity: worst ?? 'medium',
      alert_ids: ids.slice(0, 500),
      hosts: [row.host],
    })
    if (!res.ok) return setMessage(res.error)
    upsert(res.data)
    onOpenIncident(res.data.id)
  }

  return (
    <article aria-label={`Equipo ${row.host}`} className="min-w-0 space-y-4">
      <header className="panel px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="icon-tile h-10 w-10"><Desktop size={20} aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-mono text-lg font-semibold text-zinc-50">{row.host}</h2>
            <p className="text-xs text-zinc-500">{row.lastSeen ? `Última actividad ${formatTime(row.lastSeen)}` : 'Sin actividad en la ventana'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onHunt(row.host)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary-tint/10 px-3 py-1.5 text-xs font-medium text-primary-soft hover:bg-primary-tint/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ArrowSquareOut size={13} aria-hidden /> Ver alertas del equipo
            </button>
            <button type="button" onClick={() => void openIncident()} disabled={hostAlerts.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/[0.04] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <FolderPlus size={13} aria-hidden /> Abrir incidente con sus alertas
            </button>
          </div>
        </div>
        {message && <p role="alert" className="mt-2 text-xs text-red-300">{message}</p>}
        <div className="mt-4 flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-zinc-400"><SeverityIcon severity={lv.severity} size={13} /> riesgo {lv.label}</span>
          <Meter className="max-w-sm flex-1" value={row.score} max={Math.max(20, row.score)} color={lv.color} />
          <span className="text-sm font-semibold tabular-nums text-zinc-50">{row.score.toFixed(1)}</span>
        </div>
      </header>

      <SensorCard host={row.fleet} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile icon={Lightning} label="Alertas en la ventana" value={hostAlerts.length} hint={worst ? `la más grave: ${SEVERITY_LABEL[worst].toLowerCase()}` : 'ninguna'} warn={worst === 'critical'} />
        <StatTile icon={Gear} label="Procesos distintos" value={processes.size} hint="en la telemetría recibida" />
        <StatTile icon={Globe} label="Destinos de red" value={destinations.distinct} hint="conexiones salientes vistas" />
        <StatTile icon={UserCircle} label="Usuarios" value={users.size} hint={[...users].slice(0, 2).join(', ') || 'sin usuario declarado'} />
      </div>

      <div className="grid gap-4 2xl:grid-cols-2">
        <ChartCard title="Árbol de procesos en vivo" subtitle="Procesos creados en el equipo según la telemetría recibida" icon={TreeStructure}>
          {tree.length === 0 ? (
            <EmptyState icon={TreeStructure} title="Sin procesos en la ventana" hint="El árbol se forma con los eventos process.create del sensor." />
          ) : (
            <div className="max-h-96 overflow-y-auto"><ProcessTree roots={tree} label={`Árbol de procesos de ${row.host}`} /></div>
          )}
        </ChartCard>
        <ChartCard title="Grafo del equipo" subtitle="Usuarios, procesos, detecciones y destinos de este equipo" icon={Desktop}>
          {graph.nodes.length < 2 ? (
            <EmptyState icon={Desktop} title="Sin relaciones todavía" hint="El grafo aparece con alertas o conexiones del equipo." />
          ) : (
            <div className="space-y-2">
              <GraphLegend graph={graph} />
              <EntityGraphView graph={graph} height={360} ariaLabel={`Grafo del equipo ${row.host}`} />
            </div>
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <ChartCard title="Línea de tiempo del equipo" subtitle="Eventos y alertas recibidos, los más recientes primero" icon={Lightning}>
          {timeline.length === 0 ? (
            <EmptyState icon={Lightning} title="Sin actividad" hint="La línea de tiempo usa la ventana en vivo de la consola." />
          ) : (
            <ol className="max-h-[28rem] space-y-0.5 overflow-y-auto">
              {timeline.map((item) =>
                item.kind === 'alert' ? (
                  <li key={'a' + alertKey(item.alert)}>
                    <button type="button" onClick={() => item.alert.id && onOpenAlert(item.alert.id)}
                      className="grid w-full grid-cols-[64px_auto_minmax(0,1fr)] items-center gap-2 rounded-md border border-red-400/15 bg-red-500/[0.05] px-2 py-1.5 text-left hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="font-mono text-[11px] tabular-nums text-zinc-500">{formatTime(item.at)}</span>
                      <SeverityBadge severity={item.alert.severity} />
                      <span className="truncate text-xs text-zinc-100">{item.alert.rule_name}</span>
                    </button>
                  </li>
                ) : (
                  <li key={'e' + item.event.id} className="grid grid-cols-[64px_120px_minmax(0,1fr)] items-center gap-2 px-2 py-1">
                    <span className="font-mono text-[11px] tabular-nums text-zinc-600">{formatTime(item.at)}</span>
                    <span className="truncate font-mono text-[11px] text-primary-link/80">{item.event.type}</span>
                    <span className="truncate font-mono text-[11px] text-zinc-400" title={eventDetail(item.event)}>{eventDetail(item.event)}</span>
                  </li>
                ),
              )}
            </ol>
          )}
        </ChartCard>
        <div className="min-w-0 space-y-4">
          <ChartCard title="Destinos de red" subtitle="Conexiones salientes del equipo" icon={Globe}>
            <BarList
              color="var(--series-4)"
              rows={destinations.top.map((r) => ({ key: r.key, label: <span className="font-mono">{r.key}</span>, value: r.count }))}
              empty={<EmptyState icon={Globe} title="Sin conexiones" hint="Aparecen con los eventos network.connect." />}
            />
          </ChartCard>
          <BaselineCard host={row.host} alerts={hostAlerts} onOpenAlert={onOpenAlert} />
        </div>
      </div>
    </article>
  )
}
