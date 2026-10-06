// Console badge primitive (POL-7): the one shape every badge and chip
// shares — pill with border, tight padding, one text scale. Colors are
// NOT baked in beyond the two tokenized variants: THEME rule is that
// the accent lives in `--primary*` and DATA colors (severity, series)
// arrive via `className` from their own token maps, never as variants.

import { cn } from '@/lib/utils'

/** Tokenized variants; omit it to paint with caller classes (DATA). */
export type BadgeVariant = 'neutral' | 'accent'

const SHAPE =
  'inline-flex max-w-full min-w-0 items-center gap-1 truncate rounded-md border px-1.5 py-0.5 leading-none'
const VARIANTS: Record<BadgeVariant, string> = {
  neutral: 'border-zinc-800 bg-zinc-900 text-zinc-400',
  accent: 'border-primary/30 bg-primary-tint/10 text-primary-soft',
}

export function Badge({
  variant,
  mono = false,
  className,
  children,
  title,
}: {
  /** tokenized color variant; leave undefined for DATA colors via className */
  variant?: BadgeVariant
  /** mono scale: ids, techniques, tags, event types (10px mono) */
  mono?: boolean
  className?: string
  children: React.ReactNode
  /** native tooltip for truncated content */
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        SHAPE,
        mono ? 'font-mono text-[10px]' : 'text-[11px] font-medium',
        variant && VARIANTS[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}
