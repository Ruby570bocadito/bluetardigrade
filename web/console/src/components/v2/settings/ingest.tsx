'use client'

// Ajustes · Ingesta y sensores: what reaches the engine on its ingest
// port — events per minute (with the last minutes), events received and
// dropped, rejected connections, ingest identities and the events that
// claimed a host outside theirs — and the state of the host enrollment.
// All of it is set with the engine's flags; here it is the real signal.
import { CaretRight } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { v2HostsLink } from '@/lib/v2/hosts-model'
import { useEngine, useStatsHistory } from '@/components/console/engine-provider'
import { useFleet } from '@/components/console/fleet-provider'
import { Figure } from '../reports/parts'
import { Group } from './parts'

export function Ingest() {
  const { dict, lang } = useI18n()
  const t = dict.v2.settingsView
  const s = dict.settings.ingesta
  const { stats } = useEngine()
  const history = useStatsHistory()
  const { enroll } = useFleet()
  const n = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 })
  const series = history.map((h) => h.eventsPerMin ?? 0)
  const peak = Math.max(1, ...series)

  if (!stats) return <p className="v2-small v2-dim">{t.states.loading}</p>
  const usable = enroll ? enroll.tokens.filter((x) => x.status === 'active').length : 0
  const pending = enroll ? enroll.hosts.filter((h) => h.state === 'pending').length : 0
  const active = enroll ? enroll.hosts.filter((h) => h.state === 'active').length : 0

  return (
    <div className="v2-set-stack">
      <div className="v2-set-head">
        <h2>{t.inTitle}</h2>
        <p className="v2-small v2-dim">{t.inHint}</p>
      </div>
      <div className="v2-rep-figs">
        <Figure label={t.inEventsMin} value={n.format(stats.events_per_min)} />
        <Figure label={t.inEventsTotal} value={n.format(stats.events_total)} />
        <Figure label={t.inDropped} value={n.format(stats.dropped)} tone={stats.dropped > 0 ? 'warn' : undefined} />
        <Figure label={t.inRejected} value={n.format(stats.ingest_rejected)} tone={stats.ingest_rejected > 0 ? 'warn' : undefined} />
        <Figure label={t.inIdentities} value={stats.ingest_identities === undefined ? '—' : n.format(stats.ingest_identities)} />
        <Figure
          label={t.inViolations}
          value={stats.ingest_identity_violations === undefined ? '—' : n.format(stats.ingest_identity_violations)}
          note={t.inViolationsHint}
          tone={(stats.ingest_identity_violations ?? 0) > 0 ? 'warn' : undefined}
        />
      </div>
      {series.length > 1 && (
        <Group id="v2-in-history" title={`${t.inEventsMin} · ${t.inHistory}`}>
          <span className="v2-spark v2-in-spark" role="img" aria-label={`${t.inEventsMin}: ${series.map((v) => n.format(v)).join(', ')}`}>
            {series.map((v, i) => (
              <i key={i} style={{ ['--h' as string]: `${(v / peak) * 100}%` }} data-zero={v === 0} />
            ))}
          </span>
          {series.every((v) => v === 0) && <p className="v2-small v2-dim">{t.inQuiet}</p>}
        </Group>
      )}
      <Group id="v2-in-enroll" title={t.inEnroll}>
        {!enroll ? (
          <p className="v2-small v2-dim">{t.states.loading}</p>
        ) : (
          <ul className="v2-plainlist">
            <li>
              <strong>{enroll.enabled ? s.enrollOn : s.enrollOff}</strong>
            </li>
            {enroll.enabled && (
              <>
                <li className="v2-small">{s.usableTokens(usable)}</li>
                <li className="v2-small">{s.pendingHosts(pending)}</li>
                <li className="v2-small">{s.activeHosts(active)}</li>
              </>
            )}
            <li className="v2-small v2-dim">{stats.store_enabled ? s.storeOn : s.storeOff}</li>
          </ul>
        )}
        <a className="v2-btn" href={v2HostsLink('alta')}>
          {t.inOpenEnroll}
          <CaretRight aria-hidden="true" />
        </a>
      </Group>
    </div>
  )
}
