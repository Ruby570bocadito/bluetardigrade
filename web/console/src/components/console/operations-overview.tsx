'use client'

// Triage headline of the operations panel: the one hero figure (open
// critical alerts), the lifecycle split of the received window and the
// pipeline issues that need an operator. Every count opens the exact
// queue it counts.

import { ArrowClockwise, ArrowRight, CheckCircle, WarningCircle, WarningOctagon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { useEngine } from './engine-provider'
import type { ConsoleView } from './dashboard'
import { SegmentBar } from '@/components/charts/bars'
import { Counter } from '@/components/reactbits/counter'
import { pipelineIssues, triageSummary, type PipelineIssue, type TriageTarget } from '@/lib/operations'
import { formatTime, formatUptime } from '@/lib/console-types'
import { useI18n } from './i18n-provider'

// Categorical slots 1-3 in their validated adjacent order (blue, aqua,
// violet): new | acknowledged | closed. Labels travel in the dictionary
// (dict.operations.lifecycleLower).
const LIFECYCLE = [
  { target: 'new', color: 'var(--series-1)' },
  { target: 'acknowledged', color: 'var(--series-2)' },
  { target: 'closed', color: 'var(--series-3)' },
] as const

/** The dictionary copy for one noticed pipeline problem. */
function issueCopy(dict: ReturnType<typeof useI18n>['dict'], issue: PipelineIssue): string {
  const copy = dict.operations.issues
  switch (issue.id) {
    case 'ingestDropped': return copy.ingestDropped(issue.count)
    case 'webhookFailing': return copy.webhookFailing(issue.count)
    case 'storeFailures': return copy.storeFailures(issue.count)
    case 'identityViolations': return copy.identityViolations(issue.count)
    case 'idConflicts': return copy.idConflicts(issue.count)
    case 'correlatorCap': return copy.correlatorCap
    case 'beaconsCap': return copy.beaconsCap
  }
}

export function OperationsOverview({ onNavigate, onTriage }: {
  onNavigate: (view: ConsoleView) => void
  onTriage: (target: TriageTarget) => void
}) {
  const { dict } = useI18n()
  const { alerts, stats, status, streamStatus, lastSyncAt, refresh, refreshing } = useEngine()
  const summary = triageSummary(alerts)
  const issues = pipelineIssues(stats)
  const available = status === 'live' && stats !== null
  const attention = issues.length > 0 || streamStatus === 'retrying'
  const label = !available
    ? status === 'connecting' ? dict.operations.connecting : dict.operations.down
    : attention ? dict.operations.attention : dict.operations.ok
  const Icon = available && !attention ? CheckCircle : WarningCircle
  const color = !available ? 'text-zinc-400' : attention ? 'text-amber-300' : 'text-emerald-300'
  const counts = { new: summary.pending, acknowledged: summary.acknowledged, closed: summary.closed }
  const critical = available && summary.critical > 0

  return (
    <section aria-label={dict.operations.sectionAria} className="panel overflow-hidden">
      {/* the header band carries the verdict's colour: green in order,
          amber when something needs a look, the plain wash while offline */}
      <div className={'panel-head justify-between ' + (!available ? '' : attention ? 'border-amber-400/25 bg-amber-400/[0.08]' : 'border-emerald-400/20 bg-emerald-400/[0.07]')}>
        <div className={'flex items-center gap-2 text-sm font-medium ' + color}>
          <Icon size={18} weight="fill" aria-hidden />
          <span role="status">{label}</span>
          {available && stats && (
            <span className="hidden text-xs font-normal text-zinc-500 sm:inline">{dict.operations.uptime(formatUptime(stats.uptime_s))}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] tabular-nums text-zinc-500">
            {lastSyncAt ? dict.operations.lastSync(formatTime(new Date(lastSyncAt).toISOString())) : dict.operations.waitingSync}
          </span>
          {/* Acciones del héroe sobre el kit POL-7 (Button): la forma la pone
              el kit y el color de datos (rojo) viaja en className, nunca como
              variante nueva. El CTA principal es el único sólido. */}
          <Button
            type="button" variant="outline" size="sm" className="text-xs" onClick={() => onNavigate('estado')}
            title={dict.operations.estadoTitle}
          >
            {dict.operations.estadoBtn}
          </Button>
          <Button
            type="button" variant="outline" size="sm" className="text-xs" onClick={refresh} disabled={refreshing} aria-busy={refreshing}
          >
            <ArrowClockwise size={13} aria-hidden className={refreshing ? 'animate-spin motion-reduce:animate-none' : ''} />
            {refreshing ? dict.operations.refreshing : dict.operations.refresh}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 px-5 py-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)_auto] lg:items-center">
        <div className="min-w-0">
          <p className="kicker">{dict.operations.kickerTriage}</p>
          <div className="mt-2 flex items-end gap-3">
            <span className={'text-[56px] font-semibold leading-none tracking-tight ' + (critical ? 'text-red-300' : 'text-zinc-50')}>
              {/* Counter (React Bits): each digit rolls to its value */}
              {available ? <Counter value={summary.critical} height={56} /> : '—'}
            </span>
            <div className="pb-1.5">
              {critical && <WarningOctagon size={18} weight="fill" aria-hidden className="mb-1 text-[var(--sev-critical)]" />}
              <h2 className="text-sm leading-snug text-zinc-300">{dict.operations.criticalA}<br />{dict.operations.criticalB}</h2>
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <p className="kicker">{dict.operations.kickerLifecycle}</p>
            <p className="text-[11px] text-zinc-500">
              {available ? dict.operations.window(alerts.length) : dict.operations.noData}
            </p>
          </div>
          <SegmentBar
            className="mt-3"
            segments={LIFECYCLE.map((s) => ({ key: s.target, label: dict.operations.lifecycleLower[s.target], value: available ? counts[s.target] : 0, color: s.color }))}
          />
          <div className="mt-3 grid grid-cols-3 gap-2">
            {LIFECYCLE.map(({ target, color: swatch }) => (
              <button
                key={target} type="button" onClick={() => onTriage(target)} disabled={!available}
                aria-label={dict.operations.triageAria(dict.operations.lifecycleLower[target], available ? String(counts[target]) : '—')}
                className="group rounded-lg border border-zinc-800 px-3 py-2 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
              >
                <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                  <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: swatch }} />
                  {dict.operations.lifecycleLower[target]}{' '}
                </span>{' '}
                <span className="mt-0.5 block text-xl font-semibold text-zinc-100 group-hover:text-primary-soft">
                  {available ? counts[target] : '—'}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-stretch">
          {/* Jerarquía de la columna: los dos tintes (rojo de datos y acento
              primario) pesan igual que antes; la telemetría queda terciaria
              en ghost. La forma la pone el kit, el color viaja en className. */}
          <Button type="button" variant="ghost" size="sm" onClick={() => onTriage('critical')} disabled={!available}
            className="border border-red-400/30 bg-red-500/10 text-xs font-medium text-red-200 hover:bg-red-500/20 dark:bg-red-500/10 dark:hover:bg-red-500/20">
            {dict.operations.ctaCritical} <ArrowRight size={14} aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onNavigate('alertas')}
            className="border border-primary/30 bg-primary-tint/10 text-xs font-medium text-primary-soft hover:bg-primary-tint/20">
            {dict.operations.ctaQueue} <ArrowRight size={14} aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onNavigate('flujo')} className="text-xs">
            {dict.operations.ctaTelemetry}
          </Button>
        </div>
      </div>
      {available && (attention || streamStatus === 'connecting') && (
        <div className="border-t border-amber-400/15 bg-amber-400/[0.05] px-5 py-3">
          <ul className="space-y-1 text-xs text-amber-200/90">
            {streamStatus !== 'live' && <li>{dict.operations.reconnecting}</li>}
            {issues.map((issue) => <li key={issue.id}>{issueCopy(dict, issue)}.</li>)}
          </ul>
          {issues.length > 0 && <p className="mt-1 text-[11px] text-zinc-500">{dict.operations.issuesNote}</p>}
        </div>
      )}
    </section>
  )
}
