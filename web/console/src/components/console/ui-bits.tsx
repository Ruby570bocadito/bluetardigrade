'use client'

// Small shared pieces of the console design system: severity badge,
// mono tags, animated counters, section headers, empty/error states and
// skeletons. Motion only communicates state changes (MOTION 3): no
// decorative or infinite loops anywhere.

import { SEVERITY_STYLE, type Severity } from '@/lib/console-types'
import { cn } from '@/lib/utils'
import { SeverityIcon } from '@/components/charts/severity'
import { Badge } from '@/components/ui/badge'

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const s = SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.low
  // severity colors are DATA (SEVERITY_STYLE token map), not a badge
  // variant: they ride on className over the shared shape
  return (
    <Badge className={`${s.text} ${s.bg} ${s.border} ${className ?? ''}`}>
      <SeverityIcon severity={SEVERITY_STYLE[severity] ? severity : 'low'} size={11} />
      {s.label}
    </Badge>
  )
}

/** Stat tile: label, value (proportional sans figures) and a context line. */
export function StatTile({ icon: Icon, label, value, hint, warn = false }: { icon: React.ElementType; label: string; value: React.ReactNode; hint: React.ReactNode; warn?: boolean }) {
  return (
    <div className="panel px-4 py-3.5">
      <p className="flex items-center gap-2 text-xs text-zinc-400">
        <Icon size={15} aria-hidden className="text-primary" />
        {label}
      </p>
      <p className="mt-2 text-[26px] font-semibold leading-none text-zinc-50">{value}</p>
      <p className={`mt-1.5 truncate text-[11px] ${warn ? 'text-amber-300' : 'text-zinc-500'}`}>{hint}</p>
    </div>
  )
}

/** Mono chip for ids, techniques, tags, event types. */
export function MonoTag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Badge mono variant="neutral" title={typeof children === 'string' ? children : undefined} className={className}>
      {children}
    </Badge>
  )
}

export function SectionHeader({
  title,
  count,
  hint,
  action,
  className,
}: {
  title: string
  count?: number
  hint?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-2', className)}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-medium text-zinc-100">{title}</h2>
        {typeof count === 'number' && (
          <span className="font-mono text-xs tabular-nums text-zinc-500">{count}</span>
        )}
        {hint && <span className="truncate text-xs text-zinc-500">{hint}</span>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  )
}

/** Honest empty state: says what is missing and what to do about it. */
export function EmptyState({
  title,
  hint,
  icon: Icon,
  action,
  className,
}: {
  title: string
  hint?: string
  icon?: React.ElementType
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-1.5 px-6 py-10 text-center', className)}>
      {Icon && (
        <Icon size={20} aria-hidden className="mb-1 text-zinc-500" />
      )}
      <p className="text-sm text-zinc-300">{title}</p>
      {hint && <p className="max-w-[52ch] text-xs leading-relaxed text-zinc-500">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** Offline banner for a dependency that is genuinely unreachable. */
export function OfflineNotice({ title, hint }: { title: string; hint: string }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3.5 py-3"
    >
      <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-500" />
      <div className="min-w-0">
        <p className="text-sm text-zinc-200">{title}</p>
        <p className="mt-0.5 font-mono text-xs leading-relaxed text-zinc-500">{hint}</p>
      </div>
    </div>
  )
}

export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2.5', className)} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-4 animate-pulse rounded-sm bg-zinc-800/70"
          style={{ width: `${92 - ((i * 13) % 34)}%` }}
        />
      ))}
    </div>
  )
}

/** Screen-reader live region for streams (polite, no visual noise). */
export function LiveAnnouncer({ message }: { message: string }) {
  return (
    <p aria-live="polite" role="status" className="sr-only">
      {message}
    </p>
  )
}
