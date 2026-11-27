'use client'

// One case in focus, the war room: its severity and state, how long it
// has been open (a live timer; the total once closed), who owns it and the
// one-tap "take the case", the state as steps, and its sections: the
// activity, the entity graph, the response plan, its alerts and the report.
import { useEffect, useRef } from 'react'
import { ArrowLeft, X } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { updateIncident, type Incident, type IncidentStatus } from '@/lib/engine-writes'
import { elapsed, initials } from '@/lib/v2/incidents-model'
import { SEV_COLOR } from '../home/parts'
import { useNow } from '../use-now'
import { StateChip, Stepper, useCaseWrite } from './parts'
import { CaseActivity } from './case-activity'
import { CaseGraph } from './case-graph'
import { CasePlan } from './case-plan'
import { CaseAlerts } from './case-alerts'
import { CaseReport } from './case-report'

export type CaseTab = 'actividad' | 'grafo' | 'plan' | 'alertas' | 'informe'
export const CASE_TABS: readonly CaseTab[] = ['actividad', 'grafo', 'plan', 'alertas', 'informe']

export function caseTabFromParam(raw: string | null): CaseTab {
  return (CASE_TABS as readonly string[]).includes(raw ?? '') ? (raw as CaseTab) : 'actividad'
}

export function CaseDetail({
  incident,
  tab,
  onTab,
  onClose,
  autoFocus,
}: {
  incident: Incident
  tab: CaseTab
  onTab: (tab: CaseTab) => void
  onClose: () => void
  autoFocus: boolean
}) {
  const { dict } = useI18n()
  const t = dict.v2.incidentsView
  const now = useNow(1000)
  const { busy, error, run, can, me } = useCaseWrite()
  const closed = incident.status === 'closed'
  const timer = now === null ? '—' : elapsed(incident.created_at, closed && incident.closed_at ? Date.parse(incident.closed_at) : now)
  const mine = !!incident.owner && !!me.name && incident.owner.toLowerCase() === me.name.toLowerCase()
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (autoFocus) title.current?.focus()
  }, [autoFocus])

  const setStatus = (status: IncidentStatus) => void run((by) => updateIncident(incident.id, { status }, by))
  const take = () => void run((by) => updateIncident(incident.id, { owner: me.name }, by))

  return (
    <div className="v2-detail-body v2-case-detail">
      <button type="button" className="v2-btn v2-detail-back" onClick={onClose}>
        <ArrowLeft aria-hidden="true" />
        {t.back}
      </button>
      <header className="v2-detail-head">
        <div className="v2-detail-tags">
          <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[incident.severity] }}>
            {dict.v2.sev[incident.severity]}
          </span>
          <StateChip status={incident.status} />
          <span className="v2-mono v2-dim v2-small">{incident.id}</span>
        </div>
        <h2 ref={title} tabIndex={-1} className="v2-detail-title">
          {incident.title}
        </h2>
        <button type="button" className="v2-icon-btn v2-detail-close" aria-label={t.back} onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>

      <div className="v2-room">
        <div className="v2-room-cell">
          <span>{closed ? t.timerClosed : t.timer}</span>
          <b className="v2-mono v2-timer" data-live={!closed}>
            {timer}
          </b>
        </div>
        <div className="v2-room-cell">
          <span>{t.owner}</span>
          <b className="v2-room-owner">
            {incident.owner ? (
              <>
                <i className="v2-avatar v2-avatar-inline" aria-hidden="true">
                  {initials(incident.owner)}
                </i>
                {incident.owner}
              </>
            ) : (
              <span className="v2-dim">{t.noOwner}</span>
            )}
          </b>
        </div>
        <div className="v2-room-cell v2-room-take">
          {mine ? (
            <span className="v2-istate" data-state="contained">
              {t.yours}
            </span>
          ) : (
            can &&
            me.name && (
              <button type="button" className="v2-btn v2-btn-primary v2-take" disabled={busy} onClick={take}>
                {t.take}
              </button>
            )
          )}
        </div>
      </div>

      <Stepper status={incident.status} disabled={!can || busy} onPick={setStatus} />
      {!can && !me.pending && <p className="v2-dim v2-small">{t.readOnly}</p>}
      {error && (
        <p className="v2-error" role="alert">
          {error}
        </p>
      )}

      <div className="v2-tabs" role="tablist" aria-label={t.tabsAria}>
        {(['actividad', 'grafo', 'plan', 'alertas', 'informe'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`v2-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="v2-case-panel"
            onClick={() => onTab(id)}
          >
            {t.tabs[id]}
          </button>
        ))}
      </div>
      <div id="v2-case-panel" role="tabpanel" aria-labelledby={`v2-tab-${tab}`} className="v2-case-panel" key={`${incident.id}-${tab}`}>
        {tab === 'actividad' && <CaseActivity incident={incident} />}
        {tab === 'grafo' && <CaseGraph incident={incident} />}
        {tab === 'plan' && <CasePlan incident={incident} />}
        {tab === 'alertas' && <CaseAlerts incident={incident} />}
        {tab === 'informe' && <CaseReport incident={incident} />}
      </div>
    </div>
  )
}
