'use client'

// The last events the sensors sent, as an analyst reads a log: time,
// type, host and what happened. Newest first; the full stream lives in
// Investigar.
import { useI18n } from '@/components/console/i18n-provider'
import { eventDetail, formatTime, type SfEvent } from '@/lib/console-types'
import { v2InvestigateLink } from '@/lib/v2/investigate-model'
import { Empty, Panel } from './parts'

export function EventLog({ events }: { events: SfEvent[] }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.log
  const latest = [...events].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, 9)

  return (
    <Panel
      labelledBy="v2-log-title"
      title={t.title}
      subtitle={t.subtitle}
      action={
        <a className="v2-btn" href={v2InvestigateLink('')}>
          {t.all}
        </a>
      }
    >
      {latest.length === 0 ? (
        <Empty title={t.empty}>{t.emptySub}</Empty>
      ) : (
        <ol className="v2-log" aria-label={t.aria}>
          {latest.map((ev) => {
            const detail = eventDetail(ev, lang)
            return (
              <li key={ev.id}>
                <time className="v2-dim">{formatTime(ev.timestamp, lang)}</time>
                <span className="v2-log-type">{ev.type}</span>
                <span className="v2-log-host">{ev.host}</span>
                <span className="v2-log-detail" title={detail}>
                  {detail}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </Panel>
  )
}
