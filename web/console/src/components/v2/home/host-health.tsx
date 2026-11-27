'use client'

// Health of the hosts that carry risk: the engine's own score (it rises
// with every alert and cools down over time), as a bar toward the
// critical band.
import { useI18n } from '@/components/console/i18n-provider'
import type { HotHost } from '@/lib/console-types'
import { riskLevel } from '@/lib/v2/home-model'
import { v2HostLink } from '@/lib/v2/hosts-model'
import { Empty, Panel } from './parts'

const LEVEL_TONE = { critical: 'danger', elevated: 'warn', low: 'muted' } as const

export function HostHealth({ hosts }: { hosts: HotHost[] }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.health
  const locale = lang === 'en' ? 'en-GB' : 'es-ES'
  // bars fill toward the critical band (20), or toward the top score above it
  const scale = Math.max(20, ...hosts.map((h) => h.score))

  return (
    <Panel labelledBy="v2-health-title" title={t.title} subtitle={t.subtitle}>
      {hosts.length === 0 ? (
        <Empty title={t.empty}>{t.emptySub}</Empty>
      ) : (
        <ul className="v2-health">
          {hosts.map((h) => {
            const level = riskLevel(h.score)
            const score = h.score.toLocaleString(locale, { maximumFractionDigits: 1 })
            return (
              <li key={h.host} data-tone={LEVEL_TONE[level]}>
                <a href={v2HostLink(h.host)} aria-label={t.rowAria(h.host, score, t.levels[level], h.alerts)}>
                  <span className="v2-health-top">
                    <strong className="v2-mono">{h.host}</strong>
                    <span className="v2-health-level">
                      {t.levels[level]} · {score}
                    </span>
                  </span>
                  <span className="v2-bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(3, Math.min(100, (h.score / scale) * 100))}%` }} />
                  </span>
                  <span className="v2-health-sub">{t.alerts(h.alerts)}</span>
                </a>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
