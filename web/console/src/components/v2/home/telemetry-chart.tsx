'use client'

// Events per minute as the engine reports them, sampled every couple of
// seconds since this page opened: a line from zero, its scale and the
// latest value.
import { useI18n } from '@/components/console/i18n-provider'
import { chartCeiling, sparkPath } from '@/lib/v2/home-model'
import { Empty, Panel } from './parts'

const W = 320
const H = 120

export function TelemetryChart({ values, minutes }: { values: number[]; minutes: number }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.telemetry
  const locale = lang === 'en' ? 'en-GB' : 'es-ES'
  // a fifth of headroom: a steady line sits below the top, not on it
  const max = chartCeiling(Math.max(0, ...values) * 1.2)
  const line = sparkPath(values, W, H, 4, true, max)
  const last = values.length ? values[values.length - 1] : null

  return (
    <Panel
      labelledBy="v2-telemetry-title"
      title={t.title}
      subtitle={t.subtitle}
      action={last !== null ? <span className="v2-chart-now v2-mono">{t.now(last.toLocaleString(locale))}</span> : undefined}
    >
      {!line ? (
        <Empty title={t.empty}>{t.emptySub}</Empty>
      ) : (
        <div className="v2-chart">
          <div className="v2-chart-y v2-mono" aria-hidden="true">
            <span>{max.toLocaleString(locale)}</span>
            <span>{(max / 2).toLocaleString(locale)}</span>
            <span>0</span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={t.aria(last ?? 0, minutes)}>
            {[4, H / 2, H - 4].map((y) => (
              <line key={y} x1="0" x2={W} y1={y} y2={y} className="v2-chart-grid" />
            ))}
            <path d={`${line} L${W - 4} ${H - 4} L4 ${H - 4} Z`} className="v2-chart-area" />
            <path d={line} className="v2-chart-line" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="v2-chart-x v2-mono" aria-hidden="true">
            <span>{t.start(minutes)}</span>
            <span>{t.end}</span>
          </div>
        </div>
      )}
    </Panel>
  )
}
