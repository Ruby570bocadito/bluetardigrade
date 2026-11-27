'use client'

// Informes · Resumen ejecutivo: one page for management over the chosen
// window — the headline figures, alerts by severity, the triage status,
// the ATT&CK tactics, the busiest rules, the cases and the fleet — with
// the source of the numbers on top. The same body prints as a sheet.
import { useI18n } from '@/components/console/i18n-provider'
import type { ExecutiveReport, ReportWindowPreset } from '@/lib/reports'
import { v2RuleLink } from '@/lib/v2/detection-model'
import { severityShares, tacticBars, triageShares } from '@/lib/v2/reports-model'
import { Empty, SEV_COLOR } from '../home/parts'
import { Bars, Figure, ReportActions, ReportStatus, SourceLine, Stacked, useReport, WindowSeg } from './parts'
import { PrintView } from './print-view'

const TRIAGE_COLOR: Record<string, string> = { new: 'var(--v2-accent)', acknowledged: 'var(--v2-sev-low)', closed: 'var(--v2-ok)' }

export function ExecutiveBody({ report }: { report: ExecutiveReport }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.reportsView
  const n = new Intl.NumberFormat(lang)
  const sev = severityShares(report.by_severity)
  const triage = triageShares(report.by_status)
  const tactics = tacticBars(report.by_tactic)
  return (
    <div className="v2-rep-body">
      <div className="v2-rep-figs">
        <Figure label={t.exAlerts} value={n.format(report.alerts_total)} />
        <Figure label={t.exCritical} value={n.format(report.by_severity.critical ?? 0)} tone={(report.by_severity.critical ?? 0) > 0 ? 'warn' : undefined} />
        <Figure label={t.exHosts} value={n.format(report.hosts_affected)} />
        <Figure label={t.exIncOpen} value={n.format(report.incidents.open)} note={t.exIncOpened(report.incidents.opened_in_window)} />
        <Figure label={t.exIncClosed} value={n.format(report.incidents.closed_in_window)} />
      </div>
      {report.alerts_total === 0 ? (
        <Empty title={t.noAlerts} />
      ) : (
        <div className="v2-rep-grid">
          <section className="v2-rep-block">
            <h3 className="v2-eyebrow">{t.exBySeverity}</h3>
            <Stacked label={t.exBySeverity} parts={sev.map((s) => ({ ...s, label: dict.v2.sev[s.key], color: SEV_COLOR[s.key] }))} />
          </section>
          <section className="v2-rep-block">
            <h3 className="v2-eyebrow">{t.exTriage}</h3>
            <Stacked label={t.exTriage} parts={triage.map((s) => ({ ...s, label: t.triage[s.key], color: TRIAGE_COLOR[s.key] }))} />
          </section>
          <section className="v2-rep-block">
            <h3 className="v2-eyebrow">{t.exTactics}</h3>
            <Bars rows={tactics.map((x) => ({ key: x.name, label: x.slug ? dict.rules.tactics[x.slug] : x.name, count: x.count }))} />
          </section>
          <section className="v2-rep-block">
            <h3 className="v2-eyebrow">{t.exTopRules}</h3>
            <Bars
              rows={report.top_rules.map((r) => ({
                key: r.rule_id,
                label: (
                  <a className="v2-link" href={v2RuleLink(r.rule_id)}>
                    {r.rule_name || r.rule_id}
                  </a>
                ),
                count: r.count,
              }))}
            />
          </section>
        </div>
      )}
      <section className="v2-rep-block">
        <h3 className="v2-eyebrow">{t.exFleet}</h3>
        {report.fleet.enabled ? (
          <p className="v2-rep-fleet">
            <span className="v2-mono">{n.format(report.fleet.total)}</span> · <span data-status="online">{n.format(report.fleet.online)} {t.fleetStates.online}</span> ·{' '}
            <span data-status="silent">{n.format(report.fleet.silent)} {t.fleetStates.silent}</span> · <span>{n.format(report.fleet.idle)} {t.fleetStates.idle}</span>
          </p>
        ) : (
          <p className="v2-small v2-dim">{t.fleetOff}</p>
        )}
        {!report.incidents.persistent && <p className="v2-small v2-warn">{t.notPersistent}</p>}
      </section>
    </div>
  )
}

export function Executive({ win, onWin, print, onPrint }: { win: ReportWindowPreset; onWin: (w: ReportWindowPreset) => void; print: boolean; onPrint: (on: boolean) => void }) {
  const { dict } = useI18n()
  const t = dict.v2.reportsView
  const query = { kind: 'executive', window: win }
  const state = useReport<ExecutiveReport>(query)
  const report = state?.status === 'ok' ? state.data : null

  if (print && report)
    return (
      <PrintView title={t.kinds.executive.title} subtitle={t.windows[win]} env={report} onBack={() => onPrint(false)}>
        <ExecutiveBody report={report} />
      </PrintView>
    )
  return (
    <div className="v2-rep">
      <div className="v2-rep-head">
        <div>
          <h2>{t.kinds.executive.title}</h2>
          {report && <SourceLine env={report} />}
        </div>
        <WindowSeg value={win} onChange={onWin} />
      </div>
      <ReportStatus state={state} />
      {report && (
        <>
          <ReportActions query={query} onPrint={() => onPrint(true)} />
          <ExecutiveBody report={report} />
        </>
      )}
    </div>
  )
}
