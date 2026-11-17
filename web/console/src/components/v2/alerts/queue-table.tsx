'use client'

// The queue as a table: one row per alert (severity, what was detected on
// which host, its state and owner, when), a checkbox for bulk actions and,
// grouped by host, one folding header per host. A row that just arrived
// slides in with a soft amber highlight; a group that opens lays its rows
// out one after another. A row opens its alert beside the queue.
import { Fragment, useEffect, useRef, useState } from 'react'
import { CaretRight } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { alertKey } from '@/lib/engine-client'
import { SEVERITIES } from '@/lib/soc-metrics'
import { formatTime, type SfAlert } from '@/lib/console-types'
import { groupByHost, statusOf, techniqueIds } from '@/lib/v2/alerts-model'
import { SEV_COLOR } from '../home/parts'
import { StatusChip } from './status-chip'

/** Keys that appeared since the first render, for a few seconds. */
export function useFreshKeys(keys: string[]): Set<string> {
  const known = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const joined = keys.join('\n')
  useEffect(() => {
    const current = joined ? joined.split('\n') : []
    if (known.current === null) {
      known.current = new Set(current)
      return undefined
    }
    const arrived = current.filter((k) => !known.current!.has(k))
    current.forEach((k) => known.current!.add(k))
    if (arrived.length === 0) return undefined
    setFresh(new Set(arrived))
    const id = window.setTimeout(() => setFresh(new Set()), 3000)
    return () => window.clearTimeout(id)
  }, [joined])
  return fresh
}

type Props = {
  alerts: SfAlert[]
  selectedKey: string | null
  onSelect: (key: string) => void
  picked: Set<string>
  onPick: (key: string) => void
  onPickAll: () => void
  grouped: boolean
}

export function QueueTable({ alerts, selectedKey, onSelect, picked, onPick, onPickAll, grouped }: Props) {
  const { dict, lang } = useI18n()
  const t = dict.v2.alertsView
  const keys = alerts.map(alertKey)
  const fresh = useFreshKeys(keys)
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set())
  const allPicked = keys.length > 0 && keys.every((k) => picked.has(k))

  const row = (a: SfAlert, index: number) => {
    const key = alertKey(a)
    const time = formatTime(a.timestamp, lang)
    const technique = techniqueIds(a.tags)[0]
    return (
      <tr
        key={key}
        data-selected={key === selectedKey}
        data-picked={picked.has(key)}
        data-fresh={fresh.has(key)}
        data-closed={statusOf(a) === 'closed'}
        data-cascade={grouped || undefined}
        style={grouped ? { ['--i' as string]: index } : undefined}
        onClick={() => onSelect(key)}
      >
        <td className="v2-pick" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={picked.has(key)} onChange={() => onPick(key)} aria-label={t.selectRow(a.rule_name)} />
        </td>
        <td>
          <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[a.severity] }}>
            {dict.v2.sev[a.severity]}
          </span>
        </td>
        <td className="v2-q-main">
          <button
            type="button"
            className="v2-q-open"
            aria-label={t.rowAria(dict.v2.sev[a.severity], a.rule_name, a.host, time)}
            aria-pressed={key === selectedKey}
          >
            {a.rule_name}
          </button>
          <span className="v2-q-sub">
            <span className="v2-mono">{a.host}</span>
            {a.user && <span> · {a.user}</span>}
            {technique && <span className="v2-mono"> · {technique}</span>}
          </span>
        </td>
        <td>
          <StatusChip status={statusOf(a)} />
          <span className="v2-q-owner">{a.assignee ?? t.unassigned}</span>
        </td>
        <td className="v2-num v2-mono v2-dim">{time}</td>
      </tr>
    )
  }

  return (
    <div className="v2-table-wrap">
      <table className="v2-table v2-queue-table">
        <caption className="v2-sr-only">{dict.alerts.tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col" className="v2-pick">
              <input type="checkbox" checked={allPicked} onChange={onPickAll} aria-label={t.selectAll} />
            </th>
            <th scope="col">{dict.alerts.thSev}</th>
            <th scope="col">{dict.alerts.thAlert}</th>
            <th scope="col">{t.stateLabel}</th>
            <th scope="col" className="v2-num">
              {dict.alerts.thTime}
            </th>
          </tr>
        </thead>
        <tbody>
          {grouped
            ? groupByHost(alerts).map((g) => {
                const open = !closedGroups.has(g.host)
                return (
                  <Fragment key={g.host}>
                    <tr className="v2-group-row" data-open={open}>
                      <td colSpan={5}>
                        <button
                          type="button"
                          className="v2-group-btn"
                          aria-expanded={open}
                          aria-label={t.groupToggle(g.host, open)}
                          onClick={() =>
                            setClosedGroups((prev) => {
                              const next = new Set(prev)
                              if (next.has(g.host)) next.delete(g.host)
                              else next.add(g.host)
                              return next
                            })
                          }
                        >
                          <CaretRight aria-hidden="true" />
                          <strong className="v2-mono">{g.host}</strong>
                          <span className="v2-dim">{t.groupCount(g.alerts.length)}</span>
                          <span className="v2-group-bar" aria-hidden="true">
                            {SEVERITIES.map((s) =>
                              g.counts[s] ? <span key={s} style={{ flexGrow: g.counts[s], background: SEV_COLOR[s] }} /> : null,
                            )}
                          </span>
                        </button>
                      </td>
                    </tr>
                    {open && g.alerts.map((a, i) => row(a, i))}
                  </Fragment>
                )
              })
            : alerts.map((a, i) => row(a, i))}
        </tbody>
      </table>
    </div>
  )
}
