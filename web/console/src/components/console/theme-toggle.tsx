'use client'

// ThemeToggle — THEME-1: three-way pick (system / light / dark). The boot
// script in layout.tsx already resolved the theme before the first paint;
// this control only changes it after load, in the same terms: one class
// swap on <html> (html.dark / html.light), the choice persisted under the
// shared storage key, applyTheme()'s custom event for the layers that
// paint outside CSS (the dot-grid canvas) and a `storage` listener so
// every open tab follows the decision. 'system' keeps following the OS
// preference live; 'light'/'dark' pin the theme until the next pick.

import { useEffect, useState } from 'react'
import { CircleHalf, Moon, Sun } from '@phosphor-icons/react'
import { applyTheme, resolveTheme, THEME_STORAGE_KEY, type ThemeChoice } from '@/lib/theme'
import { useI18n } from './i18n-provider'

const CYCLE: readonly ThemeChoice[] = ['system', 'light', 'dark']

function storedChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    // Private mode or full storage: the OS preference is the choice.
    return 'system'
  }
}

function prefersLight(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches
}

export function ThemeToggle() {
  const { dict } = useI18n()
  // null until the mounted state aligns with the stored choice, so the
  // follow-the-OS effect cannot fight the boot decision on first paint.
  const [choice, setChoice] = useState<ThemeChoice | null>(null)

  useEffect(() => {
    setChoice(storedChoice())
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY) return
      const picked: ThemeChoice = e.newValue === 'light' || e.newValue === 'dark' ? e.newValue : 'system'
      setChoice(picked)
      applyTheme(resolveTheme(picked, prefersLight()))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // While the pick is 'system', the OS preference is applied live.
  useEffect(() => {
    if (choice !== 'system' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const follow = () => applyTheme(mq.matches ? 'light' : 'dark')
    follow()
    mq.addEventListener('change', follow)
    return () => mq.removeEventListener('change', follow)
  }, [choice])

  const shown: ThemeChoice = choice ?? 'system'
  const next = CYCLE[(CYCLE.indexOf(shown) + 1) % CYCLE.length]
  const label = dict.theme.next[next]

  return (
    <button
      type="button"
      onClick={() => {
        setChoice(next)
        try {
          localStorage.setItem(THEME_STORAGE_KEY, next)
        } catch {
          // Private mode or full storage: the theme still flips for this
          // session, it just will not survive a reload.
        }
        // 'system' re-applies through the follow-the-OS effect above.
        if (next !== 'system') applyTheme(next)
      }}
      aria-label={label}
      title={label}
      className="chip shrink-0 px-2 py-1.5 text-zinc-400 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* half circle for "system": the monitor glyph belongs to the NOC
          (full-screen) button next to it */}
      {shown === 'dark' ? <Moon size={15} aria-hidden /> : shown === 'light' ? <Sun size={15} aria-hidden /> : <CircleHalf size={15} aria-hidden />}
    </button>
  )
}
