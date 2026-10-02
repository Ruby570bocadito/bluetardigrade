'use client'

// Triage headline of the operations panel: the one hero figure (open
// critical alerts), the lifecycle split of the received window and the
// pipeline issues that need an operator. Every count opens the exact
// queue it counts.

import { ArrowClockwise, ArrowRight, CheckCircle, WarningCircle, WarningOctagon } from '@phosphor-icons/react'
import { useEngine } from './engine-provider'
import type { ConsoleView } from './dashboard'
import { SegmentBar } from '@/components/charts/bars'
import { pipelineIssues, triageSummary, type TriageTarget } from '@/lib/operations'
import { formatTime, formatUptime } from '@/lib/console-types'

// Categorical slots 1-3 in their validated adjacent order (blue, aqua,
// violet): new | acknowledged | closed.
const LIFECYCLE = [
  { target: 'new', label: 'nuevas', color: 'var(--series-1)' },
  { target: 'acknowledged', label: 'reconocidas', color: 'var(--series-2)' },
  { target: 'closed', label: 'cerradas', color: 'var(--series-3)' },
] as const

export function OperationsOverview({ onNavigate, onTriage }: {
  onNavigate: (view: ConsoleView) => void
  onTriage: (target: TriageTarget) => void
}) {
  const { alerts, stats, status, streamStatus, lastSyncAt, refresh, refreshing } = useEngine()
  const summary = triageSummary(alerts)
  const issues = pipelineIssues(stats)
  const available = status === 'live' && stats !== null
  const attention = issues.length > 0 || streamStatus === 'retrying'
  const label = !available
    ? status === 'connecting' ? 'Conectando con el motor' : 'Motor sin conexión'
    : attention ? 'La operación necesita atención' : 'Motor operativo'
  const Icon = available && !attention ? CheckCircle : WarningCircle
  const color = !available ? 'text-zinc-400' : attention ? 'text-amber-300' : 'text-emerald-300'
  const counts = { new: summary.pending, acknowledged: summary.acknowledged, closed: summary.closed }
  const critical = available && summary.critical > 0

  return (
    <section aria-label="Resumen de operación" className="panel overflow-hidden">
      <div className="panel-head justify-between">
        <div className={'flex items-center gap-2 text-sm font-medium ' + color}>
          <Icon size={18} weight="fill" aria-hidden />
          <span role="status">{label}</span>
          {available && stats && (
            <span className="hidden text-xs font-normal text-zinc-500 sm:inline">· motor activo {formatUptime(stats.uptime_s)}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] tabular-nums text-zinc-500">
            {lastSyncAt ? 'Última lectura ' + formatTime(new Date(lastSyncAt).toISOString()) : 'Esperando primera lectura'}
          </span>
          <button
            type="button" onClick={refresh} disabled={refreshing} aria-busy={refreshing}
            className="chip px-2.5 py-1.5 text-xs text-zinc-300 transition-colors hover:text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
          >
            <ArrowClockwise size={13} aria-hidden className={refreshing ? 'animate-spin motion-reduce:animate-none' : ''} />
            {refreshing ? 'Actualizando' : 'Actualizar'}
          </button>
        </div>
      </div>

      <div className="grid gap-6 px-5 py-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)_auto] lg:items-center">
        <div className="min-w-0">
          <p className="kicker">Prioridad de triaje</p>
          <div className="mt-2 flex items-end gap-3">
            <span className={'text-[56px] font-semibold leading-[0.9] tracking-tight ' + (critical ? 'text-red-300' : 'text-zinc-50')}>
              {available ? summary.critical : '—'}
            </span>
            <div className="pb-1.5">
              {critical && <WarningOctagon size={18} weight="fill" aria-hidden className="mb-1 text-[var(--sev-critical)]" />}
              <h2 className="text-sm leading-snug text-zinc-300">alertas críticas<br />sin cerrar</h2>
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <p className="kicker">Ciclo de vida</p>
            <p className="text-[11px] text-zinc-500">
              {available ? `ventana de ${alerts.length} alertas recibidas` : 'sin datos'}
            </p>
          </div>
          <SegmentBar
            className="mt-3"
            segments={LIFECYCLE.map((s) => ({ key: s.target, label: s.label, value: available ? counts[s.target] : 0, color: s.color }))}
          />
          <div className="mt-3 grid grid-cols-3 gap-2">
            {LIFECYCLE.map(({ target, label, color: swatch }) => (
              <button
                key={target} type="button" onClick={() => onTriage(target)} disabled={!available}
                aria-label={`Ver alertas ${label}: ${available ? counts[target] : 'sin datos'}`}
                className="group rounded-lg border border-zinc-800 px-3 py-2 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
              >
                <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                  <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: swatch }} />
                  {label}
                </span>
                <span className="mt-0.5 block text-xl font-semibold text-zinc-100 group-hover:text-blue-200">
                  {available ? counts[target] : '—'}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-stretch">
          <button type="button" onClick={() => onTriage('critical')} disabled={!available}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-400/30 bg-red-500/10 px-3.5 py-2 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50">
            Ver críticas sin cerrar <ArrowRight size={14} aria-hidden />
          </button>
          <button type="button" onClick={() => onNavigate('alertas')}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-400/30 bg-blue-500/10 px-3.5 py-2 text-xs font-medium text-blue-200 transition-colors hover:bg-blue-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Abrir cola de alertas <ArrowRight size={14} aria-hidden />
          </button>
          <button type="button" onClick={() => onNavigate('flujo')}
            className="chip justify-center px-3.5 py-2 text-xs text-zinc-300 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Inspeccionar telemetría
          </button>
        </div>
      </div>
      {available && (attention || streamStatus === 'connecting') && (
        <div className="border-t border-amber-400/15 bg-amber-400/[0.05] px-5 py-3">
          <ul className="space-y-1 text-xs text-amber-200/90">
            {streamStatus !== 'live' && <li>El canal en vivo está reconectando; la última lectura del motor sigue disponible.</li>}
            {issues.map((issue) => <li key={issue}>{issue}.</li>)}
          </ul>
          {issues.length > 0 && <p className="mt-1 text-[11px] text-zinc-500">Contadores acumulados desde el arranque; revisa los registros del motor.</p>}
        </div>
      )}
    </section>
  )
}
