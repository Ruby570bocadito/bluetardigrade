'use client'

// Informes · Cobertura de la flota: every machine the engine has seen,
// with the ones that sent nothing in the window pinned on top — the gap a
// report has to show first — then by status.
import { useI18n } from '@/components/console/i18n-provider'
import { formatDateTime } from '@/lib/console-types'
import type { FleetCoverageReport, ReportWindowPreset } from '@/lib/reports'
import { v2HostLink } from '@/lib/v2/hosts-model'
import { fleetRows } from '@/lib/v2/reports-model'
import { Empty } from '../home/parts'
import { Figure, ReportActions, ReportStatus, SourceLine, useReport, WindowSeg } from './parts'
import { PrintView } from './print-view'

export function FleetBody({ report }: { report: FleetCoverageReport }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.reportsView
  const n = new Intl.NumberFormat(lang)
  if (!report.enabled) return <Empty title={t.fleetOff} />
  const rows = fleetRows(report.hosts)
  const s = report.summary
  return (
    <div className="v2-rep-body">
      <div className="v2-rep-figs">
        <Figure label={t.flStates.total} value={n.format(s.total)} />
        <Figure label={t.flStates.online} value={n.format(s.online)} tone={s.online > 0 ? 'ok' : undefined} />
        <Figure label={t.flStates.silent} value={n.format(s.silent)} tone={s.silent > 0 ? 'warn' : undefined} />
        <Figure label={t.flStates.idle} value={n.format(s.idle)} />
        <Figure label={t.flStates.quiet} value={n.format(s.no_signal_in_window)} tone={s.no_signal_in_window > 0 ? 'warn' : undefined} />
      </div>
      <div className="v2-rep-tablewrap">
        <table className="v2-rep-table">
          <thead>
            <tr>
              <th>{t.flCols.host}</th>
              <th>{t.flCols.status}</th>
              <th>{t.flCols.first}</th>
              <th>{t.flCols.last}</th>
              <th className="v2-num">{t.flCols.events}</th>
              <th>{t.flCols.version}</th>
              <th>{t.flCols.identity}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.host} data-quiet={h.quiet}>
                <td>
                  <a className="v2-link v2-mono" href={v2HostLink(h.host)}>
                    {h.host}
                  </a>
                  {h.quiet && <span className="v2-tag v2-rep-quiet">{t.flQuiet}</span>}
                </td>
                <td>
                  <span className="v2-hstatus" data-status={h.status}>
                    <i aria-hidden="true" />
                    {t.flStatus[h.status] ?? h.status}
                  </span>
                </td>
                <td className="v2-small">{h.first_seen ? formatDateTime(h.first_seen, lang) : '—'}</td>
                <td className="v2-small">{h.last_seen ? formatDateTime(h.last_seen, lang) : '—'}</td>
                <td className="v2-num v2-mono">{n.format(h.events_in_window)}</td>
                <td className="v2-mono v2-small">{h.sensor_version ?? '—'}</td>
                <td className="v2-mono v2-small">{h.identity ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function FleetCoverage({ win, onWin, print, onPrint }: { win: ReportWindowPreset; onWin: (w: ReportWindowPreset) => void; print: boolean; onPrint: (on: boolean) => void }) {
  const { dict } = useI18n()
  const t = dict.v2.reportsView
  const query = { kind: 'fleet', window: win }
  const state = useReport<FleetCoverageReport>(query)
  const report = state?.status === 'ok' ? state.data : null

  if (print && report)
    return (
      <PrintView title={t.kinds.fleet.title} subtitle={t.windows[win]} env={report} onBack={() => onPrint(false)}>
        <FleetBody report={report} />
      </PrintView>
    )
  return (
    <div className="v2-rep">
      <div className="v2-rep-head">
        <div>
          <h2>{t.kinds.fleet.title}</h2>
          {report && <SourceLine env={report} />}
        </div>
        <WindowSeg value={win} onChange={onWin} />
      </div>
      <ReportStatus state={state} />
      {report && (
        <>
          <ReportActions query={query} onPrint={() => onPrint(true)} />
          <FleetBody report={report} />
        </>
      )}
    </div>
  )
}
