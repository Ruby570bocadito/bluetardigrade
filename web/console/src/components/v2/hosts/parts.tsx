'use client'

// Small pieces shared by the views of Equipos.
import { useI18n } from '@/components/console/i18n-provider'
import { formatDuration } from '@/lib/fleet'
import type { HostRow, HostStatus, RiskLevel } from '@/lib/v2/hosts-model'

export function StatusPill({ status }: { status: HostStatus }) {
  const { dict } = useI18n()
  return (
    <span className="v2-hstatus" data-status={status}>
      <i aria-hidden="true" />
      {dict.v2.hostsView.status[status]}
    </span>
  )
}

/** "hace 3 min" from an instant, or a dash. */
export function Ago({ iso, now }: { iso?: string; now: number | null }) {
  const { dict } = useI18n()
  if (!iso || now === null) return <span className="v2-dim">—</span>
  const s = Math.max(0, (now - Date.parse(iso)) / 1000)
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()}>
      {dict.v2.hostsView.ago(formatDuration(s))}
    </time>
  )
}

/** A tiny bar chart of recent activity (bars, not a line: buckets are counts). */
export function Spark({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values)
  return (
    <span className="v2-spark" role="img" aria-label={label}>
      {values.map((v, i) => (
        <i key={i} style={{ ['--h' as string]: `${(v / max) * 100}%` }} data-zero={v === 0} />
      ))}
    </span>
  )
}

/** The engine score as a bar against the hottest machine shown. */
export function RiskBar({ row, level, max }: { row: HostRow; level: RiskLevel; max: number }) {
  const { dict } = useI18n()
  const t = dict.v2.hostsView
  if (row.risk === null) return <span className="v2-dim v2-small">—</span>
  const score = row.risk.toFixed(row.risk < 10 ? 1 : 0)
  return (
    <span className="v2-riskbar" data-level={level} aria-label={t.riskAria(row.host, score)} title={t.riskLevels[level]}>
      <i aria-hidden="true">
        <b style={{ ['--w' as string]: `${Math.max(2, Math.min(100, (row.risk / Math.max(row.risk, max, 0.01)) * 100))}%` }} />
      </i>
      <span className="v2-mono">{score}</span>
    </span>
  )
}
