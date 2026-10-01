'use client'

// Keyboard shortcuts help sheet (the console's only modal): one honest
// place that lists the g-prefixed navigation the shell actually resolves
// plus the sheet's own keys. Rows arrive as props — the resolver's map
// in keyboard-nav.ts stays the single source of truth, so the sheet can
// never advertise a binding that would not navigate.
//
// Accessibility and behavior:
//   - role="dialog" + aria-modal, labelled by the sheet's title;
//   - focus moves into the panel on open and returns to the element
//     that had it before (restored on close AND on unmount);
//   - Tab is trapped inside the panel while open;
//   - Escape and a click on the backdrop close (Escape wiring lives in
//     the shell's global keydown handler, guarded by the same
//     typing-target rule as every other shortcut);
//   - motion is a plain state fade, frozen under prefers-reduced-motion;
//   - desktop-oriented by design: reachable from the sidebar's footer
//     hint and the '?' key. A touch device has no keyboard and its nav
//     is always visible, so no mobile chrome is added for this.

import { useEffect, useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Keyboard, X } from '@phosphor-icons/react'
import { SHORTCUT_PREFIX } from '@/lib/keyboard-nav'

/** One display row: the binding plus the NAV label/group from the shell. */
export type ShortcutHelpRow = { key: string; label: string; group: string }

type Props = {
  open: boolean
  rows: ShortcutHelpRow[]
  onClose: () => void
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function ShortcutsHelp({ open, rows, onClose }: Props) {
  const reduce = useReducedMotion()
  const dur = reduce ? 0 : 0.15
  const panelRef = useRef<HTMLDivElement | null>(null)
  // Where focus returns when the sheet closes: captured at open, kept
  // in a ref so the cleanup (close via Escape, backdrop or unmount)
  // always restores the same element.
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()
    return () => {
      restoreFocusRef.current?.focus()
      restoreFocusRef.current = null
    }
  }, [open])

  // Focus trap: Tab (and Shift+Tab) wrap inside the panel instead of
  // escaping into the console behind the modal.
  const trapTab = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return
    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const groups: { group: string; rows: ShortcutHelpRow[] }[] = []
  for (const row of rows) {
    const last = groups[groups.length - 1]
    if (last && last.group === row.group) last.rows.push(row)
    else groups.push({ group: row.group, rows: [row] })
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          // Backdrop: a click that lands here (not on the panel) closes.
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose()
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: dur, ease: 'easeOut' }}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcuts-title"
            tabIndex={-1}
            onKeyDown={trapTab}
            initial={reduce ? false : { opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: dur, ease: 'easeOut' }}
            className="panel max-h-[80dvh] w-full max-w-md overflow-y-auto rounded-xl p-5 outline-none"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="shortcuts-title" className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                <Keyboard size={16} aria-hidden className="text-emerald-400" />
                Atajos de teclado
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar la hoja de atajos"
                className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X size={14} aria-hidden />
              </button>
            </div>

            {groups.map(({ group, rows: groupRows }) => (
              <section key={group} className="mt-4">
                <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
                  {group}
                </p>
                <ul className="panel divide-y divide-white/[0.04] rounded-lg px-3 py-1">
                  {groupRows.map((row) => (
                    <li key={row.key} className="flex items-center justify-between gap-3 py-2">
                      <span className="text-sm text-zinc-300">{row.label}</span>
                      <KbdPair keys={[SHORTCUT_PREFIX, row.key]} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            <section className="mt-4">
              <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
                Esta hoja
              </p>
              <ul className="panel divide-y divide-white/[0.04] rounded-lg px-3 py-1">
                <li className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-zinc-300">Abrir o cerrar</span>
                  <KbdPair keys={['?']} />
                </li>
                <li className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-zinc-300">Cerrar</span>
                  <KbdPair keys={['Esc']} />
                </li>
              </ul>
            </section>

            <p className="mt-4 px-1 text-[11px] leading-relaxed text-zinc-500">
              Los atajos nunca se activan mientras escribes en un campo (búsquedas de las colas,
              nota del analista, selects): el guardia de la consola los ignora ahí.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** One key cap. */
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.75rem] items-center justify-center rounded-md border border-zinc-700/80 bg-zinc-900 px-1.5 py-1 font-mono text-[11px] font-medium leading-none text-zinc-200 shadow-[inset_0_-1px_0_0_rgba(0,0,0,0.5)]">
      {children}
    </kbd>
  )
}

/** A key sequence, rendered as separate caps (g is a prefix, not a chord). */
function KbdPair({ keys }: { keys: string[] }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </span>
  )
}
