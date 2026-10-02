'use client'

// MITRE ATT&CK tactic strip: one cell per Enterprise tactic in kill-chain
// order. Cell shade = alerts in the console window (one-hue sequential
// ramp, never a rainbow); the rule count underneath shows detection
// coverage, so a tactic with no rules reads as a gap, not as "quiet".

import type { TacticCell } from '@/lib/soc-metrics'
import { cn } from '@/lib/utils'

const RAMP = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)']

function step(alerts: number, max: number): number {
  if (alerts <= 0 || max <= 0) return -1
  return Math.min(RAMP.length - 1, Math.ceil((alerts / max) * RAMP.length) - 1)
}

export function AttackMatrix({ cells, onSelect }: { cells: TacticCell[]; onSelect?: (cell: TacticCell) => void }) {
  const max = Math.max(0, ...cells.map((c) => c.alerts))
  return (
    <div>
      <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
        {cells.map((cell) => {
          const s = step(cell.alerts, max)
          // light ramp steps carry dark ink, dark steps white ink (contrast)
          const darkInk = s >= 3
          const name = `${cell.label}: ${cell.alerts} alertas en la ventana, ${cell.rules} reglas`
          const body = (
            <>
              <span className={cn('block truncate text-[11px]', s < 0 ? 'text-zinc-400' : darkInk ? 'text-[#07111f]/80' : 'text-white/80')} title={cell.label}>
                {cell.short}
              </span>
              <span className={cn('mt-1 block text-xl font-semibold leading-none', s < 0 ? 'text-zinc-500' : darkInk ? 'text-[#07111f]' : 'text-white')}>
                {cell.alerts}
              </span>
              <span className={cn('mt-1.5 block truncate text-[10px]', s < 0 ? (cell.rules ? 'text-zinc-500' : 'text-amber-300/80') : darkInk ? 'text-[#07111f]/75' : 'text-white/75')}>
                {cell.rules ? `${cell.rules} ${cell.rules === 1 ? 'regla' : 'reglas'}` : 'sin cobertura'}
              </span>
            </>
          )
          const style = s >= 0 ? { background: RAMP[s] } : undefined
          const base = 'block h-full w-full rounded-lg px-2.5 py-2 text-left'
          return (
            <li key={cell.slug}>
              {onSelect && cell.alerts > 0 ? (
                <button
                  type="button"
                  onClick={() => onSelect(cell)}
                  aria-label={`${name}. Ver alertas de esta táctica`}
                  title={cell.label}
                  style={style}
                  className={cn(base, 'transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--viz-surface)]')}
                >
                  {body}
                </button>
              ) : (
                <div aria-label={name} role="group" style={style} className={cn(base, s < 0 && 'border border-zinc-800 bg-zinc-900/60')}>
                  {body}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span>Alertas por táctica</span>
          <span aria-hidden className="inline-flex gap-[2px]">
            <span className="h-2.5 w-4 rounded-sm border border-zinc-800 bg-zinc-900/60" />
            {RAMP.map((c) => (
              <span key={c} className="h-2.5 w-4 rounded-sm" style={{ background: c }} />
            ))}
          </span>
          <span className="tabular-nums">0 – {max}</span>
        </span>
        <span>Las celdas sin reglas muestran «sin cobertura».</span>
      </div>
    </div>
  )
}
