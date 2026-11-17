'use client'

// The first thing on Inicio: the real world map with where the hosts
// connected to (by country, from the recent network events; red where an
// alert points) and, beside it, one line on the state of the SOC with the
// sentence that explains it. Every word and every mark comes from the live
// state (engine, alerts, fleet); while the engine has seen nothing yet it
// says exactly that.
import { CheckCircle, CircleNotch, Plugs, Warning, WarningOctagon } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { alertKey } from '@/lib/engine-client'
import { formatAgo } from '@/lib/soc-metrics'
import type { SfAlert } from '@/lib/console-types'
import type { HomeKpis, HomeStatus } from '@/lib/v2/home-model'
import { worldMap } from '@/lib/v2/world-map'
import { v2AlertLink } from '@/lib/v2/alerts-model'
import { gridPoint, markRadius, type CountryMark } from '@/lib/v2/geo-map'
import { useNow } from '../use-now'

export type MapState = { marks: CountryMark[]; destinations: number; pending: boolean }

function WorldMap({ map }: { map: MapState }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.map
  const { cols, rows, path } = worldMap()
  const names = new Intl.DisplayNames([lang], { type: 'region' })
  const countries = map.marks.length
  const ips = map.marks.reduce((s, m) => s + m.ips, 0)
  const alerted = map.marks.filter((m) => m.alerts > 0).length
  return (
    <div className="v2-band-geo">
      <svg
        className="v2-band-map"
        viewBox={`0 0 ${cols} ${rows}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={countries ? t.aria(ips, countries, alerted) : t.none}
        focusable="false"
      >
        <path d={path} stroke="currentColor" strokeWidth="0.58" strokeLinecap="round" fill="none" />
        <g className="v2-map-marks">
          {map.marks.map((m) => {
            const [x, y] = gridPoint(m.lat, m.lon)
            const r = markRadius(m.ips)
            return (
              <g key={m.country} data-alert={m.alerts > 0} transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`}>
                <title>{t.markTitle(names.of(m.country) ?? m.country, m.ips, m.connections, m.alerts)}</title>
                {m.alerts > 0 && <circle className="v2-map-pulse" r={r * 2.4} />}
                <circle className="v2-map-mark" r={r} />
              </g>
            )
          })}
        </g>
      </svg>
      <p className="v2-map-legend">
        {countries > 0 ? (
          <>
            <span>
              <i aria-hidden="true" />
              {t.legendConnections}
            </span>
            {alerted > 0 && (
              <span>
                <i data-kind="alert" aria-hidden="true" />
                {t.legendAlerts}
              </span>
            )}
            <span>{t.summary(ips, countries)}</span>
            <a href="https://db-ip.com" target="_blank" rel="noreferrer noopener">
              {t.attribution}
            </a>
          </>
        ) : (
          <span>{map.pending ? t.locating : map.destinations > 0 ? t.unplaced : t.none}</span>
        )}
      </p>
    </div>
  )
}

export function StatusBand({ status, kpis, latest, map }: { status: HomeStatus; kpis: HomeKpis; latest: SfAlert | null; map: MapState }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.status
  const now = useNow(15_000)

  let tone: 'ok' | 'warn' | 'danger' | 'muted' = 'muted'
  let Icon = CircleNotch
  let state = t.connecting
  let sentence = t.subConnecting
  let action: { href: string; label: string } | null = null

  if (status.kind === 'offline') {
    tone = 'danger'
    Icon = Plugs
    state = t.offline
    sentence = t.subOffline
  } else if (status.kind === 'waiting') {
    tone = 'warn'
    Icon = Warning
    state = t.waiting
    sentence = t.subWaiting
    action = { href: '/?view=equipos', label: t.connect }
  } else if (status.kind === 'alert') {
    tone = status.severity === 'critical' ? 'danger' : 'warn'
    Icon = WarningOctagon
    state = status.severity === 'critical' ? t.alertCritical(status.count) : t.alertHigh(status.count)
    const ago = latest && now !== null ? formatAgo(Math.max(0, now - Date.parse(latest.timestamp)), lang) : ''
    sentence = latest ? t.subLatest(latest.rule_name, latest.host, ago) : ''
    action = {
      href: latest ? v2AlertLink(alertKey(latest)) : `/v2/alertas?sev=${status.severity}&estado=new`,
      label: t.review,
    }
  } else if (status.kind === 'calm') {
    tone = 'ok'
    Icon = CheckCircle
    state = status.open === 0 ? t.calm : t.calmOpen
    const hosts = kpis.hostsTotal === null ? t.hostsUnknown : t.hostsCount(kpis.hostsTotal)
    const events = kpis.eventsTotal === null ? '—' : kpis.eventsTotal.toLocaleString(lang === 'en' ? 'en-GB' : 'es-ES')
    sentence = status.open === 0 ? t.subCalm(hosts, events) : t.subCalmOpen(status.open)
  }

  return (
    <section className="v2-panel v2-band" aria-labelledby="v2-status-title">
      <WorldMap map={map} />
      <div className="v2-band-status" data-tone={tone}>
        <h2 id="v2-status-title" className="v2-band-state">
          <Icon weight={tone === 'muted' ? 'regular' : 'fill'} aria-hidden="true" />
          {state}
        </h2>
        {sentence && <p>{sentence}</p>}
        {action && (
          <a className="v2-btn" href={action.href}>
            {action.label}
          </a>
        )}
      </div>
    </section>
  )
}
