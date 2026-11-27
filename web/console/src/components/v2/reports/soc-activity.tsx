'use client'

// Informes · Actividad del SOC: how the queue moved over the window —
// alerts created, acknowledged and closed on each UTC day (every day of
// the window, the quiet ones too), the mean times to acknowledge and to
// close (none when nothing was), the backlog now and the decisions per
// operator.
import { useI18n } from '@/components/console/i18n-provider'
import { formatDuration } from '@/lib/fleet'
import type { ReportWindowPreset, SocActivityReport } from '@/lib/reports'
import { fillDays, meanOrNull, ranking, triageShares, WINDOW_DAYS } from '@/lib/v2/reports-model'
import { Bars, Figure, ReportActions, ReportStatus, SourceLine, Stacked, useReport, WindowSeg } from './parts'
import { PrintView } from './print-view'

const DAY_COLOR = { created: 'var(--v2-text-2)', acknowledged: 'var(--v2-sev-low)', closed: 'var(--v2-ok)' }

export function SocBody({ report, win }: { report: SocActivityReport; win: ReportWindowPreset }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.reportsView
  const n = new Intl.NumberFormat(lang)
  const days = fillDays(report, WINDOW_DAYS[win])
  const peak = Math.max(1, ...days.flatMap((d) => [d.created, d.acknowledged, d.closed]))
  const acked = days.reduce((s, d) => s + d.acknowledged, 0)
  const closed = days.reduce((s, d) => s + d.closed, 0)
  const mtta = meanOrNull(report.mean_time_to_ack_seconds, acked)
  const mttc = meanOrNull(report.mean_time_to_close_seconds, closed)
  const dayLabel = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const every = days.length > 10 ? Math.ceil(days.length / 8) : 1
  const backlog = triageShares(report.backlog)
  const operators = ranking(report.by_operator)

  return (
    <div className="v2-rep-body">
      <div className="v2-rep-figs">
        <Figure label={t.socCreated} value={n.format(report.created)} />
        <Figure label={t.socMtta} value={mtta === null ? '—' : formatDuration(mtta)} note={mtta === null ? t.socNoAcked : undefined} />
        <Figure label={t.socMttc} value={mttc === null ? '—' : formatDuration(mttc)} note={mttc === null ? t.socNoClosed : undefined} />
      </div>
      <section className="v2-rep-block">
        <h3 className="v2-eyebrow">{t.socDaily}</h3>
        <div className="v2-rep-days">
          {days.map((d, i) => (
            <div key={d.day} className="v2-rep-day" role="img" aria-label={t.socDayAria(dayLabel.format(new Date(d.day)), d.created, d.acknowledged, d.closed)}>
              <span className="v2-rep-daybars">
                {(['created', 'acknowledged', 'closed'] as const).map((k) => (
                  <i key={k} style={{ ['--h' as string]: `${(d[k] / peak) * 100}%`, ['--c' as string]: DAY_COLOR[k] }} data-zero={d[k] === 0} />
                ))}
              </span>
              <small>{i % every === 0 || i === days.length - 1 ? dayLabel.format(new Date(d.day)) : ''}</small>
            </div>
          ))}
        </div>
        <ul className="v2-rep-legend">
          {(['created', 'acknowledged', 'closed'] as const).map((k) => (
            <li key={k}>
              <i style={{ ['--c' as string]: DAY_COLOR[k] }} aria-hidden="true" />
              {t.socLegend[k]}
            </li>
          ))}
        </ul>
      </section>
      <div className="v2-rep-grid">
        <section className="v2-rep-block">
          <h3 className="v2-eyebrow">{t.socBacklog}</h3>
          <Stacked label={t.socBacklog} parts={backlog.map((s) => ({ ...s, label: t.triage[s.key], color: s.key === 'new' ? 'var(--v2-accent)' : s.key === 'acknowledged' ? 'var(--v2-sev-low)' : 'var(--v2-ok)' }))} />
        </section>
        <section className="v2-rep-block">
          <h3 className="v2-eyebrow">{t.socByOperator}</h3>
          {operators.length === 0 ? <p className="v2-small v2-dim">—</p> : <Bars rows={operators.map((o) => ({ key: o.key, label: o.key, count: o.count }))} />}
        </section>
      </div>
    </div>
  )
}

export function SocActivity({ win, onWin, print, onPrint }: { win: ReportWindowPreset; onWin: (w: ReportWindowPreset) => void; print: boolean; onPrint: (on: boolean) => void }) {
  const { dict } = useI18n()
  const t = dict.v2.reportsView
  const query = { kind: 'soc', window: win }
  const state = useReport<SocActivityReport>(query)
  const report = state?.status === 'ok' ? state.data : null

  if (print && report)
    return (
      <PrintView title={t.kinds.soc.title} subtitle={t.windows[win]} env={report} onBack={() => onPrint(false)}>
        <SocBody report={report} win={win} />
      </PrintView>
    )
  return (
    <div className="v2-rep">
      <div className="v2-rep-head">
        <div>
          <h2>{t.kinds.soc.title}</h2>
          {report && <SourceLine env={report} />}
        </div>
        <WindowSeg value={win} onChange={onWin} />
      </div>
      <ReportStatus state={state} />
      {report && (
        <>
          <ReportActions query={query} onPrint={() => onPrint(true)} />
          <SocBody report={report} win={win} />
        </>
      )}
    </div>
  )
}
