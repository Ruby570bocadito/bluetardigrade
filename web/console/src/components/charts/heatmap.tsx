'use client'

// Host x ATT&CK tactic heatmap: one-hue sequential ramp (darker steps =
// fewer alerts, never a rainbow), the count printed in every cell in ink
// picked by the cell's luminance, a 2px surface gap between cells and a
// hover tooltip. The grid is a real table, so it is its own table view.

import { useState } from 'react'
import type { HostTacticMatrix } from '@/lib/soc-metrics'
import { cn } from '@/lib/utils'

const RAMP = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)']

function step(value: number, max: number): number {
  if (value <= 0 || max <= 0) return -1
  return Math.min(RAMP.length - 1, Math.ceil((value / max) * RAMP.length) - 1)
}

export function HostTacticHeatmap({ matrix, onHost }: { matrix: HostTacticMatrix; onHost?: (host: string) => void }) {
  const [hover, setHover] = useState<string | null>(null)
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full border-separate text-xs" style={{ borderSpacing: 2 }}>
        <caption className="sr-only">Alertas por equipo y táctica de MITRE ATT&CK en la ventana recibida</caption>
        <thead>
          <tr>
            <th scope="col" className="w-40 px-2 pb-1.5 text-left text-[11px] font-medium text-zinc-500">Equipo</th>
            {matrix.tactics.map((t) => (
              <th key={t.slug} scope="col" title={t.label} className="min-w-14 px-1 pb-1.5 text-center text-[11px] font-medium text-zinc-500">
                {t.short}
              </th>
            ))}
            <th scope="col" className="w-14 px-2 pb-1.5 text-right text-[11px] font-medium text-zinc-500">Total</th>
          </tr>
        </thead>
        <tbody>
          {matrix.hosts.map(({ host, total }) => (
            <tr key={host}>
              <th scope="row" className="max-w-40 truncate px-2 text-left font-mono text-[11px] font-normal text-zinc-300">
                {onHost ? (
                  <button
                    type="button"
                    onClick={() => onHost(host)}
                    aria-label={`Ver alertas de ${host}`}
                    className="max-w-full truncate rounded-sm text-left hover:text-primary-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {host}
                  </button>
                ) : (
                  host
                )}
              </th>
              {matrix.tactics.map((t) => {
                const value = matrix.cells[host]?.[t.slug] ?? 0
                const s = step(value, matrix.max)
                const key = host + '|' + t.slug
                return (
                  <td
                    key={t.slug}
                    title={`${host} · ${t.label}: ${value} alertas`}
                    onPointerEnter={() => setHover(key)}
                    onPointerLeave={() => setHover(null)}
                    className={cn(
                      'h-9 rounded-[5px] text-center text-[11px] font-medium tabular-nums transition-[filter]',
                      s < 0 ? 'bg-white/[0.025] text-zinc-500' : s >= 3 ? 'text-[#07111f]' : 'text-white',
                      hover === key && 'brightness-125',
                    )}
                    style={s >= 0 ? { background: RAMP[s] } : undefined}
                  >
                    {value || ''}
                  </td>
                )
              })}
              <td className="px-2 text-right font-medium tabular-nums text-zinc-200">{total}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500">
        <span>menos</span>
        <span aria-hidden className="inline-flex gap-[2px]">
          {RAMP.map((c) => (
            <span key={c} className="h-2.5 w-5 rounded-sm" style={{ background: c }} />
          ))}
        </span>
        <span>más alertas (máximo {matrix.max} por celda)</span>
      </div>
    </div>
  )
}
