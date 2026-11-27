'use client'

// Enrollment (boceto 5): a code for new machines (what it is for, uses,
// lifetime, optional auto-approval pattern), the commands to run on the
// machine, the machines waiting for approval and the codes in use.
// Deciding is an administrator's call; the engine and the console proxy
// enforce it too, and the console never contacts a machine.
import { useEffect, useState } from 'react'
import { Copy } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { useConsoleUser } from '@/components/console/user-session'
import { useFleet } from '@/components/console/fleet-provider'
import { formatDateTime } from '@/lib/console-types'
import {
  createEnrollToken,
  decideEnrolledHost,
  isValidPattern,
  isValidServer,
  revokeEnrollToken,
  tokenEnrollmentPlan,
  type EnrollToken,
} from '@/lib/enroll'
import { Empty } from '../home/parts'

function CopyButton({ text }: { text: string }) {
  const { dict } = useI18n()
  const t = dict.v2.hostsView
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="v2-btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          window.setTimeout(() => setDone(false), 1600)
        } catch {
          setDone(false)
        }
      }}
    >
      <Copy aria-hidden="true" />
      {done ? t.copied : t.copy}
    </button>
  )
}

const LIVES = ['24', '168', '720'] as const

export function EnrollPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.hostsView
  const me = useConsoleUser()
  const { enroll, refresh } = useFleet()
  const [label, setLabel] = useState('')
  const [uses, setUses] = useState(5)
  const [life, setLife] = useState<(typeof LIVES)[number]>('168')
  const [auto, setAuto] = useState('')
  const [server, setServer] = useState('')
  const [tls, setTls] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ token: EnrollToken; secret: string } | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && !server) setServer(window.location.hostname === 'localhost' ? '' : window.location.hostname)
  }, [server])

  if (!enroll) return <Empty title={t.enrollTitle} />
  if (!enroll.enabled) return <Empty title={t.enrollOff}>{enroll.hint}</Empty>

  const canEdit = enroll.writes && !me.pending && me.role === 'admin'
  const by = me.mode === 'users' ? me.name : 'consola'
  const pending = enroll.hosts.filter((h) => h.state === 'pending')
  const fmt = (iso: string) => formatDateTime(iso, lang)

  const run = async <T,>(write: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, done?: (data: T) => void) => {
    setBusy(true)
    setError(null)
    const res = await write()
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    done?.(res.data)
    await refresh()
  }

  return (
    <div className="v2-enroll">
      {!canEdit && <p className="v2-dim v2-small">{t.enrollReadOnly}</p>}
      {error && <p className="v2-error">{error}</p>}

      <section className="v2-enroll-pending" aria-labelledby="v2-pending-title">
        <h3 id="v2-pending-title">
          {t.pendingTitle} <span className="v2-tick v2-mono">{pending.length}</span>
        </h3>
        {pending.length === 0 ? (
          <p className="v2-dim v2-small">{t.pendingNone}</p>
        ) : (
          <ul className="v2-pending-list">
            {pending.map((h) => (
              <li key={h.name}>
                <span className="v2-pending-main">
                  <strong className="v2-mono">{h.host}</strong>
                  <span className="v2-dim v2-small">
                    {t.enrolledAt(fmt(h.enrolled_at))}
                    {h.peer ? ` · ${h.peer}` : ''}
                  </span>
                  {h.conflict && <span className="v2-small v2-warn">{t.conflict(h.conflict)}</span>}
                </span>
                {canEdit && (
                  <span className="v2-actions">
                    <button
                      type="button"
                      className="v2-btn v2-btn-primary"
                      disabled={busy}
                      onClick={() => void run(() => decideEnrolledHost(h.name, 'approve', by), () => onNotice(t.approved(h.host)))}
                    >
                      {t.approve}
                    </button>
                    <button type="button" className="v2-btn" disabled={busy} onClick={() => void run(() => decideEnrolledHost(h.name, 'reject', by), () => onNotice(t.rejected(h.host)))}>
                      {t.reject}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canEdit && (
        <section className="v2-enroll-new" aria-labelledby="v2-newtoken-title">
          <h3 id="v2-newtoken-title">{t.newToken}</h3>
          {created ? (
            <div className="v2-enroll-created">
              <p className="v2-small">{t.tokenCreated}</p>
              <div className="v2-secret">
                <code className="v2-mono">{created.secret}</code>
                <CopyButton text={created.secret} />
              </div>
              <div className="v2-enroll-server">
                <label className="v2-field">
                  {t.tokenServer}
                  <input className="v2-input v2-mono" value={server} onChange={(e) => setServer(e.target.value.trim())} placeholder="192.168.1.10" />
                </label>
                <label className="v2-check-inline">
                  <input type="checkbox" checked={tls} onChange={(e) => setTls(e.target.checked)} />
                  {t.tokenTls}
                </label>
              </div>
              {isValidServer(server) && (
                <>
                <strong className="v2-small">{t.tokenSteps}</strong>
                <ol className="v2-enroll-steps">
                  {tokenEnrollmentPlan(created.secret, server, tls, dict.enroll.plan).map((s, i) => (
                    <li key={i}>
                      <span className="v2-tag">{dict.enroll.where[s.where]}</span>
                      <p className="v2-small">{s.text}</p>
                      {s.cmd && (
                        <div className="v2-cmd">
                          <code className="v2-mono">{s.cmd}</code>
                          <CopyButton text={s.cmd} />
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
                </>
              )}
              <button type="button" className="v2-btn" onClick={() => setCreated(null)}>
                {t.newToken}
              </button>
            </div>
          ) : (
            <form
              className="v2-enroll-form"
              onSubmit={(e) => {
                e.preventDefault()
                if (!label.trim() || !isValidPattern(auto)) return
                void run(() => createEnrollToken({ label: label.trim(), max_uses: uses, ttl_hours: Number(life), auto_approve: auto, by }), (d) => setCreated(d))
              }}
            >
              <label className="v2-field">
                {t.tokenLabel}
                <input className="v2-input" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder={t.tokenLabelPlaceholder} />
              </label>
              <label className="v2-field">
                {t.tokenUses}
                <input className="v2-input v2-mono" type="number" min={1} max={500} value={uses} onChange={(e) => setUses(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} />
              </label>
              <label className="v2-field">
                {t.tokenLife}
                <select className="v2-input" value={life} onChange={(e) => setLife(e.target.value as (typeof LIVES)[number])}>
                  {LIVES.map((l) => (
                    <option key={l} value={l}>
                      {t.tokenLives[l]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="v2-field">
                {t.tokenAuto}
                <input className="v2-input v2-mono" value={auto} maxLength={64} onChange={(e) => setAuto(e.target.value.trim())} placeholder="pc-planta2-*" aria-invalid={!isValidPattern(auto)} />
                <span className="v2-dim v2-small">{t.tokenAutoHint}</span>
              </label>
              <button type="submit" className="v2-btn v2-btn-primary" disabled={busy || !label.trim() || !isValidPattern(auto)}>
                {t.tokenCreate}
              </button>
            </form>
          )}
        </section>
      )}

      <section className="v2-enroll-tokens" aria-labelledby="v2-tokens-title">
        <h3 id="v2-tokens-title">{t.tokensTitle}</h3>
        {enroll.tokens.length === 0 ? (
          <p className="v2-dim v2-small">{t.tokensNone}</p>
        ) : (
          <ul className="v2-token-list">
            {enroll.tokens.map((tok) => (
              <li key={tok.id} data-status={tok.status}>
                <span className="v2-pending-main">
                  <strong>{tok.label}</strong>
                  <span className="v2-dim v2-small">
                    {t.tokenStatus[tok.status]} · {t.tokenUsesOf(tok.uses, tok.max_uses)} · {t.tokenExpires(fmt(tok.expires_at))}
                    {tok.auto_approve ? ` · ${tok.auto_approve}` : ''}
                  </span>
                </span>
                {canEdit && tok.status === 'active' && (
                  <button
                    type="button"
                    className="v2-link"
                    disabled={busy}
                    onClick={() => {
                      if (confirm !== tok.id) return setConfirm(tok.id)
                      setConfirm(null)
                      void run(() => revokeEnrollToken(tok.id, by))
                    }}
                  >
                    {confirm === tok.id ? t.revokeConfirm : t.tokenRevoke}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
