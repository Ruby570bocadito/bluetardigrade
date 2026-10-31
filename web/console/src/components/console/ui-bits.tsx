'use client'

// Small shared pieces of the console design system: severity badge,
// mono tags, animated counters, section headers, empty/error states and
// skeletons. Motion only communicates state changes (MOTION 3): no
// decorative or infinite loops anywhere.

import { SEVERITY_STYLE, type Severity } from '@/lib/console-types'
import type { Health } from '@/lib/platform-status'
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

/** Stat tile: label, value (proportional sans figures) and a context line;
 * the icon takes the hue of the area it sits in (lib/areas.ts). */
export function StatTile({ icon: Icon, label, value, hint, warn = false }: { icon: React.ElementType; label: string; value: React.ReactNode; hint: React.ReactNode; warn?: boolean }) {
  return (
    <div className="panel px-4 py-3.5">
      <p className="flex items-center gap-2 text-xs text-zinc-400">
        <Icon size={16} weight="duotone" aria-hidden className="text-[color:var(--area,var(--primary))]" />
        {label}
      </p>
      <p className="mt-2 text-[26px] font-semibold leading-none text-zinc-50">{value}</p>
      <p className={`mt-1.5 truncate text-[11px] ${warn ? 'text-amber-300' : 'text-zinc-500'}`}>{hint}</p>
    </div>
  )
}

// the 200 inks: the pill sits on an area wash, and the light theme's
// 300 green fell to 4.49:1 there (axe, estado/light)
const HEALTH_PILL: Record<Health, string> = {
  ok: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
  warn: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  bad: 'border-red-400/30 bg-red-500/10 text-red-300',
  off: 'border-zinc-700 bg-zinc-800/40 text-zinc-400',
}

const HEALTH_DOT: Record<Health, string> = {
  ok: 'bg-emerald-400',
  warn: 'bg-amber-400',
  bad: 'bg-red-400',
  off: 'bg-zinc-500',
}

/** Verdict of a section or a stage: a dot and its word, in the status
 * colours (never an area hue). */
export function HealthPill({ health, label, className }: { health: Health; label: string; className?: string }) {
  return (
    <span title={label} className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium', HEALTH_PILL[health], className)}>
      <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', HEALTH_DOT[health])} />
      <span className="truncate">{label}</span>
    </span>
  )
}

/** Heading of a settings-style block: the block's icon in the tile of
 * its area (the closest data-area), then the words. */
export function PanelHeading({ icon: Icon, children, className }: { icon: React.ElementType; children: React.ReactNode; className?: string }) {
  return (
    <h3 className={cn('flex items-center gap-2.5 text-sm font-medium text-zinc-100', className)}>
      <span className="icon-tile"><Icon size={15} weight="duotone" aria-hidden /></span>
      {children}
    </h3>
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
        <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-100">
          {/* the view's area colour marks where each section starts */}
          <span aria-hidden className="h-3.5 w-1 rounded-full bg-[color:var(--area,var(--primary))]" />
          {title}
        </h2>
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
