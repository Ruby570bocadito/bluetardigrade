'use client'

import { useId, type ReactNode } from 'react'
import { Keyboard, X } from '@phosphor-icons/react'
import { SHORTCUT_PREFIX } from '@/lib/keyboard-nav'
import { ConsoleDialog } from './console-dialog'
import { useI18n } from './i18n-provider'

export type ShortcutHelpRow = { key: string; label: string; group: string }

export function ShortcutsHelp({ open, rows, onClose }: {
  open: boolean; rows: ShortcutHelpRow[]; onClose: () => void
}) {
  const { dict } = useI18n()
  const id = useId()
  const groups: { group: string; rows: ShortcutHelpRow[] }[] = []
  for (const row of rows) {
    const last = groups[groups.length - 1]
    if (last?.group === row.group) last.rows.push(row)
    else groups.push({ group: row.group, rows: [row] })
  }

  return (
    <ConsoleDialog open={open} onClose={onClose} titleId={`${id}-title`} descriptionId={`${id}-hint`} className="max-w-md">
      <div className="p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id={`${id}-title`} className="flex items-center gap-2 text-sm font-medium">
            <Keyboard size={16} aria-hidden className="text-primary" />
            {dict.shortcuts.title}
          </h2>
          <button type="button" onClick={onClose} aria-label={dict.shortcuts.close} className="rounded-md p-1.5 text-zinc-400 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X size={16} aria-hidden />
          </button>
        </div>

        <section className="mt-4">
          <p className="pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">{dict.shortcuts.commandsHeading}</p>
          <ul className="panel divide-y divide-white/[0.04] rounded-lg px-3 py-1">
            <li className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm text-zinc-300">{dict.shortcuts.searchViews}</span>
              <KbdPair keys={['Ctrl / ⌘', 'K']} />
            </li>
          </ul>
        </section>

        {groups.map(({ group, rows: groupRows }) => (
          <section key={group} className="mt-4">
            <p className="pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">{group}</p>
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
          <p className="pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">{dict.shortcuts.thisSheet}</p>
          <ul className="panel divide-y divide-white/[0.04] rounded-lg px-3 py-1">
            <li className="flex items-center justify-between gap-3 py-2"><span className="text-sm text-zinc-300">{dict.shortcuts.toggleRow}</span><KbdPair keys={['?']} /></li>
            <li className="flex items-center justify-between gap-3 py-2"><span className="text-sm text-zinc-300">{dict.shortcuts.closeRow}</span><KbdPair keys={['Esc']} /></li>
          </ul>
        </section>
        <p id={`${id}-hint`} className="mt-4 text-xs leading-relaxed text-zinc-400">
          {dict.shortcuts.prose}
        </p>
      </div>
    </ConsoleDialog>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex min-w-[1.75rem] items-center justify-center rounded-md border border-zinc-700/80 bg-zinc-900 px-1.5 py-1 font-mono text-[11px] font-medium leading-none text-zinc-200 shadow-[inset_0_-1px_0_0_var(--kbd-edge)]">{children}</kbd>
}

function KbdPair({ keys }: { keys: string[] }) {
  return <span className="flex items-center gap-1">{keys.map((key) => <Kbd key={key}>{key}</Kbd>)}</span>
}
