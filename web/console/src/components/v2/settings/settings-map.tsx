'use client'

// Ajustes · Mapa: every area with its state as the console and the engine
// report it — configured, not armed in the engine, to review, or not
// configured yet — and where it is changed: here, when the console
// starts, or with the engine's flags. A read that fails says so. The states come from the same reads the areas
// use; nothing is assumed while they are being asked.
import { useEffect, useMemo, useState } from 'react'
import { CaretRight } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { useEngine } from '@/components/console/engine-provider'
import { useFleet } from '@/components/console/fleet-provider'
import { useConsoleUser } from '@/components/console/user-session'
import { fetchHostGroups } from '@/lib/host-groups'
import { fetchNotifySettings } from '@/lib/notify-settings'
import { allGatesDone, stepStatuses, type OnboardingFacts } from '@/lib/onboarding'
import { fetchADSettings } from '@/lib/settings'
import { fetchADStatus } from '@/lib/directory'
import { areaStates, outputRows, type AreaId, type AreaInputs, type SettingsTab } from '@/lib/v2/settings-model'
import { StatePill } from './parts'

const ORDER: AreaId[] = ['cuentas', 'mi-cuenta', 'avisos', 'directorio', 'grupos', 'ingesta', 'integraciones', 'auditoria', 'puesta-en-marcha']

export function onboardingFacts(engineStatus: string, loaded: boolean, enroll: ReturnType<typeof useFleet>['enroll'], fleet: ReturnType<typeof useFleet>['fleet']): OnboardingFacts {
  return {
    engineLive: engineStatus === 'live',
    loaded,
    enroll: enroll
      ? {
          enabled: enroll.enabled,
          usableTokens: enroll.tokens.filter((t) => t.status === 'active').length,
          pendingHosts: enroll.hosts.filter((h) => h.state === 'pending').length,
          activeHosts: enroll.hosts.filter((h) => h.state === 'active').length,
        }
      : null,
    inventoryHosts: fleet ? fleet.hosts.length : null,
  }
}

const denied = (status: number) => (status === 403 ? 'restricted' : 'unknown') as 'restricted' | 'unknown'

export function SettingsMap({ onOpen }: { onOpen: (tab: SettingsTab) => void }) {
  const { dict } = useI18n()
  const t = dict.v2.settingsView
  const me = useConsoleUser()
  const { stats, status } = useEngine()
  const { enroll, fleet, loaded } = useFleet()
  const [groups, setGroups] = useState<AreaInputs['groups']>(null)
  const [ad, setAd] = useState<AreaInputs['ad']>(null)
  const [notify, setNotify] = useState<AreaInputs['notify']>(null)

  useEffect(() => {
    let alive = true
    void fetchHostGroups().then((r) => alive && setGroups(r.ok ? (r.data.enabled ? { writable: r.data.writable, ungrouped: r.data.ungrouped.length } : 'off') : denied(r.status)))
    void Promise.all([fetchADSettings(), fetchADStatus()]).then(
      ([r, st]) =>
        alive &&
        setAd(r.ok ? { failing: !!r.data.last_reload_error || (st.ok && st.data.last_error !== '') } : r.status === 501 ? 'off' : denied(r.status)),
    )
    void fetchNotifySettings().then(
      (r) =>
        alive &&
        setNotify(
          r.ok
            ? { channels: r.data.channels.length, failed: r.data.stats.reduce((n, s) => n + s.failed, 0) }
            : r.status === 501 || r.status === 404
              ? 'off'
              : denied(r.status),
        ),
    )
    return () => {
      alive = false
    }
  }, [])

  const facts = useMemo(() => onboardingFacts(status, loaded, enroll, fleet), [status, loaded, enroll, fleet])
  const states = areaStates({
    me,
    stats: stats ? { ingest_rejected: stats.ingest_rejected, ingest_identity_violations: stats.ingest_identity_violations } : null,
    enroll: enroll ? { enabled: enroll.enabled } : null,
    groups,
    ad,
    notify,
    outputs: outputRows(stats),
    audit: me.pending ? null : me.audit,
    firstRunDone: loaded ? allGatesDone(stepStatuses(facts)) : null,
  })

  return (
    <div className="v2-set-map">
      <div className="v2-set-head">
        <h2>{t.mapTitle}</h2>
        <p className="v2-small v2-dim">{t.mapHint}</p>
      </div>
      <ul className="v2-set-cards">
        {ORDER.map((id, i) => (
          <li key={id} style={{ ['--i' as string]: i }}>
            <button type="button" className="v2-set-card" onClick={() => onOpen(id)}>
              <span className="v2-set-card-head">
                <strong>{t.tabs[id]}</strong>
                <StatePill state={states[id].state} />
              </span>
              <span className="v2-small">{t.areas[id]}</span>
              <span className="v2-set-card-foot v2-small v2-dim">
                {t.where[states[id].where]}
                <CaretRight aria-hidden="true" />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
