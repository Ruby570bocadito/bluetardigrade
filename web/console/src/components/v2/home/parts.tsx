// Small shared pieces of the v2 home: panel frame, empty state, severity colors.
import type { ReactNode } from 'react'
import type { Severity } from '@/lib/console-types'

export const SEV_COLOR: Record<Severity, string> = {
  critical: 'var(--v2-sev-critical)',
  high: 'var(--v2-sev-high)',
  medium: 'var(--v2-sev-medium)',
  low: 'var(--v2-sev-low)',
  info: 'var(--v2-sev-info)',
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className,
  labelledBy,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  labelledBy: string
}) {
  return (
    <section className={['v2-panel', className].filter(Boolean).join(' ')} aria-labelledby={labelledBy}>
      <div className="v2-panel-head">
        <div>
          <h2 id={labelledBy}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="v2-empty">
      <strong>{title}</strong>
      {children && <span>{children}</span>}
    </div>
  )
}
