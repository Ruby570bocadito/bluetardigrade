// Console table primitive (POL-7 Fase B): the shared surface for the six
// semantic tables of the console — sticky-header option, sr-only caption,
// sort semantics via aria-sort and an empty-state row. Colors are NOT baked
// in beyond the zinc structure: THEME rule is that the accent lives in
// `--primary*` and DATA colors arrive via `className` from the view's own
// token maps, never as variants. Extracted verbatim from the markup the
// views already ship (suppressions, live-feed, alerts, user-session, intel,
// rules) so the phase-B migration stays mechanical.

import { cn } from '@/lib/utils'
import type {
  HTMLAttributes,
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react'

/** Surface: full width, collapsed borders, left ink. Views add
 * `table-fixed`, `min-w-*` or the compact text scale via className. */
export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full border-collapse text-left text-sm', className)} {...props} />
}

/** Screen-reader-only caption describing what the table lists. */
export function TableCaption({ className, children }: { className?: string; children: ReactNode }) {
  return <caption className={cn('sr-only', className)}>{children}</caption>
}

/** Header band. `sticky` pins it over the scroll container (the
 * live-feed/alerts pattern: the pin lives on thead, the ink on the row). */
export function TableHeader({
  sticky,
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement> & { sticky?: boolean }) {
  return <thead className={cn(sticky && 'sticky top-0 z-10', className)} {...props} />
}

/** Head row: the zinc band every header paints over the pin. */
export function TableHeadRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('bg-zinc-900', className)} {...props} />
}

/** Column head. The `data` style (default) is the uppercase tracked label
 * with the bottom rule the data tables share; `compact` is the plain
 * medium-weight label of the small panels. `sort` publishes the order
 * through aria-sort — the view owns the actual button and logic. */
export function TableHead({
  compact,
  sort,
  className,
  children,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { compact?: boolean; sort?: 'ascending' | 'descending' }) {
  return (
    <th
      scope="col"
      aria-sort={sort}
      className={cn(
        compact
          ? 'px-2 py-1.5 font-medium'
          : 'border-b border-zinc-800 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500',
        className,
      )}
      {...props}
    >
      {children}
    </th>
  )
}

/** Body with the shared hairline between rows. */
export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-zinc-800/70', className)} {...props} />
}

/** Row. `interactive` adds the hover shift of the data tables; `selected`
 * takes the accent tint from `--primary*` (never a hue literal). The
 * selection semantics (aria-selected / the button inside) stay view-owned. */
export function TableRow({
  interactive,
  selected,
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean; selected?: boolean }) {
  return (
    <tr
      className={cn(
        'align-top',
        interactive && 'transition-colors hover:bg-zinc-900/60',
        selected && 'bg-primary-tint/10',
        className,
      )}
      {...props}
    />
  )
}

/** Cell. `compact` matches the small-panel density (px-2 py-1.5). */
export function TableCell({
  compact,
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { compact?: boolean }) {
  return <td className={cn(compact ? 'px-2 py-1.5' : 'px-4 py-2.5', className)} {...props} />
}

/** Empty-state row: one full-width muted cell; drop `EmptyState` or plain
 * text inside — the primitive only guarantees the colSpan and the ink. */
export function TableEmpty({
  colSpan,
  className,
  children,
}: {
  colSpan: number
  className?: string
  children: ReactNode
}) {
  return (
    <tr>
      <td colSpan={colSpan} className={cn('px-4 py-10 text-center text-sm text-zinc-500', className)}>
        {children}
      </td>
    </tr>
  )
}
