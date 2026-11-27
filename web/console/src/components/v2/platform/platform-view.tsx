'use client'

// v2 · Plataforma: the engine's own runtime counters (/api/stats) as one
// verdict, the path an event takes stage by stage, the detectors and
// per-host quotas against their limits, and every part of the engine in
// two balanced columns. Every figure and label comes from the engine
// through lib/platform-status; what it does not publish is named, never
// filled in. Read-only: nothing here writes to the engine.
import { useMemo } from 'react'
import { useEngine } from '@/components/console/engine-provider'
import { useI18n } from '@/components/console/i18n-provider'
import { pipelineStages, platformStatus, type Health, type StatusRow, type StatusSection } from '@/lib/platform-status'
import { balanceColumns, fillShare, publishedRows, sectionHealth, sectionsToReview, splitSections } from '@/lib/v2/platform-model'
import { Empty } from '../home/parts'

function HealthChip({ health }: { health: Health }) {
  const { dict } = useI18n()
  return (
    <span className="v2-pf-health" data-health={health}>
      <i aria-hidden="true" />
      {dict.v2.platformView.health[health]}
    </span>
  )
}

function Row({ row }: { row: StatusRow }) {
  return (
    <li className="v2-pf-row" data-tone={row.tone}>
      <span className="v2-pf-label">
        {row.label}
        {row.hint && <small className="v2-dim">{row.hint}</small>}
      </span>
      <b className="v2-mono">{row.display}</b>
      {row.fill && (
        <span className="v2-pf-meter" aria-hidden="true">
          <i style={{ ['--w' as string]: `${fillShare(row.fill)}%` }} />
        </span>
      )}
    </li>
  )
}

function Section({ section }: { section: StatusSection }) {
  const { dict } = useI18n()
  const { shown, absent } = publishedRows(section.rows)
  return (
    <section className="v2-pf-section" aria-label={section.title}>
      <header>
        <h3>{section.title}</h3>
        <HealthChip health={sectionHealth(section)} />
      </header>
      {section.hint && <p className="v2-small v2-dim">{section.hint}</p>}
      {shown.length > 0 && (
        <ul className="v2-pf-rows">
          {shown.map((r) => (
            <Row key={r.key} row={r} />
          ))}
        </ul>
      )}
      {absent.length > 0 && (
        <p className="v2-small v2-dim v2-pf-absent">
          {dict.v2.platformView.notPublished}
          {absent.join(', ')}
        </p>
      )}
    </section>
  )
}

export function PlatformView() {
  const { dict, lang } = useI18n()
  const t = dict.v2.platformView
  const { stats, status, lastSyncAt } = useEngine()
  const report = useMemo(() => platformStatus(stats, lang), [stats, lang])
  const stages = useMemo(() => pipelineStages(stats, report, lang), [stats, report, lang])

  if (!report) {
    return (
      <section className="v2-panel">
        {status === 'down' ? <Empty title={t.offTitle}>{t.offHint}</Empty> : <p className="v2-small v2-dim">{t.loading}</p>}
      </section>
    )
  }

  const toReview = sectionsToReview(report)
  const verdict: Health = !report.healthy ? 'bad' : toReview > 0 ? 'warn' : 'ok'
  const { detectors, rest } = splitSections(report)
  const [left, right] = balanceColumns(rest)
  const readAt = lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'es-ES', { hour12: false }) : null

  return (
    <div className="v2-platform">
      <section className="v2-panel v2-pf-verdict" data-health={verdict} aria-live="polite">
        <span className="v2-pf-verdict-dot" aria-hidden="true" />
        <div>
          <h2>{verdict === 'bad' ? t.failing : verdict === 'warn' ? t.review(toReview) : t.healthy}</h2>
          {readAt && <p className="v2-small v2-dim">{t.read(readAt)}</p>}
        </div>
      </section>

      {stages.length > 0 && (
        <section className="v2-panel" aria-labelledby="v2-pf-pipe">
          <div className="v2-set-head">
            <h2 id="v2-pf-pipe">{t.pipeTitle}</h2>
            <p className="v2-small v2-dim">{t.pipeHint}</p>
          </div>
          <ol className="v2-pf-pipe">
            {stages.map((s, i) => (
              <li key={s.key} className="v2-pf-stage" data-health={s.health} style={{ ['--i' as string]: i }}>
                <header>
                  <span>{s.label}</span>
                  <HealthChip health={s.health} />
                </header>
                <strong className="v2-mono">
                  {s.value}
                  {s.unit && <small> {s.unit}</small>}
                </strong>
                <p className="v2-small v2-dim">{s.detail}</p>
                {s.flag && <p className="v2-small v2-warn">{s.flag}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {detectors.length > 0 && (
        <section className="v2-panel" aria-labelledby="v2-pf-det">
          <div className="v2-set-head">
            <h2 id="v2-pf-det">{t.detTitle}</h2>
            <p className="v2-small v2-dim">{t.detHint}</p>
          </div>
          <div className="v2-pf-det">
            {detectors.map((s) => (
              <Section key={s.key} section={s} />
            ))}
          </div>
        </section>
      )}

      <section className="v2-panel" aria-labelledby="v2-pf-parts">
        <h2 id="v2-pf-parts" className="v2-pf-h">
          {t.partsTitle}
        </h2>
        <div className="v2-pf-cols">
          {[left, right].map((col, i) => (
            <div key={i} className="v2-pf-col">
              {col.map((s) => (
                <Section key={s.key} section={s} />
              ))}
            </div>
          ))}
        </div>
        {report.unavailable.length > 0 && (
          <p className="v2-small v2-dim">
            {t.unavailable}
            {report.unavailable.join(', ')}
          </p>
        )}
      </section>
    </div>
  )
}
