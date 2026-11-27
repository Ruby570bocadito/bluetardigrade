'use client'

// Small pieces shared by the views of Respuesta.
import { useI18n } from '@/components/console/i18n-provider'
import type { SfRespondRecord } from '@/lib/console-types'
import { formatDuration } from '@/lib/fleet'

export function DecisionPill({ decision }: { decision: SfRespondRecord['decision'] }) {
  const { dict } = useI18n()
  return (
    <span className="v2-decision" data-decision={decision}>
      {dict.v2.respondView.decision[decision]}
    </span>
  )
}

/** The engine's refusal in plain words, with what to do about it. */
export function useDenial(): (code: string | undefined) => { title: string; fix: string } {
  const { dict } = useI18n()
  const t = dict.v2.respondView
  return (code) => t.denials[code ?? ''] ?? { title: t.unknownReason(code || '—'), fix: '' }
}

/** "hace 3 min" from an instant, with the full date on hover. */
export function When({ iso, now }: { iso: string; now: number | null }) {
  const { dict } = useI18n()
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return <span className="v2-dim">—</span>
  return (
    <time dateTime={iso} title={new Date(t).toLocaleString()}>
      {now === null ? new Date(t).toLocaleTimeString() : dict.v2.hostsView.ago(formatDuration(Math.max(0, (now - t) / 1000)))}
    </time>
  )
}

export function formatBytes(n: number): string {
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MiB`
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(1)} KiB`
  return `${n} B`
}

/** Hands a text file to the browser (an export the operator asked for). */
export function download(filename: string, mime: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** One attempt in a line: what, on which host, by whom, and the engine's answer. */
export function AttemptLine({ r, now }: { r: SfRespondRecord; now: number | null }) {
  const { dict } = useI18n()
  const t = dict.v2.respondView
  const denial = useDenial()
  return (
    <div className="v2-attempt" data-decision={r.decision}>
      <DecisionPill decision={r.decision} />
      <span className="v2-attempt-main">
        <span className="v2-mono">
          {r.process_name} · PID {r.pid} · {r.host}
        </span>
        <span className="v2-small v2-dim">
          {r.decision === 'denied' ? denial(r.code).title : `${r.signal ?? 'SIGKILL'}${r.mechanism ? ` · ${t.mechanism(r.mechanism)}` : ''}`} · {t.by(r.operator || '—')}
        </span>
      </span>
      <span className="v2-small v2-dim">
        <When iso={r.ts} now={now} />
      </span>
    </div>
  )
}
