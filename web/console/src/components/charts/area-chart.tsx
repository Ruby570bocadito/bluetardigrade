'use client'

// Single-series area chart over evenly spaced time buckets: 2px line,
// 10% wash, hairline solid grid, end marker with a surface ring and a
// snapping crosshair (pointer and arrow keys). An optional marker rail
// under the plot places discrete occurrences (alerts) on the same time
// axis without a second scale.

import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ChartTooltip, useElementWidth, type TooltipRow } from './chart-frame'
import { formatCompact, niceTicks } from '@/lib/soc-metrics'

export type AreaPoint = { start: number; end: number; value: number }
export type RailMarker = { key: string; t: number; color: string; label: string; detail?: string }

const M = { top: 10, right: 12, bottom: 24, left: 36 }

export function AreaChart({
  points,
  now,
  color = 'var(--series-1)',
  height = 168,
  ariaLabel,
  valueLabel,
  formatX,
  markers,
  markerLabel = 'alertas',
}: {
  points: AreaPoint[]
  now: number
  color?: string
  height?: number
  ariaLabel: string
  valueLabel: string
  formatX: (point: AreaPoint) => string
  markers?: RailMarker[]
  markerLabel?: string
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const [activeMarker, setActiveMarker] = useState<string | null>(null)
  const rail = markers ? 18 : 0
  const plotH = height - M.top - M.bottom - rail
  const plotW = Math.max(0, width - M.left - M.right)
  const max = Math.max(0, ...points.map((p) => p.value))
  const ticks = niceTicks(Math.max(max, 1), 3)
  const top = ticks[ticks.length - 1]
  const n = points.length
  const step = n > 1 ? plotW / (n - 1) : 0
  const x = (i: number) => M.left + i * step
  const y = (v: number) => M.top + plotH - (v / top) * plotH
  const span = n > 0 ? points[n - 1].end - points[0].start : 1
  const xOfTime = (t: number) => M.left + ((t - points[0].start) / span) * plotW

  let line = ''
  let area = ''
  if (n > 0 && width > 0) {
    const pts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
    const base = (M.top + plotH).toFixed(1)
    line = 'M' + pts.join(' L')
    area = `M${x(0).toFixed(1)},${base} L${pts.join(' L')} L${x(n - 1).toFixed(1)},${base} Z`
  }

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

  const xLabels = useMemo(() => {
    if (n < 2) return []
    const wanted = width < 420 ? 3 : 5
    return Array.from({ length: wanted }, (_, k) => Math.round((k * (n - 1)) / (wanted - 1)))
  }, [n, width])

  const marker = markers?.find((m) => m.key === activeMarker)
  const tooltipRows: TooltipRow[] | null =
    active !== null && points[active]
      ? [{ key: 'v', color, value: points[active].value.toLocaleString('es-ES'), label: valueLabel }]
      : null
  if (tooltipRows && markers && active !== null) {
    const p = points[active]
    const inBucket = markers.filter((m) => m.t >= p.start && m.t < p.end).length
    if (inBucket > 0) tooltipRows.push({ key: 'm', color: 'var(--viz-ink-2)', value: inBucket, label: markerLabel, shape: 'dot' })
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
          <path d={area} fill={color} fillOpacity={0.1} />
          <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {active === null && points[n - 1].value > 0 && (
            <circle cx={x(n - 1)} cy={y(points[n - 1].value)} r={4} fill={color} stroke="var(--viz-surface)" strokeWidth={2} />
          )}
          {active !== null && (
            <g>
              <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + plotH} stroke="var(--viz-ink-2)" strokeOpacity={0.5} strokeWidth={1} shapeRendering="crispEdges" />
              <circle cx={x(active)} cy={y(points[active].value)} r={4.5} fill={color} stroke="var(--viz-surface)" strokeWidth={2} />
            </g>
          )}
          {markers && (
            <g>
              <line x1={M.left} x2={width - M.right} y1={M.top + plotH + rail / 2 + 4} y2={M.top + plotH + rail / 2 + 4} stroke="var(--viz-grid)" strokeWidth={1} shapeRendering="crispEdges" />
              {markers.map((m) => {
                const cx = xOfTime(m.t)
                if (cx < M.left - 1 || cx > width - M.right + 1) return null
                return (
                  <g key={m.key} onPointerEnter={() => setActiveMarker(m.key)} onPointerLeave={() => setActiveMarker(null)}>
                    <circle cx={cx} cy={M.top + plotH + rail / 2 + 4} r={12} fill="transparent" />
                    <circle cx={cx} cy={M.top + plotH + rail / 2 + 4} r={activeMarker === m.key ? 5 : 4} fill={m.color} stroke="var(--viz-surface)" strokeWidth={2} />
                  </g>
                )
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
              {formatX(points[i])}
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
      {tooltipRows && active !== null && (
        <ChartTooltip x={x(active)} y={M.top} width={width} title={formatX(points[active]) + ' · ' + bucketSpan(points[active], now)} rows={tooltipRows} />
      )}
      {marker && (
        <ChartTooltip
          x={xOfTime(marker.t)}
          y={M.top + plotH - 40}
          width={width}
          title={marker.detail ?? ''}
          rows={[{ key: marker.key, color: marker.color, value: marker.label, label: '', shape: 'dot' }]}
        />
      )}
    </div>
  )
}

function bucketSpan(p: AreaPoint, now: number): string {
  const s = Math.round((p.end - p.start) / 1000)
  return now - p.end < 1000 ? `últimos ${s} s` : `intervalo de ${s} s`
}
