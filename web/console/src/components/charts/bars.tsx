'use client'

// HTML bar pieces: horizontal bar list, part-to-whole segment bar, meter
// and sparkline. Bars are thin (8px), square at the baseline with a 4px
// rounded data end; the value sits at the tip in ink, never in the mark
// color. Lists are real lists (and rows real buttons when actionable),
// so the chart is its own table twin.

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type BarRow = {
  key: string
  label: ReactNode
  value: number
  display?: ReactNode
  hint?: ReactNode
  color?: string
  title?: string
  onSelect?: () => void
  selectLabel?: string
}

export function BarList({ rows, max, color = 'var(--series-1)', className, empty }: { rows: BarRow[]; max?: number; color?: string; className?: string; empty?: ReactNode }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value))
  if (rows.length === 0) return <>{empty}</>
  return (
    <ul className={cn('space-y-2.5', className)}>
      {rows.map((row) => {
        const pct = top > 0 ? (row.value / top) * 100 : 0
        const body = (
          <>
            <span className="flex items-baseline gap-3">
              <span className="min-w-0 flex-1 truncate text-xs text-zinc-300" title={row.title}>{row.label}</span>
              {row.hint && <span className="shrink-0 text-[11px] text-zinc-500">{row.hint}</span>}
              <span className="w-12 shrink-0 text-right text-xs font-medium tabular-nums text-zinc-100">{row.display ?? row.value.toLocaleString('es-ES')}</span>
            </span>
            <span aria-hidden className="mt-1.5 block h-2 w-full rounded-r-[4px] bg-zinc-800/50">
              <span
                className="block h-2 rounded-r-[4px] transition-[width] duration-500 ease-out motion-reduce:transition-none"
                style={{ width: row.value > 0 ? `${Math.max(1.5, pct)}%` : '0%', background: row.color ?? color }}
              />
            </span>
          </>
        )
        return (
          <li key={row.key}>
            {row.onSelect ? (
              <button
                type="button"
                onClick={row.onSelect}
                aria-label={row.selectLabel}
                className="block w-full rounded-md px-1 py-0.5 text-left transition-colors hover:bg-zinc-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {body}
              </button>
            ) : (
              <div className="px-1 py-0.5">{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export type Segment = { key: string; label: string; value: number; color: string }

/** Part-to-whole bar with 2px surface gaps between segments. */
export function SegmentBar({ segments, height = 10, className, label }: { segments: Segment[]; height?: number; className?: string; label?: string }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  const shown = segments.filter((s) => s.value > 0)
  return (
    <div
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('flex w-full gap-[2px] overflow-hidden rounded-[4px] bg-zinc-800/50', className)}
      style={{ height }}
    >
      {total > 0 &&
        shown.map((s) => (
          <span
            key={s.key}
            title={`${s.label}: ${s.value}`}
            className="block h-full transition-[flex-grow] duration-500 ease-out motion-reduce:transition-none"
            style={{ flexGrow: s.value, flexBasis: 0, background: s.color, minWidth: 3 }}
          />
        ))}
    </div>
  )
}

/** Meter: fill carries the state, track is the same hue at low alpha. */
export function Meter({ value, max, color, className }: { value: number; max: number; color: string; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <span aria-hidden className={cn('relative block h-1.5 w-full overflow-hidden rounded-full', className)}>
      <span className="absolute inset-0 rounded-full opacity-20" style={{ background: color }} />
      <span
        className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
        style={{ width: value > 0 ? `${Math.max(3, pct)}%` : '0%', background: color }}
      />
    </span>
  )
}

/** Trend line for a stat tile: de-emphasis hue, current point in the accent. */
export function Sparkline({ values, width = 96, height = 28, color = 'var(--series-1)' }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) {
    return <svg aria-hidden width={width} height={height} className="block" />
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pad = 4
  const x = (i: number) => pad + (i * (width - pad * 2)) / (values.length - 1)
  const y = (v: number) => (max === min ? height / 2 : pad + (1 - (v - min) / span) * (height - pad * 2))
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const last = values.length - 1
  return (
    <svg aria-hidden width={width} height={height} className="block overflow-visible">
      <path d={d} fill="none" stroke="var(--series-other)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(values[last])} r={3} fill={color} stroke="var(--viz-surface)" strokeWidth={2} />
    </svg>
  )
}
