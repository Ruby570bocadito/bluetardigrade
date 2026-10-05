'use client'

// VIZ-2 — weekday × hour alert-load heatmap: one-hue sequential ramp
// (darker steps = more alerts, never a rainbow), the count printed in
// every non-zero cell in ink picked by the cell's luminance, a 2px
// surface gap between cells and a title tooltip per cell. The grid is a
// real table, so it is its own table view, like the host × tactic
// heatmap; the chart/table toggle swaps to a per-day quarter summary.

import { useState } from 'react'
import type { WeekHourGrid } from '@/lib/alert-heatmap'
import { WEEKDAYS_LONG, WEEKDAYS_SHORT } from '@/lib/alert-heatmap'
import { cn } from '@/lib/utils'

const RAMP = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)']

function step(value: number, max: number): number {
  if (value <= 0 || max <= 0) return -1
  return Math.min(RAMP.length - 1, Math.ceil((value / max) * RAMP.length) - 1)
}

function hh(hour: number): string {
  return String(hour).padStart(2, '0')
}

export function WeekHourHeatmap({ grid }: { grid: WeekHourGrid }) {
  const [hover, setHover] = useState<string | null>(null)
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full border-separate text-xs" style={{ borderSpacing: 2 }}>
        <caption className="sr-only">
          Alertas por día de la semana y hora local en la ventana recibida
        </caption>
        <thead>
          <tr>
            <th scope="col" className="w-8 px-1 pb-1.5 text-left text-[11px] font-medium text-zinc-500">
              Día
            </th>
            {Array.from({ length: 24 }, (_, hour) => (
              <th
                key={hour}
                scope="col"
                title={`${hh(hour)}:00–${hh(hour)}:59`}
                className="min-w-6 px-0.5 pb-1.5 text-center text-[10px] font-medium tabular-nums text-zinc-500"
              >
                {hour % 3 === 0 ? hh(hour) : ''}
              </th>
            ))}
            <th scope="col" className="w-12 px-2 pb-1.5 text-right text-[11px] font-medium text-zinc-500">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {grid.grid.map((row, day) => {
            const dayTotal = row.reduce((sum, value) => sum + value, 0)
            return (
              <tr key={WEEKDAYS_SHORT[day]}>
                <th scope="row" title={WEEKDAYS_LONG[day]} className="px-1 text-left text-[11px] font-normal text-zinc-400">
                  {WEEKDAYS_SHORT[day]}
                </th>
                {row.map((value, hour) => {
                  const s = step(value, grid.max)
                  const key = `${day}|${hour}`
                  return (
                    <td
                      key={hour}
                      title={`${WEEKDAYS_LONG[day]} ${hh(hour)}:00–${hh(hour)}:59 · ${value} ${value === 1 ? 'alerta' : 'alertas'}`}
                      onPointerEnter={() => setHover(key)}
                      onPointerLeave={() => setHover(null)}
                      className={cn(
                        'h-6 rounded-[4px] text-center text-[10px] font-medium tabular-nums transition-[filter]',
                        s < 0 ? 'bg-white/[0.025] text-zinc-600' : s >= 3 ? 'text-[#07111f]' : 'text-white',
                        hover === key && 'brightness-125',
                      )}
                      style={s >= 0 ? { background: RAMP[s] } : undefined}
                    >
                      {value || ''}
                    </td>
                  )
                })}
                <td className="px-2 text-right text-[11px] font-medium tabular-nums text-zinc-200">{dayTotal}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500">
        <span>menos</span>
        <span aria-hidden className="inline-flex gap-[2px]">
          {RAMP.map((c) => (
            <span key={c} className="h-2.5 w-5 rounded-sm" style={{ background: c }} />
          ))}
        </span>
        <span>más alertas (máximo {grid.max} por celda)</span>
      </div>
    </div>
  )
}
