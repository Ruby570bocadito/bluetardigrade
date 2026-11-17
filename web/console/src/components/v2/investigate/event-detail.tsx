'use client'

// One event in full (boceto 5): its fields with every value that can
// scope a search ready to pivot on, the raw JSON, the alerts it raised,
// and the ways on: its process tree, its host timeline or a case.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Copy, TreeStructure, ChartLineUp, X } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { useEngine } from '@/components/console/engine-provider'
import { alertKey } from '@/lib/engine-client'
import { formatDateTime, type SfEvent } from '@/lib/console-types'
import { v2AlertLink } from '@/lib/v2/alerts-model'
import { detailRows, eventTarget, parentIndex, type QueryToken } from '@/lib/v2/investigate-model'
import { Empty, SEV_COLOR } from '../home/parts'
import { CasePicker } from './case-picker'
import { KindChip } from './parts'

export function EventDetail({
  ev,
  events,
  onPivot,
  onClose,
  onTree,
  onTimeline,
  onNotice,
  autoFocus,
  drawer,
}: {
  ev: SfEvent | null
  events: readonly SfEvent[]
  onPivot: (token: QueryToken) => void
  onClose: () => void
  onTree: (ev: SfEvent) => void
  onTimeline: (ev: SfEvent) => void
  onNotice: (message: string) => void
  autoFocus: boolean
  drawer: boolean
}) {
  const { dict, lang } = useI18n()
  const t = dict.v2.investigateView
  const { alerts } = useEngine()
  const [view, setView] = useState<'fields' | 'json'>('fields')
  const [copied, setCopied] = useState(false)
  const close = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (autoFocus && ev) close.current?.focus()
  }, [autoFocus, ev])

  const rows = useMemo(() => (ev ? detailRows(ev, parentIndex([...events, ev])) : []), [ev, events])
  const own = useMemo(() => (ev ? alerts.filter((a) => a.event_id === ev.id) : []), [ev, alerts])

  if (!ev) return <Empty title={t.pickEvent}>{t.pickEventHint}</Empty>

  const json = JSON.stringify(ev, null, 2)
  const what = eventTarget(ev) || ev.type

  return (
    <div className="v2-detail-body v2-ev-detail">
      {drawer && (
        <button type="button" className="v2-btn v2-detail-back" onClick={onClose}>
          <ArrowLeft aria-hidden="true" />
          {t.back}
        </button>
      )}
      <div className="v2-detail-head">
        <div>
          <div className="v2-detail-tags">
            <KindChip ev={ev} />
            <span className="v2-mono v2-dim v2-small">{ev.type}</span>
          </div>
          <h2 className="v2-detail-title v2-mono">{what}</h2>
          <p className="v2-dim v2-small">
            <span className="v2-mono">{ev.host}</span> · {formatDateTime(ev.timestamp, lang)}
          </p>
        </div>
        <button ref={close} type="button" className="v2-icon-btn v2-detail-close" onClick={onClose} aria-label={t.close}>
          <X aria-hidden="true" />
        </button>
      </div>

      <div className="v2-actions v2-ev-actions">
        {ev.process && (
          <button type="button" className="v2-btn" onClick={() => onTree(ev)}>
            <TreeStructure aria-hidden="true" />
            {t.openTree}
          </button>
        )}
        <button type="button" className="v2-btn" onClick={() => onTimeline(ev)}>
          <ChartLineUp aria-hidden="true" />
          {t.openTimeline}
        </button>
        <CasePicker note={t.caseNote(ev.type, ev.host, what, ev.id)} onDone={onNotice} />
      </div>

      <div className="v2-seg v2-ev-view" role="group" aria-label={t.detailViewAria}>
        <button type="button" aria-pressed={view === 'fields'} onClick={() => setView('fields')}>
          {t.detailFields}
        </button>
        <button type="button" aria-pressed={view === 'json'} onClick={() => setView('json')}>
          {t.detailJson}
        </button>
      </div>

      {view === 'fields' ? (
        <>
          <p className="v2-dim v2-small">{t.pivotHint}</p>
          <dl className="v2-fields">
            {rows.map((r, i) => (
              <div key={`${r.key}-${i}`}>
                <dt>{t.detailKeys[r.key]}</dt>
                <dd className={r.mono ? 'v2-mono' : undefined}>
                  {r.pivot ? (
                    <button type="button" className="v2-pivot" onClick={() => onPivot(r.pivot as QueryToken)} title={t.pivot(r.pivot.value)}>
                      {r.key === 'time' ? formatDateTime(r.value, lang) : r.value}
                    </button>
                  ) : r.key === 'time' ? (
                    formatDateTime(r.value, lang)
                  ) : (
                    r.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <div className="v2-json-wrap">
          <button
            type="button"
            className="v2-btn v2-json-copy"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(json)
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1600)
              } catch {
                setCopied(false)
              }
            }}
          >
            <Copy aria-hidden="true" />
            {copied ? t.copied : t.copyJson}
          </button>
          <pre className="v2-json v2-mono">{json}</pre>
        </div>
      )}

      {own.length > 0 && (
        <section className="v2-box">
          <div className="v2-box-head">
            <span>{t.eventAlerts}</span>
          </div>
          <ul className="v2-plain-list">
            {own.map((a) => (
              <li key={alertKey(a)}>
                <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[a.severity] }}>
                  {dict.alerts.sevLabels[a.severity]}
                </span>
                <a href={v2AlertLink(alertKey(a))}>{a.rule_name}</a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
