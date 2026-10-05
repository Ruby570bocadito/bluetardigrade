'use client'

// Console tab kit — the POL-7 base for tabbed sections. One shared look
// (the pill list the detection hub already used) plus a proper roving
// tabindex tablist: ArrowLeft/ArrowRight/Home/End move focus and select,
// like the WAI-ARIA tabs pattern. Every consumer keeps its own state,
// labels, icons, counts and deep links — this file only owns the
// container classes, the tab-button classes and the keyboard wiring, so
// all tabbed sections of the console look and behave the same.

import { useCallback, useRef } from 'react'

/** Bordered pill container for a row of tabs. */
export const TABLIST_CLASS = 'flex flex-wrap items-center gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1'

/** Classes of one tab button; `active` is the selected tab's pill. */
export function tabButtonClass(active: boolean): string {
  return `inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    active
      ? 'bg-primary-tint/15 text-primary-soft ring-1 ring-inset ring-primary/25'
      : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100'
  }`
}

export type ConsoleTab<K extends string> = {
  id: K
  label: string
  icon?: React.ElementType
  /** optional counter shown as a small chip after the label */
  count?: number
}

/**
 * Accessible tablist with roving tabindex (WAI-ARIA tabs): the selected
 * tab is the only tab stop; ArrowLeft/ArrowRight cycle, Home/End jump.
 * `onSelect` fires on click and on arrow selection; callers render the
 * matching `role="tabpanel"` themselves (they own its content).
 */
export function ConsoleTablist<K extends string>({
  tabs,
  value,
  onSelect,
  ariaLabel,
  /** stable id prefix: tab ids are `tab-${idPrefix}-${id}`, so the panel
      can point back with aria-labelledby */
  idPrefix,
}: {
  tabs: readonly ConsoleTab<K>[]
  value: K
  onSelect: (id: K) => void
  ariaLabel: string
  idPrefix: string
}) {
  const refs = useRef<Map<K, HTMLButtonElement>>(new Map())
  const select = useCallback(
    (id: K) => {
      onSelect(id)
      // roving tabindex: focus follows selection so keyboard users land
      // on the tab they just activated
      refs.current.get(id)?.focus()
    },
    [onSelect],
  )
  const onTablistKeyDown = (e: React.KeyboardEvent) => {
    const ids = tabs.map((t) => t.id)
    const at = ids.indexOf(value)
    let next: number | null = null
    if (e.key === 'ArrowRight') next = (at + 1) % ids.length
    else if (e.key === 'ArrowLeft') next = (at - 1 + ids.length) % ids.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = ids.length - 1
    if (next !== null) {
      e.preventDefault()
      select(ids[next])
    }
  }
  return (
    <div role="tablist" aria-label={ariaLabel} className={TABLIST_CLASS} onKeyDown={onTablistKeyDown}>
      {tabs.map(({ id, label, icon: Icon, count }) => {
        const active = id === value
        return (
          <button
            key={id}
            ref={(el) => {
              if (el) refs.current.set(id, el)
              else refs.current.delete(id)
            }}
            type="button"
            role="tab"
            id={`tab-${idPrefix}-${id}`}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(id)}
            className={tabButtonClass(active)}
          >
            {Icon && <Icon size={14} weight={active ? 'fill' : 'regular'} aria-hidden className={active ? 'text-primary' : ''} />}
            {label}
            {count !== undefined && <span className="rounded bg-white/[0.06] px-1.5 text-[10px] tabular-nums text-zinc-400">{count}</span>}
          </button>
        )
      })}
    </div>
  )
}
