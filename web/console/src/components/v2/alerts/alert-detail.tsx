'use client'

// The open alert: what fired and when, everything the engine attached to
// it (rule message, the fields that matched, ATT&CK, the observed flow,
// the source's own observations, enrichment), its triage and its owner,
// and the way to the classic console for what v2 does not rebuild yet
// (graph, forensics, report, response).
import { useEffect, useRef } from 'react'
import { ArrowLeft, BellRinging, X } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { alertKey } from '@/lib/engine-client'
import { formatAgo } from '@/lib/soc-metrics'
import { formatDateTime, type SfAlert } from '@/lib/console-types'
import { alertTacticOf, otherTags, statusOf, techniqueIds } from '@/lib/v2/alerts-model'
import { v2HostLink } from '@/lib/v2/hosts-model'
import { formatQuery, v2InvestigateLink } from '@/lib/v2/investigate-model'
import { v2WriteUpLink } from '@/lib/v2/reports-model'
import { v2RespondLink } from '@/lib/v2/respond-model'
import { SEV_COLOR } from '../home/parts'
import { useNow } from '../use-now'
import { useGeo } from '../use-geo'
import { StatusChip } from './status-chip'
import { AssignBox, TriageBox } from './triage'

function Fact({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? 'v2-mono' : undefined} title={value}>
        {value}
      </dd>
    </div>
  )
}

export function AlertDetail({ alert, onClose, autoFocus = false }: { alert: SfAlert; onClose: () => void; autoFocus?: boolean }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.alertsView
  const d = dict.alerts
  const now = useNow(15_000)
  const ago = now === null ? '' : formatAgo(Math.max(0, now - Date.parse(alert.timestamp)), lang)
  const tactic = alertTacticOf(alert)
  const techniques = techniqueIds(alert.tags)
  const tags = otherTags(alert.tags)
  const attributes = Object.entries(alert.attributes ?? {})
  const enrichment = Object.entries(alert.enrichment ?? {})
  const message = alert.message || alert.summary
  // the country of a public destination, from the console's own lookup
  const destination = alert.network?.destination_ip?.trim() ?? ''
  const where = useGeo(destination ? [destination] : [])[destination]
  // as a drawer the panel takes the focus, so the keyboard lands where the eye goes
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (autoFocus) title.current?.focus()
  }, [autoFocus])

  const hostQuery = v2InvestigateLink(formatQuery([{ field: 'host', value: alert.host, negate: false }], lang))

  return (
    <div className="v2-detail-body">
      <button type="button" className="v2-btn v2-detail-back" onClick={onClose}>
        <ArrowLeft aria-hidden="true" />
        {t.back}
      </button>
      <header className="v2-detail-head">
        <div className="v2-detail-tags">
          <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[alert.severity] }}>
            {dict.v2.sev[alert.severity]}
          </span>
          <StatusChip status={statusOf(alert)} />
          {alert.notify && (
            <span className="v2-tag" title={d.notifyIconAria}>
              <BellRinging aria-hidden="true" />
              {d.notifyChip}
            </span>
          )}
        </div>
        <h2 ref={title} tabIndex={-1} className="v2-detail-title">
          {alert.rule_name}
        </h2>
        <p className="v2-dim">{t.detected(formatDateTime(alert.timestamp, lang), ago)}</p>
        <button type="button" className="v2-icon-btn v2-detail-close" aria-label={t.closeDetail} onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>

      {message && (
        <blockquote className="v2-quote">
          <span className="v2-eyebrow">{d.ruleMessage}</span>
          {message}
        </blockquote>
      )}

      <dl className="v2-facts">
        <Fact label={d.labels.host} value={alert.host} />
        <Fact label={d.labels.user} value={alert.user ?? d.nd} />
        <Fact label={d.labels.source} value={alert.source ?? d.sourceNotDeclared} />
        <Fact label={d.labels.eventType} value={alert.event_type} />
        <Fact label={d.labels.ruleId} value={alert.rule_id} />
        <Fact label={d.labels.eventId} value={alert.event_id} />
        <Fact label={d.labels.matchedOn} value={alert.matched_on.join(', ') || d.nd} />
      </dl>

      {(tactic || techniques.length > 0) && (
        <section className="v2-detail-section">
          <h3>{t.tactic}</h3>
          <div className="v2-tags">
            {tactic && <span className="v2-tag" data-strong="true">{dict.rules.tactics[tactic]}</span>}
            {techniques.map((id) => (
              <span key={id} className="v2-tag v2-mono">
                {id}
              </span>
            ))}
          </div>
        </section>
      )}

      {tags.length > 0 && (
        <section className="v2-detail-section">
          <h3>{d.tagsHeading}</h3>
          <div className="v2-tags">
            {tags.map((tag) => (
              <span key={tag} className="v2-tag v2-mono">
                {tag}
              </span>
            ))}
          </div>
        </section>
      )}

      {alert.actions && alert.actions.length > 0 && (
        <section className="v2-detail-section">
          <h3>{d.actionsHeading}</h3>
          <div className="v2-tags">
            {alert.actions.map((a) => (
              <span key={a} className="v2-tag v2-mono">
                {a}
              </span>
            ))}
          </div>
        </section>
      )}

      {alert.network && (
        <section className="v2-detail-section">
          <h3>{d.flowHeading}</h3>
          <p className="v2-mono v2-break">
            {alert.network.protocol ?? '?'} · {alert.network.source_ip ?? '?'}:{alert.network.source_port ?? '?'} →{' '}
            {alert.network.destination_ip ?? '?'}:{alert.network.destination_port ?? '?'}
            {where && <span className="v2-dim"> · {dict.v2.map.country(new Intl.DisplayNames([lang], { type: 'region' }).of(where.country) ?? where.country)}</span>}
          </p>
        </section>
      )}

      {attributes.length > 0 && (
        <section className="v2-detail-section">
          <h3>{d.attributesHeading}</h3>
          <p className="v2-dim v2-small">{d.attributesProse}</p>
          <dl className="v2-kv">
            {attributes.map(([k, v]) => (
              <div key={k}>
                <dt className="v2-mono">{k}</dt>
                <dd className="v2-mono">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {enrichment.length > 0 && (
        <section className="v2-detail-section">
          <h3>{d.enrichmentHeading}</h3>
          <dl className="v2-kv">
            {enrichment.map(([k, v]) => (
              <div key={k}>
                <dt className="v2-mono">{k}</dt>
                <dd className="v2-mono">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <TriageBox alert={alert} />
      <AssignBox alert={alert} />

      <nav className="v2-detail-links" aria-label={t.closeDetail}>
        <a className="v2-btn" href={v2RespondLink(alertKey(alert))}>
          {dict.v2.respondView.actOpen}
        </a>
        {alert.id && (
          <a className="v2-btn" href={v2WriteUpLink(alert.id)}>
            {dict.v2.reportsView.tabs.analista}
          </a>
        )}
        <a className="v2-btn" href={v2HostLink(alert.host)}>
          {t.links.host}
        </a>
        <a className="v2-btn" href={`${hostQuery}${alert.event_id ? `&evento=${encodeURIComponent(alert.event_id)}` : ''}`}>
          {t.links.flow}
        </a>
        <a className="v2-btn" href={v2InvestigateLink(formatQuery([{ field: 'host', value: alert.host, negate: false }], lang), 'arbol')}>
          {t.links.tree}
        </a>
      </nav>
    </div>
  )
}
