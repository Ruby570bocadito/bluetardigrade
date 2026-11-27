'use client'

// Detección · Ruido: what makes the most noise in a period, fleet-wide or
// on one machine — the rules with the most alerts (with how many of them
// were closed), the processes with the most events and the most queried
// domains. Counted by the engine; a loud rule can be silenced from here.
import { useEffect, useState } from 'react'
import { SpeakerSlash } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { fetchNoise, NOISE_WINDOWS, type NoiseReport, type NoiseWindow } from '@/lib/noise'
import { Empty } from '../home/parts'

const base = (path: string) => path.split(/[\\/]/).pop() || path

export function Noise({
  hosts,
  ruleIds,
  canWrite,
  onOpen,
  onSuppress,
}: {
  hosts: string[]
  ruleIds: Set<string>
  canWrite: boolean
  onOpen: (id: string) => void
  onSuppress: (ruleId: string, host: string, name: string) => void
}) {
  const { dict } = useI18n()
  const t = dict.v2.detectionView
  const [win, setWin] = useState<NoiseWindow>('24h')
  const [host, setHost] = useState('')
  const [report, setReport] = useState<NoiseReport | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    void fetchNoise(win, host, 10).then((res) => {
      if (!alive) return
      setLoading(false)
      if (res.ok) {
        setReport(res.data)
        setError('')
      } else {
        setReport(null)
        setError(res.error)
      }
    })
    return () => {
      alive = false
    }
  }, [win, host])

  const maxRule = Math.max(1, ...(report?.rules ?? []).map((r) => r.count))
  const maxProc = Math.max(1, ...(report?.processes ?? []).map((r) => r.count))
  const maxDom = Math.max(1, ...(report?.domains ?? []).map((r) => r.count))

  return (
    <div className="v2-noise" aria-busy={loading}>
      <div className="v2-det-filters">
        <h2 className="v2-noise-title">{t.noiseTitle}</h2>
        <div className="v2-seg" role="group" aria-label={t.noiseWindow}>
          {NOISE_WINDOWS.map((w) => (
            <button key={w} type="button" aria-pressed={w === win} onClick={() => setWin(w)}>
              {w}
            </button>
          ))}
        </div>
        <label className="v2-select">
          <span className="v2-sr-only">{t.noiseHost}</span>
          <select value={host} onChange={(e) => setHost(e.target.value)}>
            <option value="">{t.noiseAllHosts}</option>
            {hosts.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <Empty title={t.noiseError(error)} />
      ) : !report ? null : (
        <>
          <p className="v2-small v2-dim">{t.noiseSource(report.source, report.scanned.events, report.scanned.alerts, report.scanned.truncated)}</p>
          <div className="v2-noise-grid">
            <section aria-labelledby="v2-noise-rules" className="v2-noise-block v2-noise-rules">
              <h3 id="v2-noise-rules" className="v2-eyebrow">
                {t.noiseRules}
              </h3>
              {report.rules.length === 0 ? (
                <p className="v2-small v2-dim">{t.noiseEmpty}</p>
              ) : (
                <ol>
                  {report.rules.map((r) => (
                    <li key={r.rule_id}>
                      <div className="v2-noise-line">
                        {ruleIds.has(r.rule_id) ? (
                          <button type="button" className="v2-link" onClick={() => onOpen(r.rule_id)}>
                            {r.rule_name || r.rule_id}
                          </button>
                        ) : (
                          <span>{r.rule_name || r.rule_id}</span>
                        )}
                        <b className="v2-mono">{r.count}</b>
                      </div>
                      <i className="v2-noise-bar" aria-hidden="true">
                        <b style={{ ['--w' as string]: `${(r.count / maxRule) * 100}%` }} />
                      </i>
                      <div className="v2-noise-meta v2-small v2-dim">
                        <span>{t.noiseHosts(r.distinct_hosts)}</span>
                        <span>{t.noiseClosed(Math.round(r.closed_pct))}</span>
                        {canWrite && (
                          <button type="button" className="v2-link" onClick={() => onSuppress(r.rule_id, report.host, r.rule_name)}>
                            <SpeakerSlash aria-hidden="true" />
                            {t.noiseSuppress}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section aria-labelledby="v2-noise-procs" className="v2-noise-block">
              <h3 id="v2-noise-procs" className="v2-eyebrow">
                {t.noiseProcesses}
              </h3>
              {report.processes.length === 0 ? (
                <p className="v2-small v2-dim">{t.noiseEmpty}</p>
              ) : (
                <ol>
                  {report.processes.map((p) => (
                    <li key={p.image}>
                      <div className="v2-noise-line">
                        <span title={p.image}>
                          <strong>{base(p.image)}</strong>
                          {p.parent && <span className="v2-dim"> ← {base(p.parent)}</span>}
                        </span>
                        <b className="v2-mono">{p.count}</b>
                      </div>
                      <i className="v2-noise-bar" aria-hidden="true">
                        <b style={{ ['--w' as string]: `${(p.count / maxProc) * 100}%` }} />
                      </i>
                      <div className="v2-noise-meta v2-small v2-dim">
                        <span className="v2-mono v2-noise-path">{p.image}</span>
                        <span>{t.noiseHosts(p.distinct_hosts)}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section aria-labelledby="v2-noise-doms" className="v2-noise-block">
              <h3 id="v2-noise-doms" className="v2-eyebrow">
                {t.noiseDomains}
              </h3>
              {report.domains.length === 0 ? (
                <p className="v2-small v2-dim">{t.noiseEmpty}</p>
              ) : (
                <ol>
                  {report.domains.map((d) => (
                    <li key={d.domain}>
                      <div className="v2-noise-line">
                        <span className="v2-mono">{d.domain}</span>
                        <b className="v2-mono">{d.count}</b>
                      </div>
                      <i className="v2-noise-bar" aria-hidden="true">
                        <b style={{ ['--w' as string]: `${(d.count / maxDom) * 100}%` }} />
                      </i>
                      <div className="v2-noise-meta v2-small v2-dim">
                        <span>{t.noiseHosts(d.distinct_hosts)}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
