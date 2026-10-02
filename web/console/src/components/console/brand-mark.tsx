'use client'

// The bluetardigrade mark (docs/assets/logo.svg) inlined so it inherits
// no external request; gradient ids are per instance.

import { useId } from 'react'

export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  const shield = `bt-shield-${id}`
  const body = `bt-body-${id}`
  const leg = `bt-leg-${id}`
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden className={className}>
      <defs>
        <linearGradient id={shield} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#132036" />
          <stop offset="1" stopColor="#0b1220" />
        </linearGradient>
        <linearGradient id={body} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#67d3ff" />
          <stop offset="1" stopColor="#2f74f0" />
        </linearGradient>
        <linearGradient id={leg} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3f8af5" />
          <stop offset="1" stopColor="#2a5fd6" />
        </linearGradient>
      </defs>
      <path d="M32 3 L56 11 V31 C56 45 46 55 32 61 C18 55 8 45 8 31 V11 Z" fill={`url(#${shield})`} stroke="#2f74f0" strokeOpacity="0.55" strokeWidth="1.5" />
      <g fill={`url(#${leg})`}>
        <rect x="17.5" y="35" width="5.6" height="9" rx="2.8" />
        <rect x="25.5" y="36" width="5.6" height="9" rx="2.8" />
        <rect x="33.5" y="36" width="5.6" height="9" rx="2.8" />
        <rect x="41.5" y="35" width="5.6" height="9" rx="2.8" />
      </g>
      <path
        d="M17 24.5 C19 19 26 17.5 33 17.5 C41 17.5 49 19.5 51 26 C52.5 31 50.5 37.5 44 38.5 C37 39.6 26 39.8 19.5 38 C14.5 36.6 15.4 28.8 17 24.5 Z"
        fill={`url(#${body})`}
      />
      <g stroke="#1f56c9" strokeOpacity="0.55" strokeWidth="1.2" strokeLinecap="round" fill="none">
        <path d="M27 19 C25.5 25 25.5 32 27 38.8" />
        <path d="M35 18.2 C33.6 25 33.6 32 35 39.2" />
        <path d="M43 19.6 C41.8 25.5 41.8 32 43 38.6" />
      </g>
      <circle cx="16.5" cy="29" r="7.2" fill={`url(#${body})`} />
      <ellipse cx="10.4" cy="30.4" rx="2.6" ry="2.1" fill="#3f8af5" />
      <circle cx="15.6" cy="26.6" r="1.7" fill="#0b1220" />
      <circle cx="16.1" cy="26.1" r="0.55" fill="#ffffff" />
    </svg>
  )
}
