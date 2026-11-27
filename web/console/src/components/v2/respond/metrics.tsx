'use client'

// Respuesta · Métricas: how fast and how often the team answers, over what
// the console can read — the action log it loads (100 or 500 lines) and
// the engine's cases. Every number says where it comes from; one that
// cannot be computed is shown as missing, never estimated.
import { useMemo } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import type { RuleMeta, SfAlert, SfRespondRecord } from '@/lib/console-types'
import type { Incident } from '@/lib/engine-writes'
import { formatDuration } from '@/lib/fleet'
import { containStats, dailyAttempts, timeToFirstAction, topBy } from '@/lib/v2/respond-model'

function Bars({ title, rows, label }: { title: string; rows: { key: string; count: number }[]; label: (k: string) => string }) {
  const { dict } = useI18n()
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <section className="v2-met-block" aria-label={title}>
      <h3 className="v2-eyebrow">{title}</h3>
      {rows.length === 0 ? (
        <p className="v2-small v2-dim">{dict.v2.respondView.metNoData}</p>
      ) : (
        <ul className="v2-bars">
          {rows.map((r) => (
            <li key={r.key}>
              <span title={label(r.key)}>{label(r.key)}</span>
              <i aria-hidden="true">
                <b style={{ ['--w' as string]: `${(r.count / max) * 100}%` }} />
              </i>
              <span className="v2-mono">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function Metrics({
  records,
  alerts,
  incidents,
  rules,
  now,
}: {
  records: SfRespondRecord[]
  alerts: SfAlert[]
  incidents: Incident[]
  rules: RuleMeta[]
  now: number | null
}) {
  const { dict, lang } = useI18n()
  const t = dict.v2.respondView
  const at = now ?? Date.now()
  const first = useMemo(() => timeToFirstAction(records, alerts), [records, alerts])
  const days = useMemo(() => dailyAttempts(records, at, 30), [records, at])
  const cases = useMemo(() => containStats(incidents), [incidents])
  const ruleName = useMemo(() => new Map(rules.map((r) => [r.id, r.name])), [rules])
  const executed = records.filter((r) => r.decision === 'executed').length
  const denied = records.length - executed
  const peak = Math.max(1, ...days.map((d) => d.executed + d.denied))
  const dayLabel = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const dur = (s: number | null) => (s === null ? '—' : formatDuration(s))

  return (
    <div className="v2-met">
      <div>
        <h2>{t.metTitle}</h2>
        <p className="v2-small v2-dim">{t.metHint}</p>
      </div>
      <div className="v2-met-kpis">
        <div>
          <span className="v2-eyebrow">{t.metFirstAction}</span>
          <b className="v2-mono">{dur(first.median)}</b>
          <span className="v2-small">
            {t.median} · {t.p90} <span className="v2-mono">{dur(first.p90)}</span>
          </span>
          <span className="v2-small v2-dim">{t.metFirstActionNote(first.samples)}</span>
        </div>
        <div>
          <span className="v2-eyebrow">{t.metAttempts}</span>
          <b className="v2-mono">{records.length}</b>
          <span className="v2-small">
            <span className="v2-met-ok">{executed}</span> {t.decision.executed.toLowerCase()} · <span className="v2-met-no">{denied}</span> {t.decision.denied.toLowerCase()}
          </span>
          <span className="v2-small v2-dim">{t.metAttemptsNote(records.length)}</span>
        </div>
        <div>
          <span className="v2-eyebrow">{t.metCases}</span>
          <b className="v2-mono">{cases.active + cases.contained}</b>
          <span className="v2-small">{t.metCasesValue(cases.active, cases.contained)}</span>
        </div>
        <div>
          <span className="v2-eyebrow">{t.metContain}</span>
          <b className="v2-mono">{dur(cases.median)}</b>
          <span className="v2-small v2-dim">{t.metContainNote(cases.samples)}</span>
        </div>
      </div>

      <section className="v2-met-block" aria-labelledby="v2-met-daily">
        <h3 id="v2-met-daily" className="v2-eyebrow">
          {t.metDaily}
        </h3>
        <div className="v2-met-daily" role="img" aria-label={t.dailyAria(executed, denied)}>
          {days.map((d, i) => (
            <div key={d.day} className="v2-met-day" title={`${dayLabel.format(new Date(d.day))} · ${d.executed} / ${d.denied}`}>
              <span className="v2-met-stack">
                <i data-kind="denied" style={{ ['--h' as string]: `${(d.denied / peak) * 100}%` }} />
                <i data-kind="executed" style={{ ['--h' as string]: `${(d.executed / peak) * 100}%` }} />
              </span>
              <small>{i % 5 === 4 || i === days.length - 1 ? dayLabel.format(new Date(d.day)) : ''}</small>
            </div>
          ))}
        </div>
        <p className="v2-small v2-dim v2-met-legend">
          <span className="v2-met-ok">■</span> {t.decision.executed} · <span className="v2-met-no">■</span> {t.decision.denied}
        </p>
      </section>

      <div className="v2-met-grid">
        <Bars title={t.metByOperator} rows={topBy(records, 'operator')} label={(k) => k} />
        <Bars title={t.metByRule} rows={topBy(records, 'rule_id')} label={(k) => ruleName.get(k) ?? k} />
        <Bars title={t.metByHost} rows={topBy(records, 'host')} label={(k) => k} />
      </div>
    </div>
  )
}
