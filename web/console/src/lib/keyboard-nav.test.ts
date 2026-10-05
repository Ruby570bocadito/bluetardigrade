// Unit tests for the g-prefixed navigation shortcuts (keyboard-nav.ts):
// the pure resolver and the typing-target guard contract the shell
// wires to a window keydown listener. They run the REAL module — the
// buffer semantics (arm / resolve / quiet-cancel), the collision-free
// mnemonic map and the guard's non-element fallback are pinned exactly
// as the console invokes them. DOM-specific branches of the guard
// (real inputs) belong to the wiring and tsc; here the guard's
// non-element paths are pinned.

//   bun test            (from web/console/)

import { describe, expect, test } from 'bun:test'
import type { ConsoleView } from '../components/console/dashboard'
import { CONSOLE_VIEWS } from './url-state'
import {
  SHORTCUT_ARM_MS,
  SHORTCUT_PREFIX,
  isHelpToggleKey,
  isTypingTarget,
  resolveShortcut,
  shortcutHintFor,
  shortcutRows,
} from './keyboard-nav'

describe('resolveShortcut — arming', () => {
  test('the bare prefix arms the buffer and navigates nowhere', () => {
    expect(resolveShortcut({ key: SHORTCUT_PREFIX, prefixed: false })).toEqual({ action: 'arm' })
  })

  test('a single unmapped key without the prefix does nothing', () => {
    expect(resolveShortcut({ key: 'a', prefixed: false })).toEqual({ action: 'none' })
    expect(resolveShortcut({ key: 'k', prefixed: false })).toEqual({ action: 'none' })
  })

  test('arming is case-insensitive too (Caps Lock must not break the prefix)', () => {
    // Same contract as navigation: 'G' arms, the resolved key afterwards
    // is lowercased — the shortcut never depends on shift state.
    expect(resolveShortcut({ key: 'G', prefixed: false })).toEqual({ action: 'arm' })
  })

  test('non-character keys never arm (Escape, arrows, Enter)', () => {
    expect(resolveShortcut({ key: 'Escape', prefixed: false })).toEqual({ action: 'none' })
    expect(resolveShortcut({ key: 'ArrowLeft', prefixed: false })).toEqual({ action: 'none' })
    expect(resolveShortcut({ key: 'Enter', prefixed: false })).toEqual({ action: 'none' })
  })
})

describe('resolveShortcut — navigation', () => {
  test('every view has a unique mnemonic key (collision-free map)', () => {
    const expected: Record<string, ConsoleView> = {
      p: 'panel',
      f: 'flujo',
      a: 'alertas',
      r: 'reglas',
      c: 'cadenas',
      l: 'inteligencia',
      s: 'supresiones',
      o: 'informes',
      u: 'ruido',
      v: 'simulacion',
      k: 'respuesta',
      n: 'analista',
    }
    for (const [key, view] of Object.entries(expected)) {
      expect(resolveShortcut({ key, prefixed: true })).toEqual({ action: 'navigate', view })
    }
  })

  test('navigation is case-insensitive (Caps Lock must not break it)', () => {
    expect(resolveShortcut({ key: 'A', prefixed: true })).toEqual({ action: 'navigate', view: 'alertas' })
    expect(resolveShortcut({ key: 'K', prefixed: true })).toEqual({ action: 'navigate', view: 'respuesta' })
  })

  test('an unmapped key after the prefix cancels quietly (no navigation)', () => {
    expect(resolveShortcut({ key: 'g', prefixed: true })).toEqual({ action: 'none' })
    expect(resolveShortcut({ key: 'z', prefixed: true })).toEqual({ action: 'none' })
    expect(resolveShortcut({ key: '1', prefixed: true })).toEqual({ action: 'none' })
  })

  test('multi-char keys after the prefix cancel (Esc, arrows never navigate)', () => {
    expect(resolveShortcut({ key: 'Escape', prefixed: true })).toEqual({ action: 'none' })
    expect(resolveShortcut({ key: 'ArrowUp', prefixed: true })).toEqual({ action: 'none' })
  })
})

describe('shortcutHintFor', () => {
  test('every nav view gets a g-hint for its native tooltip', () => {
    const views: readonly ConsoleView[] = [
      'panel',
      'flujo',
      'alertas',
      'reglas',
      'cadenas',
      'inteligencia',
      'supresiones',
      'respuesta',
      'analista',
    ]
    for (const view of views) {
      // Every hint is the prefix plus exactly one of the mnemonic keys.
      expect(shortcutHintFor(view)).toMatch(/^g [pfarclsknuvo]$/)
    }
  })
})

describe('shortcutRows — help sheet catalog', () => {
  test('covers the console vocabulary exactly: every view once, no extras', () => {
    const rows = shortcutRows()
    expect(rows.map((r) => r.view).sort()).toEqual([...CONSOLE_VIEWS].sort())
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
  })

  test('every advertised row resolves through the REAL resolver (the help cannot lie)', () => {
    for (const row of shortcutRows()) {
      expect(resolveShortcut({ key: row.key, prefixed: true })).toEqual({
        action: 'navigate',
        view: row.view,
      })
    }
  })

  test('row keys and tooltip hints are the same binding for every view', () => {
    for (const row of shortcutRows()) {
      expect(shortcutHintFor(row.view)).toBe(`${SHORTCUT_PREFIX} ${row.key}`)
    }
  })
})

describe('isHelpToggleKey', () => {
  test("'?' toggles the sheet, nothing else does", () => {
    expect(isHelpToggleKey('?')).toBe(true)
    for (const key of ['g', 'G', 'a', '/', 'shift', 'Escape', 'Enter', '??', '']) {
      expect(isHelpToggleKey(key)).toBe(false)
    }
  })
})

describe('SHORTCUT_ARM_MS', () => {
  test('the buffer expiry stays snappy (sub-2s, SOC muscle memory)', () => {
    expect(SHORTCUT_ARM_MS).toBeGreaterThanOrEqual(600)
    expect(SHORTCUT_ARM_MS).toBeLessThanOrEqual(2000)
  })
})

describe('isTypingTarget — non-element paths (DOM wiring is tsc-certified)', () => {
  test('null and window-like targets are not typing targets', () => {
    expect(isTypingTarget(null)).toBe(false)
    expect(isTypingTarget({} as EventTarget)).toBe(false)
  })
})
