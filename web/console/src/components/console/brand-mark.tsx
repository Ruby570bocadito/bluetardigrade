'use client'

// The bluetardigrade mark (docs/assets/logo.svg) inlined: no extra
// request, per-instance gradient ids, and the halo breathes only when
// the engine is live (frozen under prefers-reduced-motion).

import { useId } from 'react'

export function BrandMark({ size = 32, live = false, className }: { size?: number; live?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '')
  const body = `bt-body-${id}`
  const glow = `bt-glow-${id}`
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden className={className}>
      <defs>
        <linearGradient id={body} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4dc3ff" />
          <stop offset="1" stopColor="#2f6fed" />
        </linearGradient>
        <linearGradient id={glow} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4dc3ff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#2f6fed" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="34" r="26" fill={`url(#${glow})`} className={live ? 'bt-breathe' : undefined} />
      <g stroke={`url(#${body})`} strokeWidth="3.4" strokeLinecap="round" fill="none">
        <path d="M22 30 C17 29 14 26 13 22" />
        <path d="M21 37 C15 37 11 35 9 32" />
        <path d="M22 44 C16 45 13 48 12 52" />
        <path d="M42 30 C47 29 50 26 51 22" />
        <path d="M43 37 C49 37 53 35 55 32" />
        <path d="M42 44 C48 45 51 48 52 52" />
      </g>
      <g fill={`url(#${body})`}>
        <rect x="20" y="24" width="24" height="22" rx="11" />
        <rect x="26" y="25" width="12" height="20" rx="6" opacity="0.25" stroke="#4dc3ff" strokeWidth="1" fill="none" />
        <rect x="21.5" y="32" width="21" height="1.6" rx="0.8" opacity="0.28" />
        <rect x="21.5" y="38" width="21" height="1.6" rx="0.8" opacity="0.28" />
      </g>
      <circle cx="32" cy="25.5" r="7.5" fill={`url(#${body})`} />
      <circle cx="29" cy="24" r="1.7" fill="#060a10" />
      <circle cx="35" cy="24" r="1.7" fill="#060a10" />
      <circle cx="29.5" cy="23.4" r="0.55" fill="#cfeaff" />
      <circle cx="35.5" cy="23.4" r="0.55" fill="#cfeaff" />
    </svg>
  )
}
