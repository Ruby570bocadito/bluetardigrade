'use client'

// Stacked columns over time buckets: columns <= 24px, 4px rounded data
// end on the top segment only (square at the baseline), 2px surface gap
// between segments, one shared y axis. The whole column slot is the hit
// target; the tooltip lists every series in that column.

import { useState, type KeyboardEvent } from 'react'
import { ChartTooltip, useElementWidth } from './chart-frame'
import { formatCompact, niceTicks } from '@/lib/soc-metrics'

export type ColumnSeries = { key: string; label: string; color: string }
export type ColumnBucket = { key: string; label: string; detail: string; values: Record<string, number> }

const M = { top: 10, right: 8, bottom: 24, left: 32 }
const GAP = 2

function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`
}

export function StackedColumns({
  buckets,
  series,
  height = 176,
  ariaLabel,
  unit,
}: {
  buckets: ColumnBucket[]
  series: ColumnSeries[]
  height?: number
  ariaLabel: string
  unit: string
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const plotH = height - M.top - M.bottom
  const plotW = Math.max(0, width - M.left - M.right)
  const totals = buckets.map((b) => series.reduce((sum, s) => sum + (b.values[s.key] ?? 0), 0))
  const ticks = niceTicks(Math.max(1, ...totals), 3)
  const top = ticks[ticks.length - 1]
  const slot = buckets.length > 0 ? plotW / buckets.length : 0
  const barW = Math.max(2, Math.min(24, slot * 0.62))
  const y = (v: number) => M.top + plotH - (v / top) * plotH
  const labelEvery = Math.max(1, Math.ceil(buckets.length / (width < 420 ? 4 : 6)))

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const from = active ?? buckets.length - 1
      setActive(Math.min(buckets.length - 1, Math.max(0, from + (e.key === 'ArrowRight' ? 1 : -1))))
    } else if (e.key === 'Escape') setActive(null)
  }

  return (
    <div
      ref={ref}
      role="img"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={onKey}
      onBlur={() => setActive(null)}
      className="relative rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ height }}
    >
      {width > 0 && (
        <svg width={width} height={height} aria-hidden className="block">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-zinc-500 text-[10px] tabular-nums">
                {formatCompact(t)}
              </text>
            </g>
          ))}
          {buckets.map((b, i) => {
            const cx = M.left + slot * i + slot / 2
            let acc = 0
            const segments = series
              .map((s) => ({ s, v: b.values[s.key] ?? 0 }))
              .filter((seg) => seg.v > 0)
            const dim = active !== null && active !== i
            return (
              <g key={b.key} opacity={dim ? 0.45 : 1}>
                {segments.map((seg, k) => {
                  const y0 = y(acc)
                  acc += seg.v
                  const y1 = y(acc)
                  const isTop = k === segments.length - 1
                  // the surface gap is carved from the top of every segment
                  // except the topmost, so stacks stay one consistent height
                  const h = Math.max(1, y0 - y1 - (isTop ? 0 : GAP))
                  const yTop = isTop ? y1 : y1 + GAP
                  return isTop ? (
                    <path key={seg.s.key} d={topRounded(cx - barW / 2, yTop, barW, h, 4)} fill={seg.s.color} />
                  ) : (
                    <rect key={seg.s.key} x={cx - barW / 2} y={yTop} width={barW} height={h} fill={seg.s.color} />
                  )
                })}
                <rect
                  x={M.left + slot * i}
                  y={M.top}
                  width={slot}
                  height={plotH}
                  fill="transparent"
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                />
                {i % labelEvery === 0 || i === buckets.length - 1 ? (
                  <text x={cx} y={height - 6} textAnchor="middle" className="fill-zinc-500 text-[10px] tabular-nums">
                    {b.label}
                  </text>
                ) : null}
              </g>
            )
          })}
        </svg>
      )}
      {active !== null && buckets[active] && (
        <ChartTooltip
          x={M.left + slot * active + slot / 2}
          y={M.top}
          width={width}
          title={buckets[active].detail}
          rows={[
            ...series.map((s) => ({ key: s.key, color: s.color, value: buckets[active].values[s.key] ?? 0, label: s.label })),
            { key: '__total', color: 'transparent', value: totals[active], label: unit },
          ]}
        />
      )}
    </div>
  )
}
