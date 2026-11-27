'use client'

// The sensor of one machine (boceto 4): its build next to the engine's,
// how it runs and captures, its heartbeat (the last ones, at their
// interval, with the time since the latest), how full its queue is, what
// it had to keep on disk or drop, and whether its YARA pack is the
// engine's. An administrator can revoke a machine that joined by code.
import { useState } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import { useConsoleUser } from '@/components/console/user-session'
import { useFleet } from '@/components/console/fleet-provider'
import { decideEnrolledHost, enrolledFor } from '@/lib/enroll'
import { formatDuration, runModeText, type YaraStatus } from '@/lib/fleet'
import { sensorHealth, type HostRow } from '@/lib/v2/hosts-model'
import { Empty } from '../home/parts'

export function SensorCard({ row, engineVersion, yara, now, onNotice }: { row: HostRow; engineVersion: string | null; yara: YaraStatus | null; now: number | null; onNotice: (m: string) => void }) {
  const { dict } = useI18n()
  const t = dict.v2.hostsView
  const me = useConsoleUser()
  const { enroll, refresh } = useFleet()
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const s = row.sensor
  const enrolled = enrolledFor(enroll, row.host, row.identity)
  const canRevoke = !!enroll?.writes && !me.pending && me.role === 'admin' && enrolled?.state === 'active'

  if (!s || now === null) return <Empty title={t.sensorNone}>{t.sensorNoneHint}</Empty>
  const h = sensorHealth(s, engineVersion, yara, now)
  // the beats the interval implies over the last minutes, the latest real
  const beats = Math.min(16, Math.max(4, Math.round(600 / Math.max(5, s.interval_s))))
  const queuePct = h.queueUse === null ? null : Math.round(h.queueUse * 100)

  return (
    <div className="v2-sensor">
      <dl className="v2-sensor-facts">
        <div>
          <dt>{t.sensorFacts.version}</dt>
          <dd>
            <span className="v2-mono">{s.version ?? '—'}</span>
            <span className="v2-sensor-state v2-small" data-state={h.versionState}>
              {h.versionState === 'outdated' ? t.versionState.outdated(engineVersion ?? '') : t.versionState[h.versionState]}
            </span>
          </dd>
        </div>
        <div>
          <dt>{t.sensorFacts.mode}</dt>
          <dd>{runModeText(s.run_mode, dict.fleet.modes)}</dd>
        </div>
        <div>
          <dt>{t.sensorFacts.capture}</dt>
          <dd className="v2-mono">{s.capture ?? '—'}</dd>
        </div>
        <div>
          <dt>{t.sensorFacts.os}</dt>
          <dd>{s.os ?? '—'}</dd>
        </div>
        <div>
          <dt>{t.sensorFacts.uptime}</dt>
          <dd className="v2-mono">{formatDuration(s.uptime_s)}</dd>
        </div>
        <div>
          <dt>{t.sensorFacts.yara}</dt>
          <dd>
            <span className="v2-sensor-state v2-small" data-state={h.yara}>
              {h.yara === 'match' || h.yara === 'stale' ? t.yaraState[h.yara](s.yara_rules ?? 0) : t.yaraState[h.yara]}
            </span>
            {s.yara_rules_sha && <span className="v2-mono v2-dim v2-small"> {s.yara_rules_sha.slice(0, 4)}…{s.yara_rules_sha.slice(-4)}</span>}
          </dd>
        </div>
      </dl>

      <section className="v2-sensor-beat">
        <h3>
          {t.sensorFacts.interval} <span className="v2-dim v2-small">{t.everyS(s.interval_s)}</span>
        </h3>
        <div className="v2-beats" role="img" aria-label={t.beatsAria} data-silent={row.status === 'silent'}>
          {Array.from({ length: beats }, (_, i) => (
            <i key={i} style={{ ['--i' as string]: i }} data-last={i === beats - 1} />
          ))}
        </div>
        <p className="v2-dim v2-small">{h.heartbeatAgeS !== null && t.lastBeat(formatDuration(h.heartbeatAgeS))}</p>
      </section>

      <section className="v2-sensor-queue">
        <h3>{t.sensorFacts.queue}</h3>
        {queuePct === null ? (
          <p className="v2-dim v2-small">—</p>
        ) : (
          <>
            <span className="v2-meter" data-level={queuePct >= 80 ? 'high' : queuePct >= 50 ? 'medium' : 'low'}>
              <i style={{ ['--w' as string]: `${Math.max(1, queuePct)}%` }} />
            </span>
            <p className="v2-small v2-mono">
              {t.queueOf(s.spooled, s.queue_cap ?? 0)} · {queuePct} %
            </p>
          </>
        )}
        <dl className="v2-sensor-counts">
          <div>
            <dt>{t.sensorFacts.spooled}</dt>
            <dd className="v2-mono">{s.spooled}</dd>
          </div>
          <div>
            <dt>{t.sensorFacts.dropped}</dt>
            <dd className="v2-mono" data-bad={s.dropped > 0}>
              {s.dropped}
            </dd>
          </div>
        </dl>
      </section>

      {canRevoke && (
        <div className="v2-sensor-revoke">
          {error && <p className="v2-error">{error}</p>}
          <button
            type="button"
            className="v2-link"
            onClick={async () => {
              if (!confirm) return setConfirm(true)
              setConfirm(false)
              const res = await decideEnrolledHost(enrolled!.name, 'revoke', me.mode === 'users' ? me.name : 'consola')
              if (!res.ok) return setError(res.error)
              onNotice(t.revoked(row.host))
              await refresh()
            }}
          >
            {confirm ? t.revokeConfirm : t.revoke}
          </button>
        </div>
      )}
    </div>
  )
}
