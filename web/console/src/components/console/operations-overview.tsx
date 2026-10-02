'use client'

import { ArrowClockwise, ArrowRight, CheckCircle, WarningCircle } from '@phosphor-icons/react'
import { useEngine } from './engine-provider'
import type { ConsoleView } from './dashboard'
import { pipelineIssues, triageSummary, type TriageTarget } from '@/lib/operations'
import { formatTime } from '@/lib/console-types'

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

  return (
    <section aria-label="Resumen de operación" className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
        <div className={'flex items-center gap-2 text-sm font-medium ' + color}>
          <Icon size={18} aria-hidden />
          <span role="status">{label}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-[11px] tabular-nums text-zinc-500">
            {lastSyncAt ? 'Última lectura · ' + formatTime(new Date(lastSyncAt).toISOString()) : 'Esperando primera lectura'}
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
      <div className="grid gap-5 px-4 py-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Prioridad de triaje</p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={'font-mono text-3xl tabular-nums tracking-tight ' + (summary.critical > 0 && available ? 'text-red-300' : 'text-zinc-100')}>
              {available ? summary.critical : '—'}
            </span>
            <h2 className="text-sm text-zinc-300">alertas críticas sin cerrar</h2>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
            {([
              { target: 'new', count: summary.pending, label: 'nuevas' },
              { target: 'acknowledged', count: summary.acknowledged, label: 'reconocidas' },
              { target: 'closed', count: summary.closed, label: 'cerradas' },
            ] as const).map(({ target, count, label }) => (
              <button key={target} type="button" onClick={() => onTriage(target)} disabled={!available}
                aria-label={`Ver alertas ${label}: ${available ? count : 'sin datos'}`}
                className="rounded-sm underline decoration-zinc-600 underline-offset-4 hover:text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:no-underline">
                {available ? count : '—'} {label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            {available ? 'Ventana de ' + alerts.length + ' alertas recibidas; los totales del motor aparecen debajo.' : 'El triaje se mostrará cuando se recupere la conexión.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:flex-col md:items-stretch">
          <button type="button" onClick={() => onTriage('critical')} disabled={!available}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-400/25 bg-red-400/10 px-3.5 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50">
            Ver críticas sin cerrar <ArrowRight size={14} aria-hidden />
          </button>
          <button type="button" onClick={() => onNavigate('alertas')}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-400/30 bg-blue-400/10 px-3.5 py-2 text-xs font-medium text-blue-300 transition-colors hover:bg-blue-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Abrir cola de alertas <ArrowRight size={14} aria-hidden />
          </button>
          <button type="button" onClick={() => onNavigate('flujo')}
            className="chip justify-center px-3.5 py-2 text-xs text-zinc-300 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Inspeccionar telemetría
          </button>
        </div>
      </div>
      {available && (attention || streamStatus === 'connecting') && (
        <div className="border-t border-amber-400/10 bg-amber-400/[0.04] px-4 py-3">
          <ul className="space-y-1 text-xs text-amber-200/80">
            {streamStatus !== 'live' && <li>El canal en vivo está reconectando; la última lectura del motor sigue disponible.</li>}
            {issues.map((issue) => <li key={issue}>{issue}.</li>)}
          </ul>
          {issues.length > 0 && <p className="mt-1 text-[11px] text-zinc-500">Contadores acumulados desde el arranque; revisa los registros del motor.</p>}
        </div>
      )}
    </section>
  )
}
