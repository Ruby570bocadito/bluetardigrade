'use client'

// Drop-down panel for the header chips. The chip row scrolls sideways
// (overflow-x: auto), and CSS then clips it vertically too, so a panel
// positioned inside the row was cut off below the header. This one is
// rendered into document.body at a fixed position under its anchor,
// and closes on an outside press or Escape. Being at the end of the
// document, it takes keyboard focus when it opens (Tab then walks its
// controls) and closes when focus leaves it.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

const GAP = 8
const MARGIN = 8
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

export function HeaderPopover({ anchorRef, open, onClose, label, className = 'w-80', children }: {
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  label: string
  className?: string
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = anchorRef.current?.getBoundingClientRect()
      if (!r) return
      setPos({ top: Math.round(r.bottom + GAP), right: Math.max(MARGIN, Math.round(window.innerWidth - r.right)) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, anchorRef])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
      anchorRef.current?.focus()
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, anchorRef])

  // focus the first control once the panel is placed
  useEffect(() => {
    if (!open || !pos) return
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true })
  }, [open, pos])

  if (!open || !pos || typeof document === 'undefined') return null
  return createPortal(
    <div
      ref={panelRef}
      role="group"
      aria-label={label}
      onKeyDown={(e) => {
        // Tab past the last control (or Shift+Tab before the first) leaves
        // the panel back to its chip instead of the end of the document
        if (e.key !== 'Tab') return
        const items = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
        if (items.length === 0) return
        const edge = e.shiftKey ? items[0] : items[items.length - 1]
        if (document.activeElement !== edge) return
        e.preventDefault()
        onClose()
        anchorRef.current?.focus()
      }}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null
        if (next && !panelRef.current?.contains(next) && !anchorRef.current?.contains(next)) onClose()
      }}
      style={{ position: 'fixed', top: pos.top, right: pos.right }}
      className={`z-50 max-w-[calc(100vw-16px)] rounded-xl border border-white/10 bg-zinc-900/95 shadow-2xl backdrop-blur ${className}`}
    >
      {children}
    </div>,
    document.body,
  )
}
