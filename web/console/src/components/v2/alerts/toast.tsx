'use client'

// One quiet notice at the bottom right after a triage write: what
// changed and, for a few seconds, the way to undo it (the thin bar shows
// the time left). It stays put while hovered or focused.
import { useEffect, useRef, useState } from 'react'
import { X } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'

export type ToastState = { id: number; message: string; undo?: () => Promise<void>; link?: { href: string; label: string } } | null

const LIFE_MS = 6000

export function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  const { dict } = useI18n()
  const t = dict.v2.alertsView.toast
  const [paused, setPaused] = useState(false)
  const [busy, setBusy] = useState(false)
  const left = useRef(LIFE_MS)
  const started = useRef(0)

  useEffect(() => {
    left.current = LIFE_MS
    setBusy(false)
  }, [toast?.id])

  useEffect(() => {
    if (!toast || paused || busy) return undefined
    started.current = Date.now()
    const id = window.setTimeout(onClose, left.current)
    return () => {
      window.clearTimeout(id)
      left.current -= Date.now() - started.current
    }
  }, [toast, paused, busy, onClose])

  if (!toast) return null
  return (
    <div
      key={toast.id}
      className="v2-toast"
      role="status"
      data-paused={paused || busy}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span>{toast.message}</span>
      {toast.link && (
        <a className="v2-link" href={toast.link.href}>
          {toast.link.label}
        </a>
      )}
      {toast.undo && (
        <button
          type="button"
          className="v2-link"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await toast.undo!()
            onClose()
          }}
        >
          {t.undo}
        </button>
      )}
      <button type="button" className="v2-icon-btn" aria-label={t.dismiss} onClick={onClose}>
        <X aria-hidden="true" />
      </button>
      <i className="v2-toast-life" aria-hidden="true" style={{ animationDuration: `${LIFE_MS}ms` }} />
    </div>
  )
}
