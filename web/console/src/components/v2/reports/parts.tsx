'use client'

// Pieces shared by the views of Informes: reading one engine report, the
// line that says where its numbers come from, the window picker, the
// downloads of the engine's own bytes and the small charts.
import { useEffect, useState, type ReactNode } from 'react'
import { DownloadSimple, Printer } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { formatDateTime } from '@/lib/console-types'
import { downloadReport, fetchReport, REPORT_WINDOWS, type ReportData, type ReportEnvelope, type ReportQuery, type ReportWindowPreset } from '@/lib/reports'
import { sourceOf } from '@/lib/v2/reports-model'

export type ReportState<T> = { status: 'loading' } | { status: 'ok'; data: T } | { status: 'error'; error: string; missing: boolean }

/** One report from the engine, read again when its query changes. */
export function useReport<T extends ReportData>(query: ReportQuery | null): ReportState<T> | null {
  const [state, setState] = useState<ReportState<T> | null>(null)
  const key = query ? `${query.kind}|${query.window ?? ''}|${query.id ?? ''}` : ''
  useEffect(() => {
    if (!query) {
      setState(null)
      return undefined
    }
    let alive = true
    setState({ status: 'loading' })
    void fetchReport(query).then((res) => {
      if (!alive) return
      setState(res.ok ? { status: 'ok', data: res.data as T } : { status: 'error', error: res.error, missing: res.status === 404 })
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state
}

/** Where the numbers come from and whether the window is really covered. */
export function SourceLine({ env }: { env: ReportEnvelope }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.reportsView.source
  const s = sourceOf(env)
  const text =
    s.from === 'store'
      ? s.complete
        ? t.storeComplete
        : t.storeCut
      : s.from === 'ring'
        ? s.complete
          ? t.ringComplete
          : s.oldest
            ? t.ringCut(formatDateTime(s.oldest, lang))
            : t.ringCutUnknown
        : t.unknown
  return (
    <p className="v2-rep-source" data-complete={s.complete}>
      <i aria-hidden="true" />
      <span>{text}</span>
      <span className="v2-dim"> · {dict.v2.reportsView.generated(formatDateTime(env.generated_at, lang))}</span>
    </p>
  )
}

export function WindowSeg({ value, onChange }: { value: ReportWindowPreset; onChange: (w: ReportWindowPreset) => void }) {
  const { dict } = useI18n()
  const t = dict.v2.reportsView
  return (
    <div className="v2-seg" role="group" aria-label={t.windowAria}>
      {REPORT_WINDOWS.map((w) => (
        <button key={w} type="button" aria-pressed={w === value} onClick={() => onChange(w)}>
          {t.windows[w]}
        </button>
      ))}
    </div>
  )
}

/** JSON and CSV exactly as the engine serves them, and the print view. */
export function ReportActions({ query, onPrint }: { query: ReportQuery; onPrint?: () => void }) {
  const { dict } = useI18n()
  const t = dict.v2.reportsView
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState('')
  async function get(format: 'json' | 'csv') {
    const res = await downloadReport(query, format)
    if (res.ok) {
      setDone(format)
      setError('')
      window.setTimeout(() => setDone((d) => (d === format ? null : d)), 2500)
    } else setError(res.error)
  }
  return (
    <div className="v2-rep-actions">
      {(['json', 'csv'] as const).map((f) => (
        <button key={f} type="button" className="v2-btn" onClick={() => void get(f)}>
          <DownloadSimple aria-hidden="true" />
          {done === f ? `✓ ${t.downloaded}` : f.toUpperCase()}
        </button>
      ))}
      {onPrint && (
        <button type="button" className="v2-btn" onClick={onPrint}>
          <Printer aria-hidden="true" />
          {t.printView}
        </button>
      )}
      {error && (
        <p className="v2-small v2-warn" role="alert">
          {t.error(error)}
        </p>
      )}
    </div>
  )
}

export function Figure({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'warn' | 'ok' }) {
  return (
    <div className="v2-rep-fig" data-tone={tone}>
      <span className="v2-eyebrow">{label}</span>
      <b className="v2-mono">{value}</b>
      {note && <span className="v2-small v2-dim">{note}</span>}
    </div>
  )
}

/** A single stacked bar with its legend (counts and shares). */
export function Stacked({ parts, label }: { parts: { key: string; label: string; count: number; share: number; color: string }[]; label: string }) {
  const { lang } = useI18n()
  const pct = new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 0 })
  return (
    <div className="v2-rep-stack">
      <span className="v2-rep-stackbar" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.count}`).join(', ')}`}>
        {parts
          .filter((p) => p.count > 0)
          .map((p) => (
            <i key={p.key} style={{ ['--w' as string]: `${p.share * 100}%`, ['--c' as string]: p.color }} />
          ))}
      </span>
      <ul className="v2-rep-legend">
        {parts.map((p) => (
          <li key={p.key}>
            <i style={{ ['--c' as string]: p.color }} aria-hidden="true" />
            {p.label} <b className="v2-mono">{p.count}</b> <span className="v2-dim">{pct.format(p.share)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Ranked horizontal bars (label, bar, count). */
export function Bars({ rows }: { rows: { key: string; label: ReactNode; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <ul className="v2-bars v2-rep-bars">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="v2-rep-bar-label">{r.label}</span>
          <i aria-hidden="true">
            <b style={{ ['--w' as string]: `${(r.count / max) * 100}%` }} />
          </i>
          <span className="v2-mono">{r.count}</span>
        </li>
      ))}
    </ul>
  )
}

/** The loading and error states every report view shares. */
export function ReportStatus<T>({ state }: { state: ReportState<T> | null }) {
  const { dict } = useI18n()
  const t = dict.v2.reportsView
  if (!state || state.status === 'loading') return <p className="v2-small v2-dim">{t.loading}</p>
  if (state.status === 'error') return <p className="v2-small v2-warn">{state.missing ? t.notAvailable : t.error(state.error)}</p>
  return null
}
