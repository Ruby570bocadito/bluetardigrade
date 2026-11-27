'use client'

// Five numbers an operator checks first, each with what it means right
// under it. Nothing is shown as a number until the engine has reported it.
import type { ComponentType, ReactNode } from 'react'
import { Broadcast, Crosshair, Desktop, Flame, Siren, type IconProps } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import type { HomeKpis } from '@/lib/v2/home-model'

type Tone = 'ok' | 'warn' | 'danger' | 'muted'

function Tile({ label, icon: Icon, value, sub, tone = 'muted', valueTone }: {
  label: string
  icon: ComponentType<IconProps>
  value: ReactNode
  sub: string
  tone?: Tone
  valueTone?: Tone
}) {
  return (
    <div className="v2-panel v2-kpi">
      <span className="v2-kpi-label">
        <Icon aria-hidden="true" />
        {label}
      </span>
      <span className="v2-kpi-value" data-tone={valueTone}>
        {value}
      </span>
      <span className="v2-kpi-sub" data-tone={tone}>
        {sub}
      </span>
    </div>
  )
}

const RISK_TONE = { critical: 'danger', elevated: 'warn', low: 'muted' } as const

export function KpiTiles({ kpis }: { kpis: HomeKpis }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.kpi
  const locale = lang === 'en' ? 'en-GB' : 'es-ES'
  const n = (v: number) => v.toLocaleString(locale)
  const critical = kpis.openBySeverity.critical

  return (
    <section className="v2-kpis" aria-label={t.aria}>
      <Tile
        label={t.events}
        icon={Broadcast}
        value={kpis.eventsPerMin === null ? '—' : n(kpis.eventsPerMin)}
        sub={kpis.eventsTotal === null ? t.noData : t.eventsSub(n(kpis.eventsTotal))}
      />
      <Tile
        label={t.open}
        icon={Siren}
        value={n(kpis.open)}
        sub={critical > 0 ? t.openCritical(critical) : t.openNone}
        tone={critical > 0 ? 'danger' : 'muted'}
      />
      <Tile
        label={t.hosts}
        icon={Desktop}
        value={
          kpis.hostsOnline === null ? (
            '—'
          ) : (
            <>
              {n(kpis.hostsOnline)}
              {kpis.hostsTotal !== null && <small>/{n(kpis.hostsTotal)}</small>}
            </>
          )
        }
        sub={kpis.hostsSilent === null ? t.hostsOff : kpis.hostsTotal === 0 ? t.hostsNone : t.hostsSub(kpis.hostsSilent)}
        tone={kpis.hostsSilent ? 'warn' : kpis.hostsSilent === 0 && kpis.hostsTotal ? 'ok' : 'muted'}
      />
      <Tile
        label={t.risk}
        icon={Flame}
        value={kpis.topRisk ? t.levels[kpis.topRisk.level] : '—'}
        valueTone={kpis.topRisk ? RISK_TONE[kpis.topRisk.level] : undefined}
        sub={kpis.topRisk ? t.riskSub(kpis.topRisk.host, kpis.topRisk.score.toLocaleString(locale, { maximumFractionDigits: 1 })) : t.riskNone}
      />
      <Tile label={t.rules} icon={Crosshair} value={n(kpis.rules)} sub={t.rulesSub(kpis.tacticsCovered, kpis.tacticsTotal)} />
    </section>
  )
}
