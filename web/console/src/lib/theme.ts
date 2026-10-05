// Theme plumbing shared by the boot script (layout.tsx), the toggle
// (theme-toggle.tsx) and the NOC wall (noc-mode.tsx). The boot decision
// is mirrored as an inline script for first-paint speed; resolveTheme is
// its testable twin.

export const THEME_STORAGE_KEY = 'bt-theme'
/** Custom event fired on <html> class changes so canvas/SVG layers repaint. */
export const THEME_EVENT = 'bt-themechange'

export type Theme = 'dark' | 'light'

/** What the operator picked: 'system' follows prefers-color-scheme,
 * 'light'/'dark' pin the theme until the next pick. */
export type ThemeChoice = 'system' | Theme

/** Pure decision: a stored pin wins, then the OS preference, then dark.
 * 'system' (or anything unknown) deliberately falls to the OS branch. */
export function resolveTheme(stored: string | null | undefined, prefersLight: boolean): Theme {
  if (stored === 'light' || stored === 'dark') return stored
  return prefersLight ? 'light' : 'dark'
}

/** Applies a theme to <html> (classes mirror html.dark / html.light) and
 * tells the non-CSS layers (dot-grid canvas, entity-graph SVG) to repaint. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.classList.toggle('light', theme === 'light')
  window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: theme }))
}
