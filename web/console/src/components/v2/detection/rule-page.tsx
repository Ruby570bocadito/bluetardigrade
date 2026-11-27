'use client'

// Detección · one rule in full: what it looks for, where it has fired
// this week (alerts in memory), the chains it feeds and the suppressions
// that silence it. From here the rule is tested with an event, its alerts
// are opened in the queue, or a suppression is started.
import { ArrowLeft, Flask, Siren, SpeakerSlash } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import type { SfAlert } from '@/lib/console-types'
import { formatDuration } from '@/lib/fleet'
import { ruleTopHosts, type RuleRow } from '@/lib/v2/detection-model'
import { v2HostLink } from '@/lib/v2/hosts-model'
import { Empty } from '../home/parts'
import { Conditions, SevPill, WeekBars } from './parts'

export function RulePage({
  id,
  row,
  alerts,
  now,
  canWrite,
  onBack,
  onTest,
  onSuppress,
  onChain,
}: {
  id: string
  row: RuleRow | undefined
  alerts: SfAlert[]
  now: number | null
  canWrite: boolean
  onBack: () => void
  onTest: (row: RuleRow) => void
  onSuppress: (ruleId: string) => void
  onChain: () => void
}) {
  const { dict } = useI18n()
  const t = dict.v2.detectionView
  const back = (
    <button type="button" className="v2-link v2-back" onClick={onBack}>
      <ArrowLeft aria-hidden="true" />
      {t.back}
    </button>
  )
  if (!row)
    return (
      <div className="v2-rulepage">
        {back}
        <Empty title={t.ruleUnknown}>
          <code>{id}</code>
        </Empty>
      </div>
    )

  const { rule } = row
  const hosts = ruleTopHosts(alerts, rule.id)
  const maxHost = Math.max(1, ...hosts.map((h) => h.count))
  const tactic = row.tactic ? dict.rules.tactics[row.tactic] : null

  return (
    <article className="v2-rulepage" aria-labelledby="v2-rule-title">
      {back}
      <header className="v2-rulepage-head">
        <div className="v2-detail-tags">
          <SevPill sev={rule.severity} />
          {rule.mitre && <span className="v2-tag v2-mono">{rule.mitre}</span>}
          {tactic && <span className="v2-tag">{tactic}</span>}
        </div>
        <h2 id="v2-rule-title">{rule.name}</h2>
        <p className="v2-mono v2-dim">{rule.id}</p>
        {rule.description && <p className="v2-rulepage-desc">{rule.description}</p>}
        <div className="v2-rulepage-actions">
          <button type="button" className="v2-btn v2-btn-primary" onClick={() => onTest(row)}>
            <Flask aria-hidden="true" />
            {t.testWith}
          </button>
          <a className="v2-btn" href={`/v2/alertas?q=${encodeURIComponent(rule.id)}`}>
            <Siren aria-hidden="true" />
            {t.seeAlerts}
          </a>
          {canWrite && (
            <button type="button" className="v2-btn" onClick={() => onSuppress(rule.id)}>
              <SpeakerSlash aria-hidden="true" />
              {t.noiseSuppress}
            </button>
          )}
        </div>
      </header>

      <div className="v2-rulepage-grid">
        <section className="v2-rulepage-block" aria-labelledby="v2-rule-conds">
          <h3 id="v2-rule-conds" className="v2-eyebrow">
            {t.conditions}
          </h3>
          <Conditions rule={rule} />
          <dl className="v2-facts">
            <div>
              <dt>{t.ruleFacts.type}</dt>
              <dd className="v2-mono">{rule.event_type}</dd>
            </div>
            {rule.tags.length > 0 && (
              <div>
                <dt>{t.ruleFacts.tags}</dt>
                <dd className="v2-rulepage-tags">
                  {rule.tags.map((tag) => (
                    <span key={tag} className="v2-tag v2-mono">
                      {tag}
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        </section>

        <section className="v2-rulepage-block" aria-labelledby="v2-rule-week">
          <h3 id="v2-rule-week" className="v2-eyebrow">
            {t.weekTitle}
          </h3>
          <WeekBars values={row.week} now={now} label={t.weekAria(rule.name)} />
          {row.lastFired && now !== null && (
            <p className="v2-small v2-dim">{t.lastFired(dict.v2.hostsView.ago(formatDuration(Math.max(0, (now - Date.parse(row.lastFired)) / 1000))))}</p>
          )}
          <h3 className="v2-eyebrow">{t.topHosts}</h3>
          {hosts.length === 0 ? (
            <p className="v2-small v2-dim">{t.noHosts}</p>
          ) : (
            <ul className="v2-bars">
              {hosts.map((h) => (
                <li key={h.host}>
                  <a className="v2-link" href={v2HostLink(h.host)}>
                    {h.host}
                  </a>
                  <i aria-hidden="true">
                    <b style={{ ['--w' as string]: `${(h.count / maxHost) * 100}%` }} />
                  </i>
                  <span className="v2-mono">{h.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="v2-rulepage-block" aria-labelledby="v2-rule-chains">
          <h3 id="v2-rule-chains" className="v2-eyebrow">
            {t.inChains}
          </h3>
          {row.chains.length === 0 ? (
            <p className="v2-small v2-dim">{t.noChains}</p>
          ) : (
            <ul className="v2-plainlist">
              {row.chains.map((c) => (
                <li key={c}>
                  <button type="button" className="v2-link" onClick={onChain}>
                    {c}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <h3 className="v2-eyebrow">{t.affecting}</h3>
          {row.suppressions.length === 0 ? (
            <p className="v2-small v2-dim">{t.noSuppressions}</p>
          ) : (
            <ul className="v2-plainlist">
              {row.suppressions.map((s) => (
                <li key={`${s.host ?? ''}`}>
                  <strong>{s.host || t.supAllHosts}</strong>
                  {s.reason && <span className="v2-dim"> · {s.reason}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </article>
  )
}
