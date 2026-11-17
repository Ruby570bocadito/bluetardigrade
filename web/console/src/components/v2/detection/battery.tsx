'use client'

// Detección · Validación: the lab attack scenarios replayed against the
// engine (synthetic LAB-SIM hosts, inert telemetry) to check that the
// rules still catch them. The detection rate of the latest runs, the
// outcome of each scenario and, for the missed ones, which rule fell
// short. Without -scenarios the engine says how to arm it.
import { useCallback, useEffect, useState } from 'react'
import { Play } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import {
  fetchScenarioRun,
  fetchScenarioRuns,
  fetchScenarioSurface,
  launchScenarioRun,
  passRatePercent,
  type ScenarioResultStatus,
  type ScenarioRun,
  type ScenarioSurface,
} from '@/lib/simulation'
import { Empty } from '../home/parts'

const STATUS_ORDER: Record<ScenarioResultStatus, number> = { missing: 0, error: 1, catalog: 2, detected: 3 }

export function Battery({ canRun, onNotice }: { canRun: boolean; onNotice: (message: string) => void }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.detectionView
  const [surface, setSurface] = useState<ScenarioSurface | null>(null)
  const [runs, setRuns] = useState<ScenarioRun[]>([])
  const [current, setCurrent] = useState<ScenarioRun | null>(null)
  const [busy, setBusy] = useState(false)

  const readRuns = useCallback(async () => {
    const res = await fetchScenarioRuns(20)
    if (!res.ok) return
    setRuns(res.data.runs)
    const last = res.data.runs[0]
    if (last) {
      const detail = await fetchScenarioRun(last.run_id)
      if (detail.ok) setCurrent(detail.data)
    }
  }, [])

  useEffect(() => {
    let alive = true
    void fetchScenarioSurface().then((s) => {
      if (!alive) return
      setSurface(s)
      if (s.state === 'armed') void readRuns()
    })
    return () => {
      alive = false
    }
  }, [readRuns])

  // a run in progress is followed until it completes
  useEffect(() => {
    if (!current || current.status !== 'running') return undefined
    const id = window.setInterval(() => {
      void fetchScenarioRun(current.run_id).then((res) => {
        if (!res.ok) return
        setCurrent(res.data)
        if (res.data.status === 'completed') void readRuns()
      })
    }, 2000)
    return () => window.clearInterval(id)
  }, [current, readRuns])

  async function launch() {
    setBusy(true)
    const res = await launchScenarioRun()
    setBusy(false)
    if (!res.ok) return onNotice(t.valError(res.error))
    setCurrent(res.data)
  }

  if (!surface) return null
  if (surface.state === 'unavailable') return <Empty title={t.valUnavailable} />
  if (surface.state === 'unarmed') return <Empty title={t.valUnarmed}>{t.valUnarmedHint}</Empty>

  const lib = surface.library
  const trend = [...runs].reverse()
  const running = current?.status === 'running'
  // what fell short first: a missed scenario is the reason to open this page
  const results = [...(current?.results ?? [])].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name))
  const fmt = new Intl.DateTimeFormat(lang, { dateStyle: 'short', timeStyle: 'short' })

  return (
    <div className="v2-battery">
      <header className="v2-battery-head">
        <div>
          <h2>{t.valTitle}</h2>
          <p className="v2-small v2-dim">
            {t.valHint} · {t.valScenarios(lib.count)}
          </p>
        </div>
        {canRun && (
          <button type="button" className="v2-btn v2-btn-primary" onClick={() => void launch()} disabled={busy || running}>
            <Play aria-hidden="true" />
            {running ? t.valRunning(current?.results?.length ?? 0, current?.total ?? lib.count) : t.valRun}
          </button>
        )}
      </header>

      {runs.length === 0 && !current ? (
        <>
          <p className="v2-small v2-dim">{t.valNoRuns}</p>
          <ul className="v2-battery-list">
            {lib.scenarios.map((s) => (
              <li key={s.id}>
                <strong>{s.name}</strong>
                <span className="v2-mono v2-dim">{s.attack.map((a) => a.toUpperCase()).join(' · ')}</span>
                <span className="v2-small v2-dim">{s.expected.map((e) => e.rule).join(', ')}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className="v2-battery-top">
            {current && (
              <div className="v2-battery-rate" role="status">
                <span className="v2-eyebrow">{t.valPassRate}</span>
                <b className="v2-mono">{passRatePercent(current.pass_rate)}</b>
                <span className="v2-small v2-dim">
                  {current.detected}/{current.total} · {fmt.format(new Date(current.started_at))}
                </span>
              </div>
            )}
            {trend.length > 1 && (
              <div className="v2-battery-trend">
                <span className="v2-eyebrow">{t.valTrend}</span>
                <div className="v2-weekbars" role="img" aria-label={`${t.valTrend}: ${trend.map((r) => passRatePercent(r.pass_rate)).join(', ')}`}>
                  {trend.map((r) => (
                    <div key={r.run_id} className="v2-weekbar" title={`${fmt.format(new Date(r.started_at))} · ${passRatePercent(r.pass_rate)}`}>
                      <i style={{ ['--h' as string]: `${Math.max(2, r.pass_rate * 100)}%` }} data-low={r.pass_rate < 1} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {current?.results && (
            <ul className="v2-battery-results">
              {results.map((r) => (
                <li key={r.scenario_id} data-status={r.status}>
                  <span className="v2-battery-status">{t.valStatus[r.status]}</span>
                  <div>
                    <strong>{r.name}</strong>
                    <span className="v2-mono v2-dim"> {r.attack.map((a) => a.toUpperCase()).join(' · ')}</span>
                    {r.missing?.map((m) => (
                      <p key={m.rule} className="v2-small">
                        {t.valMissing(m.rule, m.expected, m.fired)}
                      </p>
                    ))}
                    {r.detail && <p className="v2-small v2-dim">{r.detail}</p>}
                  </div>
                </li>
              ))}
              {running &&
                lib.scenarios
                  .filter((s) => !current.results?.some((r) => r.scenario_id === s.id))
                  .map((s) => (
                    <li key={s.id} data-status="pending">
                      <span className="v2-battery-status">{t.valStatus.pending}</span>
                      <div>
                        <strong>{s.name}</strong>
                      </div>
                    </li>
                  ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
