'use client'

// SET-3 «Estado de la plataforma»: one dedicated page that mirrors the
// engine's own runtime counters (/api/stats) section by section — motor,
// ingesta, colas y correlación, almacén, entrega externa and the
// auxiliary detectors. Every number comes from the engine; anything the
// API does not publish (latencies, store bytes, version, certificates,
// scheduled reports) is declared instead of being invented. Read-only by
// design: no engine writes from this page.
//
// Reading order: the verdict and the path an event takes (the pipeline
// strip, one figure per stage), then each section in its area's colour
// with its own verdict, in two balanced columns so no card is stretched
// over empty space. Metrics the engine does not publish collapse into
// one line per section, named, never dropped.

import {
  ArrowClockwise,
  Broadcast,
  CheckCircle,
  Database,
  FlowArrow,
  Gauge,
  SealCheck,
  ShieldCheck,
  Siren,
  Stack,
  UploadSimple,
  Users,
  WarningCircle,
} from '@phosphor-icons/react'
import { useEngine } from './engine-provider'
import { useI18n } from './i18n-provider'
import { EmptyState, HealthPill, SectionHeader } from './ui-bits'
import { Meter } from '@/components/charts/bars'
import type { Area } from '@/lib/areas'
import {
  pipelineStages,
  platformStatus,
  rowsHealth,
  topHostLine,
  type PipelineStage,
  type PipelineStageKey,
  type StatusRow,
  type StatusSection,
  type StatusTone,
} from '@/lib/platform-status'
import { formatTime, formatUptime } from '@/lib/console-types'

const SECTION_ICONS: Record<string, React.ElementType> = {
  motor: Gauge,
  ingesta: Broadcast,
  colas: Stack,
  almacen: Database,
  entrega: UploadSimple,
  certificados: SealCheck,
  deteccion: ShieldCheck,
  cuotas: Users,
}

// each section in the colour of the area it belongs to (lib/areas.ts)
const SECTION_AREA: Record<string, Area> = {
  motor: 'core',
  ingesta: 'telemetry',
  colas: 'detection',
  almacen: 'core',
  entrega: 'connect',
  certificados: 'core',
  deteccion: 'detection',
  cuotas: 'fleet',
}

const STAGE_ICONS: Record<PipelineStageKey, React.ElementType> = {
  ingest: Broadcast,
  correlation: FlowArrow,
  alerts: Siren,
  store: Database,
  delivery: UploadSimple,
}

const STAGE_AREA: Record<PipelineStageKey, Area> = {
  ingest: 'telemetry',
  correlation: 'detection',
  alerts: 'alerts',
  store: 'core',
  delivery: 'connect',
}

const TONE_TEXT: Record<StatusTone, string> = {
  neutral: 'text-zinc-100',
  ok: 'text-emerald-300',
  warn: 'text-amber-300',
  bad: 'text-red-300',
}

const TONE_DOT: Record<StatusTone, string> = {
  neutral: '',
  ok: 'bg-emerald-400',
  warn: 'bg-amber-400',
  bad: 'bg-red-400',
}

function StatusLine({ row }: { row: StatusRow }) {
  // one grouping div per row: dt/dd must be a DIRECT grouping of the dl
  // (a nested wrapper breaks the description-list semantics — axe
  // definition-list/dlitem); the meter and the hint ride along inside
  // the dt/dd elements instead of extra wrappers
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 px-4 py-2.5">
      <dt className="min-w-0 text-[13px] text-zinc-300">
        <span className="block truncate" title={row.hint}>{row.label}</span>
        {row.hint && <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{row.hint}</span>}
      </dt>
      <dd className={'shrink-0 text-[13px] font-semibold tabular-nums ' + TONE_TEXT[row.tone]}>
        {/* a dot only where the tone says something: a clean counter is
            plain ink, so the eye lands on what needs a look */}
        {row.tone !== 'neutral' && <span aria-hidden className={'mr-1.5 inline-block h-2 w-2 rounded-full align-[1px] ' + TONE_DOT[row.tone]} />}
        {row.display}
      </dd>
      {row.fill && (
        <dd className="col-span-2 mt-2">
          {/* the cap's meter in the section's own hue, amber past 80% */}
          <Meter value={row.fill.value} max={row.fill.max} color={row.fill.color === 'var(--series-1)' ? 'var(--area)' : row.fill.color} className="h-2" />
        </dd>
      )}
    </div>
  )
}

function StatusPanel({ section }: { section: StatusSection }) {
  const { dict } = useI18n()
  const st = dict.status
  const Icon = SECTION_ICONS[section.key] ?? Gauge
  const health = rowsHealth(section.rows)
  const shown = section.rows.filter((row) => !row.absent)
  const absent = section.rows.filter((row) => row.absent)
  return (
    <div data-area={SECTION_AREA[section.key] ?? 'core'} className="panel mb-5 break-inside-avoid overflow-hidden">
      <div className="panel-head flex-nowrap">
        <span className="flex shrink-0 items-center gap-2.5 text-sm font-semibold text-zinc-100">
          <span className="icon-tile"><Icon size={15} weight="duotone" aria-hidden /></span>
          {section.title}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500" title={section.hint}>{section.hint}</span>
        <HealthPill health={health} label={st.health[health]} />
      </div>
      {shown.length > 0 && (
        <dl className="divide-y divide-zinc-800/60">
          {shown.map((row) => <StatusLine key={row.key} row={row} />)}
        </dl>
      )}
      {absent.length > 0 && (
        <p className={'px-4 py-2.5 text-[11px] leading-relaxed text-zinc-500 ' + (shown.length ? 'border-t border-zinc-800/60' : '')}>
          {st.absentLead}
          {absent.map((row, i) => (
            <span key={row.key} title={row.hint}>{i ? ', ' : ''}{row.label}</span>
          ))}
        </p>
      )}
    </div>
  )
}

/** The path an event takes, one stage per area colour; the dashes of
 * each link flow while the engine is live (still under reduced motion). */
function PipelineStrip({ stages, live }: { stages: PipelineStage[]; live: boolean }) {
  const { dict } = useI18n()
  const st = dict.status
  return (
    <ol aria-label={st.pipelineAria} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5">
      {stages.map((stage, i) => {
        const Icon = STAGE_ICONS[stage.key]
        const last = i === stages.length - 1
        return (
          <li
            key={stage.key}
            data-area={STAGE_AREA[stage.key]}
            className={'relative min-w-0 px-5 py-4 ' + (last ? 'sm:col-span-2 xl:col-span-1' : '')}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="icon-tile h-8 w-8 rounded-full"><Icon size={16} weight="duotone" aria-hidden /></span>
              <span className="truncate text-[13px] font-semibold text-[color:var(--area)]">{stage.label}</span>
              {stage.health === 'ok' && <HealthPill health="ok" label={st.health.ok} compact />}
            </div>
            <p className="mt-3 flex min-w-0 items-baseline gap-1.5">
              <span className="text-[26px] font-semibold leading-none tracking-tight tabular-nums text-zinc-50">{stage.value}</span>
              {stage.unit && <span className="truncate text-xs text-zinc-400">{stage.unit}</span>}
            </p>
            <p className="mt-1.5 truncate text-[11px] text-zinc-500" title={stage.detail}>{stage.detail}</p>
            {/* a stage that is not in order says why, in the status colour */}
            {stage.health !== 'ok' && (
              <HealthPill
                health={stage.health}
                label={stage.flag ?? (stage.health === 'off' ? st.stageOff : st.health[stage.health])}
                className="mt-2.5 max-w-full"
              />
            )}
            {!last && (
              <svg
                aria-hidden width="28" height="12" viewBox="0 0 28 12"
                className="absolute right-0 top-[26px] hidden translate-x-1/2 overflow-visible xl:block"
              >
                <line x1="1" y1="6" x2="21" y2="6" stroke="var(--area)" strokeWidth="2" strokeLinecap="round" className={live ? 'edge-flow' : undefined} strokeDasharray={live ? undefined : '4 6'} />
                <path d="M20 1.5 L26 6 L20 10.5" fill="none" stroke="var(--area)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </li>
        )
      })}
    </ol>
  )
}

export function PlatformStatusView() {
  const { dict, lang } = useI18n()
  const st = dict.status
  const { stats, status, lastSyncAt, refresh, refreshing } = useEngine()
  const report = platformStatus(stats, lang)
  const stages = pipelineStages(stats, report, lang)
  const badRows = report
    ? report.sections.flatMap((s) => s.rows).filter((r) => r.tone === 'bad').length
    : 0
  const topHost = topHostLine(stats?.hot_hosts, lang)

  return (
    <section aria-label={st.sectionAria}>
      <SectionHeader
        title={st.title}
        hint={st.hint}
        action={
          <button
            type="button" onClick={refresh} disabled={refreshing} aria-busy={refreshing}
            className="chip px-2.5 py-1.5 text-xs text-zinc-300 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
          >
            <ArrowClockwise size={13} aria-hidden className={refreshing ? 'animate-spin motion-reduce:animate-none' : ''} />
            {refreshing ? st.refreshing : st.refresh}
          </button>
        }
      />

      <p className="max-w-[80ch] pb-4 text-xs leading-relaxed text-zinc-500">{st.prose}</p>

      {!report ? (
        <div className="panel px-4 py-10">
          <EmptyState
            icon={Gauge}
            title={status === 'connecting' ? st.connecting : st.offline}
            hint={st.offlineHint}
          />
        </div>
      ) : (
        <>
          <div className="panel mb-5 overflow-hidden">
            <div
              role="status"
              className={'flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-5 py-3 ' + (report.healthy
                ? 'border-emerald-400/20 bg-emerald-400/[0.07]'
                : 'border-amber-400/25 bg-amber-400/[0.08]')}
            >
              <span className={'flex items-center gap-2 text-sm font-semibold ' + (report.healthy ? 'text-emerald-300' : 'text-amber-300')}>
                {report.healthy
                  ? <CheckCircle size={18} weight="fill" aria-hidden />
                  : <WarningCircle size={18} weight="fill" aria-hidden />}
                {report.healthy ? st.healthy : badRows === 1 ? st.oneBad : st.manyBad(badRows)}
              </span>
              {stats && <span className="text-xs text-zinc-400">{dict.operations.uptime(formatUptime(stats.uptime_s))}</span>}
              <span className="ml-auto flex flex-wrap gap-x-4 text-[11px] tabular-nums text-zinc-400">
                {topHost && <span>{st.maxRisk} {topHost}</span>}
                {lastSyncAt && <span>{st.lastRead + formatTime(new Date(lastSyncAt).toISOString())}</span>}
              </span>
            </div>
            <PipelineStrip stages={stages} live={status === 'live'} />
          </div>

          <div className="columns-1 gap-5 xl:columns-2">
            {report.sections.map((section) => <StatusPanel key={section.key} section={section} />)}
          </div>

          <p className="mt-1 max-w-[90ch] text-[11px] leading-relaxed text-zinc-500">
            {st.unavailableProseA}{report.unavailable.join(', ')}{st.unavailableProseB}<span className="text-zinc-500">/api/stats</span>{st.unavailableProseC}
          </p>
        </>
      )}
    </section>
  )
}
