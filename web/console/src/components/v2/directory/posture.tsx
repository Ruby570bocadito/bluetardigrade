'use client'

// Directorio · Postura: the engine's score of the domain with its reading,
// the findings by severity as one bar, the ones that weigh most and the
// score over the last syncs. The score, the severities and the thresholds
// are the engine's; the page only draws them.
import { useEffect, useState } from 'react'
import { CaretRight } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { scoreTone, type ADPosture, type ADPosturePoint } from '@/lib/directory'
import { bySeverity, severityShares, trendDelta, trendDots, type DirectoryTab } from '@/lib/v2/directory-model'
import type { Severity } from '@/lib/console-types'
import { Empty, SEV_COLOR } from '../home/parts'

const R = 52
const CIRC = 2 * Math.PI * R
const TONE_COLOR = { ok: 'var(--v2-ok)', warn: 'var(--v2-accent)', bad: 'var(--v2-danger)' } as const

function sevColor(sev: string): string {
  return SEV_COLOR[sev as Severity] ?? 'var(--v2-text-3)'
}

function ScoreRing({ score }: { score: number | null }) {
  const { dict } = useI18n()
  const t = dict.v2.directoryView
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(id)
  }, [])
  const tone = score === null ? null : scoreTone(score)
  const share = score === null ? 0 : Math.min(100, Math.max(0, score)) / 100
  return (
    <div className="v2-dir-score" role="img" aria-label={score === null ? t.scoreTitle : t.scoreAria(score)}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r={R} className="v2-dir-score-track" />
        <circle
          cx="60"
          cy="60"
          r={R}
          className="v2-dir-score-arc"
          style={{ stroke: tone ? TONE_COLOR[tone] : undefined, strokeDasharray: CIRC, strokeDashoffset: drawn ? CIRC * (1 - share) : CIRC }}
        />
      </svg>
      <div className="v2-dir-score-text">
        <strong className="v2-mono">{score === null ? '—' : Math.round(score)}</strong>
        <span>{dict.directory.score.of}</span>
      </div>
      {tone && (
        <span className="v2-dir-tone" data-tone={tone}>
          {t.tones[tone]}
        </span>
      )}
    </div>
  )
}

function Trend({ history }: { history: ADPosturePoint[] }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.directoryView
  const tr = dict.directory.trend
  if (history.length < 2) return <Empty title={tr.emptyTitle}>{tr.emptyHint}</Empty>
  const W = 600
  const H = 150
  const dots = trendDots(history, W, H)
  const delta = trendDelta(history) ?? 0
  const fmt = (sec: number) => new Date(sec * 1000).toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { day: '2-digit', month: 'short' })
  return (
    <figure className="v2-dir-trend">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={t.trendAria(history.length)}>
        {[25, 50, 75].map((g) => (
          <line key={g} x1="0" x2={W} y1={8 + (1 - g / 100) * (H - 16)} y2={8 + (1 - g / 100) * (H - 16)} className="v2-dir-grid" />
        ))}
        <polyline points={dots.map((p) => `${p.x},${p.y}`).join(' ')} className="v2-dir-line" />
      </svg>
      <ul className="v2-dir-dots" aria-hidden="true">
        {dots.map((p) => (
          <li key={p.at} style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` }} title={`${fmt(p.at)} · ${Math.round(p.score)}`} />
        ))}
      </ul>
      <figcaption className="v2-small v2-dim">
        <span>{fmt(dots[0].at)}</span>
        <span>{t.trendDelta(delta)}</span>
        <span>{fmt(dots[dots.length - 1].at)}</span>
      </figcaption>
    </figure>
  )
}

export function Posture({ posture, history, onOpen }: { posture: ADPosture; history: ADPosturePoint[]; onOpen: (tab: DirectoryTab) => void }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.directoryView
  const d = dict.directory
  const shares = severityShares(posture.summary)
  const top = bySeverity(posture.findings).slice(0, 5)
  const at = posture.generated_at ? new Date(posture.generated_at).toLocaleString(lang === 'en' ? 'en-GB' : 'es-ES', { hour12: false }) : '—'
  return (
    <div className="v2-dir-posture">
      <div className="v2-dir-head">
        <h2>{t.scoreTitle}</h2>
        <p className="v2-small v2-dim">{d.score.subtitle(at, new Intl.NumberFormat(lang).format(posture.objects_checked))}</p>
      </div>
      <div className="v2-dir-top">
        <ScoreRing score={posture.score} />
        <div className="v2-dir-sev">
          <h3 className="v2-eyebrow">{t.sevTitle}</h3>
          {shares.length === 0 ? (
            <p className="v2-small v2-dim">{t.noFindings}</p>
          ) : (
            <>
              <div className="v2-dir-stack" role="img" aria-label={shares.map((s) => `${d.sevLabels[s.sev as keyof typeof d.sevLabels]} ${s.count}`).join(', ')}>
                {shares.map((s, i) => (
                  <i key={s.sev} style={{ ['--w' as string]: `${s.share}%`, ['--c' as string]: sevColor(s.sev), ['--i' as string]: i }} />
                ))}
              </div>
              <ul className="v2-dir-legend">
                {shares.map((s) => (
                  <li key={s.sev}>
                    <i style={{ background: sevColor(s.sev) }} aria-hidden="true" />
                    {d.sevLabels[s.sev as keyof typeof d.sevLabels]} <b className="v2-mono">{s.count}</b>
                  </li>
                ))}
              </ul>
            </>
          )}
          {top.length > 0 && (
            <>
              <h3 className="v2-eyebrow">{t.topFindings}</h3>
              <ul className="v2-dir-toplist">
                {top.map((f) => (
                  <li key={f.id}>
                    <i style={{ background: sevColor(f.severity) }} aria-hidden="true" />
                    <span>{f.title}</span>
                    <b className="v2-mono">{f.count}</b>
                  </li>
                ))}
              </ul>
              <button type="button" className="v2-link v2-small v2-dir-more" onClick={() => onOpen('hallazgos')}>
                {t.seeAll(posture.findings.length)}
                <CaretRight aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>
      <p className="v2-small v2-dim">{d.score.thresholds(posture.inactive_days, posture.krbtgt_max_age_days)}</p>
      <section aria-labelledby="v2-dir-trend">
        <h3 id="v2-dir-trend" className="v2-eyebrow">
          {d.trend.title} · {d.trend.subtitle}
        </h3>
        <Trend history={history} />
      </section>
    </div>
  )
}
