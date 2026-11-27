'use client'

// Triage and assignment of the open alert. Both write to the engine
// through the same calls as the classic queue (lib/lifecycle) and patch
// the live ring with the engine's own answer, so the row and this panel
// change together; only the in-flight and error states live here. The
// engine checks the role again on every write; the panel only spares a
// read-only account buttons it could not use.
import { useState } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import { useEngine } from '@/components/console/engine-provider'
import { useConsoleUser } from '@/components/console/user-session'
import { postAlertAssign, postAlertStatus } from '@/lib/lifecycle'
import { formatDateTime, type SfAlert, type SfAlertLifecycle, type SfAlertStatus } from '@/lib/console-types'
import { statusOf } from '@/lib/v2/alerts-model'

function useWrite() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  type Ack = { ok: true; entry: SfAlertLifecycle | null } | { ok: false; error: string }
  async function run(write: () => Promise<Ack>, apply: (entry: SfAlertLifecycle) => void) {
    if (busy) return false
    setBusy(true)
    setError(null)
    const ack = await write()
    setBusy(false)
    if (!ack.ok) {
      setError(ack.error)
      return false
    }
    if (ack.entry) apply(ack.entry)
    return true
  }
  return { busy, error, run }
}

export function TriageBox({ alert }: { alert: SfAlert }) {
  const { dict, lang } = useI18n()
  const d = dict.alerts
  const me = useConsoleUser()
  const { applyTriage } = useEngine()
  const [note, setNote] = useState('')
  const { busy, error, run } = useWrite()
  const status = statusOf(alert)

  async function apply(next: SfAlertStatus) {
    if (!alert.id) return
    const ok = await run(() => postAlertStatus({ alert_id: alert.id!, status: next, note: note.trim(), by: 'consola' }), applyTriage)
    if (ok) setNote('')
  }

  return (
    <section className="v2-box">
      <div className="v2-box-head">
        <h3>{d.lifecycleHeading}</h3>
        <span className="v2-mono v2-dim">
          {alert.status_by ? alert.status_by : ''}
          {alert.status_at ? ` · ${formatDateTime(alert.status_at, lang)}` : ''}
        </span>
      </div>
      {alert.status_note && status !== 'new' && <p className="v2-quote v2-quote-small">{alert.status_note}</p>}
      {me.pending ? null : !alert.id ? (
        <p className="v2-dim v2-small">{d.noIdProse}</p>
      ) : !me.can_triage ? (
        <p className="v2-dim v2-small">{dict.v2.alertsView.readOnly}</p>
      ) : (
        <>
          <input
            className="v2-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            placeholder={d.notePlaceholder}
            aria-label={d.noteAria}
          />
          <div className="v2-actions">
            {status === 'new' && (
              <button type="button" className="v2-btn v2-btn-primary" disabled={busy} onClick={() => void apply('acknowledged')}>
                {d.acknowledge}
              </button>
            )}
            {status !== 'closed' && (
              <button type="button" className="v2-btn" disabled={busy} onClick={() => void apply('closed')}>
                {d.close}
              </button>
            )}
            {status === 'closed' && (
              <button type="button" className="v2-btn" disabled={busy} onClick={() => void apply('new')}>
                {d.reopen}
              </button>
            )}
          </div>
        </>
      )}
      {error && (
        <p className="v2-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

export function AssignBox({ alert }: { alert: SfAlert }) {
  const { dict, lang } = useI18n()
  const d = dict.alerts
  const t = dict.v2.alertsView
  const me = useConsoleUser()
  const { applyTriage } = useEngine()
  const { busy, error, run } = useWrite()
  const [asking, setAsking] = useState(false)
  const [name, setName] = useState('')
  // In accounts mode the write is signed with the session account; the
  // token and open modes keep the shared 'consola' signer (as the classic queue).
  const by = me.mode === 'users' ? me.name : 'consola'

  async function assign(assignee: string) {
    if (!alert.id) return
    const ok = await run(() => postAlertAssign({ alert_id: alert.id!, assignee, by }), applyTriage)
    if (ok) {
      setAsking(false)
      setName('')
    }
  }

  return (
    <section className="v2-box">
      <div className="v2-box-head">
        <h3>{d.assignHeading}</h3>
      </div>
      <p className={alert.assignee ? 'v2-small' : 'v2-dim v2-small'}>
        {alert.assignee
          ? d.assigneeLine(alert.assignee, alert.assigned_by ?? d.nd, alert.assigned_at ? formatDateTime(alert.assigned_at, lang) : d.nd)
          : d.unassignedProse}
      </p>
      {me.pending || !alert.id || !me.can_triage ? null : asking ? (
        <form
          className="v2-actions"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) void assign(name.trim())
          }}
        >
          <input
            className="v2-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            placeholder={d.namePlaceholder}
            aria-label={t.assignName}
            autoFocus
          />
          <button type="submit" className="v2-btn v2-btn-primary" disabled={busy || !name.trim()}>
            {t.assignConfirm}
          </button>
          <button type="button" className="v2-btn" onClick={() => setAsking(false)}>
            {t.cancel}
          </button>
        </form>
      ) : (
        <div className="v2-actions">
          {!alert.assignee && me.name && (
            <button type="button" className="v2-btn" disabled={busy} onClick={() => void assign(me.name)}>
              {d.assignMine}
            </button>
          )}
          <button type="button" className="v2-btn" disabled={busy} onClick={() => setAsking(true)}>
            {alert.assignee ? d.reassign : d.assignOther}
          </button>
          {alert.assignee && (
            <button type="button" className="v2-btn" disabled={busy} onClick={() => void assign('')}>
              {d.unassign}
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="v2-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
