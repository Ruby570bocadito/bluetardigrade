'use client'

// Respuesta · Registro: every attempt the engine logged, executed and
// denied, newest first — who asked, on which host and process, from which
// rule and alert, and the engine's answer in plain words. The log line is
// written before the signal: what is not here did not happen.
import { useMemo } from 'react'
import { DownloadSimple, MagnifyingGlass } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import type { RuleMeta, SfAlert, SfRespondAudit } from '@/lib/console-types'
import { alertKey } from '@/lib/engine-client'
import { v2RuleLink } from '@/lib/v2/detection-model'
import { AUDIT_FILTERS, auditCounts, filterAudit, type AuditFilter } from '@/lib/v2/respond-model'
import { Empty } from '../home/parts'
import { DecisionPill, download, useDenial, When } from './parts'

export function ActionLog({
  audit,
  auditLimit,
  onMore,
  rules,
  alerts,
  filter,
  onFilter,
  q,
  onQ,
  now,
  onOpenAlert,
}: {
  audit: SfRespondAudit
  auditLimit: number
  onMore: () => void
  rules: RuleMeta[]
  alerts: SfAlert[]
  filter: AuditFilter
  onFilter: (f: AuditFilter) => void
  q: string
  onQ: (q: string) => void
  now: number | null
  onOpenAlert: (key: string) => void
}) {
  const { dict } = useI18n()
  const t = dict.v2.respondView
  const denial = useDenial()
  const records = audit.records
  const counts = auditCounts(records)
  const shown = useMemo(() => filterAudit(records, filter, q), [records, filter, q])
  const ruleName = useMemo(() => new Map(rules.map((r) => [r.id, r.name])), [rules])
  const alertById = useMemo(() => new Map(alerts.map((a) => [a.id, a])), [alerts])

  return (
    <div className="v2-alog">
      <div className="v2-alog-head">
        <div>
          <h2>{t.logTitle}</h2>
          <p className="v2-small v2-dim">{t.logHint}</p>
        </div>
        <button
          type="button"
          className="v2-btn"
          disabled={shown.length === 0}
          onClick={() => download('respond-audit.jsonl', 'application/x-ndjson;charset=utf-8', shown.map((r) => JSON.stringify(r)).join('\n') + '\n')}
        >
          <DownloadSimple aria-hidden="true" />
          {t.exportJsonl}
        </button>
      </div>
      <div className="v2-det-filters">
        <div className="v2-seg" role="group" aria-label={t.logTitle}>
          {AUDIT_FILTERS.map((f) => (
            <button key={f} type="button" aria-pressed={f === filter} onClick={() => onFilter(f)}>
              {t.logFilters[f]} <span className="v2-mono v2-dim">{counts[f]}</span>
            </button>
          ))}
        </div>
        <label className="v2-search">
          <MagnifyingGlass aria-hidden="true" />
          <input value={q} onChange={(e) => onQ(e.target.value)} placeholder={t.logSearch} aria-label={t.logSearch} />
        </label>
      </div>

      {records.length === 0 ? (
        <Empty title={t.logEmpty} />
      ) : shown.length === 0 ? (
        <Empty title={t.logNone} />
      ) : (
        <ul className="v2-alog-list">
          {shown.map((r) => {
            const a = r.alert_id ? alertById.get(r.alert_id) : undefined
            const d = r.decision === 'denied' ? denial(r.code) : null
            return (
              <li key={r.action_id} className="v2-alog-row" data-decision={r.decision}>
                <span className="v2-alog-when v2-small">
                  <When iso={r.ts} now={now} />
                </span>
                <span className="v2-alog-target">
                  <span className="v2-mono">{r.process_name}</span>
                  <span className="v2-small v2-dim">
                    PID {r.pid} · {r.host}
                  </span>
                </span>
                <span className="v2-alog-who v2-small">{r.operator || '—'}</span>
                <span className="v2-alog-origin v2-small">
                  {r.rule_id && (
                    <a className="v2-link" href={v2RuleLink(r.rule_id)}>
                      {ruleName.get(r.rule_id) ?? r.rule_id}
                    </a>
                  )}
                  {a ? (
                    <button type="button" className="v2-link" onClick={() => onOpenAlert(alertKey(a))}>
                      {t.fromAlert}
                    </button>
                  ) : r.alert_id ? (
                    <span className="v2-mono v2-dim">{r.alert_id}</span>
                  ) : null}
                </span>
                <span className="v2-alog-decision">
                  <DecisionPill decision={r.decision} />
                  {r.followup && <span className="v2-tag">{t.followup}</span>}
                </span>
                <span className="v2-alog-reason v2-small">
                  {d ? d.title : `${r.signal ?? 'SIGKILL'}${r.mechanism ? ` · ${t.mechanism(r.mechanism)}` : ''}`}
                  {r.reason && <span className="v2-dim"> · {r.reason}</span>}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {audit.truncated && auditLimit < 500 ? (
        <button type="button" className="v2-link v2-small" onClick={onMore}>
          {t.logMore(500)}
        </button>
      ) : audit.truncated ? (
        <p className="v2-small v2-dim">{t.logTruncated}</p>
      ) : null}
      {audit.skipped > 0 && <p className="v2-small v2-dim">{t.logSkipped(audit.skipped)}</p>}
    </div>
  )
}
