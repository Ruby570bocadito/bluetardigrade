import { describe, expect, test } from 'bun:test'
import { resolveTheme } from './theme'

describe('theme boot decision', () => {
  test('a stored choice wins over the OS preference', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('light', false)).toBe('light')
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  test('an unknown stored value falls through to the OS preference', () => {
    expect(resolveTheme('night', true)).toBe('light')
    expect(resolveTheme('night', false)).toBe('dark')
    expect(resolveTheme('', true)).toBe('light')
  })

  test('without storage the OS preference decides, defaulting to dark', () => {
    expect(resolveTheme(null, true)).toBe('light')
    expect(resolveTheme(null, false)).toBe('dark')
    expect(resolveTheme(undefined, false)).toBe('dark')
  })
})
