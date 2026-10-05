'use client'

// ThemeToggle — THEME-2: flips the console between the dark (default) and
// light palettes. The boot script in layout.tsx already resolved the theme
// before the first paint; this control only changes it after load, in the
// same terms: one class swap on <html> (html.dark / html.light), the
// choice persisted under the shared storage key, applyTheme()'s custom
// event for the layers that paint outside CSS (the dot-grid canvas) and a
// `storage` listener so every open tab follows the decision. The OS
// preference is only read at boot: once the operator picks a theme, that
// pick is the truth.

import { useEffect, useState } from 'react'
import { Moon, Sun } from '@phosphor-icons/react'
import { applyTheme, THEME_STORAGE_KEY, type Theme } from '@/lib/theme'

function currentTheme(): Theme {
  return document.documentElement.classList.contains('light') ? 'light' : 'dark'
}

export function ThemeToggle() {
  // The server render cannot know the boot outcome, so it renders the dark
  // icon (the default theme); the mounted state aligns it with reality.
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    setTheme(currentTheme())
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY) return
      if (e.newValue !== 'light' && e.newValue !== 'dark') return
      applyTheme(e.newValue)
      setTheme(e.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const next: Theme = theme === 'dark' ? 'light' : 'dark'
  const label = next === 'light' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'

  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(next)
        try {
          localStorage.setItem(THEME_STORAGE_KEY, next)
        } catch {
          // Private mode or full storage: the theme still flips for this
          // session, it just will not survive a reload.
        }
        setTheme(next)
      }}
      aria-label={label}
      title={label}
      className="chip shrink-0 px-2 py-1.5 text-zinc-400 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {theme === 'dark' ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
    </button>
  )
}
