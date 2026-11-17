'use client'

// The newest alerts as a table: severity, host, what was detected and
// when. A row that just arrived keeps a soft highlight for a moment.
// Each detection opens its alert in the v2 queue (Alertas).
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import { alertKey } from '@/lib/engine-client'
import { formatTime, type SfAlert } from '@/lib/console-types'
import { parentTechniques } from '@/lib/v2/home-model'
import { v2AlertLink } from '@/lib/v2/alerts-model'
import { Empty, Panel, SEV_COLOR } from './parts'

function useFreshKeys(keys: string[]): Set<string> {
  const known = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const joined = keys.join('\n')
  useEffect(() => {
    const current = joined ? joined.split('\n') : []
    if (known.current === null) {
      // first data: everything is already "old news"
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

export function LiveAlerts({ alerts }: { alerts: SfAlert[] }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.alerts
  const keys = alerts.map(alertKey)
  const fresh = useFreshKeys(keys)

  return (
    <Panel
      labelledBy="v2-alerts-title"
      title={t.title}
      subtitle={t.subtitle}
      action={
        <a className="v2-btn" href="/v2/alertas">
          {t.all}
        </a>
      }
    >
      {alerts.length === 0 ? (
        <Empty title={t.empty}>{t.emptySub}</Empty>
      ) : (
        <div className="v2-table-wrap">
          <table className="v2-table">
            <thead>
              <tr>
                <th scope="col">{t.cols.severity}</th>
                <th scope="col">{t.cols.host}</th>
                <th scope="col">{t.cols.detection}</th>
                <th scope="col" className="v2-num">
                  {t.cols.time}
                </th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a, i) => {
                const key = keys[i]
                const technique = parentTechniques(a.tags)[0]
                return (
                  <tr key={key} data-fresh={fresh.has(key)} data-closed={a.status === 'closed'}>
                    <td>
                      <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[a.severity] }}>
                        {dict.v2.sev[a.severity]}
                      </span>
                    </td>
                    <td className="v2-mono">{a.host}</td>
                    <td className="v2-detection">
                      <a href={v2AlertLink(key)}>{a.rule_name}</a>
                      {technique && <span className="v2-mono v2-dim"> {technique}</span>}
                    </td>
                    <td className="v2-mono v2-num v2-dim">{formatTime(a.timestamp, lang)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
