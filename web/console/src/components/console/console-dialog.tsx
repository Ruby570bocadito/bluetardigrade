'use client'

import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

/** Native modality keeps background controls inert and keyboard focus inside. */
export function ConsoleDialog({ open, onClose, titleId, descriptionId, initialFocus, children, className = '' }: {
  open: boolean
  onClose: () => void
  titleId: string
  descriptionId?: string
  initialFocus?: RefObject<HTMLElement | null>
  children: ReactNode
  className?: string
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const backdropPress = useRef(false)

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current!
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.documentElement.style.overflow
    dialog.showModal()
    document.documentElement.style.overflow = 'hidden'
    initialFocus?.current?.focus({ preventScroll: true })
    return () => {
      dialog.close()
      document.documentElement.style.overflow = overflow
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [open, initialFocus])

  const outside = (x: number, y: number) => {
    const bounds = dialogRef.current!.getBoundingClientRect()
    return x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom
  }

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onPointerDown={(event) => {
        backdropPress.current = event.button === 0 && event.target === event.currentTarget && outside(event.clientX, event.clientY)
      }}
      onPointerUp={(event) => {
        if (backdropPress.current && event.target === event.currentTarget && outside(event.clientX, event.clientY)) onClose()
        backdropPress.current = false
      }}
      className={`m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-0 text-zinc-100 shadow-2xl outline-none backdrop:bg-zinc-950/80 backdrop:backdrop-blur-sm ${className}`}
    >
      {children}
    </dialog>
  )
}
