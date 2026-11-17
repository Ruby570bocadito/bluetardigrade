'use client'

// Detección · Supresiones: the rules silenced on one machine or on all,
// active ones first by the time they have left, permanent ones marked,
// expired ones last. A suppression is created here (or started from the
// noise report or a rule page) and removed with a second click.
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { SpeakerSlash, Trash } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import type { RuleMeta, SfSuppression } from '@/lib/console-types'
import { createSuppression, deleteSuppression, expiryInDays } from '@/lib/engine-writes'
import { formatDuration } from '@/lib/fleet'
import { suppressionStates } from '@/lib/v2/detection-model'
import { Empty } from '../home/parts'

/** A suppression started elsewhere; the name covers rules the engine raises itself (not in the rule files). */
export type SuppressionSeed = { id: number; ruleId: string; host: string; name?: string } | null
const DAYS = ['1', '7', '30', '0'] as const

export function Suppressions({
  list,
  rules,
  hosts,
  now,
  seed,
  canWrite,
  onChanged,
  onNotice,
  onOpen,
}: {
  list: SfSuppression[]
  rules: RuleMeta[]
  hosts: string[]
  now: number | null
  seed: SuppressionSeed
  canWrite: boolean
  onChanged: () => void
  onNotice: (message: string) => void
  onOpen: (id: string) => void
}) {
  const { dict } = useI18n()
  const t = dict.v2.detectionView
  const states = useMemo(() => suppressionStates(list, rules, now ?? Date.now()), [list, rules, now])
  const sorted = useMemo(() => [...rules].sort((a, b) => a.name.localeCompare(b.name)), [rules])
  const known = useMemo(() => new Set(rules.map((r) => r.id)), [rules])
  const [ruleId, setRuleId] = useState('')
  const [host, setHost] = useState('')
  const [reason, setReason] = useState('')
  const [days, setDays] = useState<(typeof DAYS)[number]>('7')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [arming, setArming] = useState<string | null>(null)

  useEffect(() => {
    if (!seed) return
    setRuleId(seed.ruleId)
    setHost(seed.host)
    setError('')
    document.getElementById('v2-sup-reason')?.focus()
  }, [seed])

  useEffect(() => {
    if (!arming) return undefined
    const id = window.setTimeout(() => setArming(null), 4000)
    return () => window.clearTimeout(id)
  }, [arming])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ruleId || !reason.trim()) return
    setBusy(true)
    setError('')
    const res = await createSuppression({ rule_id: ruleId, host: host.trim() || undefined, reason: reason.trim(), expires: days === '0' ? undefined : expiryInDays(Number(days)) })
    setBusy(false)
    if (!res.ok) return setError(t.supError(res.error))
    onNotice(t.supCreated(rules.find((r) => r.id === ruleId)?.name ?? (seed?.ruleId === ruleId && seed.name ? seed.name : ruleId)))
    setReason('')
    onChanged()
  }

  async function remove(s: SfSuppression) {
    const key = `${s.rule_id}|${s.host ?? ''}`
    if (arming !== key) return setArming(key)
    setArming(null)
    const res = await deleteSuppression(s.rule_id, s.host ?? '')
    if (!res.ok) return onNotice(t.supError(res.error))
    onNotice(t.supDeleted)
    onChanged()
  }

  const active = states.filter((x) => !x.expired)
  const expired = states.filter((x) => x.expired)

  const item = (x: (typeof states)[number]) => {
    const key = `${x.s.rule_id}|${x.s.host ?? ''}`
    return (
      <li key={key} className="v2-sup" data-expired={x.expired}>
        <div className="v2-sup-main">
          {known.has(x.s.rule_id) ? (
            <button type="button" className="v2-link" onClick={() => onOpen(x.s.rule_id)}>
              {x.ruleName}
            </button>
          ) : (
            <strong>{x.ruleName}</strong>
          )}
          <span className="v2-tag">{x.s.host || t.supAllHosts}</span>
        </div>
        {x.s.reason && <p className="v2-small">{x.s.reason}</p>}
        <div className="v2-sup-foot v2-small">
          <span className="v2-mono" data-soon={!x.expired && x.remainingMs !== null && x.remainingMs < 86_400_000}>
            {x.permanent ? t.supForever : x.expired ? t.supExpiredAgo(formatDuration(-(x.remainingMs ?? 0) / 1000)) : t.supLeft(formatDuration((x.remainingMs ?? 0) / 1000))}
          </span>
          {canWrite && (
            <button type="button" className="v2-link v2-sup-del" data-armed={arming === key} onClick={() => void remove(x.s)}>
              <Trash aria-hidden="true" />
              {arming === key ? t.supDeleteConfirm : t.supDelete}
            </button>
          )}
        </div>
      </li>
    )
  }

  return (
    <div className="v2-sups">
      <section className="v2-sups-list" aria-labelledby="v2-sups-title">
        <h2 id="v2-sups-title">{t.supTitle}</h2>
        <p className="v2-small v2-dim">{t.supHint}</p>
        {states.length === 0 ? (
          <Empty title={t.supNone} />
        ) : (
          <>
            {active.length > 0 && (
              <>
                <h3 className="v2-eyebrow">{t.supActive}</h3>
                <ul>{active.map(item)}</ul>
              </>
            )}
            {expired.length > 0 && (
              <>
                <h3 className="v2-eyebrow">{t.supExpired}</h3>
                <ul>{expired.map(item)}</ul>
              </>
            )}
          </>
        )}
      </section>

      <section className="v2-sups-form" aria-labelledby="v2-sups-new">
        <h2 id="v2-sups-new">
          <SpeakerSlash aria-hidden="true" />
          {t.supNew}
        </h2>
        {!canWrite ? (
          <p className="v2-small v2-dim">{t.supReadOnly}</p>
        ) : (
          <form onSubmit={(e) => void submit(e)}>
            <label className="v2-field">
              <span>{t.supRule}</span>
              <select className="v2-input" value={ruleId} onChange={(e) => setRuleId(e.target.value)} required>
                <option value="" disabled>
                  —
                </option>
                {ruleId && !known.has(ruleId) && <option value={ruleId}>{seed?.ruleId === ruleId && seed.name ? seed.name : ruleId}</option>}
                {sorted.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="v2-field">
              <span>{t.supHost}</span>
              <input className="v2-input" value={host} onChange={(e) => setHost(e.target.value)} list="v2-sup-hosts" autoComplete="off" />
              <datalist id="v2-sup-hosts">
                {hosts.map((h) => (
                  <option key={h} value={h} />
                ))}
              </datalist>
            </label>
            <label className="v2-field">
              <span>{t.supReason}</span>
              <input id="v2-sup-reason" className="v2-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.supReasonPlaceholder} required maxLength={200} />
            </label>
            <label className="v2-field">
              <span>{t.supDays}</span>
              <select className="v2-input" value={days} onChange={(e) => setDays(e.target.value as (typeof DAYS)[number])}>
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {t.supDaysOptions[d]}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="v2-btn v2-btn-primary" disabled={busy || !ruleId || !reason.trim()}>
              {t.supCreate}
            </button>
            {error && (
              <p role="alert" className="v2-error">
                {error}
              </p>
            )}
          </form>
        )}
      </section>
    </div>
  )
}
