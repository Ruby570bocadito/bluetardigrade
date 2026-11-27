'use client'

// Focus mode: one alert at a time with what it takes to decide, and the
// keyboard to go fast (A acknowledge, C close, J next, K previous, Esc
// leave). A decision moves on to the next alert right away (the write
// follows, with its undo in the notice); each new card comes in from the
// side it is reached from.
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import { useConsoleUser } from '@/components/console/user-session'
import { alertKey } from '@/lib/engine-client'
import { formatAgo } from '@/lib/soc-metrics'
import { formatDateTime, type SfAlert, type SfAlertStatus } from '@/lib/console-types'
import { alertTacticOf, focusStart, statusOf, techniqueIds } from '@/lib/v2/alerts-model'
import { Empty, SEV_COLOR } from '../home/parts'
import { useNow } from '../use-now'
import { StatusChip } from './status-chip'

export function FocusMode({
  alerts,
  selectedKey,
  onSelect,
  onMove,
  onExit,
}: {
  alerts: SfAlert[]
  selectedKey: string | null
  onSelect: (key: string) => void
  onMove: (alert: SfAlert, to: SfAlertStatus) => void
  onExit: () => void
}) {
  const { dict, lang } = useI18n()
  const t = dict.v2.alertsView
  const d = dict.alerts
  const me = useConsoleUser()
  const now = useNow(15_000)
  const can = !me.pending && me.can_triage
  const [currentKey, setCurrentKey] = useState<string | null>(() => {
    const i = focusStart(alerts, selectedKey)
    return i >= 0 ? alertKey(alerts[i]) : null
  })
  const [done, setDone] = useState(false)
  const [dir, setDir] = useState<'next' | 'prev'>('next')
  const lastIndex = useRef(0)

  let index = currentKey === null ? -1 : alerts.findIndex((a) => alertKey(a) === currentKey)
  // the open alert left the queue (another lens, another analyst): stay at its place
  if (index === -1 && alerts.length > 0 && !done) index = Math.min(lastIndex.current, alerts.length - 1)
  if (index >= 0) lastIndex.current = index
  const alert = !done && index >= 0 ? alerts[index] : null
  const key = alert ? alertKey(alert) : null

  useEffect(() => {
    if (key && key !== currentKey) setCurrentKey(key)
    if (key) onSelect(key)
  }, [key, currentKey, onSelect])

  const go = (step: 1 | -1) => {
    setDir(step === 1 ? 'next' : 'prev')
    const target = index + step
    if (target >= alerts.length) {
      setDone(true)
      return
    }
    if (target < 0) return
    setDone(false)
    setCurrentKey(alertKey(alerts[target]))
  }

  const decide = (to: SfAlertStatus) => {
    if (!alert || !can || !alert.id) return
    const target = alert
    go(1)
    onMove(target, to)
  }

  // the keyboard drives the mode, except while typing somewhere
  const handler = useRef<(e: KeyboardEvent) => void>(() => undefined)
  handler.current = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (k === 'escape') onExit()
    else if (k === 'j' || k === 'arrowright') go(1)
    else if (k === 'k' || k === 'arrowleft') go(-1)
    else if (k === 'a' && alert && statusOf(alert) === 'new') decide('acknowledged')
    else if (k === 'c' && alert && statusOf(alert) !== 'closed') decide('closed')
    else return
    e.preventDefault()
  }
  useEffect(() => {
    const listener = (e: KeyboardEvent) => handler.current(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  if (alerts.length === 0) return <Empty title={t.focus.empty} />
  if (done || !alert) {
    return (
      <div className="v2-focus v2-focus-done" aria-label={t.focus.aria} role="region">
        <Empty title={t.focus.done} />
        <div className="v2-actions">
          <button
            type="button"
            className="v2-btn v2-btn-primary"
            onClick={() => {
              setDone(false)
              setDir('prev')
              setCurrentKey(alertKey(alerts[0]))
            }}
          >
            {t.focus.restart}
          </button>
          <button type="button" className="v2-btn" onClick={onExit}>
            {t.focus.exit}
          </button>
        </div>
      </div>
    )
  }

  const status = statusOf(alert)
  const tactic = alertTacticOf(alert)
  const techniques = techniqueIds(alert.tags)
  const ago = now === null ? '' : formatAgo(Math.max(0, now - Date.parse(alert.timestamp)), lang)

  return (
    <div className="v2-focus" aria-label={t.focus.aria} role="region">
      <div className="v2-focus-progress">
        <span className="v2-mono">{t.focus.progress(index + 1, alerts.length)}</span>
        <span className="v2-bar" aria-hidden="true">
          <span style={{ width: `${((index + 1) / alerts.length) * 100}%` }} />
        </span>
      </div>
      <article key={key} className="v2-focus-card" data-dir={dir}>
        <div className="v2-detail-tags">
          <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[alert.severity] }}>
            {dict.v2.sev[alert.severity]}
          </span>
          <StatusChip status={status} />
        </div>
        <h2 className="v2-focus-title">{alert.rule_name}</h2>
        <p className="v2-dim">{t.detected(formatDateTime(alert.timestamp, lang), ago)}</p>
        {(alert.message || alert.summary) && <blockquote className="v2-quote">{alert.message || alert.summary}</blockquote>}
        <dl className="v2-facts">
          <div>
            <dt>{d.labels.host}</dt>
            <dd className="v2-mono">{alert.host}</dd>
          </div>
          <div>
            <dt>{d.labels.user}</dt>
            <dd className="v2-mono">{alert.user ?? d.nd}</dd>
          </div>
          <div>
            <dt>{d.labels.eventType}</dt>
            <dd className="v2-mono">{alert.event_type}</dd>
          </div>
          <div>
            <dt>{t.tactic}</dt>
            <dd className="v2-mono">{[tactic ? dict.rules.tactics[tactic] : '', ...techniques].filter(Boolean).join(' · ') || d.nd}</dd>
          </div>
        </dl>
        <div className="v2-actions">
          {can && alert.id && status === 'new' && (
            <button type="button" className="v2-btn v2-btn-primary" onClick={() => decide('acknowledged')}>
              {d.acknowledge} <kbd>A</kbd>
            </button>
          )}
          {can && alert.id && status !== 'closed' && (
            <button type="button" className="v2-btn" onClick={() => decide('closed')}>
              {d.close} <kbd>C</kbd>
            </button>
          )}
          <span className="v2-spacer" />
          <button type="button" className="v2-btn" disabled={index === 0} onClick={() => go(-1)}>
            {t.focus.previous} <kbd>K</kbd>
          </button>
          <button type="button" className="v2-btn" onClick={() => go(1)}>
            {t.focus.next} <kbd>J</kbd>
          </button>
        </div>
      </article>
      <p className="v2-dim v2-small v2-focus-keys">{t.focus.keys}</p>
    </div>
  )
}
