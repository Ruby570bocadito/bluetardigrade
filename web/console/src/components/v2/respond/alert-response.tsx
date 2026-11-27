'use client'

// Respuesta · one alert, answered: its process (from the event in memory
// or, failing that, from the forensic snapshot), the terminate request,
// the attempts already made from it, the reputation of what it touched
// and what the engine froze on that host when it fired.
import { useState } from 'react'
import { ArrowLeft } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import type { SfAlert, SfEvent, SfRespondRecord } from '@/lib/console-types'
import { readForensicBundle } from '@/lib/forensic'
import { v2AlertLink } from '@/lib/v2/alerts-model'
import { actionsFor } from '@/lib/v2/respond-model'
import { alertKey } from '@/lib/engine-client'
import { Empty, SEV_COLOR } from '../home/parts'
import { ForensicPanel, type ForensicSlot } from './forensic'
import { KillPanel } from './kill-panel'
import { AttemptLine, When } from './parts'
import { ReputationPanel } from './reputation'

export function AlertResponse({
  alert,
  event,
  records,
  armed,
  now,
  onBack,
  onActed,
}: {
  alert: SfAlert | undefined
  event?: SfEvent
  records: SfRespondRecord[]
  armed: boolean
  now: number | null
  onBack: () => void
  onActed: () => void
}) {
  const { dict } = useI18n()
  const t = dict.v2.respondView
  const [forensic, setForensic] = useState<ForensicSlot>('idle')

  const back = (
    <button type="button" className="v2-link v2-back" onClick={onBack}>
      <ArrowLeft aria-hidden="true" />
      {t.back}
    </button>
  )
  if (!alert)
    return (
      <div className="v2-answer">
        {back}
        <Empty title={t.alertGone} />
      </div>
    )

  const loadForensic = () => {
    setForensic('loading')
    void readForensicBundle(alert.id ?? '').then(setForensic)
  }
  // without the event in memory the snapshot may still name the process
  const frozen = typeof forensic === 'object' && forensic.kind === 'bundle' ? forensic.bundle.timeline.find((e) => e.id === alert.event_id) : undefined
  const proc = event?.process ?? frozen?.process
  const pid = typeof proc?.pid === 'number' && proc.pid > 0 ? proc.pid : null
  const attempts = actionsFor(records, alert.id)

  return (
    <article className="v2-answer" aria-labelledby="v2-answer-title">
      {back}
      <header className="v2-answer-head">
        <div className="v2-detail-tags">
          <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[alert.severity] }}>
            {dict.v2.sev[alert.severity]}
          </span>
          <a className="v2-link v2-small" href={v2AlertLink(alertKey(alert))}>
            {t.fromAlert}
          </a>
        </div>
        <h2 id="v2-answer-title">{alert.rule_name}</h2>
        <p className="v2-small v2-dim">
          <span className="v2-mono">{alert.host}</span> · <When iso={alert.timestamp} now={now} />
          {alert.user ? ` · ${alert.user}` : ''}
        </p>
        {alert.summary && <p className="v2-answer-summary">{alert.summary}</p>}
      </header>

      <div className="v2-answer-grid">
        <section className="v2-answer-block" aria-labelledby="v2-proc-title">
          <h3 id="v2-proc-title">{t.processTitle}</h3>
          {proc ? (
            <dl className="v2-fields">
              <div>
                <dt>{t.fields.process}</dt>
                <dd className="v2-mono">{proc.name ?? '—'}</dd>
              </div>
              <div>
                <dt>{t.fields.pid}</dt>
                <dd className="v2-mono">{pid ?? '—'}</dd>
              </div>
              {proc.command_line && (
                <div>
                  <dt>{t.fields.commandLine}</dt>
                  <dd className="v2-mono">{proc.command_line}</dd>
                </div>
              )}
              <div>
                <dt>{t.fields.host}</dt>
                <dd className="v2-mono">{alert.host}</dd>
              </div>
            </dl>
          ) : null}
          {!event && <p className="v2-small v2-warn">{frozen ? t.processFromForensic : t.processUnknown}</p>}
          <KillPanel key={alert.id} alert={alert} pid0={pid} name0={proc?.name ?? ''} armed={armed} onDone={onActed} />
          <h3 className="v2-eyebrow">{t.attemptsTitle}</h3>
          {attempts.length === 0 ? (
            <p className="v2-small v2-dim">{t.attemptsNone}</p>
          ) : (
            <ul className="v2-attempts">
              {attempts.map((r) => (
                <li key={r.action_id}>
                  <AttemptLine r={r} now={now} />
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="v2-answer-block">
          <ReputationPanel alert={alert} event={event} now={now} />
        </div>
      </div>
      <div className="v2-answer-block">
        <ForensicPanel alert={alert} slot={forensic} onLoad={loadForensic} />
      </div>
    </article>
  )
}
