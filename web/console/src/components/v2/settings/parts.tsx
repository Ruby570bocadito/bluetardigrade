'use client'

// Small pieces shared by the views of Ajustes.
import type { ReactNode } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import type { AreaState } from '@/lib/v2/settings-model'

export function StatePill({ state }: { state: AreaState }) {
  const { dict } = useI18n()
  return (
    <span className="v2-set-state" data-state={state}>
      <i aria-hidden="true" />
      {dict.v2.settingsView.states[state]}
    </span>
  )
}

/** A titled group of settings with an optional line of help. */
export function Group({ title, hint, children, id }: { title: string; hint?: ReactNode; children: ReactNode; id: string }) {
  return (
    <section className="v2-set-group" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {hint && <p className="v2-small v2-dim">{hint}</p>}
      {children}
    </section>
  )
}

/** A notice that explains why something cannot be changed (not armed, read-only, conflict). */
export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  return (
    <p className="v2-set-notice" data-tone={tone} role={tone === 'error' ? 'alert' : undefined}>
      {children}
    </p>
  )
}

/** On/off switch with a visible label (a real checkbox underneath). */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className="v2-toggle" data-disabled={disabled}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="v2-toggle-track" aria-hidden="true">
        <i />
      </span>
      <span>{label}</span>
    </label>
  )
}
