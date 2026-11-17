'use client'

// Small pieces shared by the views of Detección.
import { useI18n } from '@/components/console/i18n-provider'
import type { RuleMeta, Severity } from '@/lib/console-types'
import { SEV_COLOR } from '../home/parts'

export function SevPill({ sev }: { sev: Severity }) {
  const { dict } = useI18n()
  return (
    <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[sev] }}>
      {dict.v2.sev[sev]}
    </span>
  )
}

/** A rule's conditions as the engine evaluates them: all of them must hold. */
export function Conditions({ rule }: { rule: Pick<RuleMeta, 'conditions'> }) {
  const { dict } = useI18n()
  const ops = dict.v2.detectionView.operators as Record<string, string>
  if (rule.conditions.length === 0) return null
  return (
    <ul className="v2-conds">
      {rule.conditions.map((c, i) => {
        const values = Array.isArray(c.value) ? c.value : [c.value]
        return (
          <li key={i}>
            <code className="v2-cond-field">{c.field}</code>
            <span className="v2-cond-op" title={c.operator}>
              {ops[c.operator] ?? c.operator}
            </span>
            <span className="v2-cond-values">
              {values.map((v, j) => (
                <code key={j}>{String(v)}</code>
              ))}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** Alerts per day over the last week, with the weekday under each bar. */
export function WeekBars({ values, now, label }: { values: number[]; now: number | null; label: string }) {
  const { lang } = useI18n()
  const max = Math.max(1, ...values)
  const day = new Intl.DateTimeFormat(lang, { weekday: 'short' })
  return (
    <div className="v2-weekbars" role="img" aria-label={`${label}: ${values.join(', ')}`}>
      {values.map((v, i) => (
        <div key={i} className="v2-weekbar">
          <span className="v2-mono">{v}</span>
          <i style={{ ['--h' as string]: `${(v / max) * 100}%` }} data-zero={v === 0} />
          <small>{now === null ? '' : day.format(new Date(now - (values.length - 1 - i) * 86_400_000))}</small>
        </div>
      ))}
    </div>
  )
}
