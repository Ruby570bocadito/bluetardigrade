'use client'

// Incidents: cases that group alerts (engine /api/incidents). The list
// on the left filters by state; the case on the right carries status,
// severity, owner, the affected hosts, its alerts, a graph of the
// entities those alerts touch and the timeline the engine records for
// every change. The open case is part of the URL (?incidente=).

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowSquareOut,
  CheckCircle,
  ClockCounterClockwise,
  Desktop,
  FileHtml,
  FileText,
  Files,
  FolderOpen,
  Lightning,
  NotePencil,
  Plus,
  ShieldWarning,
  Sparkle,
  Stack,
  UserCircle,
  Warning,
} from '@phosphor-icons/react'
import { useEngine } from './engine-provider'
import { useIncidents } from './incidents-provider'
import { IncidentPlaybook } from './incident-playbook'
import { EmptyState, SeverityBadge, StatTile } from './ui-bits'
import { AnimatedItem } from '@/components/reactbits/animated-list'
import { EntityGraphView, GraphLegend } from '@/components/charts/entity-graph'
import { buildEntityGraph } from '@/lib/entity-graph'
import { buildIncidentAnalysis, type PendingIncidentAnalysis } from '@/lib/incident-analysis'
import { buildIncidentHtml, buildIncidentMarkdown, reportFilename } from '@/lib/incident-report'
import {
  addIncidentNote,
  createIncident,
  INCIDENT_STATUS_LABEL,
  updateIncident,
  type Incident,
  type IncidentEntry,
  type IncidentStatus,
} from '@/lib/engine-writes'
import type { IncidentPlaybookState } from '@/lib/incident-playbook'
import { alertKey } from '@/lib/engine-client'
import { formatDateTime, formatTime, type Severity } from '@/lib/console-types'
import { currentSearch, readLensState, replaceOperatorState, writeIncidentToSearch } from '@/lib/url-state'
import { SEVERITIES, SEVERITY_LABEL } from '@/lib/soc-metrics'

type Filter = 'active' | 'all' | 'closed'

const STATUS_STYLE: Record<IncidentStatus, string> = {
  open: 'border-red-400/30 bg-red-500/10 text-red-200',
  investigating: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  contained: 'border-primary/30 bg-primary-tint/10 text-primary-soft',
  closed: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
}

export function StatusChip({ status }: { status: IncidentStatus }) {
  return <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${STATUS_STYLE[status]}`}>{INCIDENT_STATUS_LABEL[status]}</span>
}

export function IncidentsView({ onHost, onOpenAlert, onAnalyze, onOpenEngineReport }: { onHost: (host: string) => void; onOpenAlert: (alertId: string) => void; onAnalyze?: (pending: PendingIncidentAnalysis) => void; onOpenEngineReport?: (incidentId: string) => void }) {
  const { incidents, persistent, available, loaded, upsert } = useIncidents()
  const [filter, setFilter] = useState<Filter>('active')
  const [selected, setSelectedState] = useState<string>('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    const apply = () => setSelectedState(readLensState(currentSearch()).incidente)
    apply()
    window.addEventListener('popstate', apply)
    return () => window.removeEventListener('popstate', apply)
  }, [])
  const select = (id: string) => {
    setSelectedState(id)
    replaceOperatorState((search) => writeIncidentToSearch(search, id))
  }

  const counts = useMemo(() => {
    const out: Record<IncidentStatus, number> = { open: 0, investigating: 0, contained: 0, closed: 0 }
    for (const i of incidents) out[i.status]++
    return out
  }, [incidents])
  const visible = incidents.filter((i) => (filter === 'all' ? true : filter === 'closed' ? i.status === 'closed' : i.status !== 'closed'))
  // Without a ?incidente= lens the first case of the list opens, so the
  // page is never an empty frame while cases exist; the URL stays untouched
  // until the analyst picks one.
  const current = incidents.find((i) => i.id === selected) ?? (selected ? null : visible[0] ?? null)
  const openId = current?.id ?? ''

  if (loaded && !available) {
    return (
      <div className="panel">
        <EmptyState
          icon={FolderOpen}
          title="Este motor no ofrece incidentes"
          hint="Actualiza la instalación (sf-update): los incidentes llegan con la versión del motor que incluye /api/incidents."
        />
      </div>
    )
  }

  return (
    <section aria-label="Incidentes" className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile icon={Warning} label="Abiertos" value={counts.open} hint="sin asignar trabajo todavía" warn={counts.open > 0} />
        <StatTile icon={ClockCounterClockwise} label="Investigando" value={counts.investigating} hint="con analista trabajando" />
        <StatTile icon={ShieldWarning} label="Contenidos" value={counts.contained} hint="amenaza aislada, sin cerrar" />
        <StatTile icon={CheckCircle} label="Cerrados" value={counts.closed} hint={persistent ? 'guardados en el motor' : 'solo en memoria del motor'} />
      </div>
      {!persistent && loaded && (
        <p className="rounded-lg border border-amber-400/20 bg-amber-400/[0.05] px-3 py-2 text-xs text-amber-200/90">
          El motor guarda los incidentes solo en memoria: se perderán al reiniciarlo. Arráncalo con -incidents para conservarlos.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
        <div className="panel flex min-w-0 flex-col overflow-hidden">
          <div className="panel-head justify-between">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-medium text-zinc-100">Casos</h2>
              <span className="text-xs tabular-nums text-zinc-500">{visible.length}</span>
            </div>
            <button
              type="button"
              onClick={() => setCreating((v) => !v)}
              aria-expanded={creating}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary-tint/10 px-2.5 py-1.5 text-xs font-medium text-primary-soft hover:bg-primary-tint/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus size={13} aria-hidden /> Nuevo incidente
            </button>
          </div>
          {creating && (
            <NewIncidentForm
              onDone={(inc) => {
                setCreating(false)
                if (inc) {
                  upsert(inc)
                  select(inc.id)
                }
              }}
            />
          )}
          <div role="group" aria-label="Filtrar incidentes" className="flex gap-1 border-b border-white/[0.06] px-3 py-2">
            {([['active', 'Activos'], ['all', 'Todos'], ['closed', 'Cerrados']] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
                className={`rounded-md px-2.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  filter === id ? 'bg-primary-tint/15 text-primary-soft' : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title={incidents.length === 0 ? 'Ningún incidente todavía' : 'Ninguno con este filtro'}
              hint="Crea uno aquí o selecciona alertas en la cola y usa «Añadir a incidente»."
            />
          ) : (
            <ul className="max-h-[70vh] divide-y divide-white/[0.05] overflow-y-auto">
              {visible.map((inc, i) => (
                <li key={inc.id}>
                  <AnimatedItem index={i}>
                    <button
                      type="button"
                      onClick={() => select(inc.id === selected ? '' : inc.id)}
                      aria-current={inc.id === openId ? 'true' : undefined}
                      className={`block w-full px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                        inc.id === openId ? 'bg-primary-tint/[0.08]' : 'hover:bg-white/[0.03]'
                      }`}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <SeverityBadge severity={inc.severity} />
                        <StatusChip status={inc.status} />
                        <span className="ml-auto text-[11px] tabular-nums text-zinc-500">{formatTime(inc.updated_at)}</span>
                      </span>
                      <span className="mt-1.5 block truncate text-[13px] font-medium text-zinc-100">{inc.title}</span>
                      <span className="mt-0.5 block text-[11px] text-zinc-500">
                        {inc.alert_ids.length} alertas · {inc.hosts.length} equipos{inc.owner ? ` · ${inc.owner}` : ''}
                      </span>
                    </button>
                  </AnimatedItem>
                </li>
              ))}
            </ul>
          )}
        </div>

        {current ? (
          <IncidentDetail key={current.id} incident={current} onChange={upsert} onHost={onHost} onOpenAlert={onOpenAlert} onAnalyze={onAnalyze} onOpenEngineReport={onOpenEngineReport} />
        ) : (
          <div className="panel">
            <EmptyState icon={Stack} title="Selecciona un incidente" hint="Verás sus alertas, los equipos afectados, el grafo de entidades y la línea de tiempo." />
          </div>
        )}
      </div>
    </section>
  )
}

function NewIncidentForm({ onDone }: { onDone: (incident: Incident | null) => void }) {
  const [title, setTitle] = useState('')
  const [severity, setSeverity] = useState<Severity>('medium')
  const [summary, setSummary] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="space-y-2 border-b border-white/[0.06] bg-white/[0.02] px-4 py-3"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        const res = await createIncident({ title, severity, summary })
        setBusy(false)
        if (!res.ok) return setError(res.error)
        onDone(res.data)
      }}
    >
      <label className="block text-xs text-zinc-400" htmlFor="incident-title">Título</label>
      <input id="incident-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required
        className="h-8 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      <div className="flex gap-2">
        <label className="flex-1 text-xs text-zinc-400">
          Severidad
          <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}
            className="mt-1 block h-8 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-100">
            {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
          </select>
        </label>
      </div>
      <label className="block text-xs text-zinc-400" htmlFor="incident-summary">Resumen (opcional)</label>
      <textarea id="incident-summary" value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} maxLength={4000}
        className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => onDone(null)} className="rounded-md px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-100">Cancelar</button>
        <button type="submit" disabled={busy || !title.trim()} className="rounded-md bg-primary-strong px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
          {busy ? 'Creando…' : 'Crear incidente'}
        </button>
      </div>
    </form>
  )
}

const KIND_ICON: Record<IncidentEntry['kind'], React.ElementType> = {
  created: FolderOpen,
  status: ClockCounterClockwise,
  severity: ShieldWarning,
  owner: UserCircle,
  alerts: Lightning,
  note: NotePencil,
}

function downloadFile(filename: string, contents: string, mime: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const exportCls =
  'inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

function IncidentDetail({
  incident,
  onChange,
  onHost,
  onOpenAlert,
  onAnalyze,
  onOpenEngineReport,
}: {
  incident: Incident
  onChange: (incident: Incident) => void
  onHost: (host: string) => void
  onOpenAlert: (alertId: string) => void
  onAnalyze?: (pending: PendingIncidentAnalysis) => void
  onOpenEngineReport?: (incidentId: string) => void
}) {
  const { alerts, events } = useEngine()
  const [owner, setOwner] = useState(incident.owner ?? '')
  const [summary, setSummary] = useState(incident.summary ?? '')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // the response plan (IDEA-3) lives in this browser; the header keeps
  // the current one so the export buttons carry it into the report
  const [plan, setPlan] = useState<IncidentPlaybookState | null>(null)
  const applyPlanNote = (text: string) => {
    void addIncidentNote(incident.id, text).then((res) => {
      if (res.ok) onChange(res.data)
    })
  }

  const ids = new Set(incident.alert_ids)
  const caseAlerts = alerts.filter((a) => a.id && ids.has(a.id))
  const outside = incident.alert_ids.length - caseAlerts.length
  // only the case hosts' own connections: the event buffer holds every
  // host's traffic, which would draw unrelated machines into the case
  const caseHosts = new Set(incident.hosts.map((h) => h.toLowerCase()))
  const caseEvents = events.filter((e) => caseHosts.has((e.host || '').toLowerCase()))
  const graph = useMemo(() => buildEntityGraph(caseAlerts, caseEvents), [caseAlerts, caseEvents])

  async function patch(p: Parameters<typeof updateIncident>[1]) {
    setBusy(true)
    setError('')
    const res = await updateIncident(incident.id, p)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    onChange(res.data)
  }

  return (
    <article aria-label={`Incidente ${incident.title}`} className="panel min-w-0">
      <header className="border-b border-white/[0.06] px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={incident.severity} />
          <StatusChip status={incident.status} />
          <span className="font-mono text-[11px] text-zinc-600">{incident.id}</span>
          <div role="group" aria-label="Exportar informe del incidente" className="ml-auto flex items-center gap-1.5">
            {onAnalyze && (
              <button
                type="button"
                className={exportCls}
                disabled={caseAlerts.length === 0}
                title="El analista IA estudia el caso completo: agrupa las alertas por equipo y ventana, adjunta el bundle forense de la alerta más grave y cita la evidencia"
                onClick={() =>
                  onAnalyze({
                    payload: buildIncidentAnalysis({
                      source: 'incident',
                      incident: {
                        title: incident.title,
                        severity: incident.severity,
                        status: incident.status,
                        summary: incident.summary,
                        hosts: incident.hosts,
                      },
                      alerts: caseAlerts,
                      timeline: incident.timeline,
                    }),
                    label: incident.title,
                  })
                }
              >
                <Sparkle size={13} weight="fill" aria-hidden /> Analizar con IA
              </button>
            )}
            <button
              type="button"
              className={exportCls}
              title="Descargar el informe en Markdown (para un ticket o una wiki)"
              onClick={() => downloadFile(reportFilename(incident, 'md'), buildIncidentMarkdown({ incident, alerts: caseAlerts, graph, playbook: plan ?? undefined }), 'text/markdown;charset=utf-8')}
            >
              <FileText size={13} aria-hidden /> Informe .md
            </button>
            <button
              type="button"
              className={exportCls}
              title="Descargar el informe como página imprimible, con el grafo (ábrela y usa Imprimir para obtener un PDF)"
              onClick={() => downloadFile(reportFilename(incident, 'html'), buildIncidentHtml({ incident, alerts: caseAlerts, graph, playbook: plan ?? undefined }), 'text/html;charset=utf-8')}
            >
              <FileHtml size={13} aria-hidden /> Informe imprimible
            </button>
            {onOpenEngineReport && (
              <button
                type="button"
                className={exportCls}
                title="Abrir el informe de incidente del motor (REP-1): descarga CSV/JSON y vista imprimible"
                onClick={() => onOpenEngineReport(incident.id)}
              >
                <Files size={13} aria-hidden /> Informe del motor
              </button>
            )}
          </div>
        </div>
        <h2 className="mt-2 text-lg font-semibold tracking-tight text-zinc-50">{incident.title}</h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          Abierto {formatDateTime(incident.created_at)} · actualizado {formatDateTime(incident.updated_at)}
          {incident.closed_at ? ` · cerrado ${formatDateTime(incident.closed_at)}` : ''}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-zinc-400">
            Estado
            <select
              value={incident.status}
              disabled={busy}
              onChange={(e) => void patch({ status: e.target.value as IncidentStatus })}
              className="mt-1 block h-8 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-100"
            >
              {(Object.keys(INCIDENT_STATUS_LABEL) as IncidentStatus[]).map((s) => <option key={s} value={s}>{INCIDENT_STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="text-xs text-zinc-400">
            Severidad
            <select
              value={incident.severity}
              disabled={busy}
              onChange={(e) => void patch({ severity: e.target.value as Severity })}
              className="mt-1 block h-8 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-100"
            >
              {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="text-xs text-zinc-400">
            Responsable
            <input
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              onBlur={() => owner !== (incident.owner ?? '') && void patch({ owner })}
              onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
              maxLength={200}
              placeholder="sin asignar"
              className="mt-1 block h-8 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-100 placeholder:text-zinc-600"
            />
          </label>
        </div>
        <label className="mt-3 block text-xs text-zinc-400">
          Resumen
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            onBlur={() => summary !== (incident.summary ?? '') && void patch({ summary })}
            rows={2}
            maxLength={4000}
            placeholder="Qué ha pasado, alcance y estado de la contención"
            className="mt-1 block w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600"
          />
        </label>
        {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
      </header>

      <div className="grid gap-5 px-5 py-4 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-300">
              <Desktop size={14} aria-hidden className="text-primary" /> Equipos afectados
            </h3>
            {incident.hosts.length === 0 ? (
              <p className="text-xs text-zinc-500">Sin equipos todavía: se añaden con las alertas.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {incident.hosts.map((h) => (
                  <button key={h} type="button" onClick={() => onHost(h)}
                    className="rounded-md border border-primary/20 bg-primary-tint/[0.08] px-2 py-1 font-mono text-[11px] text-primary-soft hover:bg-primary-tint/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {h}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-300">
              <Lightning size={14} aria-hidden className="text-primary" /> Alertas del caso ({incident.alert_ids.length})
            </h3>
            {caseAlerts.length === 0 && outside === 0 ? (
              <p className="text-xs text-zinc-500">Sin alertas: selecciónalas en la cola y usa «Añadir a incidente».</p>
            ) : (
              <ul className="divide-y divide-white/[0.05] rounded-lg border border-white/[0.06]">
                {caseAlerts.map((a) => (
                  <li key={alertKey(a)}>
                    <button type="button" onClick={() => a.id && onOpenAlert(a.id)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                      <SeverityBadge severity={a.severity} />
                      <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">{a.rule_name}</span>
                      <span className="font-mono text-[11px] text-zinc-500">{a.host}</span>
                      <span className="text-[11px] tabular-nums text-zinc-500">{formatTime(a.timestamp)}</span>
                      <ArrowSquareOut size={12} aria-hidden className="text-zinc-600" />
                    </button>
                  </li>
                ))}
                {outside > 0 && (
                  <li className="px-3 py-2 text-[11px] text-zinc-500">
                    {outside} {outside === 1 ? 'alerta ya no está' : 'alertas ya no están'} en la ventana en vivo; búscalas en Alertas → Histórico.
                  </li>
                )}
              </ul>
            )}
          </div>

          {graph.nodes.length > 1 && (
            <div className="rounded-lg border border-white/[0.06] bg-zinc-950/40 p-2">
              <p className="px-1 text-[11px] font-medium text-zinc-300">Grafo del incidente</p>
              <EntityGraphView graph={graph} height={300} ariaLabel={`Grafo del incidente: ${graph.nodes.length} entidades`} onSelect={(n) => n.kind === 'host' && onHost(n.label)} selectHint="Abrir la ficha del equipo" />
              <div className="px-1 pb-1"><GraphLegend graph={graph} /></div>
            </div>
          )}
        </div>

        <div className="min-w-0">
          <h3 className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-300">
            <ClockCounterClockwise size={14} aria-hidden className="text-primary" /> Línea de tiempo
          </h3>
          <form
            className="mb-3 space-y-2"
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true)
              const res = await addIncidentNote(incident.id, note)
              setBusy(false)
              if (!res.ok) return setError(res.error)
              setNote('')
              onChange(res.data)
            }}
          >
            <label htmlFor={`note-${incident.id}`} className="sr-only">Nota del analista</label>
            <textarea id={`note-${incident.id}`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={4000}
              placeholder="Añade una nota: qué viste, qué hiciste, siguiente paso"
              className="block w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <button type="submit" disabled={busy || !note.trim()} className="rounded-md bg-primary-strong px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              Añadir nota
            </button>
          </form>
          <ol className="relative space-y-3 border-l border-zinc-800 pl-4">
            {[...incident.timeline].reverse().map((entry, i) => {
              const Icon = KIND_ICON[entry.kind] ?? NotePencil
              return (
                <li key={entry.at + i} className="relative">
                  <span aria-hidden className="absolute -left-[25px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-400">
                    <Icon size={9} weight="bold" />
                  </span>
                  <p className={`text-xs leading-relaxed ${entry.kind === 'note' ? 'text-zinc-200' : 'text-zinc-400'}`}>{entry.text}</p>
                  <p className="mt-0.5 text-[10px] text-zinc-600">{formatDateTime(entry.at)}{entry.by ? ` · ${entry.by}` : ''}</p>
                </li>
              )
            })}
          </ol>
        </div>
      </div>

      <div className="border-t border-white/[0.06] px-5 py-4">
        <IncidentPlaybook incidentId={incident.id} onPlanChange={setPlan} onApplyNote={applyPlanNote} />
      </div>
    </article>
  )
}
