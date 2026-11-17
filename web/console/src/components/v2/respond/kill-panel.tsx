'use client'

// Respuesta · terminate a process, in two steps: write the request (host
// from the alert; PID and name from its event; who and why), then confirm
// what exactly is about to receive SIGKILL. The engine answers executed or
// denied with a named reason, and either way the attempt is in its log.
import { useEffect, useState } from 'react'
import { Lightning } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { useConsoleUser } from '@/components/console/user-session'
import type { SfAlert } from '@/lib/console-types'
import { killProcess } from '@/lib/engine-writes'
import { useDenial } from './parts'

type Outcome = { ok: true; text: string } | { ok: false; title: string; fix: string } | null

export function KillPanel({
  alert,
  pid0,
  name0,
  armed,
  onDone,
}: {
  alert: SfAlert
  pid0: number | null
  name0: string
  armed: boolean
  onDone: () => void
}) {
  const { dict } = useI18n()
  const t = dict.v2.respondView
  const me = useConsoleUser()
  const denial = useDenial()
  const isAdmin = !me.pending && me.role === 'admin'
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'form' | 'confirm'>('form')
  const [pid, setPid] = useState(pid0 ? String(pid0) : '')
  const [name, setName] = useState(name0)
  const [operator, setOperator] = useState(me.mode === 'users' ? me.name : '')
  const [token, setToken] = useState('')
  const [reason, setReason] = useState(t.reasonDefault(alert.rule_name))
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>(null)

  // the forensic snapshot may bring the PID after the panel was drawn
  useEffect(() => {
    if (pid0 && !pid) setPid(String(pid0))
    if (name0 && !name) setName(name0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid0, name0])

  const valid = Number(pid) > 0 && name.trim() !== '' && operator.trim() !== '' && reason.trim() !== ''

  async function submit() {
    setBusy(true)
    const res = await killProcess(
      { host: alert.host, pid: Number(pid), process_name: name.trim(), operator: operator.trim(), reason: reason.trim(), rule_id: alert.rule_id, alert_id: alert.id },
      token,
    )
    setBusy(false)
    setToken('')
    setStep('form')
    if (res.ok) setOutcome({ ok: true, text: t.executed(res.data.signal ?? 'SIGKILL', res.data.action_id) })
    else if (res.status === 403 || res.status === 409 || res.status === 429) {
      const d = denial(res.error)
      setOutcome({ ok: false, title: t.deniedTitle(d.title), fix: d.fix })
    } else setOutcome({ ok: false, title: t.killError(res.error), fix: res.status === 404 ? t.needArmed : '' })
    onDone()
  }

  return (
    <div className="v2-kill">
      {!open ? (
        <div className="v2-kill-start">
          <button type="button" className="v2-btn v2-btn-primary" disabled={!isAdmin || !armed} onClick={() => setOpen(true)}>
            <Lightning aria-hidden="true" />
            {t.kill}
          </button>
          {!isAdmin ? <p className="v2-small v2-dim">{t.needAdmin}</p> : !armed ? <p className="v2-small v2-dim">{t.needArmed}</p> : null}
        </div>
      ) : (
        <section className="v2-kill-sheet" aria-labelledby="v2-kill-title">
          <h3 id="v2-kill-title">{t.killTitle}</h3>
          <p className="v2-small v2-dim">{t.killIntro}</p>
          <p className="v2-small v2-warn">{t.killHostNote}</p>
          {outcome?.ok ? null : step === 'form' ? (
            <form
              className="v2-kill-form"
              onSubmit={(e) => {
                e.preventDefault()
                if (valid) {
                  setOutcome(null)
                  setStep('confirm')
                }
              }}
            >
              <label className="v2-field">
                <span>{t.fields.host}</span>
                <input className="v2-input v2-mono" value={alert.host} readOnly />
              </label>
              <label className="v2-field">
                <span>{t.fields.pid}</span>
                <input className="v2-input v2-mono" value={pid} onChange={(e) => setPid(e.target.value.replace(/\D/g, ''))} inputMode="numeric" required />
              </label>
              <label className="v2-field v2-kill-wide">
                <span>{t.fields.process}</span>
                <input className="v2-input v2-mono" value={name} onChange={(e) => setName(e.target.value)} required maxLength={260} />
              </label>
              <label className="v2-field">
                <span>{t.operator}</span>
                <input className="v2-input" value={operator} onChange={(e) => setOperator(e.target.value)} autoComplete="username" required maxLength={64} />
              </label>
              <label className="v2-field">
                <span>{t.operatorToken}</span>
                <input className="v2-input" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="current-password" />
                <small className="v2-dim">{t.operatorTokenHint}</small>
              </label>
              <label className="v2-field v2-kill-wide">
                <span>{t.reason}</span>
                <textarea className="v2-input v2-textarea" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={512} required />
              </label>
              <div className="v2-kill-actions v2-kill-wide">
                <button type="button" className="v2-btn" onClick={() => setOpen(false)}>
                  {t.cancel}
                </button>
                <button type="submit" className="v2-btn v2-btn-primary" disabled={!valid}>
                  {t.next}
                </button>
              </div>
            </form>
          ) : (
            <div className="v2-kill-confirm" role="alertdialog" aria-labelledby="v2-kill-confirm-text">
              <p id="v2-kill-confirm-text">{t.confirmHint(name.trim(), Number(pid), alert.host)}</p>
              <div className="v2-kill-actions">
                <button type="button" className="v2-btn" onClick={() => setStep('form')} disabled={busy}>
                  {t.cancel}
                </button>
                <button type="button" className="v2-btn v2-btn-primary" onClick={() => void submit()} disabled={busy} autoFocus>
                  {busy ? t.sending : t.confirm}
                </button>
              </div>
            </div>
          )}
          {outcome && (
            <div className="v2-kill-outcome" data-ok={outcome.ok} role={outcome.ok ? 'status' : 'alert'}>
              {outcome.ok ? (
                <>
                  <strong>{outcome.text}</strong>
                  <button type="button" className="v2-link v2-small" onClick={() => setOpen(false)}>
                    {t.close}
                  </button>
                </>
              ) : (
                <>
                  <strong>{outcome.title}</strong>
                  {outcome.fix && <span className="v2-small">{outcome.fix}</span>}
                </>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
