'use client'

// Chart container kit (dataviz method): every chart sits in a card that
// owns its title, legend and a table-view twin, so no value is reachable
// only through a hover tooltip. Charts are plain SVG measured with a
// ResizeObserver; colors come from the validated --sev-* / --series-*
// tokens in globals.css and text always wears the ink tokens.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ChartBar, Table } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

/** Width of an element, tracked with ResizeObserver (fallback for jsdom/SSR). */
export function useElementWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width) || fallback)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [fallback])
  return [ref, width] as const
}

export type TableTwin = {
  caption: string
  columns: string[]
  rows: (string | number)[][]
}

export type LegendItem = { key: string; label: string; color: string; value?: ReactNode; shape?: 'rect' | 'line' }

export function Legend({ items, className }: { items: LegendItem[]; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-zinc-400', className)}>
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={item.shape === 'line' ? 'h-0.5 w-3 shrink-0 rounded-full' : 'h-2.5 w-2.5 shrink-0 rounded-[3px]'}
            style={{ background: item.color }}
          />
          <span>{item.label}</span>
          {item.value !== undefined && <span className="font-medium tabular-nums text-zinc-200">{item.value}</span>}
        </li>
      ))}
    </ul>
  )
}

/**
 * Card with header (title, subtitle, actions), optional legend, the chart
 * body and a chart/table toggle. `table` is the accessible twin.
 */
export function ChartCard({
  title,
  subtitle,
  icon: Icon,
  actions,
  legend,
  table,
  footer,
  className,
  bodyClassName,
  children,
  label,
}: {
  title: string
  subtitle?: ReactNode
  icon?: React.ElementType
  actions?: ReactNode
  legend?: LegendItem[]
  table?: TableTwin
  footer?: ReactNode
  className?: string
  bodyClassName?: string
  children: ReactNode
  /** accessible name of the section (defaults to the title) */
  label?: string
}) {
  const [tableView, setTableView] = useState(false)
  const headingId = useId()
  return (
    <section aria-labelledby={label ? undefined : headingId} aria-label={label} className={cn('panel flex min-w-0 flex-col', className)}>
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          {Icon && (
            <span className="icon-tile mt-0.5">
              <Icon size={14} aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            <h2 id={headingId} className="text-sm font-medium text-zinc-100">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {table && (
            <button
              type="button"
              onClick={() => setTableView((v) => !v)}
              aria-pressed={tableView}
              title={tableView ? 'Ver gráfico' : 'Ver como tabla'}
              className="chip px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {tableView ? <ChartBar size={13} aria-hidden /> : <Table size={13} aria-hidden />}
              <span>{tableView ? 'Gráfico' : 'Tabla'}</span>
            </button>
          )}
        </div>
      </div>
      {legend && legend.length > 0 && !tableView && <Legend items={legend} className="px-4 pt-3" />}
      <div className={cn('min-w-0 flex-1 px-4 pb-4 pt-3', bodyClassName)}>
        {tableView && table ? <DataTable table={table} /> : children}
      </div>
      {footer && <div className="border-t border-white/[0.06] px-4 py-2.5 text-[11px] leading-relaxed text-zinc-500">{footer}</div>}
    </section>
  )
}

export function DataTable({ table }: { table: TableTwin }) {
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-zinc-800">
      <table className="w-full border-collapse text-left text-xs">
        <caption className="sr-only">{table.caption}</caption>
        <thead className="sticky top-0 bg-zinc-900">
          <tr>
            {table.columns.map((c, i) => (
              <th key={c} scope="col" className={cn('border-b border-zinc-800 px-3 py-2 font-medium text-zinc-400', i > 0 && 'text-right')}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/70">
          {table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) =>
                i === 0 ? (
                  <th key={i} scope="row" className="px-3 py-1.5 text-left font-normal text-zinc-300">{cell}</th>
                ) : (
                  <td key={i} className="px-3 py-1.5 text-right tabular-nums text-zinc-200">{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export type TooltipRow = { key: string; color: string; value: ReactNode; label: string; shape?: 'line' | 'dot' }

/** Hover readout: values lead, labels follow, short line keys. */
export function ChartTooltip({ x, y, width, title, rows }: { x: number; y: number; width: number; title: ReactNode; rows: TooltipRow[] }) {
  const flip = x > width - 180
  return (
    <div className="viz-tooltip" style={{ left: flip ? undefined : x + 12, right: flip ? width - x + 12 : undefined, top: Math.max(0, y) }}>
      <p className="mb-1 text-[11px] text-zinc-500">{title}</p>
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2">
            <span
              aria-hidden
              className={row.shape === 'dot' ? 'h-2 w-2 rounded-full' : 'h-0.5 w-2.5 rounded-full'}
              style={{ background: row.color }}
            />
            <span className="font-semibold tabular-nums text-zinc-50">{row.value}</span>
            <span className="truncate text-zinc-400">{row.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
