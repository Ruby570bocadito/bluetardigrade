'use client'

// Everything one host did, on a time axis (boceto 4): one lane per kind
// of event and one for its alerts, an overview strip on top where a range
// is brushed with the pointer, and the lanes gliding into that range. The
// events of the range are listed below, newest first.
import { useMemo, useRef, useState } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import { formatTime, type SfAlert, type SfEvent } from '@/lib/console-types'
import { EVENT_KINDS, eventTarget, kindOf, matchEvent, parentIndex, timeSpan, type QueryToken } from '@/lib/v2/investigate-model'
import { Empty, SEV_COLOR } from '../home/parts'
import { HistStrip, KindChip } from './parts'

const LIST = 200

export function HostTimeline({
  events,
  alerts,
  host,
  tokens,
  selectedId,
  onSelect,
}: {
  events: readonly SfEvent[]
  alerts: readonly SfAlert[]
  host: string
  tokens: readonly QueryToken[]
  selectedId: string | null
  onSelect: (ev: SfEvent) => void
}) {
  const { dict, lang } = useI18n()
  const t = dict.v2.investigateView
  const own = useMemo(() => alerts.filter((a) => a.host.toLowerCase() === host.toLowerCase()), [alerts, host])
  const span = useMemo(() => timeSpan(events), [events])
  const [range, setRange] = useState<[number, number] | null>(null)
  const [drag, setDrag] = useState<[number, number] | null>(null)
  const strip = useRef<HTMLDivElement>(null)
  const parents = useMemo(() => parentIndex(events), [events])
  const marks = tokens.filter((x) => x.field !== 'host')

  if (!span) return <Empty title={t.treeEmpty} />
  const [from, to] = range ?? [span.from, span.to]
  const width = Math.max(1, to - from)
  const pos = (iso: string) => ((Date.parse(iso) - from) / width) * 100
  const kinds = EVENT_KINDS.filter((k) => events.some((e) => kindOf(e) === k))
  const inRange = events.filter((e) => {
    const x = Date.parse(e.timestamp)
    return x >= from && x <= to
  })
  const hot = marks.length ? events.filter((e) => matchEvent(e, marks, parents)) : undefined

  // pointer fraction of the overview strip -> time
  const at = (clientX: number) => {
    const r = strip.current?.getBoundingClientRect()
    if (!r) return span.from
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    return span.from + f * (span.to - span.from)
  }
  const overview = (x: number) => ((x - span.from) / Math.max(1, span.to - span.from)) * 100

  return (
    <div className="v2-tl">
      <div className="v2-tl-head">
        <span className="v2-dim v2-small">{t.brushHint}</span>
        {range && (
          <button type="button" className="v2-btn" onClick={() => setRange(null)}>
            {t.resetZoom}
          </button>
        )}
      </div>
      <div
        ref={strip}
        className="v2-tl-overview"
        onPointerDown={(e) => {
          ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
          const x = at(e.clientX)
          setDrag([x, x])
        }}
        onPointerMove={(e) => drag && setDrag([drag[0], at(e.clientX)])}
        onPointerUp={() => {
          if (drag) {
            const [a, b] = [Math.min(...drag), Math.max(...drag)]
            if (b - a > (span.to - span.from) / 200) setRange([a, b])
          }
          setDrag(null)
        }}
        onPointerCancel={() => setDrag(null)}
      >
        <HistStrip events={events} from={span.from} to={span.to} buckets={80} hot={hot}>
          {(drag || range) && (
            <i
              className="v2-tl-brush"
              aria-hidden="true"
              style={{
                left: `${overview(Math.min(...(drag ?? range!)))}%`,
                width: `${Math.max(0.4, overview(Math.max(...(drag ?? range!))) - overview(Math.min(...(drag ?? range!))))}%`,
              }}
            />
          )}
        </HistStrip>
      </div>

      <div className="v2-tl-lanes" role="img" aria-label={t.timelineAria(host)}>
        {own.length > 0 && (
          <div className="v2-tl-lane" data-lane="alerts">
            <span className="v2-tl-label">{t.alertsLane}</span>
            <div className="v2-tl-track">
              {own.map((a) => {
                const x = pos(a.timestamp)
                return (
                  <span
                    key={a.id ?? `${a.timestamp}-${a.rule_id}`}
                    className="v2-tl-alert"
                    data-out={x < 0 || x > 100}
                    title={`${formatTime(a.timestamp, lang)} · ${a.rule_name}`}
                    style={{ left: `${x}%`, ['--c' as string]: SEV_COLOR[a.severity] }}
                  />
                )
              })}
            </div>
          </div>
        )}
        {kinds.map((k) => (
          <div key={k} className="v2-tl-lane" data-kind={k}>
            <span className="v2-tl-label">{t.kinds[k]}</span>
            <div className="v2-tl-track">
              {events
                .filter((e) => kindOf(e) === k)
                .map((e) => {
                  const x = pos(e.timestamp)
                  return (
                    <span
                      key={e.id}
                      className="v2-tl-tick"
                      data-out={x < 0 || x > 100}
                      data-match={!!hot && matchEvent(e, marks, parents)}
                      data-selected={e.id === selectedId}
                      title={`${formatTime(e.timestamp, lang)} · ${eventTarget(e) || e.type}`}
                      style={{ left: `${x}%` }}
                      onClick={() => onSelect(e)}
                    />
                  )
                })}
            </div>
          </div>
        ))}
        <div className="v2-tl-axis v2-mono" aria-hidden="true">
          <span>{formatTime(new Date(from).toISOString(), lang)}</span>
          <span>{formatTime(new Date(from + width / 2).toISOString(), lang)}</span>
          <span>{formatTime(new Date(to).toISOString(), lang)}</span>
        </div>
      </div>

      <p className="v2-dim v2-small">{t.inRange(inRange.length)}</p>
      <ul className="v2-tl-list">
        {inRange.slice(0, LIST).map((e) => (
          <li key={e.id} data-selected={e.id === selectedId}>
            <button type="button" onClick={() => onSelect(e)}>
              <span className="v2-mono v2-dim">{formatTime(e.timestamp, lang)}</span>
              <KindChip ev={e} />
              <span className="v2-mono v2-tl-what">{eventTarget(e) || e.type}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
