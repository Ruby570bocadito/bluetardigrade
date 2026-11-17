'use client'

// Sensor state from the engine's fleet inventory: how many hosts send
// telemetry, how many went silent and how many are idle.
import { useI18n } from '@/components/console/i18n-provider'
import type { FleetPayload } from '@/lib/fleet'
import { Empty, Panel } from './parts'

const ROWS = [
  { key: 'online', tone: 'ok' },
  { key: 'silent', tone: 'danger' },
  { key: 'idle', tone: 'muted' },
] as const

export function Sensors({ fleet }: { fleet: FleetPayload | null }) {
  const { dict } = useI18n()
  const t = dict.v2.sensors
  if (!fleet?.enabled) {
    return (
      <Panel labelledBy="v2-sensors-title" title={t.title} subtitle={t.subtitle}>
        <Empty title={t.off} />
      </Panel>
    )
  }
  const total = fleet.hosts.length
  const values = { online: fleet.online, silent: fleet.silent, idle: fleet.idle }
  if (total === 0) {
    return (
      <Panel labelledBy="v2-sensors-title" title={t.title} subtitle={t.subtitle}>
        <Empty title={t.none}>{t.noneSub}</Empty>
      </Panel>
    )
  }

  return (
    <Panel labelledBy="v2-sensors-title" title={t.title} subtitle={t.subtitle}>
      <div className="v2-stack-bar" role="img" aria-label={t.aria(fleet.online, total)}>
        {ROWS.map((r) => (values[r.key] > 0 ? <span key={r.key} data-tone={r.tone} style={{ flexGrow: values[r.key] }} /> : null))}
      </div>
      <ul className="v2-sensors">
        {ROWS.map((r) => (
          <li key={r.key} data-tone={r.tone}>
            <i aria-hidden="true" />
            <span>{t[r.key]}</span>
            <b className="v2-mono">{values[r.key]}</b>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
