'use client'

// Detección · Indicadores: the indicator lists the engine checks every
// event against (files in its intel folder, nothing downloaded), with
// what each holds, and the recent matches among the alerts in memory.
import { useEffect, useMemo, useState } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import type { SfAlert } from '@/lib/console-types'
import { alertKey } from '@/lib/engine-client'
import { formatDuration } from '@/lib/fleet'
import { fetchIntel, intelAlerts, kindBreakdown, learnText, listOfAlert, type IntelPayload } from '@/lib/intel'
import { v2AlertLink } from '@/lib/v2/alerts-model'
import { Empty } from '../home/parts'
import { SevPill } from './parts'

export function Indicators({ alerts, now }: { alerts: SfAlert[]; now: number | null }) {
  const { dict } = useI18n()
  const t = dict.v2.detectionView
  const [intel, setIntel] = useState<IntelPayload | null>(null)
  const [failed, setFailed] = useState(false)
  const [q, setQ] = useState('')

  useEffect(() => {
    let alive = true
    const read = () =>
      void fetchIntel().then((res) => {
        if (!alive) return
        setIntel(res.ok ? res.data : null)
        setFailed(!res.ok)
      })
    read()
    const id = window.setInterval(read, 60_000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return intelAlerts(alerts, 100).filter(
      (a) => !needle || [a.summary, a.host, a.rule_id, a.network?.destination_ip ?? '', a.network?.domain ?? '', ...Object.values(a.attributes ?? {})].join(' ').toLowerCase().includes(needle),
    )
  }, [alerts, q])

  const ago = (iso: string) => (now === null ? '' : dict.v2.hostsView.ago(formatDuration(Math.max(0, (now - Date.parse(iso)) / 1000))))
  // an engine without lists answers null for them (a nil slice in Go)
  const lists = intel?.enabled ? (intel.lists ?? []) : []

  return (
    <div className="v2-intel">
      <section aria-labelledby="v2-intel-lists" className="v2-intel-lists">
        <h2 id="v2-intel-lists">{t.intelTitle}</h2>
        <p className="v2-small v2-dim">{t.intelHint}</p>
        {failed ? (
          <Empty title={dict.intel.notFound} />
        ) : !intel ? null : !intel.enabled ? (
          <Empty title={t.intelOff}>{t.intelOffHint}</Empty>
        ) : lists.length === 0 ? (
          <Empty title={t.intelEmpty}>{t.intelEmptyHint(intel.dir)}</Empty>
        ) : (
          <ul>
            {lists.map((l) => (
              <li key={l.name} className="v2-intel-list">
                <div>
                  <strong>{l.name}</strong>
                  <span className="v2-mono v2-dim">{l.file}</span>
                </div>
                <b className="v2-mono">{t.intelList(l.indicators)}</b>
                <div className="v2-intel-kinds">
                  {kindBreakdown({ by_kind: l.by_kind ?? {} }, dict.intel.kindLabels).map((k) => (
                    <span key={k.kind} className="v2-tag">
                      {k.label} <span className="v2-mono">{k.count}</span>
                    </span>
                  ))}
                </div>
                <span className="v2-small v2-dim">
                  {l.modified && t.intelModified(ago(l.modified))}
                  {l.skipped > 0 && ` · ${t.intelSkipped(l.skipped)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {intel?.baseline?.enabled && (
          <p className="v2-small v2-dim">{t.intelBaseline(intel.baseline.hosts, intel.baseline.learning, learnText(intel.baseline.learn_s, dict.intel.units))}</p>
        )}
      </section>

      <section aria-labelledby="v2-intel-matches" className="v2-intel-matches">
        <h2 id="v2-intel-matches">{t.intelMatches}</h2>
        <label className="v2-search">
          <MagnifyingGlass aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.intelSearch} aria-label={t.intelSearch} />
        </label>
        {matches.length === 0 ? (
          <p className="v2-small v2-dim">{t.intelNoMatches}</p>
        ) : (
          <ul>
            {matches.map((a) => {
              const list = listOfAlert(a)
              return (
                <li key={alertKey(a)}>
                  <SevPill sev={a.severity} />
                  <div>
                    <a className="v2-link" href={v2AlertLink(alertKey(a))}>
                      {a.summary || a.rule_name}
                    </a>
                    <span className="v2-small v2-dim">
                      {a.host} · {list ? dict.intel.listTag(list) : dict.intel.baselineTag} · <time dateTime={a.timestamp}>{ago(a.timestamp)}</time>
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
