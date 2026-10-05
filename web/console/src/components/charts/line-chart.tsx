'use client'

// Multi-series line chart on evenly spaced samples: 2px lines that BREAK
// on unobserved slots (a gap is never interpolated), a snapping
// crosshair whose tooltip lists every series at that sample, and end
// markers on the last observed point of each series. Same visual
// grammar as AreaChart: hairline grid, es-ES numerals, keyboard nav,
// no animation (respects prefers-reduced-motion by construction).

import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ChartTooltip, useElementWidth, type TooltipRow } from './chart-frame'
import { formatCompact, niceTicks } from '@/lib/soc-metrics'

export type LineSeries = { key: string; label: string; color: string }
export type LineSlot = { t: number; values: Record<string, number | null> }

const M = { top: 10, right: 12, bottom: 24, left: 40 }

export function LineChart({
  series,
  slots,
  height = 196,
  ariaLabel,
  valueLabel,
  formatT,
  gapText = 'sin muestra del motor',
}: {
  series: LineSeries[]
  /** one entry per grid slot, oldest first; a null value breaks the line */
  slots: LineSlot[]
  height?: number
  ariaLabel: string
  valueLabel: string
  formatT: (t: number) => string
  /** tooltip readout for a slot with no observation at all */
  gapText?: string
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const plotH = height - M.top - M.bottom
  const plotW = Math.max(0, width - M.left - M.right)
  const n = slots.length
  const max = Math.max(0, ...slots.flatMap((s) => series.map((sr) => s.values[sr.key] ?? 0)))
  const ticks = niceTicks(Math.max(max, 1), 3)
  const top = ticks[ticks.length - 1]
  const step = n > 1 ? plotW / (n - 1) : 0
  const x = (i: number) => M.left + i * step
  const y = (v: number) => M.top + plotH - (v / top) * plotH

  // one polyline path per series, broken at null values (no bridges)
  const paths = series.map((sr) => {
    let d = ''
    let open = false
    slots.forEach((slot, i) => {
      const v = slot.values[sr.key]
      if (v === null || v === undefined) {
        open = false
        return
      }
      d += `${open ? ' L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
      open = true
    })
    return d
  })
  const lastSeen = series.map((sr) => {
    for (let i = n - 1; i >= 0; i--) {
      const v = slots[i]?.values[sr.key]
      if (v !== null && v !== undefined) return { i, v }
    }
    return null
  })

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const i = Math.round((e.clientX - box.left) / Math.max(step, 1))
    setActive(Math.min(n - 1, Math.max(0, i)))
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const from = active ?? n - 1
      setActive(Math.min(n - 1, Math.max(0, from + (e.key === 'ArrowRight' ? 1 : -1))))
    } else if (e.key === 'Escape') setActive(null)
  }

  const xLabels = n >= 2 ? [0, Math.round((n - 1) / 2), n - 1].filter((v, i, arr) => arr.indexOf(v) === i) : []

  const slot = active !== null ? slots[active] : null
  const tooltipRows: TooltipRow[] | null = slot
    ? series.map((sr) => {
        const v = slot.values[sr.key]
        return v === null || v === undefined
          ? { key: sr.key, color: 'var(--viz-muted)', value: '—', label: sr.label }
          : { key: sr.key, color: sr.color, value: v.toLocaleString('es-ES'), label: sr.label, shape: 'line' as const }
      })
    : null
  const slotIsGap = slot ? series.every((sr) => slot.values[sr.key] === null || slot.values[sr.key] === undefined) : false

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
      {width > 0 && n > 0 && (
        <svg width={width} height={height} aria-hidden className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-zinc-500 text-[10px] tabular-nums">
                {formatCompact(t)}
              </text>
            </g>
          ))}
          {series.map((sr, si) => (
            <path key={sr.key} d={paths[si]} fill="none" stroke={sr.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {active === null &&
            lastSeen.map((ls, si) =>
              ls ? <circle key={series[si].key} cx={x(ls.i)} cy={y(ls.v)} r={3.5} fill={series[si].color} stroke="var(--viz-surface)" strokeWidth={2} /> : null,
            )}
          {active !== null && (
            <g>
              <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + plotH} stroke="var(--viz-ink-2)" strokeOpacity={0.5} strokeWidth={1} shapeRendering="crispEdges" />
              {series.map((sr, si) => {
                const v = slot?.values[sr.key]
                if (v === null || v === undefined) return null
                return <circle key={sr.key} cx={x(active)} cy={y(v)} r={4.5} fill={sr.color} stroke="var(--viz-surface)" strokeWidth={2} />
              })}
            </g>
          )}
          {xLabels.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={height - 6}
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
              className="fill-zinc-500 text-[10px] tabular-nums"
            >
              {formatT(slots[i].t)}
            </text>
          ))}
          <rect
            x={M.left}
            y={M.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
      )}
      {tooltipRows && slot && (
        <ChartTooltip
          x={x(active!)}
          y={M.top}
          width={width}
          title={formatT(slot.t) + (slotIsGap ? ` · ${gapText}` : '')}
          rows={slotIsGap ? [{ key: 'gap', color: 'var(--viz-muted)', value: '—', label: gapText }] : tooltipRows}
        />
      )}
    </div>
  )
}
