'use client'

// REP-1 — report catalog screen. The picker is rendered from the
// engine's own catalog (GET /api/reports): kinds the engine cannot
// compute today simply do not appear, and a future kind without a
// bespoke renderer still shows its honest JSON. Every report can be
// downloaded exactly as the engine serves it (CSV with the engine's
// formula escaping, pretty JSON) and printed or saved as PDF from a
// dedicated printable sheet.

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
import { SEVERITIES, SEVERITY_LABEL } from '@/lib/soc-metrics'
import { INCIDENT_STATUS_LABEL } from '@/lib/engine-writes'
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

const chip =
  'rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const primaryBtn =
  'inline-flex items-center gap-1.5 rounded-lg bg-primary-strong px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-primary-tint disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const th = 'border-b border-zinc-800 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500'

export function ReportsView() {
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
    setNotice(res.ok ? `Descarga enviada: ${res.filename}` : `No se pudo descargar: ${res.error}`)
  }

  const openIncidents = useMemo(() => incidents.filter((i) => i.status !== 'closed'), [incidents])

  if (catalogError) {
    return (
      <section aria-label="Informes" className="panel px-4 py-6">
        <EmptyState icon={Files} title="El catálogo de informes no está disponible" hint={`${catalogError} — el catálogo lo sirve el motor (GET /api/reports).`} />
      </section>
    )
  }

  if (!catalog) {
    return (
      <section aria-label="Informes" className="panel px-4 py-6">
        <SkeletonRows rows={4} />
      </section>
    )
  }

  if (catalog.reports.length === 0) {
    return (
      <section aria-label="Informes" className="panel px-4 py-6">
        <EmptyState icon={Files} title="Este motor no publica informes" hint="El catálogo está vacío: actualiza el motor para tener el resumen ejecutivo, cobertura, actividad del SOC e informes de incidente." />
      </section>
    )
  }

  return (
    <section aria-label="Informes" className="space-y-4">
      <p className="max-w-[100ch] text-xs leading-relaxed text-zinc-500">
        Informes de solo lectura que el motor agrega de sus propios registros. Con almacén SQLite cubren toda la retención; con
        los anillos en memoria cubren lo que el motor aún recuerda y el propio informe lo declara. Descarga exactamente lo que
        sirve el motor (CSV con su escapado, JSON completo) o imprime la hoja y guárdala como PDF.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Informe
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
            Ventana
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
            Incidente (16 hex)
            <input value={caseId} onChange={(e) => setCaseId(e.target.value.trim().toLowerCase())} placeholder="0123abcdef012345" spellCheck={false} maxLength={16} className={`${chip} w-56 font-mono`} list="informes-casos" />
            <datalist id="informes-casos">
              {openIncidents.slice(0, 20).map((i) => (
                <option key={i.id} value={i.id}>{i.title}</option>
              ))}
            </datalist>
          </label>
        )}

        <button type="button" className={primaryBtn} disabled={!canGenerate || loading} onClick={() => void generate()}>
          {loading ? 'Generando…' : 'Generar informe'}
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
              <Printer size={13} aria-hidden /> Imprimir / PDF
            </button>
          </div>
        )}
      </div>

      {entry && <p className="max-w-[100ch] text-xs text-zinc-500">{entry.description}</p>}

      {needsId && !INCIDENT_ID_RE.test(caseId) && (
        <p role="status" className="text-xs text-zinc-400">
          El informe de incidente necesita un identificador de caso (16 caracteres hexadecimales); el desplegable lista los casos abiertos que la consola conoce.
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

function donutTable(model: ReturnType<typeof buildDonut>, caption: string, kind: string) {
  return {
    caption,
    columns: [kind, 'Alertas', '% del informe'],
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
  const severityModel = useMemo(
    () => buildDonut(SEVERITIES.map((s) => ({ key: s, label: SEVERITY_LABEL[s], value: report.by_severity[s] ?? 0 }))),
    [report.by_severity],
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
          title="Alertas por severidad"
          subtitle={`Composición del informe: ${report.alerts_total.toLocaleString('es-ES')} alertas en la ventana`}
          icon={ChartPie}
          legend={severityModel.total ? donutLegend(severityModel, severityColors) : undefined}
          table={donutTable(severityModel, 'Alertas por severidad (desglose completo)', 'Severidad')}
        >
          {severityModel.total === 0 ? (
            <EmptyState icon={ChartPie} title="Sin alertas en la ventana" hint="El donut aparece en cuanto el informe cubre alertas." />
          ) : (
            <DonutChart model={severityModel} colors={severityColors} unit="alertas" ariaLabel={`Alertas por severidad: ${severityModel.total} en ${severityModel.entries.length} niveles`} />
          )}
        </ChartCard>
        <ChartCard
          title="Alertas por táctica"
          subtitle="Composición del informe por táctica ATT&CK declarada por las reglas"
          icon={ChartPie}
          legend={tacticModel.total ? donutLegend(tacticModel, tacticColors) : undefined}
          table={donutTable(tacticModel, 'Alertas por táctica ATT&CK (desglose completo)', 'Táctica')}
        >
          {tacticModel.total === 0 ? (
            <EmptyState icon={ChartPie} title="Sin tácticas en la ventana" hint="Las alertas del informe llenan este donut." />
          ) : (
            <DonutChart model={tacticModel} colors={tacticColors} unit="alertas" ariaLabel={`Alertas por táctica: ${tacticModel.total} en ${tacticModel.entries.length} tácticas`} />
          )}
        </ChartCard>
        <ChartCard
          title="Reglas más activas"
          subtitle="Top 5 del informe por alertas en la ventana"
          icon={ListBullets}
          table={{ caption: 'Reglas más activas del informe', columns: ['Regla', 'Alertas'], rows: report.top_rules.map((r) => [r.rule_name, r.count]) }}
        >
          {report.top_rules.length === 0 ? (
            <EmptyState icon={ListBullets} title="Sin reglas destacadas" hint="El top aparece cuando el informe cubre alertas."
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
  if (!report.enabled) {
    return (
      <div className="panel px-4 py-5">
        <EmptyState icon={Desktop} title="Gráficas de cobertura no disponibles" hint="El motor corre sin el rastreador de equipos: no hay inventario del que dibujar y no se pintan ceros." />
      </div>
    )
  }
  const model = useMemo(
    () => buildDonut([
      { key: 'online', label: 'En línea', value: report.summary.online },
      { key: 'silent', label: 'Sin señal', value: report.summary.silent },
      { key: 'idle', label: 'Inactivos', value: report.summary.idle },
    ]),
    [report.summary],
  )
  const colors: Record<string, string> = { online: 'var(--series-2)', silent: 'var(--sev-critical)', idle: 'var(--series-other)' }
  return (
    <ChartCard
      title="Flota por estado"
      subtitle={`${report.summary.total} equipos en el inventario al generar el informe`}
      icon={Desktop}
      legend={donutLegend(model, colors)}
      table={{
        caption: 'Equipos por estado en el informe',
        columns: ['Estado', 'Equipos', '% de la flota'],
        rows: model.entries.map((e) => [e.label, e.value, model.total ? Math.round((e.value / model.total) * 100) + ' %' : '—']),
      }}
    >
      {model.total === 0 ? (
        <EmptyState icon={Desktop} title="Inventario vacío" hint="El informe cubre una ventana sin inventario; en cuanto el rastreador vea equipos, el donut aparece."
        />
      ) : (
        <DonutChart model={model} colors={colors} unit="equipos" ariaLabel={`Flota por estado: ${model.total} equipos`} />
      )}
    </ChartCard>
  )
}

function SocCharts({ report }: { report: SocActivityReport }) {
  const series = [
    { key: 'created', label: 'Creadas', color: 'var(--series-1)' },
    { key: 'acknowledged', label: 'Reconocidas', color: 'var(--series-3)' },
    { key: 'closed', label: 'Cerradas', color: 'var(--series-2)' },
  ]
  const total = report.days.reduce((sum, d) => sum + d.created + d.acknowledged + d.closed, 0)
  return (
    <ChartCard
      title="Actividad de triaje por día"
      subtitle="Alertas creadas y acciones de triaje por día UTC en la ventana del informe"
      icon={Pulse}
      legend={series.map((s, i) => ({ key: s.key, label: s.label, color: s.color, value: report.days.reduce((sum, d) => sum + (d[['created', 'acknowledged', 'closed'][i]] as number), 0) }))}
      table={{
        caption: 'Alertas creadas y acciones de triaje por día UTC',
        columns: ['Día', 'Creadas', 'Reconocidas', 'Cerradas'],
        rows: report.days.map((d) => [d.day, d.created, d.acknowledged, d.closed]),
      }}
      footer={`${total} sucesos en ${report.days.length} días. Las acciones cuentan la última de cada alerta; las medias MTTA/MTTC están en la hoja del informe.`}
    >
      {report.days.length === 0 ? (
        <EmptyState icon={Pulse} title="Sin días en la ventana" hint="El informe SOC dibuja esta pila en cuanto haya actividad diaria."
        />
      ) : (
        <StackedColumns
          buckets={report.days.map((d) => ({ key: d.day, label: d.day.slice(8), detail: d.day, values: { created: d.created, acknowledged: d.acknowledged, closed: d.closed } }))}
          series={series}
          ariaLabel={`Actividad de triaje por día: ${total} sucesos en ${report.days.length} días`}
          unit="sucesos en total"
        />
      )}
    </ChartCard>
  )
}

// ---- printable sheet --------------------------------------------------------

/** The printable sheet: kind-specific honest rendering, engine envelope
 * declared at the top. Unknown kinds fall back to their JSON. */
function ReportSheet({ report, onClose }: { report: ReportData; onClose: () => void }) {
  const generated = report.generated_at.replace('T', ' ').slice(0, 19)
  const windowText = report.window ? `${report.window.preset} (${report.window.from.slice(0, 19)} → ${report.window.until.slice(0, 19)} UTC)` : 'punto en el tiempo'
  const sourceText = report.source === 'store' ? 'almacén SQLite (retención completa)' : `anillos en memoria${report.oldest_record ? ` · recuerdo más antiguo: ${report.oldest_record.replace('T', ' ').slice(0, 19)}` : ''}`
  return (
    <div>
      <div className="flex flex-wrap items-start gap-2 border-b border-zinc-800 pb-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-zinc-50">{REPORT_TITLES[report.kind] ?? report.kind}</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            bluetardigrade · generado {generated} UTC · ventana {windowText} · {sourceText}
            {report.truncated ? ' · examen en el tope de registros (ve el trozo más nuevo de la ventana)' : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={`ml-auto rounded p-1 text-zinc-500 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${styles.noPrint}`}
          aria-label="Cerrar el informe"
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

const REPORT_TITLES: Record<string, string> = {
  executive: 'Resumen ejecutivo',
  incident: 'Informe de incidente',
  fleet: 'Cobertura de flota',
  soc: 'Actividad del equipo SOC',
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
  const mapEntries = (record: Record<string, number>) => Object.entries(record).map(([k, v]) => [k, v] as (string | number)[])
  return (
    <div className="space-y-4">
      <KpiTiles
        tiles={[
          { label: 'Alertas en la ventana', value: report.alerts_total.toLocaleString('es-ES') },
          { label: 'Equipos afectados', value: String(report.hosts_affected) },
          { label: 'Incidentes abiertos ahora', value: String(report.incidents.open), warn: report.incidents.open > 0 },
          { label: 'Abiertos / cerrados en ventana', value: `${report.incidents.opened_in_window} / ${report.incidents.closed_in_window}` },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <SheetTable caption="Por severidad" columns={['Severidad', 'Alertas']} rows={mapEntries(report.by_severity)} />
        <SheetTable caption="Por estado de triaje" columns={['Estado', 'Alertas']} rows={mapEntries(report.by_status)} />
        <SheetTable caption="Por táctica ATT&CK" columns={['Táctica', 'Alertas']} rows={mapEntries(report.by_tactic)} />
      </div>
      <SheetTable
        caption="Reglas más activas (top 5)"
        columns={['Regla', 'Identificador', 'Alertas']}
        rows={report.top_rules.map((r) => [r.rule_name, r.rule_id, r.count])}
      />
      {report.fleet.enabled ? (
        <SheetTable
          caption="Foto de la flota al generar el informe"
          columns={['Total', 'En línea', 'Sin señal', 'Inactivos']}
          rows={[[report.fleet.total, report.fleet.online, report.fleet.silent, report.fleet.idle]]}
        />
      ) : (
        <p className="text-xs text-zinc-500">La flota no está disponible: el motor corre sin el rastreador de equipos, así que no se pintan ceros como cobertura.</p>
      )}
      <p className="text-[11px] text-zinc-500">Incident store: {report.incidents.persistent ? 'persistente en disco' : 'en memoria (se pierde al reiniciar el motor)'}.</p>
    </div>
  )
}

function FleetSheet({ report }: { report: FleetCoverageReport }) {
  if (!report.enabled) {
    return (
      <EmptyState icon={Files} title="Cobertura no disponible" hint="El motor corre sin el rastreador de equipos (flota): no hay inventario del que informar y no se pintan ceros." />
    )
  }
  return (
    <div className="space-y-4">
      <KpiTiles
        tiles={[
          { label: 'Equipos en inventario', value: String(report.summary.total) },
          { label: 'En línea', value: String(report.summary.online) },
          { label: 'Sin señal', value: String(report.summary.silent), warn: report.summary.silent > 0 },
          { label: 'Sin eventos en la ventana', value: String(report.summary.no_signal_in_window), warn: report.summary.no_signal_in_window > 0 },
        ]}
      />
      <SheetTable
        caption="Equipos del inventario"
        columns={['Equipo', 'Estado', 'Primera señal', 'Última señal', 'Eventos (vida)', 'Eventos en ventana', 'Sensor', 'Identidad']}
        rows={report.hosts.map((h) => [
          h.host,
          h.status === 'online' ? 'en línea' : h.status === 'silent' ? 'sin señal' : 'inactivo',
          h.first_seen.replace('T', ' ').slice(0, 19),
          h.last_seen.replace('T', ' ').slice(0, 19),
          h.events.toLocaleString('es-ES'),
          h.events_in_window.toLocaleString('es-ES'),
          h.sensor_version ?? '—',
          h.identity ?? '—',
        ])}
      />
    </div>
  )
}

function SocSheet({ report }: { report: SocActivityReport }) {
  const mtta = report.mean_time_to_ack_seconds > 0 ? `${Math.round(report.mean_time_to_ack_seconds / 60)} min` : '—'
  const mttc = report.mean_time_to_close_seconds > 0 ? `${Math.round(report.mean_time_to_close_seconds / 60)} min` : '—'
  return (
    <div className="space-y-4">
      <KpiTiles
        tiles={[
          { label: 'Alertas creadas', value: report.created.toLocaleString('es-ES') },
          { label: 'Backlog abierto (nuevas)', value: String(report.backlog.new), warn: report.backlog.new > 0 },
          { label: 'MTTA', value: mtta },
          { label: 'MTTC', value: mttc },
        ]}
      />
      <SheetTable
        caption="Alertas creadas por día UTC"
        columns={['Día', 'Creadas', 'Reconocidas', 'Cerradas']}
        rows={report.days.map((d) => [d.day, d.created, d.acknowledged, d.closed])}
      />
      <SheetTable
        caption="Acciones de triaje por operadora (última acción de cada alerta)"
        columns={['Operadora', 'Acciones']}
        rows={Object.entries(report.by_operator).map(([name, count]) => [name, count])}
      />
      <p className="text-[11px] text-zinc-500">Backlog actual: {report.backlog.new} nuevas · {report.backlog.acknowledged} reconocidas · {report.backlog.closed} cerradas. Las medias se calculan sobre la última acción de cada alerta.</p>
    </div>
  )
}

function IncidentSheet({ report }: { report: IncidentReport }) {
  const c = report.incident
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-100">{c.title}</h3>
          <SeverityBadge severity={(c.severity as 'critical' | 'high' | 'medium' | 'low' | 'info') ?? 'low'} />
          <span className="rounded-md border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-300">{INCIDENT_STATUS_LABEL[c.status as keyof typeof INCIDENT_STATUS_LABEL] ?? c.status}</span>
          <span className="ml-auto font-mono text-[11px] text-zinc-500">{c.id}</span>
        </div>
        {c.summary && <p className="mt-1.5 text-xs leading-relaxed text-zinc-300">{c.summary}</p>}
        <p className="mt-2 text-[11px] text-zinc-500">
          Responsable: {c.owner ?? 'sin asignar'} · equipos: {c.hosts.join(', ') || 'ninguno'} · creado {c.created_at.replace('T', ' ').slice(0, 19)} · actualizado {c.updated_at.replace('T', ' ').slice(0, 19)}{c.closed_at ? ` · cerrado ${c.closed_at.replace('T', ' ').slice(0, 19)}` : ''}
        </p>
      </div>

      <SheetTable
        caption="Cronología del caso"
        columns={['Momento', 'Autoría', 'Tipo', 'Entrada']}
        rows={report.timeline.map((t) => [t.at.replace('T', ' ').slice(0, 19), t.by ?? '—', t.kind, t.text])}
      />

      <SheetTable
        caption="Alertas agrupadas por el caso"
        columns={['Alerta', 'Regla', 'Severidad', 'Equipo', 'Momento', 'Estado', 'Resumen']}
        rows={report.alerts.map((a) => [
          a.found ? (a.id ?? '—') : `${a.id} (ya no resoluble)`,
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
