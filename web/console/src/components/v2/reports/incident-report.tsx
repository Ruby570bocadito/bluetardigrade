'use client'

// Informes · Informe de incidente: one case as a document. The engine's
// incident report lists every alert the case groups — also the ones that
// already left memory — with its triage state; the document itself (the
// summary, the chronology, the techniques, the hosts and the plan) is the
// case report of Incidentes, exported as Markdown or HTML.
import { useMemo } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import { formatDateTime, severityOf } from '@/lib/console-types'
import type { Incident } from '@/lib/engine-writes'
import type { IncidentReport as EngineIncidentReport } from '@/lib/reports'
import { Empty, SEV_COLOR } from '../home/parts'
import { CaseReport } from '../incidents/case-report'
import { ReportActions, ReportStatus, useReport } from './parts'

export function IncidentReport({ incidents, available, caseId, onCase }: { incidents: Incident[]; available: boolean; caseId: string | null; onCase: (id: string) => void }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.reportsView
  const sorted = useMemo(
    () => [...incidents].sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || b.updated_at.localeCompare(a.updated_at)),
    [incidents],
  )
  const incident = incidents.find((i) => i.id === caseId) ?? sorted[0]
  const query = incident ? { kind: 'incident', id: incident.id } : null
  const state = useReport<EngineIncidentReport>(query)
  const report = state?.status === 'ok' ? state.data : null

  if (!available) return <Empty title={dict.v2.respondView.incidentsOff} />
  if (!incident) return <Empty title={t.incNone} />
  const alerts = report ? [...report.alerts].sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? '')) : []

  return (
    <div className="v2-rep">
      <div className="v2-rep-head">
        <label className="v2-select">
          <span className="v2-sr-only">{t.incPick}</span>
          <select value={incident.id} onChange={(e) => onCase(e.target.value)}>
            {sorted.map((i) => (
              <option key={i.id} value={i.id}>
                {`${dict.incidents.statusLabels[i.status]} · ${i.title}`}
              </option>
            ))}
          </select>
        </label>
        {query && <ReportActions query={query} />}
      </div>

      <CaseReport incident={incident} />

      <section className="v2-rep-block" aria-labelledby="v2-inc-alerts">
        <h3 id="v2-inc-alerts" className="v2-eyebrow">
          {t.incAlerts(report ? report.alerts.length : incident.alert_ids.length)}
        </h3>
        <p className="v2-small v2-dim">{t.incEngineNote}</p>
        <ReportStatus state={state} />
        {report && (
          <ul className="v2-inc-alerts">
            {alerts.map((a) => {
              const sev = severityOf(a.severity ?? 'info')
              return (
                <li key={a.id} data-found={a.found}>
                  {/* an alert out of retention has no known severity: none is shown */}
                  {a.found ? (
                    <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[sev] }}>
                      {dict.v2.sev[sev]}
                    </span>
                  ) : (
                    <span className="v2-dim" aria-hidden="true">
                      —
                    </span>
                  )}
                  <span className="v2-inc-alert-main">
                    <strong className={a.found ? undefined : 'v2-mono'}>{a.rule_name || a.rule_id || a.id}</strong>
                    {a.found && (
                      <span className="v2-small v2-dim">
                        {a.host ?? '—'} · {a.timestamp ? formatDateTime(a.timestamp, lang) : '—'}
                      </span>
                    )}
                  </span>
                  <span className="v2-small">
                    {a.found ? (t.alertStatus[a.status ?? 'new'] ?? a.status) : <span className="v2-tag">{t.incGone}</span>}
                    {a.found && a.status_by ? <span className="v2-dim"> · {a.status_by}</span> : null}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
