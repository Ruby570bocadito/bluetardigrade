'use client'

// Ajustes · Auditoría: what the accounts did in the console, newest first
// — who, with which role, the action in plain words, the account acted on
// and the outcome — read from the console's own audit file (an
// administrator's read), filtered by account and outcome, exportable.
import { useEffect, useState } from 'react'
import { DownloadSimple } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { useConsoleUser } from '@/components/console/user-session'
import { formatDateTime } from '@/lib/console-types'
import { describeAction, fetchAudit, roleText, type ConsoleAuditEntry } from '@/lib/console-user'
import { auditCounts, auditUsers, filterConsoleAudit, type AuditOutcome } from '@/lib/v2/settings-model'
import { Empty } from '../home/parts'
import { download } from '../respond/parts'
import { Notice } from './parts'

export function ConsoleAudit() {
  const { dict, lang } = useI18n()
  const t = dict.v2.settingsView
  const me = useConsoleUser()
  const [state, setState] = useState<{ enabled: boolean; entries: ConsoleAuditEntry[] } | { error: string } | null>(null)
  const [user, setUser] = useState('')
  const [outcome, setOutcome] = useState<AuditOutcome>('all')

  useEffect(() => {
    let alive = true
    void fetchAudit(500, lang).then((r) => alive && setState(r.ok ? { enabled: r.enabled, entries: r.entries } : { error: r.error }))
    return () => {
      alive = false
    }
  }, [lang])

  if (!me.pending && me.role !== 'admin') return <Empty title={t.auNotAdmin} />
  if (!state) return <p className="v2-small v2-dim">{t.states.loading}</p>
  if ('error' in state) return <Notice tone="error">{t.auError(state.error)}</Notice>
  if (!state.enabled) return <Empty title={t.auOff}>{t.auOffHint}</Empty>

  const counts = auditCounts(state.entries)
  const shown = filterConsoleAudit(state.entries, user, outcome)
  return (
    <div className="v2-set-stack">
      <div className="v2-rep-head">
        <div>
          <h2>{t.auTitle}</h2>
          <p className="v2-small v2-dim">{t.auHint}</p>
        </div>
        <button
          type="button"
          className="v2-btn"
          disabled={shown.length === 0}
          onClick={() => download('console-audit.jsonl', 'application/x-ndjson;charset=utf-8', shown.map((e) => JSON.stringify(e)).join('\n') + '\n')}
        >
          <DownloadSimple aria-hidden="true" />
          {t.auExport}
        </button>
      </div>
      <div className="v2-det-filters">
        <label className="v2-select">
          <span className="v2-sr-only">{t.auAllUsers}</span>
          <select value={user} onChange={(e) => setUser(e.target.value)}>
            <option value="">{t.auAllUsers}</option>
            {auditUsers(state.entries).map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <div className="v2-seg" role="group" aria-label={t.auTitle}>
          {(['all', 'ok', 'error', 'denied'] as AuditOutcome[]).map((o) => (
            <button key={o} type="button" aria-pressed={outcome === o} onClick={() => setOutcome(o)}>
              {t.auOutcomes[o]} <span className="v2-mono v2-dim">{counts[o]}</span>
            </button>
          ))}
        </div>
      </div>
      {state.entries.length === 0 ? (
        <Empty title={t.auEmpty} />
      ) : shown.length === 0 ? (
        <Empty title={t.auNone} />
      ) : (
        <ul className="v2-au-list">
          {shown.map((e, i) => (
            <li key={`${e.at}|${i}`} className="v2-au-row" data-outcome={e.outcome}>
              <time className="v2-small v2-dim" dateTime={e.at}>
                {formatDateTime(e.at, lang)}
              </time>
              <span className="v2-au-who">
                <strong className="v2-mono">{e.user || t.auAnonymous}</strong>
                {e.role && <span className="v2-small v2-dim">{roleText(e.role, lang)}</span>}
              </span>
              <span className="v2-au-what">
                {describeAction(e, lang)}
                {e.target && <span className="v2-dim"> · {t.auOn(e.target)}</span>}
              </span>
              <span className="v2-au-outcome" data-outcome={e.outcome}>
                {t.auOutcomes[e.outcome]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
