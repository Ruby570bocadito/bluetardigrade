'use client'

// SET-3 «Estado de la plataforma»: one dedicated page that mirrors the
// engine's own runtime counters (/api/stats) section by section — motor,
// ingesta, colas y correlación, almacén, entrega externa and the
// auxiliary detectors. Every number comes from the engine; anything the
// API does not publish (latencies, store bytes, version, certificates,
// scheduled reports) is declared in the footnote instead of being
// invented. Read-only by design: no engine writes from this page.

import {
  ArrowClockwise,
  Broadcast,
  Database,
  Gauge,
  SealCheck,
  ShieldCheck,
  Stack,
  UploadSimple,
} from '@phosphor-icons/react'
import { useEngine } from './engine-provider'
import { EmptyState, SectionHeader } from './ui-bits'
import { Meter } from '@/components/charts/bars'
import { platformStatus, topHostLine, type StatusRow, type StatusSection, type StatusTone } from '@/lib/platform-status'
import { formatTime } from '@/lib/console-types'

const SECTION_ICONS: Record<string, React.ElementType> = {
  motor: Gauge,
  ingesta: Broadcast,
  colas: Stack,
  almacen: Database,
  entrega: UploadSimple,
  certificados: SealCheck,
  deteccion: ShieldCheck,
}

const TONE_TEXT: Record<StatusTone, string> = {
  neutral: 'text-zinc-200',
  ok: 'text-emerald-300',
  warn: 'text-amber-300',
  bad: 'text-red-300',
}

const TONE_DOT: Record<StatusTone, string> = {
  neutral: 'bg-zinc-500',
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
      <dt className="min-w-0 text-xs text-zinc-400">
        <span className="block truncate" title={row.hint}>{row.label}</span>
        {row.hint && <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{row.hint}</span>}
      </dt>
      <dd className={'shrink-0 text-xs font-medium tabular-nums ' + (row.absent ? 'font-normal text-zinc-500' : TONE_TEXT[row.tone])}>
        <span aria-hidden className={'mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-[1px] ' + (row.absent ? 'bg-zinc-700' : TONE_DOT[row.tone])} />
        {row.display}
      </dd>
      {row.fill && (
        <dd className="col-span-2 mt-1.5">
          <Meter value={row.fill.value} max={row.fill.max} color={row.fill.color} />
        </dd>
      )}
    </div>
  )
}

function StatusPanel({ section }: { section: StatusSection }) {
  const Icon = SECTION_ICONS[section.key] ?? Gauge
  return (
    <div className="panel overflow-hidden">
      <div className="panel-head">
        <span className="flex items-center gap-2 text-sm font-medium text-zinc-200">
          <Icon size={16} aria-hidden className="text-zinc-500" />
          {section.title}
        </span>
        {section.hint && <span className="text-[11px] text-zinc-500">{section.hint}</span>}
      </div>
      <dl className="divide-y divide-zinc-800/60">
        {section.rows.map((row) => <StatusLine key={row.key} row={row} />)}
      </dl>
    </div>
  )
}

export function PlatformStatusView() {
  const { stats, status, lastSyncAt, refresh, refreshing } = useEngine()
  const report = platformStatus(stats)
  const badRows = report
    ? report.sections.flatMap((s) => s.rows).filter((r) => r.tone === 'bad').length
    : 0

  return (
    <section aria-label="Estado de la plataforma">
      <SectionHeader
        title="Estado de la plataforma"
        hint="lectura de /api/stats · sin escrituras al motor"
        action={
          <button
            type="button" onClick={refresh} disabled={refreshing} aria-busy={refreshing}
            className="chip px-2.5 py-1.5 text-xs text-zinc-300 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
          >
            <ArrowClockwise size={13} aria-hidden className={refreshing ? 'animate-spin motion-reduce:animate-none' : ''} />
            {refreshing ? 'Actualizando' : 'Actualizar'}
          </button>
        }
      />

      <p className="max-w-[80ch] pb-4 text-xs leading-relaxed text-zinc-500">
        Los contadores de runtime que el motor publica en <span className="text-zinc-400">/api/stats</span>, leídos
        tal cual: ingesta, colas del correlador, almacén SQLite y entrega a conectores externos. Lo que la API no
        publica no se inventa — se declara al pie de la página.
      </p>

      {!report ? (
        <div className="panel px-4 py-10">
          <EmptyState
            icon={Gauge}
            title={status === 'connecting' ? 'Conectando con el motor' : 'Motor sin conexión'}
            hint="Esta página refleja únicamente lo que el motor publica; en cuanto /api/stats responda, los contadores se rellenan solos."
          />
        </div>
      ) : (
        <>
          <div className="panel mb-5 flex flex-wrap items-center justify-between gap-2 px-4 py-3" role="status">
            <span className={'flex items-center gap-2 text-sm font-medium ' + (report.healthy ? 'text-emerald-300' : 'text-amber-300')}>
              <span aria-hidden className={'inline-block h-2 w-2 rounded-full ' + (report.healthy ? 'bg-emerald-400' : 'bg-amber-400')} />
              {report.healthy
                ? 'Sin incidencias visibles en los contadores'
                : badRows === 1
                  ? 'Un contador necesita atención'
                  : `${badRows} contadores necesitan atención`}
            </span>
            {topHostLine(stats?.hot_hosts) && (
              <span className="text-[11px] tabular-nums text-zinc-500">riesgo máximo: {topHostLine(stats?.hot_hosts)}</span>
            )}
            <span className="text-[11px] tabular-nums text-zinc-500">
              {lastSyncAt ? 'última lectura ' + formatTime(new Date(lastSyncAt).toISOString()) : ''}
            </span>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            {report.sections.map((section) => <StatusPanel key={section.key} section={section} />)}
          </div>

          <p className="mt-5 max-w-[90ch] text-[11px] leading-relaxed text-zinc-500">
            El TODO pide además {report.unavailable.join(', ')}. Ninguno se publica hoy en <span className="text-zinc-500">/api/stats</span>
            {' '}— se necesitan campos nuevos en la API del motor (propuesta a Implementación A); esta página los añadirá
            en cuanto existan, sin sustituirlos por estimaciones.
          </p>
        </>
      )}
    </section>
  )
}
