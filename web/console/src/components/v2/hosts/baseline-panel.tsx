'use client'

// The process baseline of one machine (boceto 6): how far the engine is
// in learning it, the process names it treats as normal there (with how
// many starts of each the events in memory hold) and what it has never
// seen, from the alerts it raised for it.
import { useEffect, useState } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import { useEngine } from '@/components/console/engine-provider'
import { alertKey } from '@/lib/engine-client'
import { formatDateTime } from '@/lib/console-types'
import { fetchBaselineHost, type BaselineHost } from '@/lib/intel'
import { v2AlertLink } from '@/lib/v2/alerts-model'
import { baselineView } from '@/lib/v2/hosts-model'
import { Empty, SEV_COLOR } from '../home/parts'

export function BaselinePanel({ host, now }: { host: string; now: number | null }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.hostsView
  const { events, alerts } = useEngine()
  const [data, setData] = useState<BaselineHost | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setData(null)
    setError(null)
    void fetchBaselineHost(host).then((res) => {
      if (!alive) return
      if (res.ok) setData(res.data)
      else setError(res.error)
    })
    return () => {
      alive = false
    }
  }, [host])

  if (error) return <p className="v2-error">{t.baselineError(error)}</p>
  if (!data || now === null) return null
  if (!data.enabled) return <Empty title={t.baselineOff} />
  if (!data.known) return <Empty title={t.baselineUnknown} />
  const v = baselineView(data, host, events, alerts, now)
  const maxStarts = Math.max(1, ...v.processes.map((p) => p.starts))

  return (
    <div className="v2-baseline">
      <section className="v2-baseline-learn">
        {v.learning && v.progress !== null ? (
          <>
            <p className="v2-small">{t.baselineLearning(v.daysDone ?? 0, v.daysTotal ?? 0)}</p>
            <span className="v2-meter" data-level="low">
              <i style={{ ['--w' as string]: `${Math.max(2, Math.round(v.progress * 100))}%` }} />
            </span>
          </>
        ) : (
          <p className="v2-small">{t.baselineLearned}</p>
        )}
        {data.full && <p className="v2-dim v2-small">{t.baselineFull}</p>}
      </section>

      <div className="v2-baseline-cols">
        <section>
          <h3>{t.baselineProcesses(v.processes.length)}</h3>
          <ul className="v2-baseline-list">
            {v.processes.map((p, i) => (
              <li key={p.name} style={{ ['--i' as string]: Math.min(i, 20) }}>
                <span className="v2-mono">{p.name}</span>
                <span className="v2-baseline-bar" aria-hidden="true">
                  <i style={{ ['--w' as string]: `${(p.starts / maxStarts) * 100}%` }} />
                </span>
                <span className="v2-dim v2-small">{t.baselineStarts(p.starts)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="v2-baseline-new">
          <h3>{t.baselineNovelties}</h3>
          {v.novelties.length === 0 ? (
            <p className="v2-dim v2-small">{t.baselineNoNovelties}</p>
          ) : (
            <ul className="v2-plain-list">
              {v.novelties.slice(0, 12).map((a) => (
                <li key={alertKey(a)}>
                  <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[a.severity] }}>
                    {dict.alerts.sevLabels[a.severity]}
                  </span>
                  <a href={v2AlertLink(alertKey(a))} className="v2-mono">
                    {a.summary || a.rule_name}
                  </a>
                  <span className="v2-dim v2-small">{formatDateTime(a.timestamp, lang)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
