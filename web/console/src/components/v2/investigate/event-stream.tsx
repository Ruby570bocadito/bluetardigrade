'use client'

// The live stream (boceto 1): the events that match the query, newest on
// top, with one chip per kind of event and how many there are, a pause
// that freezes the list and counts what keeps arriving, and the export
// of exactly what is shown.
import { useMemo, useState } from 'react'
import { Pause, Play } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { formatTime, type SfEvent } from '@/lib/console-types'
import { EVENT_KINDS, eventTarget, filterEvents, kindOf, kindWord, type EventKind, type QueryToken } from '@/lib/v2/investigate-model'
import { Empty } from '../home/parts'
import { useFreshKeys } from '../alerts/queue-table'
import { useMedia } from '../use-media'
import { download, eventsCsv, eventsJsonl, KIND_WORD, KindChip, stamp } from './parts'
import type { Investigation } from './use-investigation'

const PAGE = 150

/** The kind a type token selects, when the query has exactly one. */
function activeKind(tokens: readonly QueryToken[]): EventKind | null {
  const types = tokens.filter((t) => t.field === 'type' && !t.negate)
  return types.length === 1 ? kindWord(types[0].value) : null
}

export function EventStream({
  inv,
  tokens,
  onTokens,
  live,
  selectedId,
  onSelect,
}: {
  inv: Investigation
  tokens: QueryToken[]
  onTokens: (tokens: QueryToken[]) => void
  live: boolean
  selectedId: string | null
  onSelect: (ev: SfEvent) => void
}) {
  const { dict, lang } = useI18n()
  const t = dict.v2.investigateView
  const narrow = useMedia('(max-width: 720px)')
  const [limit, setLimit] = useState(PAGE)

  // the chips count under the rest of the query, as the alert chips do
  const counts = useMemo(() => {
    const rest = tokens.filter((x) => x.field !== 'type')
    const c = Object.fromEntries(EVENT_KINDS.map((k) => [k, 0])) as Record<EventKind, number>
    let all = 0
    for (const ev of filterEvents(inv.base, rest)) {
      c[kindOf(ev)]++
      all++
    }
    return { ...c, all }
  }, [inv.base, tokens])
  const kind = activeKind(tokens)

  const pickKind = (k: EventKind | null) => {
    const rest = tokens.filter((x) => x.field !== 'type')
    onTokens(k ? [...rest, { field: 'type', value: KIND_WORD[lang][k], negate: false }] : rest)
  }

  const shown = inv.events.slice(0, limit)
  const fresh = useFreshKeys(live && !inv.paused ? shown.map((e) => e.id) : [])

  return (
    <div className="v2-stream">
      <div className="v2-stream-bar">
        <div className="v2-chips" role="group" aria-label={t.kindAria}>
          <button type="button" className="v2-chip-btn" aria-pressed={kind === null && !tokens.some((x) => x.field === 'type')} onClick={() => pickKind(null)}>
            {t.kindAll} <b key={counts.all} className="v2-tick">{counts.all}</b>
          </button>
          {EVENT_KINDS.filter((k) => counts[k] > 0 || kind === k).map((k) => (
            <button key={k} type="button" className="v2-chip-btn" data-kind={k} aria-pressed={kind === k} onClick={() => pickKind(kind === k ? null : k)}>
              <i aria-hidden="true" />
              {t.kinds[k]} <b key={counts[k]} className="v2-tick">{counts[k]}</b>
            </button>
          ))}
        </div>
        <div className="v2-actions">
          {live && (
            <button type="button" className="v2-btn" aria-pressed={inv.paused} onClick={() => inv.setPaused(!inv.paused)}>
              {inv.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
              {inv.paused ? t.resume : t.pause}
            </button>
          )}
          <div className="v2-seg" role="group" aria-label={t.exportAria}>
            <button type="button" disabled={inv.events.length === 0} onClick={() => download(`eventos-${stamp()}.csv`, eventsCsv(inv.events), 'text/csv;charset=utf-8')}>
              {t.exportCsv}
            </button>
            <button type="button" disabled={inv.events.length === 0} onClick={() => download(`eventos-${stamp()}.jsonl`, eventsJsonl(inv.events), 'application/x-ndjson')}>
              {t.exportJsonl}
            </button>
          </div>
        </div>
      </div>

      {inv.paused && (
        <div className="v2-paused" role="status">
          <span key={inv.waiting} className="v2-tick">
            {t.paused(inv.waiting)}
          </span>
          <button type="button" className="v2-link" onClick={() => inv.setPaused(false)}>
            {t.resume}
          </button>
        </div>
      )}

      {inv.events.length === 0 ? (
        tokens.length === 0 && live ? (
          <Empty title={t.emptyLive}>{t.emptyLiveHint}</Empty>
        ) : (
          <Empty title={t.emptyQuery}>{t.emptyQueryHint}</Empty>
        )
      ) : narrow ? (
        <ul className="v2-ev-list" aria-label={t.streamAria}>
          {shown.map((ev) => (
            <li key={ev.id} data-fresh={fresh.has(ev.id)} data-selected={ev.id === selectedId}>
              <button type="button" onClick={() => onSelect(ev)}>
                <span className="v2-ev-top">
                  <KindChip ev={ev} />
                  <span className="v2-mono v2-dim">{formatTime(ev.timestamp, lang)}</span>
                  <span className="v2-mono v2-dim">{ev.host}</span>
                </span>
                <span className="v2-ev-what v2-mono">{eventTarget(ev) || ev.type}</span>
                {ev.process && <span className="v2-dim v2-small">{ev.process.name}{ev.user ? ` · ${ev.user}` : ''}</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="v2-table-wrap">
          <table className="v2-ev-table" aria-label={t.streamAria}>
            <thead>
              <tr>
                <th scope="col">{t.cols.time}</th>
                <th scope="col">{t.cols.host}</th>
                <th scope="col">{t.cols.type}</th>
                <th scope="col">{t.cols.what}</th>
                <th scope="col">{t.cols.process}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((ev) => (
                <tr
                  key={ev.id}
                  tabIndex={0}
                  aria-selected={ev.id === selectedId}
                  data-fresh={fresh.has(ev.id)}
                  onClick={() => onSelect(ev)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelect(ev)
                    }
                  }}
                >
                  <td className="v2-mono v2-dim">{formatTime(ev.timestamp, lang)}</td>
                  <td className="v2-mono">{ev.host}</td>
                  <td>
                    <KindChip ev={ev} />
                  </td>
                  <td className="v2-mono v2-ev-what" title={eventTarget(ev)}>
                    {eventTarget(ev) || ev.type}
                  </td>
                  <td className="v2-mono" title={ev.user ? `${ev.process?.name ?? ''} · ${ev.user}` : undefined}>
                    {ev.process?.name ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {inv.events.length > limit && (
        <button type="button" className="v2-btn v2-more" onClick={() => setLimit((l) => l + PAGE)}>
          {t.showMore(Math.min(PAGE, inv.events.length - limit))}
        </button>
      )}
    </div>
  )
}
