'use client'

// Small pieces shared by the lenses of Investigar.
import type { ReactNode } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import type { SfEvent } from '@/lib/console-types'
import { tableToCsv } from '@/lib/chart-export'
import { eventTarget, histogram, kindOf, type EventKind } from '@/lib/v2/investigate-model'

/** The word a kind chip writes into the query, in the console language. */
export const KIND_WORD: Record<'es' | 'en', Record<EventKind, string>> = {
  es: { process: 'proceso', network: 'red', dns: 'dns', file: 'fichero', registry: 'registro', image: 'modulo', other: 'otro' },
  en: { process: 'process', network: 'network', dns: 'dns', file: 'file', registry: 'registry', image: 'image', other: 'other' },
}

export function KindChip({ ev, kind }: { ev?: Pick<SfEvent, 'type'>; kind?: EventKind }) {
  const { dict } = useI18n()
  const k = kind ?? (ev ? kindOf(ev) : 'other')
  return (
    <span className="v2-kind" data-kind={k} title={ev?.type}>
      {dict.v2.investigateView.kinds[k]}
    </span>
  )
}

/** "60 s", "2 min 05 s", "1 h 04 min" — a gap between connections. */
export function formatGap(ms: number, lang: 'es' | 'en'): string {
  const s = ms / 1000
  if (s < 1) return `${Math.round(ms)} ms`
  if (s < 60) return `${s < 10 ? s.toFixed(1).replace('.', lang === 'es' ? ',' : '.') : Math.round(s)} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${String(Math.round(s % 60)).padStart(2, '0')} s`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}

export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function eventsCsv(events: readonly SfEvent[]): string {
  return tableToCsv(
    ['timestamp', 'host', 'type', 'user', 'process', 'pid', 'ppid', 'command_line', 'target', 'id'],
    events.map((e) => [
      e.timestamp, e.host, e.type, e.user ?? '', e.process?.name ?? '', e.process?.pid ?? '', e.process?.ppid ?? '',
      e.process?.command_line ?? '', eventTarget(e), e.id,
    ]),
  )
}

export function eventsJsonl(events: readonly SfEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n'
}

export function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
}

/** Events over time as a strip of bars; `hot` paints the ones that matter in amber. */
export function HistStrip({
  events,
  from,
  to,
  buckets = 64,
  hot,
  children,
}: {
  events: readonly SfEvent[]
  from: number
  to: number
  buckets?: number
  hot?: readonly SfEvent[]
  children?: ReactNode
}) {
  const { dict, lang } = useI18n()
  const counts = histogram(events, from, to, buckets)
  const hotCounts = hot ? histogram(hot, from, to, buckets) : null
  const max = Math.max(1, ...counts)
  // a short span shows its seconds, a long one its day
  const span = to - from
  const time = (ms: number) =>
    new Date(ms).toLocaleString(lang === 'en' ? 'en-GB' : 'es-ES', {
      ...(span > 36 * 3_600_000 ? { day: '2-digit', month: 'short' } : {}),
      hour: '2-digit',
      minute: '2-digit',
      ...(span < 2 * 3_600_000 ? { second: '2-digit' } : {}),
    })
  return (
    <div className="v2-hist">
      <div className="v2-hist-bars" role="img" aria-label={dict.v2.investigateView.histAria(events.length)}>
        {counts.map((c, i) => (
          <span key={i} style={{ ['--h' as string]: `${(c / max) * 100}%`, ['--i' as string]: i }}>
            {hotCounts && hotCounts[i] > 0 && <i style={{ height: `${(hotCounts[i] / Math.max(1, c)) * 100}%` }} />}
          </span>
        ))}
        {children}
      </div>
      <div className="v2-hist-axis v2-mono" aria-hidden="true">
        <span>{time(from)}</span>
        <span>{time(from + (to - from) / 2)}</span>
        <span>{time(to)}</span>
      </div>
    </div>
  )
}
