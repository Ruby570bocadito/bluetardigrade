// SOC-style g-prefixed navigation: 'g' arms a one-key buffer, the next
// keypress jumps to a view (g a → alertas, g k → respuesta...), the way
// veteran operators expect from mail/HUD consoles. The resolver here is
// a pure string function so it runs under bun test without a DOM; the
// shell owns the listener, the buffer expiry timer and the typing-target
// guard wiring.
//
// The map is mnemonic and collision-free across the shell's nav ids:
//   p panel · f flujo · a alertas · r reglas · c cadenas
//   s supresiones · k respuesta (the view's own action: kill)
//   n analista
// The help sheet (?) lists this map through shortcutRows(): keys come
// from HERE, labels/groups from the shell's NAV — neither side can
// drift from the resolver.

import type { ConsoleView } from '../components/console/dashboard'

/** The key that arms the shortcut buffer. */
export const SHORTCUT_PREFIX = 'g'

/** How long the buffer stays armed waiting for the second key (ms). */
export const SHORTCUT_ARM_MS = 1200

const KEY_TO_VIEW: Record<string, ConsoleView> = {
  p: 'panel',
  f: 'flujo',
  a: 'alertas',
  r: 'reglas',
  c: 'cadenas',
  s: 'supresiones',
  k: 'respuesta',
  n: 'analista',
}

export type ShortcutInput = {
  /** The pressed key, exactly as the event delivered it ('a', 'g', 'Escape'). */
  key: string
  /** Whether the prefix buffer was armed before this keypress. */
  prefixed: boolean
}

export type ShortcutResult =
  | { action: 'navigate'; view: ConsoleView }
  | { action: 'arm' }
  | { action: 'none' }

/**
 * Resolve one keypress against the buffer state. Anything that is not
 * the prefix or a mapped key cancels quietly — wrong guesses never
 * navigate, they just disarm.
 */
export function resolveShortcut(input: ShortcutInput): ShortcutResult {
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key
  if (!input.prefixed) {
    return key === SHORTCUT_PREFIX ? { action: 'arm' } : { action: 'none' }
  }
  if (key.length !== 1) return { action: 'none' }
  const view = KEY_TO_VIEW[key]
  return view ? { action: 'navigate', view } : { action: 'none' }
}

export type ShortcutRow = { key: string; view: ConsoleView }

/**
 * Ordered rows for the shortcuts help sheet — the definition order of
 * KEY_TO_VIEW itself, so the help can never advertise a binding the
 * resolver would not honor (pinned by test against the real resolver).
 */
export function shortcutRows(): ShortcutRow[] {
  return Object.entries(KEY_TO_VIEW).map(([key, view]) => ({ key, view }))
}

/**
 * True when the keypress should toggle the shortcuts help sheet.
 * '?' as the event delivers it (Shift+slash on most layouts), so the
 * shell's keydown handler can stay declarative: guard typing targets,
 * then ask this.
 */
export function isHelpToggleKey(key: string): boolean {
  return key === '?'
}

/**
 * The hint for a view's nav button ('g a'), or null when the view has
 * no binding — used for native title tooltips (discoverability without
 * touching the design).
 */
export function shortcutHintFor(view: ConsoleView): string | null {
  const key = Object.keys(KEY_TO_VIEW).find((k) => KEY_TO_VIEW[k] === view)
  return key ? `${SHORTCUT_PREFIX} ${key}` : null
}

/**
 * True when the event target means the operator is TYPING: shortcuts
 * must never hijack the queues' search boxes, the analyst note, a
 * select or a rich-text field. Non-element targets (window, document)
 * are fair game.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  // No DOM (SSR, bun test): no keydown events exist there, so nothing
  // can be a typing target — the guard is only wired inside a browser.
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false
  if (target instanceof HTMLElement && target.isContentEditable) return true
  return Boolean(target.closest('input, textarea, select, [role="textbox"], [role="searchbox"], [role="combobox"], [contenteditable]:not([contenteditable="false"])'))
}

/** Global navigation yields to a modal or composite widget's own keyboard. */
export function isKeyboardScope(target: EventTarget | null): boolean {
  return typeof Element !== 'undefined' && target instanceof Element &&
    Boolean(target.closest('dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'))
}

export function isPaletteToggleKey(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): boolean {
  return event.key.toLowerCase() === 'k' && event.ctrlKey !== event.metaKey && !event.altKey && !event.shiftKey
}
