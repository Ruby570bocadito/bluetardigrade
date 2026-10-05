'use client'

// VIZ-1 — donut chart: annular sectors with angular gaps, the total in
// the center, hover/focus tooltip and keyboard navigation (arrows move
// the active slice, Escape clears). Colors arrive as validated tokens
// via props; slices below the label threshold stay tooltip+table only,
// so nothing is invented to fit the paint.

import { useState, type KeyboardEvent } from 'react'
import { ChartTooltip, useElementWidth } from './chart-frame'
import { formatCompact } from '@/lib/soc-metrics'
import type { DonutModel, DonutSlice } from '@/lib/donut'

const TAU = Math.PI * 2

function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.sin(angle), cy - r * Math.cos(angle)]
}

/** Annular sector from a0 to a1 (radians from 12 o'clock, clockwise). */
export function donutSector(cx: number, cy: number, rOut: number, rIn: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0
  const [x0, y0] = polar(cx, cy, rOut, a0)
  const [x1, y1] = polar(cx, cy, rOut, a1)
  const [x2, y2] = polar(cx, cy, rIn, a1)
  const [x3, y3] = polar(cx, cy, rIn, a0)
  return `M${x0},${y0} A${rOut},${rOut} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${rIn},${rIn} 0 ${large} 0 ${x3},${y3} Z`
}

export function DonutChart({
  model,
  colors,
  unit,
  ariaLabel,
  size = 190,
  thickness = 26,
}: {
  model: DonutModel
  /** slice key → fill (token or validated color) */
  colors: Record<string, string>
  /** what the center total counts («alertas», «equipos») */
  unit: string
  ariaLabel: string
  size?: number
  thickness?: number
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const cx = Math.max(size / 2, width / 2)
  const cy = size / 2
  const rOut = size / 2 - 2
  const rIn = rOut - thickness
  const total = model.total
  const slices = model.slices

  // visible slices get one equal angular gap between them; a single
  // slice draws complete (a lone portion has no neighbor to separate)
  // and slices thinner than the gap draw their full span (no clipping)
  const gap = slices.length > 1 ? Math.min(0.04, TAU / (slices.length * 12)) : 0
  let angle = 0
  const arcs = slices.map((s) => {
    const span = total ? (s.value / total) * TAU : 0
    const inset = span > gap ? gap / 2 : 0
    const a0 = angle + inset
    const a1 = angle + span - inset
    angle += span
    return { slice: s, a0, a1 }
  })

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      const from = active ?? slices.length - 1
      setActive(Math.min(slices.length - 1, from + 1))
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      const from = active ?? 0
      setActive(Math.max(0, from - 1))
    } else if (e.key === 'Escape') setActive(null)
  }

  const activeSlice: DonutSlice | null = active !== null ? slices[active] ?? null : null

  return (
    <div
      ref={ref}
      role="img"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={onKey}
      onBlur={() => setActive(null)}
      className="relative mx-auto flex min-h-0 justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ height: size }}
    >
      {width > 0 && (
        <svg width={width} height={size} aria-hidden className="block">
          {total > 0 && arcs.map(({ slice, a0, a1 }, i) => (
            <path
              key={slice.key}
              d={donutSector(cx, cy, rOut, rIn, a0, a1)}
              fill={colors[slice.key] ?? 'var(--series-other)'}
              opacity={active === null || active === i ? 1 : 0.4}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
            >
              <title>{`${slice.label}: ${slice.value} (${Math.round((slice.value / total) * 100)} %)`}</title>
            </path>
          ))}
          <text x={cx} y={cy - 4} textAnchor="middle" className="fill-zinc-100 text-xl font-semibold tabular-nums">
            {formatCompact(total)}
          </text>
          <text x={cx} y={cy + 14} textAnchor="middle" className="fill-zinc-500 text-[10px] uppercase tracking-wider">
            {unit}
          </text>
        </svg>
      )}
      {activeSlice && total > 0 && (
        <ChartTooltip
          x={cx}
          y={cy - rOut / 2}
          width={width}
          title={`${unit} de ${activeSlice.label}`}
          rows={[
            { key: activeSlice.key, color: colors[activeSlice.key] ?? 'var(--series-other)', value: activeSlice.value, label: `${Math.round((activeSlice.value / total) * 100)} % del total` },
          ]}
        />
      )}
    </div>
  )
}
