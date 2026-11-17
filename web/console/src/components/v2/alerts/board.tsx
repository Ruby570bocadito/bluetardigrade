'use client'

// The queue as a board: one column per triage state. With triage rights a
// card can be dragged to another column (or moved with its buttons, which
// also serve the keyboard and touch); the card lands in its new column with
// a short entrance and the counters follow. A card opens its alert.
import { useRef, useState } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import { useConsoleUser } from '@/components/console/user-session'
import { alertKey } from '@/lib/engine-client'
import { formatTime, type SfAlert, type SfAlertStatus } from '@/lib/console-types'
import { boardColumns, statusOf, techniqueIds } from '@/lib/v2/alerts-model'
import { SEV_COLOR } from '../home/parts'
import { StatusChip } from './status-chip'

const STATES: readonly SfAlertStatus[] = ['new', 'acknowledged', 'closed']

function initials(name: string): string {
  const parts = name.replace(/^.*\\/, '').split(/[\s._@-]+/).filter(Boolean)
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase()
}

export function Board({
  alerts,
  selectedKey,
  onSelect,
  onMove,
}: {
  alerts: SfAlert[]
  selectedKey: string | null
  onSelect: (key: string) => void
  onMove: (alert: SfAlert, to: SfAlertStatus) => void
}) {
  const { dict, lang } = useI18n()
  const t = dict.v2.alertsView
  const me = useConsoleUser()
  const can = !me.pending && me.can_triage
  const columns = boardColumns(alerts)
  const [over, setOver] = useState<SfAlertStatus | null>(null)
  const dragging = useRef<string | null>(null)

  function drop(to: SfAlertStatus, key: string) {
    setOver(null)
    const alert = alerts.find((a) => alertKey(a) === key)
    if (alert && alert.id && statusOf(alert) !== to) onMove(alert, to)
  }

  return (
    <div className="v2-board" aria-label={t.board.aria} role="region">
      {can && <p className="v2-dim v2-small">{t.board.hint}</p>}
      <div className="v2-board-cols">
        {STATES.map((status) => (
          <section
            key={status}
            className="v2-board-col"
            data-over={over === status}
            aria-labelledby={`v2-col-${status}`}
            onDragOver={(e) => {
              if (!can || !dragging.current) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (over !== status) setOver(status)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === status ? null : o))
            }}
            onDrop={(e) => {
              e.preventDefault()
              drop(status, e.dataTransfer.getData('text/plain') || dragging.current || '')
            }}
          >
            <h3 id={`v2-col-${status}`} className="v2-board-head">
              <StatusChip status={status} />
              <b key={columns[status].length} className="v2-tick v2-mono">
                {columns[status].length}
              </b>
            </h3>
            {columns[status].length === 0 ? (
              <p className="v2-board-empty">{t.board.empty}</p>
            ) : (
              <ul className="v2-board-list">
                {columns[status].map((a) => {
                  const key = alertKey(a)
                  const technique = techniqueIds(a.tags)[0]
                  return (
                    <li
                      key={`${key}-${status}`}
                      className="v2-card"
                      data-selected={key === selectedKey}
                      draggable={can && !!a.id}
                      onDragStart={(e) => {
                        dragging.current = key
                        e.dataTransfer.setData('text/plain', key)
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                      onDragEnd={() => {
                        dragging.current = null
                        setOver(null)
                      }}
                    >
                      <button
                        type="button"
                        className="v2-card-open"
                        aria-label={t.board.cardAria(dict.v2.sev[a.severity], a.rule_name, a.host)}
                        onClick={() => onSelect(key)}
                      >
                        <span className="v2-card-top">
                          <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[a.severity] }}>
                            {dict.v2.sev[a.severity]}
                          </span>
                          <span className="v2-mono v2-dim">{formatTime(a.timestamp, lang)}</span>
                        </span>
                        <strong>{a.rule_name}</strong>
                        <span className="v2-q-sub">
                          <span className="v2-mono">{a.host}</span>
                          {technique && <span className="v2-mono"> · {technique}</span>}
                        </span>
                        {a.assignee && (
                          <span className="v2-avatar" title={a.assignee} aria-label={a.assignee}>
                            {initials(a.assignee)}
                          </span>
                        )}
                      </button>
                      {can && a.id && (
                        <div className="v2-card-actions">
                          {STATES.filter((s) => s !== status && !(status === 'closed' && s === 'acknowledged')).map((s) => (
                            <button key={s} type="button" className="v2-link" onClick={() => onMove(a, s)}>
                              {s === 'new' ? dict.alerts.reopen : t.board.moveTo(t.status[s])}
                            </button>
                          ))}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
