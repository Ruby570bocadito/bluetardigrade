'use client'

// One header chip for the engine's behavioral detectors (correlator,
// beaconing, thresholds, threat intel, process baseline) instead of one
// chip each: the header row no longer overflows, and the closed chip
// still carries the signal that matters (red when a tracker is full,
// amber when the intel lists matched). Rows and states: lib/detectors.ts.

import { useCallback, useRef, useState } from 'react'
import { Broadcast, CaretDown, FlowArrow, Gauge, ListMagnifyingGlass, Pulse, Timer } from '@phosphor-icons/react'
import type { ConsoleView } from './dashboard'
import type { EngineStats } from '@/lib/console-types'
import { detectorRows, worstState, type DetectorKey, type DetectorState } from '@/lib/detectors'
import { HeaderPopover } from './header-popover'

const ICON: Record<DetectorKey, React.ElementType> = {
  correlator: FlowArrow,
  beacons: Broadcast,
  thresholds: Gauge,
  intel: ListMagnifyingGlass,
  baseline: Timer,
}

// where a row leads, when there is a view for it
const VIEW: Partial<Record<DetectorKey, ConsoleView>> = { correlator: 'cadenas', intel: 'inteligencia', baseline: 'inteligencia' }

const CHIP_TONE: Record<DetectorState, string> = {
  ok: 'text-zinc-400',
  warn: 'border-amber-300/30 bg-amber-300/[0.06] text-amber-200',
  alert: 'border-red-400/40 bg-red-400/10 text-red-300',
}
const VALUE_TONE: Record<DetectorState, string> = { ok: 'text-zinc-200', warn: 'text-amber-200', alert: 'text-red-300' }

export function DetectorsMenu({ stats, onOpen }: { stats: EngineStats | null; onOpen: (view: ConsoleView) => void }) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])
  const rows = detectorRows(stats)
  const worst = worstState(rows)

  if (rows.length === 0) return null
  const full = rows.filter((r) => r.state === 'alert').length
  return (
    <div className="hidden shrink-0 lg:block">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Detectores: ${rows.length} activos${full ? `, ${full} al límite` : ''}`}
        title="Estado de los detectores de comportamiento"
        className={`chip gap-1.5 whitespace-nowrap px-2.5 py-1.5 font-mono text-[11px] transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${CHIP_TONE[worst]}`}
      >
        <Pulse size={12} aria-hidden />
        <span>{full ? `detectores · ${full} al límite` : `detectores ${rows.length}`}</span>
        <CaretDown size={10} aria-hidden className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <HeaderPopover anchorRef={anchorRef} open={open} onClose={close} label="Detectores de comportamiento" className="w-80 p-2">
          <ul className="space-y-0.5">
            {rows.map((row) => {
              const Icon = ICON[row.key]
              const view = VIEW[row.key]
              const body = (
                <>
                  <Icon size={14} aria-hidden className="mt-0.5 shrink-0 text-zinc-500" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-medium text-zinc-100">{row.label}</span>
                      <span className={`font-mono text-[11px] tabular-nums ${VALUE_TONE[row.state]}`}>{row.value}</span>
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">{row.detail}</span>
                  </span>
                </>
              )
              return (
                <li key={row.key}>
                  {view ? (
                    <button
                      type="button"
                      onClick={() => { setOpen(false); onOpen(view) }}
                      className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex items-start gap-2.5 px-2 py-2">{body}</div>
                  )}
                </li>
              )
            })}
          </ul>
      </HeaderPopover>
    </div>
  )
}
