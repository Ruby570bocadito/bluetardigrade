'use client'

// Silent hosts (boceto 8): each sensor's time since its last heartbeat as
// a bar, against the margin the engine itself applies (three heartbeats,
// at least its minimum). A bar past the margin is a silent machine.
import { useI18n } from '@/components/console/i18n-provider'
import { formatDuration } from '@/lib/fleet'
import { heartbeatBars, type HostRow } from '@/lib/v2/hosts-model'
import { Empty } from '../home/parts'
import { StatusPill } from './parts'

export function SilentHosts({ rows, now, minGraceS, onOpen }: { rows: HostRow[]; now: number | null; minGraceS: number; onOpen: (host: string) => void }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.hostsView
  if (now === null) return null
  const bars = heartbeatBars(rows, now, minGraceS)
  if (bars.length === 0) return <Empty title={t.noSensors}>{t.noSensorsHint}</Empty>
  // the scale: twice the widest margin, or the quietest sensor if it is further
  const scale = Math.max(...bars.map((b) => Math.max(b.ageS, b.graceS * 2)))
  const time = (iso: string) => new Date(iso).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'es-ES', { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="v2-silent">
      <div className="v2-silent-head">
        <h3>{t.silentTitle}</h3>
        <p className="v2-dim v2-small">{t.silentHint}</p>
      </div>
      <ul className="v2-silent-list">
        {bars.map((b, i) => (
          <li key={b.host} data-past={b.past} style={{ ['--i' as string]: i }}>
            <button type="button" onClick={() => onOpen(b.host)}>
              <span className="v2-silent-name">
                <strong className="v2-mono">{b.host}</strong>
                <StatusPill status={b.status} />
              </span>
              <span className="v2-silent-track" aria-hidden="true">
                <i className="v2-silent-bar" style={{ ['--w' as string]: `${(Math.min(b.ageS, scale) / scale) * 100}%` }} />
                <i className="v2-silent-grace" style={{ left: `${(b.graceS / scale) * 100}%` }} title={t.graceMark(formatDuration(b.graceS))} />
              </span>
              <span className="v2-small v2-silent-text">
                {b.past ? t.silentSince(time(b.lastHeartbeat), formatDuration(b.ageS)) : t.lastBeat(formatDuration(b.ageS))}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
