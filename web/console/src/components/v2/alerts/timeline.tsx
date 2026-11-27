'use client'

// The last hour of the queue at a glance: one dot per alert on a line
// that runs from an hour ago to now. As time passes the dots drift left;
// a new alert appears at the right end. A dot opens its alert.
import { useI18n } from '@/components/console/i18n-provider'
import { formatTime, type SfAlert } from '@/lib/console-types'
import { timelineDots } from '@/lib/v2/alerts-model'
import { SEV_COLOR } from '../home/parts'
import { useNow } from '../use-now'

export function Timeline({ alerts, selectedKey, onSelect }: { alerts: SfAlert[]; selectedKey: string | null; onSelect: (key: string) => void }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.alertsView.timeline
  const now = useNow(10_000)
  if (now === null) return null
  const { dots, older } = timelineDots(alerts, now)

  return (
    <section className="v2-timeline" aria-label={t.aria(dots.length)}>
      <div className="v2-timeline-head">
        <h3>{t.title}</h3>
        {older > 0 && <span className="v2-dim">{t.older(older)}</span>}
      </div>
      <div className="v2-timeline-track">
        {[0, 0.25, 0.5, 0.75, 1].map((x) => (
          <i key={x} className="v2-timeline-grid" style={{ left: `${x * 100}%` }} aria-hidden="true" />
        ))}
        {dots.map((d) => (
          <button
            key={d.key}
            type="button"
            className="v2-timeline-dot"
            data-selected={d.key === selectedKey}
            style={{ left: `${d.x * 100}%`, ['--c' as string]: SEV_COLOR[d.severity] }}
            aria-label={t.dotAria(dict.v2.sev[d.severity], d.rule, d.host, formatTime(d.at, lang))}
            title={`${formatTime(d.at, lang)} · ${d.rule} · ${d.host}`}
            onClick={() => onSelect(d.key)}
          />
        ))}
      </div>
      <div className="v2-timeline-ticks v2-mono" aria-hidden="true">
        {t.ticks.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </section>
  )
}
