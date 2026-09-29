'use client'

// Small shared pieces: severity badge, animated counters, section headers,
// empty states. Motion is only used where it communicates a state change.

import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'motion/react'
import { useEffect } from 'react'
import { SEVERITY_STYLE, type Severity } from '@/lib/console-types'

export function SeverityBadge({ severity, className = '' }: { severity: Severity; className?: string }) {
  const s = SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.low
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[11px] leading-none ${s.text} ${s.bg} ${s.border} ${className}`}
    >
      {s.label}
    </span>
  )
}

/** Number that springs to new values instead of jumping. */
export function AnimatedNumber({ value, className = '' }: { value: number; className?: string }) {
  const reduce = useReducedMotion()
  const mv = useMotionValue(value)
  const spring = useSpring(mv, { stiffness: 120, damping: 24 })
  const rounded = useTransform(spring, (v) => Math.round(v).toLocaleString('es-ES'))
  useEffect(() => {
    if (reduce) {
      mv.set(value)
    } else {
      mv.set(value)
    }
  }, [value, mv, reduce])
  return <motion.span className={className}>{rounded}</motion.span>
}

export function SectionHeader({ title, count, action }: { title: string; count?: number; action?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 pb-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-medium text-zinc-200">{title}</h2>
        {typeof count === 'number' && <span className="font-mono text-xs text-zinc-500">{count}</span>}
      </div>
      {action}
    </div>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-10 text-center">
      <p className="text-sm text-zinc-400">{title}</p>
      {hint && <p className="text-xs text-zinc-600">{hint}</p>}
    </div>
  )
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-white/5" style={{ width: `${88 - i * 9}%` }} />
      ))}
    </div>
  )
}
