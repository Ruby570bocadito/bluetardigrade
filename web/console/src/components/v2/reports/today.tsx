'use client'

// Informes · Hoy frente a la semana: the last 24 hours against the daily
// average of the last 7 and 30 days, from the same engine reports over
// the three windows. Counts are divided by their days; mean times compare
// as they are; distinct hosts are shown, never averaged. What is unusual
// today is said in one line per rule.
import { useI18n } from '@/components/console/i18n-provider'
import type { ExecutiveReport, SocActivityReport } from '@/lib/reports'
import { formatDuration } from '@/lib/fleet'
import { v2RuleLink } from '@/lib/v2/detection-model'
import { compareToday, fillDays, unusualRules, type Comparison } from '@/lib/v2/reports-model'
import { ReportStatus, SourceLine, useReport } from './parts'

export function Today() {
  const { dict, lang } = useI18n()
  const t = dict.v2.reportsView
  const e24 = useReport<ExecutiveReport>({ kind: 'executive', window: '24h' })
  const e7 = useReport<ExecutiveReport>({ kind: 'executive', window: '7d' })
  const e30 = useReport<ExecutiveReport>({ kind: 'executive', window: '30d' })
  const s24 = useReport<SocActivityReport>({ kind: 'soc', window: '24h' })
  const s7 = useReport<SocActivityReport>({ kind: 'soc', window: '7d' })
  const s30 = useReport<SocActivityReport>({ kind: 'soc', window: '30d' })
  const ex24 = e24?.status === 'ok' ? e24.data : null
  const ex7 = e7?.status === 'ok' ? e7.data : null
  const ex30 = e30?.status === 'ok' ? e30.data : null
  const so24 = s24?.status === 'ok' ? s24.data : null
  const so7 = s7?.status === 'ok' ? s7.data : null
  const so30 = s30?.status === 'ok' ? s30.data : null

  if (!ex24) return <ReportStatus state={e24} />

  const rows = compareToday(ex24, ex7, ex30, so24, so7, so30)
  const unusual = unusualRules(ex24, ex7)
  const num = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 })
  const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)} %`
  const value = (r: Comparison, v: number | null) => (v === null ? '—' : r.kind === 'time' ? formatDuration(v) : num.format(v))
  const spark = so30 ? fillDays(so30, 30) : []
  const peak = Math.max(1, ...spark.map((d) => d.created))

  return (
    <div className="v2-today">
      <div className="v2-rep-head">
        <div>
          <h2>{t.tdTitle}</h2>
          <p className="v2-small v2-dim">{t.tdHint}</p>
          <SourceLine env={ex24} />
        </div>
      </div>
      <div className="v2-today-grid">
        {rows.map((r, i) => {
          // more alerts or slower answers are worse; fewer or faster, better
          const tone = r.delta7 === null || Math.round(r.delta7) === 0 ? 'none' : r.delta7 > 0 ? 'worse' : 'better'
          return (
            <section key={r.key} className="v2-today-card" style={{ ['--i' as string]: i }} aria-label={t.tdMetrics[r.key]}>
              <span className="v2-eyebrow">{t.tdMetrics[r.key]}</span>
              <b className="v2-mono">{value(r, r.today)}</b>
              {r.key === 'hosts' ? (
                <span className="v2-small v2-dim">{t.tdHostsNote(ex7?.hosts_affected ?? 0, ex30?.hosts_affected ?? 0)}</span>
              ) : (
                <>
                  <span className="v2-today-delta" data-tone={tone}>
                    {r.delta7 === null ? t.tdNoBase : tone === 'none' ? t.tdVs(pct(r.delta7), 7) : `${t.tdVs(pct(r.delta7), 7)} · ${tone === 'worse' ? t.tdWorse : t.tdBetter}`}
                  </span>
                  <span className="v2-small v2-dim">
                    {t.tdAvg(7, value(r, r.avg7))} · {t.tdAvg(30, value(r, r.avg30))}
                  </span>
                </>
              )}
              {r.key === 'alerts' && spark.length > 0 && (
                <span className="v2-spark v2-today-spark" role="img" aria-label={`${t.tdSpark}: ${spark.map((d) => d.created).join(', ')}`}>
                  {spark.map((d) => (
                    <i key={d.day} style={{ ['--h' as string]: `${(d.created / peak) * 100}%` }} data-zero={d.created === 0} />
                  ))}
                </span>
              )}
            </section>
          )
        })}
      </div>
      <section className="v2-rep-block" aria-labelledby="v2-today-unusual">
        <h3 id="v2-today-unusual" className="v2-eyebrow">
          {t.tdUnusual}
        </h3>
        {unusual.length === 0 ? (
          <p className="v2-small v2-dim">{t.tdNothing}</p>
        ) : (
          <ul className="v2-plainlist">
            {unusual.map((u) => (
              <li key={u.rule_id}>
                <a className="v2-link" href={v2RuleLink(u.rule_id)}>
                  {u.rule_name || u.rule_id}
                </a>
                <span className="v2-small v2-dim"> · {t.tdUnusualRule(u.today, num.format(u.avg7))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
