'use client'

// The fleet inventory (boceto 1): every machine with its status, group,
// system, sensor build, last signal, recent activity and risk. A status
// that changes flashes once; a phone gets one card per machine.
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import type { SfEvent } from '@/lib/console-types'
import { activitySeries, riskLevel, type HostRow } from '@/lib/v2/hosts-model'
import { Empty } from '../home/parts'
import { useMedia } from '../use-media'
import { Ago, RiskBar, Spark, StatusPill } from './parts'

/** Machines whose status just changed (for one flash). */
function useChangedStatus(rows: readonly HostRow[]): Set<string> {
  const seen = useRef<Map<string, string> | null>(null)
  const [changed, setChanged] = useState<Set<string>>(new Set())
  const key = rows.map((r) => `${r.host}:${r.status}`).join('|')
  useEffect(() => {
    const now = new Map(rows.map((r) => [r.host, r.status as string]))
    const before = seen.current
    seen.current = now
    if (!before) return undefined
    const moved = rows.filter((r) => before.has(r.host) && before.get(r.host) !== r.status).map((r) => r.host)
    if (moved.length === 0) return undefined
    setChanged(new Set(moved))
    const id = window.setTimeout(() => setChanged(new Set()), 2400)
    return () => window.clearTimeout(id)
    // rows travel through `key`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return changed
}

export function Inventory({
  rows,
  allRows,
  events,
  now,
  groupLabel,
  onOpen,
}: {
  rows: HostRow[]
  allRows: HostRow[]
  events: readonly SfEvent[]
  now: number | null
  groupLabel: (name: string) => string
  onOpen: (host: string) => void
}) {
  const { dict } = useI18n()
  const t = dict.v2.hostsView
  const narrow = useMedia('(max-width: 760px)')
  const changed = useChangedStatus(allRows)
  const max = Math.max(0, ...allRows.map((r) => r.risk ?? 0))

  if (rows.length === 0) return <Empty title={t.empty}>{t.emptyHint}</Empty>

  if (narrow)
    return (
      <ul className="v2-host-cards">
        {rows.map((r) => (
          <li key={r.host} data-changed={changed.has(r.host)}>
            <button type="button" onClick={() => onOpen(r.host)}>
              <span className="v2-host-card-top">
                <strong className="v2-mono">{r.host}</strong>
                <StatusPill status={r.status} />
              </span>
              <span className="v2-dim v2-small">
                {r.groups.map(groupLabel).join(', ') || t.groupNone} · {r.sensor?.os ?? t.noSensor}
              </span>
              <span className="v2-host-card-bottom">
                <Ago iso={r.lastSeen} now={now} />
                <RiskBar row={r} level={riskLevel(r.risk, allRows)} max={max} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    )

  return (
    <div className="v2-table-wrap">
      <table className="v2-host-table">
        <thead>
          <tr>
            <th scope="col">{t.cols.host}</th>
            <th scope="col">{t.cols.status}</th>
            <th scope="col">{t.cols.group}</th>
            <th scope="col">{t.cols.os}</th>
            <th scope="col">{t.cols.sensor}</th>
            <th scope="col">{t.cols.lastSeen}</th>
            <th scope="col">{t.cols.activity}</th>
            <th scope="col">{t.cols.risk}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.host}
              tabIndex={0}
              data-changed={changed.has(r.host)}
              style={{ ['--i' as string]: Math.min(i, 20) }}
              onClick={() => onOpen(r.host)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onOpen(r.host)
                }
              }}
            >
              <td>
                <span className="v2-mono v2-host-name">{r.host}</span>
                {r.openAlerts > 0 && <span className="v2-dim v2-small"> · {t.openAlerts(r.openAlerts)}</span>}
              </td>
              <td>
                <StatusPill status={r.status} />
              </td>
              <td className="v2-dim">{r.groups.map(groupLabel).join(', ') || '—'}</td>
              <td className="v2-dim">{r.sensor?.os ?? '—'}</td>
              <td className="v2-mono v2-dim">{r.sensor?.version ?? t.noSensor}</td>
              <td className="v2-dim">
                <Ago iso={r.lastSeen} now={now} />
              </td>
              <td>
                {now !== null && <Spark values={activitySeries(events, r.host, now)} label={t.activityAria(r.host)} />}
                <span className="v2-dim v2-small v2-mono"> {t.events5m(r.events5m)}</span>
              </td>
              <td>
                <RiskBar row={r} level={riskLevel(r.risk, allRows)} max={max} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
