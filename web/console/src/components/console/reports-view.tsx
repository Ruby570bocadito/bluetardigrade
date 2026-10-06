'use client'

// REP-1 — report catalog screen. The picker is rendered from the
// engine's own catalog (GET /api/reports): kinds the engine cannot
// compute today simply do not appear, and a future kind without a
// bespoke renderer still shows its honest JSON. Every report can be
// downloaded exactly as the engine serves it (CSV with the engine's
// formula escaping, pretty JSON) and printed or saved as PDF from a
// dedicated printable sheet. Console chrome is bilingual (IDEA-10); the
// engine's catalog titles, descriptions and data travel verbatim.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { DownloadSimple, Files, ListBullets, Printer, X, ChartPie, Desktop, Pulse } from '@phosphor-icons/react'
import { useIncidents } from './incidents-provider'
import { EmptyState, SkeletonRows, SeverityBadge } from './ui-bits'
import { ChartCard } from '@/components/charts/chart-frame'
import { DonutChart } from '@/components/charts/donut'
import { BarList } from '@/components/charts/bars'
import { StackedColumns } from '@/components/charts/stacked-columns'
import { buildDonut, isOtherSlice } from '@/lib/donut'
import { SEV_COLOR } from '@/components/charts/severity'
import { SEVERITIES } from '@/lib/soc-metrics'
import {
  downloadReport,
  fetchReport,
  fetchReportCatalog,
  INCIDENT_ID_RE,
  reportWindowPreset,
  REPORT_WINDOWS,
  type ExecutiveReport,
  type FleetCoverageReport,
  type IncidentReport,
  type ReportCatalog,
  type ReportData,
  type ReportWindowPreset,
  type SocActivityReport,
} from '@/lib/reports'
import { readLensState, currentSearch, pushOperatorState, writeReportLensToSearch } from '@/lib/url-state'
import styles from './reports-print.module.css'
import { useI18n } from './i18n-provider'
import type { Lang } from '@/lib/i18n'

const chip =
  'rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const primaryBtn =
  'inline-flex items-center gap-1.5 rounded-lg bg-primary-strong px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-primary-tint disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const th = 'border-b border-zinc-800 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500'

/** Number presentation follows the console language (data stays verbatim). */
function numberLocale(lang: Lang): string {
  return lang === 'en' ? 'en-US' : 'es-ES'
}

export function ReportsView() {
  const { dict, lang } = useI18n()
  const { incidents } = useIncidents()

  const [catalog, setCatalog] = useState<ReportCatalog | null>(null)
  const [catalogError, setCatalogError] = useState('')
  const [kind, setKind] = useState('')
  const [windowPreset, setWindowPreset] = useState<ReportWindowPreset>('7d')
  const [caseId, setCaseId] = useState('')
  const [report, setReport] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // lens from the URL (?informe=&ventana=&caso=): a shared link lands
  // on the same report
  useEffect(() => {
    const lens = readLensState(currentSearch())
    if (lens.informe) setKind(lens.informe)
    if (lens.ventana) setWindowPreset(reportWindowPreset(lens.ventana))
    if (lens.caso) setCaseId(lens.caso)
  }, [])

  useEffect(() => {
    let alive = true
    fetchReportCatalog().then((res) => {
      if (!alive) return
      if (res.ok) {
        setCatalog(res.data)
        setCatalogError('')
      } else setCatalogError(res.error)
    })
    return () => {
      alive = false
    }
  }, [])

  // when the catalog arrives, fall back honestly to its first kind
  useEffect(() => {
    if (!catalog) return
    if (!kind || !catalog.reports.some((r) => r.kind === kind)) setKind(catalog.reports[0]?.kind ?? '')
  }, [catalog, kind])

  const entry = catalog?.reports.find((r) => r.kind === kind) ?? null
  const needsId = entry?.params.id !== undefined && entry.params.id !== '' && kind === 'incident'
  const canGenerate = Boolean(entry) && (!needsId || INCIDENT_ID_RE.test(caseId))

  const persistLens = useCallback((nextKind: string, nextWindow: string, nextCase: string) => {
    pushOperatorState((search) => writeReportLensToSearch(search, nextKind, nextWindow, nextCase))
  }, [])

  const generate = useCallback(async () => {
    if (!entry) return
    setLoading(true)
    setError('')
    setNotice('')
    const res = await fetchReport({ kind: entry.kind, window: entry.kind === 'incident' ? undefined : windowPreset, id: entry.kind === 'incident' ? caseId : undefined })
    setLoading(false)
    if (!res.ok) {
      setReport(null)
      setError(res.error)
      return
    }
    setReport(res.data)
    persistLens(entry.kind, windowPreset, caseId)
  }, [entry, windowPreset, caseId, persistLens])

  const share = async (format: 'json' | 'csv') => {
    if (!entry) return
    const res = await downloadReport({ kind: entry.kind, window: entry.kind === 'incident' ? undefined : windowPreset, id: entry.kind === 'incident' ? caseId : undefined }, format)
    setNotice(res.ok ? dict.reports.downloadSent(res.filename) : dict.reports.downloadFailed(res.error))
  }

  const openIncidents = useMemo(() => incidents.filter((i) => i.status !== 'closed'), [incidents])

  if (catalogError) {
    return (
      <section aria-label={dict.reports.sectionAria} className="panel px-4 py-6">
        <EmptyState icon={Files} title={dict.reports.catalogErrorTitle} hint={dict.reports.catalogErrorHint(catalogError)} />
      </section>
    )
  }

  if (!catalog) {
    return (
      <section aria-label={dict.reports.sectionAria} className="panel px-4 py-6">
        <SkeletonRows rows={4} />
      </section>
    )
  }

  if (catalog.reports.length === 0) {
    return (
      <section aria-label={dict.reports.sectionAria} className="panel px-4 py-6">
        <EmptyState icon={Files} title={dict.reports.emptyCatalogTitle} hint={dict.reports.emptyCatalogHint} />
      </section>
    )
  }

  return (
    <section aria-label={dict.reports.sectionAria} className="space-y-4">
      <p className="max-w-[100ch] text-xs leading-relaxed text-zinc-500">{dict.reports.prose}</p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          {dict.reports.kindLabel}
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value)
              setReport(null)
              setError('')
              persistLens(e.target.value, windowPreset, caseId)
            }}
            className={chip}
          >
            {catalog.reports.map((r) => (
              <option key={r.kind} value={r.kind}>{r.title}</option>
            ))}
          </select>
        </label>

        {entry && kind !== 'incident' && (
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            {dict.reports.windowLabel}
            <select
              value={windowPreset}
              onChange={(e) => {
                const next = reportWindowPreset(e.target.value)
                setWindowPreset(next)
                setReport(null)
                persistLens(kind, next, caseId)
              }}
              className={chip}
            >
              {REPORT_WINDOWS.map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
          </label>
        )}

        {needsId && (
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            {dict.reports.caseLabel}
            <input value={caseId} onChange={(e) => setCaseId(e.target.value.trim().toLowerCase())} placeholder="0123abcdef012345" spellCheck={false} maxLength={16} className={`${chip} w-56 font-mono`} list="informes-casos" />
            <datalist id="informes-casos">
              {openIncidents.slice(0, 20).map((i) => (
                <option key={i.id} value={i.id}>{i.title}</option>
              ))}
            </datalist>
          </label>
        )}

        <button type="button" className={primaryBtn} disabled={!canGenerate || loading} onClick={() => void generate()}>
          {loading ? dict.reports.generating : dict.reports.generate}
        </button>

        {report && (
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" className="chip px-2.5 py-1.5 text-xs text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void share('csv')}>
              <DownloadSimple size={13} aria-hidden /> CSV
            </button>
            <button type="button" className="chip px-2.5 py-1.5 text-xs text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void share('json')}>
              <DownloadSimple size={13} aria-hidden /> JSON
            </button>
            <button type="button" className="chip px-2.5 py-1.5 text-xs text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => window.print()}>
              <Printer size={13} aria-hidden /> {dict.reports.printPdf}
            </button>
          </div>
        )}
      </div>

      {entry && <p className="max-w-[100ch] text-xs text-zinc-500">{entry.description}</p>}

      {needsId && !INCIDENT_ID_RE.test(caseId) && (
        <p role="status" className="text-xs text-zinc-400">
          {dict.reports.needsCaseId}
        </p>
      )}

      {notice && <p role="status" className="text-xs text-emerald-300">{notice}</p>}
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}

      {loading && (
        <div className="panel px-4 py-6">
          <SkeletonRows rows={5} />
        </div>
      )}

      {!loading && report && (
        <>
          {/* REP-4: the console's own charts over the report data, with the
              shared export menu (PNG/SVG/CSV). Ink-free print: the PDF
              sheet below stays text-only. */}
          <div className={`space-y-5 ${styles.noPrint}`}>
            <ReportCharts report={report} />
          </div>
          <div className={`${styles.printRoot} panel px-4 pb-4 pt-4`}>
            <ReportSheet report={report} onClose={() => { setReport(null); setNotice('') }} />
          </div>
        </>
      )}
    </section>
  )
}

// ---- REP-4 charts -----------------------------------------------------------

/** VIZ-1 palette hand-off: named slices take the four validated
 * categorical hues in order, the folded «Otros» the muted token — the
 * same assignment the dashboard donuts use. */
function donutColors(model: ReturnType<typeof buildDonut>): Record<string, string> {
  const hues = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)']
  const out: Record<string, string> = {}
  let named = 0
  for (const slice of model.slices) {
    out[slice.key] = isOtherSlice(slice) ? 'var(--series-other)' : hues[named++ % hues.length]
  }
  return out
}

function donutLegend(model: ReturnType<typeof buildDonut>, colors: Record<string, string>) {
  return model.slices.map((s) => ({ key: s.key, label: s.label, color: colors[s.key], value: s.value }))
}

function donutTable(model: ReturnType<typeof buildDonut>, caption: string, kind: string, alerts: string, share: string) {
  return {
    caption,
    columns: [kind, alerts, share],
    rows: model.entries.map((e) => [e.label, e.value, model.total ? Math.round((e.value / model.total) * 100) + ' %' : '—']),
  }
}

/** Charts over the report data — the same chart components the console
 * uses, so legends, table twins and the VIZ-6 export menu come for
 * free. Kinds whose data is already tabular (incident) get no chart
 * instead of an invented one. */
function ReportCharts({ report }: { report: ReportData }) {
  if (report.kind === 'executive') return <ExecutiveCharts report={report} />
  if (report.kind === 'fleet') return <FleetCharts report={report} />
  if (report.kind === 'soc') return <SocCharts report={report} />
  return null
}

function ExecutiveCharts({ report }: { report: ExecutiveReport }) {
  const { dict, lang } = useI18n()
  const severityModel = useMemo(
    () => buildDonut(SEVERITIES.map((s) => ({ key: s, label: dict.alerts.sevLabels[s], value: report.by_severity[s] ?? 0 }))),
    [report.by_severity, dict],
  )
  const severityColors: Record<string, string> = {}
  for (const s of SEVERITIES) severityColors[s] = SEV_COLOR[s]
  const tacticModel = useMemo(
    () => buildDonut(Object.entries(report.by_tactic).map(([key, value]) => ({ key, label: key, value }))),
    [report.by_tactic],
  )
  const tacticColors = donutColors(tacticModel)
  return (
    <>
      <div className="grid gap-5 xl:grid-cols-3">
        <ChartCard
          title={dict.reports.charts.alertsBySeverity}
          subtitle={dict.reports.charts.severityComposition(report.alerts_total.toLocaleString(numberLocale(lang)))}
          icon={ChartPie}
          legend={severityModel.total ? donutLegend(severityModel, severityColors) : undefined}
          table={donutTable(severityModel, dict.reports.charts.severityTableCaption, dict.reports.charts.colSeverity, dict.reports.charts.colAlerts, dict.reports.charts.colShare)}
        >
          {severityModel.total === 0 ? (
            <EmptyState icon={ChartPie} title={dict.reports.charts.severityEmpty} hint={dict.reports.charts.severityEmptyHint} />
          ) : (
            <DonutChart model={severityModel} colors={severityColors} unit={dict.reports.charts.unitAlerts} ariaLabel={dict.reports.charts.severityAria(severityModel.total, severityModel.entries.length)} />
          )}
        </ChartCard>
        <ChartCard
          title={dict.reports.charts.alertsByTactic}
          subtitle={dict.reports.charts.tacticComposition}
          icon={ChartPie}
          legend={tacticModel.total ? donutLegend(tacticModel, tacticColors) : undefined}
          table={donutTable(tacticModel, dict.reports.charts.tacticTableCaption, dict.reports.charts.colTactic, dict.reports.charts.colAlerts, dict.reports.charts.colShare)}
        >
          {tacticModel.total === 0 ? (
            <EmptyState icon={ChartPie} title={dict.reports.charts.tacticEmpty} hint={dict.reports.charts.tacticEmptyHint} />
          ) : (
            <DonutChart model={tacticModel} colors={tacticColors} unit={dict.reports.charts.unitAlerts} ariaLabel={dict.reports.charts.tacticAria(tacticModel.total, tacticModel.entries.length)} />
          )}
        </ChartCard>
        <ChartCard
          title={dict.reports.charts.topRules}
          subtitle={dict.reports.charts.topRulesSubtitle}
          icon={ListBullets}
          table={{ caption: dict.reports.charts.topRulesCaption, columns: [dict.reports.charts.colRule, dict.reports.charts.colAlerts], rows: report.top_rules.map((r) => [r.rule_name, r.count]) }}
        >
          {report.top_rules.length === 0 ? (
            <EmptyState icon={ListBullets} title={dict.reports.charts.topRulesEmpty} hint={dict.reports.charts.topRulesEmptyHint}
            />
          ) : (
            <BarList rows={report.top_rules.map((r) => ({ key: r.rule_id, label: r.rule_name, title: r.rule_name, value: r.count }))} />
          )}
        </ChartCard>
      </div>
    </>
  )
}

function FleetCharts({ report }: { report: FleetCoverageReport }) {
  const { dict } = useI18n()
  if (!report.enabled) {
    return (
      <div className="panel px-4 py-5">
        <EmptyState icon={Desktop} title={dict.reports.charts.fleetChartsUnavailable} hint={dict.reports.charts.fleetChartsUnavailableHint} />
      </div>
    )
  }
  const model = useMemo(
    () => buildDonut([
      { key: 'online', label: dict.reports.charts.fleetOnline, value: report.summary.online },
      { key: 'silent', label: dict.reports.charts.fleetSilent, value: report.summary.silent },
      { key: 'idle', label: dict.reports.charts.fleetIdle, value: report.summary.idle },
    ]),
    [report.summary, dict],
  )
  const colors: Record<string, string> = { online: 'var(--series-2)', silent: 'var(--sev-critical)', idle: 'var(--series-other)' }
  return (
    <ChartCard
      title={dict.reports.charts.fleetByStatus}
      subtitle={dict.reports.charts.fleetSubtitle(report.summary.total)}
      icon={Desktop}
      legend={donutLegend(model, colors)}
      table={{
        caption: dict.reports.charts.fleetTableCaption,
        columns: [dict.reports.charts.colStatus, dict.reports.charts.colHosts, dict.reports.charts.colFleetShare],
        rows: model.entries.map((e) => [e.label, e.value, model.total ? Math.round((e.value / model.total) * 100) + ' %' : '—']),
      }}
    >
      {model.total === 0 ? (
        <EmptyState icon={Desktop} title={dict.reports.charts.fleetEmpty} hint={dict.reports.charts.fleetEmptyHint}
        />
      ) : (
        <DonutChart model={model} colors={colors} unit={dict.reports.charts.unitHosts} ariaLabel={dict.reports.charts.fleetAria(model.total)} />
      )}
    </ChartCard>
  )
}

function SocCharts({ report }: { report: SocActivityReport }) {
  const { dict } = useI18n()
  const series = [
    { key: 'created', label: dict.reports.charts.seriesCreated, color: 'var(--series-1)' },
    { key: 'acknowledged', label: dict.reports.charts.seriesAcknowledged, color: 'var(--series-3)' },
    { key: 'closed', label: dict.reports.charts.seriesClosed, color: 'var(--series-2)' },
  ]
  const total = report.days.reduce((sum, d) => sum + d.created + d.acknowledged + d.closed, 0)
  return (
    <ChartCard
      title={dict.reports.charts.socByDay}
      subtitle={dict.reports.charts.socSubtitle}
      icon={Pulse}
      legend={series.map((s, i) => ({ key: s.key, label: s.label, color: s.color, value: report.days.reduce((sum, d) => sum + (d[['created', 'acknowledged', 'closed'][i]] as number), 0) }))}
      table={{
        caption: dict.reports.charts.socTableCaption,
        columns: [dict.reports.charts.colDay, dict.reports.charts.colCreated, dict.reports.charts.colAcknowledged, dict.reports.charts.colClosed],
        rows: report.days.map((d) => [d.day, d.created, d.acknowledged, d.closed]),
      }}
      footer={dict.reports.charts.socFooter(total, report.days.length)}
    >
      {report.days.length === 0 ? (
        <EmptyState icon={Pulse} title={dict.reports.charts.socEmpty} hint={dict.reports.charts.socEmptyHint}
        />
      ) : (
        <StackedColumns
          buckets={report.days.map((d) => ({ key: d.day, label: d.day.slice(8), detail: d.day, values: { created: d.created, acknowledged: d.acknowledged, closed: d.closed } }))}
          series={series}
          ariaLabel={dict.reports.charts.socAria(total, report.days.length)}
          unit={dict.reports.charts.unitEvents}
        />
      )}
    </ChartCard>
  )
}

// ---- printable sheet --------------------------------------------------------

/** The printable sheet: kind-specific honest rendering, engine envelope
 * declared at the top. Unknown kinds fall back to their JSON. */
function ReportSheet({ report, onClose }: { report: ReportData; onClose: () => void }) {
  const { dict } = useI18n()
  const generated = report.generated_at.replace('T', ' ').slice(0, 19)
  const windowText = report.window ? `${report.window.preset} (${report.window.from.slice(0, 19)} → ${report.window.until.slice(0, 19)} UTC)` : dict.reports.sheet.pointInTime
  const sourceText = report.source === 'store' ? dict.reports.sheet.sourceStore : `${dict.reports.sheet.sourceMemory}${report.oldest_record ? ` · ${dict.reports.sheet.oldestRecord}: ${report.oldest_record.replace('T', ' ').slice(0, 19)}` : ''}`
  return (
    <div>
      <div className="flex flex-wrap items-start gap-2 border-b border-zinc-800 pb-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-zinc-50">{dict.reports.titles[report.kind as keyof typeof dict.reports.titles] ?? report.kind}</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            bluetardigrade · {dict.reports.sheet.generatedAt} {generated} UTC · {dict.reports.sheet.windowWord} {windowText} · {sourceText}
            {report.truncated ? dict.reports.sheet.truncated : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={`ml-auto rounded p-1 text-zinc-500 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${styles.noPrint}`}
          aria-label={dict.reports.closeReportAria}
        >
          <X size={14} aria-hidden />
        </button>
      </div>
      <div className="pt-3">
        <KindBody report={report} />
      </div>
    </div>
  )
}

function KindBody({ report }: { report: ReportData }) {
  if (report.kind === 'executive') return <ExecutiveSheet report={report} />
  if (report.kind === 'fleet') return <FleetSheet report={report} />
  if (report.kind === 'soc') return <SocSheet report={report} />
  if (report.kind === 'incident') return <IncidentSheet report={report} />
  // a future kind without a bespoke renderer still gets its honest JSON
  return <pre className="overflow-x-auto rounded-lg border border-zinc-800 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">{JSON.stringify(report, null, 2)}</pre>
}

function KpiTiles({ tiles }: { tiles: { label: string; value: string; warn?: boolean }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className={`rounded-lg px-3 py-2.5 ${t.warn ? 'bg-amber-400/[0.06]' : 'bg-white/[0.03]'}`}>
          <dt className="truncate text-[11px] text-zinc-500">{t.label}</dt>
          <dd className={`mt-1 font-mono text-sm tabular-nums ${t.warn ? 'text-amber-300' : 'text-zinc-100'}`}>{t.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function SheetTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: (string | number)[][] }) {
  if (rows.length === 0) return null
  return (
    <table className="w-full border-collapse text-left text-sm">
      <caption className="pb-1.5 text-left text-[11px] uppercase tracking-wider text-zinc-500">{caption}</caption>
      <thead>
        <tr className="bg-zinc-900">
          {columns.map((c) => (
            <th key={c} scope="col" className={th}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-800/70">
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j} className="px-4 py-2 text-xs tabular-nums text-zinc-200">{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ExecutiveSheet({ report }: { report: ExecutiveReport }) {
  const { dict, lang } = useI18n()
  const mapEntries = (record: Record<string, number>) => Object.entries(record).map(([k, v]) => [k, v] as (string | number)[])
  return (
    <div className="space-y-4">
      <KpiTiles
        tiles={[
          { label: dict.reports.exec.kpiAlerts, value: report.alerts_total.toLocaleString(numberLocale(lang)) },
          { label: dict.reports.exec.kpiHosts, value: String(report.hosts_affected) },
          { label: dict.reports.exec.kpiOpenIncidents, value: String(report.incidents.open), warn: report.incidents.open > 0 },
          { label: dict.reports.exec.kpiOpenedClosed, value: `${report.incidents.opened_in_window} / ${report.incidents.closed_in_window}` },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <SheetTable caption={dict.reports.exec.bySeverity} columns={[dict.reports.charts.colSeverity, dict.reports.charts.colAlerts]} rows={mapEntries(report.by_severity)} />
        <SheetTable caption={dict.reports.exec.byStatus} columns={[dict.reports.exec.colState, dict.reports.charts.colAlerts]} rows={mapEntries(report.by_status)} />
        <SheetTable caption={dict.reports.exec.byTactic} columns={[dict.reports.charts.colTactic, dict.reports.charts.colAlerts]} rows={mapEntries(report.by_tactic)} />
      </div>
      <SheetTable
        caption={dict.reports.exec.topRules}
        columns={[dict.reports.charts.colRule, dict.reports.exec.colId, dict.reports.charts.colAlerts]}
        rows={report.top_rules.map((r) => [r.rule_name, r.rule_id, r.count])}
      />
      {report.fleet.enabled ? (
        <SheetTable
          caption={dict.reports.exec.fleetSnapshot}
          columns={[dict.reports.exec.colTotal, dict.reports.charts.fleetOnline, dict.reports.charts.fleetSilent, dict.reports.charts.fleetIdle]}
          rows={[[report.fleet.total, report.fleet.online, report.fleet.silent, report.fleet.idle]]}
        />
      ) : (
        <p className="text-xs text-zinc-500">{dict.reports.exec.fleetUnavailable}</p>
      )}
      <p className="text-[11px] text-zinc-500">{dict.reports.exec.incidentStore}: {report.incidents.persistent ? dict.reports.exec.storePersistent : dict.reports.exec.storeMemory}.</p>
    </div>
  )
}

function FleetSheet({ report }: { report: FleetCoverageReport }) {
  const { dict, lang } = useI18n()
  if (!report.enabled) {
    return (
      <EmptyState icon={Files} title={dict.reports.fleet.unavailable} hint={dict.reports.fleet.unavailableHint} />
    )
  }
  return (
    <div className="space-y-4">
      <KpiTiles
        tiles={[
          { label: dict.reports.fleet.kpiHosts, value: String(report.summary.total) },
          { label: dict.reports.fleet.kpiOnline, value: String(report.summary.online) },
          { label: dict.reports.fleet.kpiSilent, value: String(report.summary.silent), warn: report.summary.silent > 0 },
          { label: dict.reports.fleet.kpiNoSignalWindow, value: String(report.summary.no_signal_in_window), warn: report.summary.no_signal_in_window > 0 },
        ]}
      />
      <SheetTable
        caption={dict.reports.fleet.hostsCaption}
        columns={[dict.reports.fleet.colHost, dict.reports.charts.colStatus, dict.reports.fleet.colFirstSeen, dict.reports.fleet.colLastSeen, dict.reports.fleet.colEventsLifetime, dict.reports.fleet.colEventsWindow, dict.reports.fleet.colSensor, dict.reports.fleet.colIdentity]}
        rows={report.hosts.map((h) => [
          h.host,
          h.status === 'online' ? dict.reports.fleet.statusOnline : h.status === 'silent' ? dict.reports.fleet.statusSilent : dict.reports.fleet.statusIdle,
          h.first_seen.replace('T', ' ').slice(0, 19),
          h.last_seen.replace('T', ' ').slice(0, 19),
          h.events.toLocaleString(numberLocale(lang)),
          h.events_in_window.toLocaleString(numberLocale(lang)),
          h.sensor_version ?? '—',
          h.identity ?? '—',
        ])}
      />
    </div>
  )
}

function SocSheet({ report }: { report: SocActivityReport }) {
  const { dict, lang } = useI18n()
  const mtta = report.mean_time_to_ack_seconds > 0 ? `${Math.round(report.mean_time_to_ack_seconds / 60)} min` : '—'
  const mttc = report.mean_time_to_close_seconds > 0 ? `${Math.round(report.mean_time_to_close_seconds / 60)} min` : '—'
  return (
    <div className="space-y-4">
      <KpiTiles
        tiles={[
          { label: dict.reports.soc.kpiCreated, value: report.created.toLocaleString(numberLocale(lang)) },
          { label: dict.reports.soc.kpiBacklog, value: String(report.backlog.new), warn: report.backlog.new > 0 },
          { label: 'MTTA', value: mtta },
          { label: 'MTTC', value: mttc },
        ]}
      />
      <SheetTable
        caption={dict.reports.soc.byDayCaption}
        columns={[dict.reports.charts.colDay, dict.reports.charts.colCreated, dict.reports.charts.colAcknowledged, dict.reports.charts.colClosed]}
        rows={report.days.map((d) => [d.day, d.created, d.acknowledged, d.closed])}
      />
      <SheetTable
        caption={dict.reports.soc.byOperatorCaption}
        columns={[dict.reports.soc.colOperator, dict.reports.soc.colActions]}
        rows={Object.entries(report.by_operator).map(([name, count]) => [name, count])}
      />
      <p className="text-[11px] text-zinc-500">{dict.reports.soc.backlog(report.backlog.new, report.backlog.acknowledged, report.backlog.closed)}</p>
    </div>
  )
}

function IncidentSheet({ report }: { report: IncidentReport }) {
  const { dict } = useI18n()
  const c = report.incident
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-100">{c.title}</h3>
          <SeverityBadge severity={(c.severity as 'critical' | 'high' | 'medium' | 'low' | 'info') ?? 'low'} />
          <span className="rounded-md border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-300">{dict.incidents.statusLabels[c.status as keyof typeof dict.incidents.statusLabels] ?? c.status}</span>
          <span className="ml-auto font-mono text-[11px] text-zinc-500">{c.id}</span>
        </div>
        {c.summary && <p className="mt-1.5 text-xs leading-relaxed text-zinc-300">{c.summary}</p>}
        <p className="mt-2 text-[11px] text-zinc-500">
          {dict.reports.incident.owner}: {c.owner ?? dict.reports.incident.unassigned} · {dict.reports.incident.hosts}: {c.hosts.join(', ') || dict.reports.incident.noHosts} · {dict.reports.incident.created} {c.created_at.replace('T', ' ').slice(0, 19)} · {dict.reports.incident.updated} {c.updated_at.replace('T', ' ').slice(0, 19)}{c.closed_at ? ` · ${dict.reports.incident.closed} ${c.closed_at.replace('T', ' ').slice(0, 19)}` : ''}
        </p>
      </div>

      <SheetTable
        caption={dict.reports.incident.timelineCaption}
        columns={[dict.reports.incident.colMoment, dict.reports.incident.colAuthor, dict.reports.incident.colType, dict.reports.incident.colEntry]}
        rows={report.timeline.map((t) => [t.at.replace('T', ' ').slice(0, 19), t.by ?? '—', t.kind, t.text])}
      />

      <SheetTable
        caption={dict.reports.incident.alertsCaption}
        columns={[dict.reports.incident.colAlert, dict.reports.charts.colRule, dict.reports.charts.colSeverity, dict.reports.fleet.colHost, dict.reports.incident.colMoment, dict.reports.exec.colState, dict.reports.incident.colSummary]}
        rows={report.alerts.map((a) => [
          a.found ? (a.id ?? '—') : `${a.id} (${dict.reports.incident.noLongerResolvable})`,
          a.rule_name ?? a.rule_id ?? '—',
          a.severity ?? '—',
          a.host ?? '—',
          a.timestamp ? a.timestamp.replace('T', ' ').slice(0, 19) : '—',
          a.status ?? '—',
          a.summary ?? '—',
        ])}
      />
    </div>
  )
}
