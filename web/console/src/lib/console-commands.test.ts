import { describe, expect, test } from 'bun:test'
import { CONSOLE_COMMANDS, CONSOLE_DESTINATIONS, findConsoleCommands } from './console-commands'
import { CONSOLE_VIEWS } from './url-state'
import { isKeyboardScope, isPaletteToggleKey, shortcutHintFor } from './keyboard-nav'

describe('operator command search', () => {
  test('every view is discoverable and uses the actual navigation binding', () => {
    expect(CONSOLE_DESTINATIONS.map((item) => item.id)).toEqual([...CONSOLE_VIEWS])
    for (const command of CONSOLE_COMMANDS) {
      if (command.kind === 'navigate') expect(command.shortcut).toBe(shortcutHintFor(command.view) ?? undefined)
    }
    expect(new Set(CONSOLE_COMMANDS.map((command) => command.id)).size).toBe(CONSOLE_COMMANDS.length)
  })
  test('empty input shows the complete catalogue', () => {
    expect(findConsoleCommands('  \t ')).toEqual(CONSOLE_COMMANDS)
  })
  test('search ignores accents, case and spacing', () => {
    expect(findConsoleCommands('  DETECCION  ReGlAs ').map((command) => command.id)).toEqual(['view:reglas'])
    expect(findConsoleCommands('historico').map((command) => command.id)).toEqual(['view:alertas'])
  })
  test('descriptions and operator synonyms are searchable with every word required', () => {
    expect(findConsoleCommands('recuperar motor').map((command) => command.id)).toEqual(['refresh'])
    expect(findConsoleCommands('kill chain').map((command) => command.id)).toEqual(['view:cadenas'])
    expect(findConsoleCommands('reglas recuperar')).toEqual([])
  })
  test('a match in the command name ranks before a match in a description', () => {
    expect(findConsoleCommands('noc')[0].id).toBe('noc')
    expect(findConsoleCommands('noc').map((command) => command.id)).toContain('view:alertas')
  })
  test('unknown commands are not interpreted as an action or route', () => {
    expect(findConsoleCommands('<script>kill all</script>')).toEqual([])
    expect(findConsoleCommands('https://unrelated.test')).toEqual([])
  })
})

describe('palette activation', () => {
  const base = { key: 'k', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }
  test('accepts Ctrl+K and Meta+K', () => {
    expect(isPaletteToggleKey({ ...base, ctrlKey: true })).toBe(true)
    expect(isPaletteToggleKey({ ...base, key: 'K', metaKey: true })).toBe(true)
  })
  test('does not capture bare, alternate or ambiguous chords', () => {
    for (const input of [base, { ...base, ctrlKey: true, metaKey: true }, { ...base, ctrlKey: true, altKey: true }, { ...base, ctrlKey: true, shiftKey: true }, { ...base, key: 'a', ctrlKey: true }]) expect(isPaletteToggleKey(input)).toBe(false)
  })
  test('keyboard scopes tolerate SSR and non-element targets', () => {
    expect(isKeyboardScope(null)).toBe(false)
    expect(isKeyboardScope({} as EventTarget)).toBe(false)
  })
})
