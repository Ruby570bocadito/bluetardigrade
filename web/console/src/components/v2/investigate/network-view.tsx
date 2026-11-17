'use client'

// Outbound connections and beacons (boceto 8): connections grouped by
// host, process and destination, with their cadence measured over the
// latest session. A destination reached at a steady rhythm is marked
// Regular by the same rule as the engine's beacons, and a beacon the
// engine already alerted on says so. Picking one draws its connections
// on a strip, with the gaps measured.
import { useMemo, useState } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { formatDateTime, type SfAlert, type SfEvent } from '@/lib/console-types'
import { publicIPv4s } from '@/lib/geo/ip'
import { networkFlows, type Flow, type QueryToken } from '@/lib/v2/investigate-model'
import { Empty, SEV_COLOR } from '../home/parts'
import { useGeo } from '../use-geo'
import { formatGap } from './parts'

const STRIP = 32

function percent(cv: number, lang: 'es' | 'en'): string {
  const p = cv * 100
  return `${p < 10 ? p.toFixed(1).replace('.', lang === 'es' ? ',' : '.') : Math.round(p)} %`
}

function Cadence({ flow }: { flow: Flow }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.investigateView
  if (flow.meanMs === undefined) return <span className="v2-dim">—</span>
  return (
    <span className="v2-cadence">
      <span className="v2-mono">{t.every(formatGap(flow.meanMs, lang))}</span>
      {flow.cv !== undefined && <span className="v2-dim v2-small">{t.jitter(percent(flow.cv, lang))}</span>}
    </span>
  )
}

function FlowPanel({ flow, onPivot }: { flow: Flow; onPivot: (token: QueryToken) => void }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.investigateView
  const times = flow.session.slice(-STRIP)
  const from = times[0]
  const width = Math.max(1, times[times.length - 1] - from)
  const x = (ms: number) => ((ms - from) / width) * 100
  return (
    <div className="v2-beacon">
      <div className="v2-beacon-head">
        <strong className="v2-mono">{flow.dst}</strong>
        <span className="v2-dim v2-small v2-mono">
          {flow.process || '—'} · {flow.host}
        </span>
        {flow.alert && (
          <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[flow.alert.severity] }} title={flow.alert.summary}>
            {t.engineBeacon}
          </span>
        )}
        <button type="button" className="v2-btn v2-beacon-search" onClick={() => onPivot(flow.token)}>
          <MagnifyingGlass aria-hidden="true" />
          {t.searchDst}
        </button>
      </div>
      {times.length > 1 ? (
        <>
          <div className="v2-beacon-sub">
            <span>{t.beaconTitle}</span>
            <span className="v2-dim v2-small">
              {t.lastSession(flow.session.length)} · {t.beaconHint(times.length)}
            </span>
          </div>
          <div className="v2-beacon-strip" key={flow.key} aria-hidden="true">
            {times.slice(1).map((ms, i) =>
              i < 6 ? (
                <span key={`g${i}`} className="v2-beacon-gap" style={{ left: `${x(times[i])}%`, width: `${x(ms) - x(times[i])}%`, ['--i' as string]: i }}>
                  <b className="v2-mono">{formatGap(ms - times[i], lang)}</b>
                </span>
              ) : null,
            )}
            {times.map((ms, i) => (
              <span key={i} className="v2-beacon-tick" style={{ left: `${x(ms)}%`, ['--i' as string]: i }} />
            ))}
          </div>
          <div className="v2-beacon-axis v2-mono v2-dim" aria-hidden="true">
            <span>{formatDateTime(new Date(from).toISOString(), lang)}</span>
            <span>{formatDateTime(new Date(times[times.length - 1]).toISOString(), lang)}</span>
          </div>
        </>
      ) : null}
      <p className="v2-dim v2-small">{t.beaconRule}</p>
    </div>
  )
}

export function NetworkView({
  events,
  alerts,
  onPivot,
}: {
  events: readonly SfEvent[]
  alerts: readonly SfAlert[]
  onPivot: (token: QueryToken) => void
}) {
  const { dict } = useI18n()
  const t = dict.v2.investigateView
  const flows = useMemo(() => networkFlows(events, alerts), [events, alerts])
  const [picked, setPicked] = useState<string | null>(null)
  const geo = useGeo(publicIPv4s(flows.map((f) => f.dst.split(':')[0])))
  const current = flows.find((f) => f.key === picked) ?? flows[0] ?? null

  if (flows.length === 0) return <Empty title={t.netEmpty} />

  return (
    <div className="v2-net">
      <div className="v2-table-wrap">
        <table className="v2-net-table">
          <thead>
            <tr>
              <th scope="col">{t.netCols.dst}</th>
              <th scope="col">{t.netCols.process}</th>
              <th scope="col">{t.netCols.host}</th>
              <th scope="col">{t.netCols.count}</th>
              <th scope="col">{t.netCols.cadence}</th>
            </tr>
          </thead>
          <tbody>
            {flows.slice(0, 200).map((f) => {
              const country = geo[f.dst.split(':')[0]]?.country
              return (
                <tr
                  key={f.key}
                  tabIndex={0}
                  aria-selected={current?.key === f.key}
                  data-regular={f.regular}
                  onClick={() => setPicked(f.key)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setPicked(f.key)
                  }}
                >
                  <td className="v2-mono">
                    {f.dst}
                    {country && <span className="v2-tag v2-net-cc">{country}</span>}
                  </td>
                  <td className="v2-mono">{f.process || '—'}</td>
                  <td className="v2-mono">{f.host}</td>
                  <td className="v2-mono">{f.count}</td>
                  <td>
                    <span className="v2-net-cadence">
                      <Cadence flow={f} />
                      {f.alert ? (
                        <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[f.alert.severity] }}>
                          {t.engineBeacon}
                        </span>
                      ) : f.regular ? (
                        <span className="v2-tag v2-tag-match">{t.regular}</span>
                      ) : null}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {current ? <FlowPanel flow={current} onPivot={onPivot} /> : <p className="v2-dim v2-small">{t.pickFlow}</p>}
    </div>
  )
}
