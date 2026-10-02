'use client'

// Severity is a status scale: every colored mark ships with an icon and a
// text label so state never rides on hue alone.

import { Info, Warning, WarningCircle, WarningDiamond, WarningOctagon, type Icon } from '@phosphor-icons/react'
import type { Severity } from '@/lib/console-types'

export const SEV_COLOR: Record<Severity, string> = {
  critical: 'var(--sev-critical)',
  high: 'var(--sev-high)',
  medium: 'var(--sev-medium)',
  low: 'var(--sev-low)',
  info: 'var(--sev-info)',
}

export const SEV_ICON: Record<Severity, Icon> = {
  critical: WarningOctagon,
  high: WarningDiamond,
  medium: Warning,
  low: WarningCircle,
  info: Info,
}

export function SeverityIcon({ severity, size = 14, className }: { severity: Severity; size?: number; className?: string }) {
  const Glyph = SEV_ICON[severity] ?? Info
  return <Glyph size={size} weight="fill" aria-hidden className={className} style={{ color: SEV_COLOR[severity] }} />
}
