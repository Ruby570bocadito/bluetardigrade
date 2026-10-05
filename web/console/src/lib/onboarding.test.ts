import { describe, expect, test } from 'bun:test'
import {
  ONBOARDING_KEY,
  allGatesDone,
  clearDismissed,
  readDismissed,
  shouldAutoOpen,
  stepStatuses,
  writeDismissed,
  type OnboardingFacts,
} from './onboarding'

const fresh: OnboardingFacts = {
  engineLive: true,
  loaded: true,
  enroll: { enabled: true, usableTokens: 0, pendingHosts: 0, activeHosts: 0 },
  inventoryHosts: 0,
}

const memory = () => {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  }
}

describe('first-run assistant offer', () => {
  test('opens only on a loaded, empty, live installation', () => {
    expect(shouldAutoOpen(fresh, false)).toBe(true)
    expect(shouldAutoOpen(fresh, true)).toBe(false)
  })
  test('never opens on partial data or an established fleet', () => {
    expect(shouldAutoOpen({ ...fresh, engineLive: false }, false)).toBe(false)
    expect(shouldAutoOpen({ ...fresh, loaded: false }, false)).toBe(false)
    expect(shouldAutoOpen({ ...fresh, enroll: null }, false)).toBe(false)
    expect(shouldAutoOpen({ ...fresh, inventoryHosts: null }, false)).toBe(false)
    expect(shouldAutoOpen({ ...fresh, inventoryHosts: 3 }, false)).toBe(false)
    expect(shouldAutoOpen({ ...fresh, enroll: { ...fresh.enroll!, activeHosts: 2 } }, false)).toBe(false)
  })
  test('a pending host is still a fresh install (mid-approval)', () => {
    expect(shouldAutoOpen({ ...fresh, enroll: { ...fresh.enroll!, pendingHosts: 1 } }, false)).toBe(true)
  })
})

describe('step states from observed facts', () => {
  test('every step waits until the engine answers enrollment', () => {
    expect(stepStatuses({ ...fresh, enroll: null })).toEqual({
      acceso: 'info',
      certificado: 'info',
      token: 'pendiente',
      sensor: 'pendiente',
    })
  })
  test('the engine signals drive certificate, token and sensor', () => {
    const off = stepStatuses({ ...fresh, enroll: { enabled: false, usableTokens: 0, pendingHosts: 1, activeHosts: 0 } })
    expect(off.certificado).toBe('aviso')
    expect(off.token).toBe('pendiente')
    expect(off.sensor).toBe('aviso')

    const done = stepStatuses({ ...fresh, enroll: { enabled: true, usableTokens: 2, pendingHosts: 0, activeHosts: 1 } })
    expect(done.certificado).toBe('hecho')
    expect(done.token).toBe('hecho')
    expect(done.sensor).toBe('hecho')
    expect(allGatesDone(done)).toBe(true)
  })
  test('only the two verifiable gates close the assistant', () => {
    expect(allGatesDone(stepStatuses({ ...fresh, enroll: { enabled: false, usableTokens: 1, pendingHosts: 0, activeHosts: 1 } }))).toBe(true)
    expect(allGatesDone(stepStatuses({ ...fresh, enroll: { enabled: true, usableTokens: 0, pendingHosts: 0, activeHosts: 1 } }))).toBe(false)
  })
})

describe('dismissal record', () => {
  test('round-trips and degrades to not dismissed on anything corrupt', () => {
    const storage = memory()
    expect(readDismissed(storage)).toBe(false)
    writeDismissed(storage, new Date('2026-10-05T18:00:00Z'))
    expect(readDismissed(storage)).toBe(true)
    expect(JSON.parse(storage.getItem(ONBOARDING_KEY)!)).toEqual({ dismissed_at: '2026-10-05T18:00:00.000Z' })

    for (const raw of ['', 'not json', '[]', '42', JSON.stringify({ dismissed_at: 7 }), JSON.stringify({ other: true })]) {
      storage.setItem(ONBOARDING_KEY, raw)
      expect(readDismissed(storage)).toBe(false)
    }
  })
  test('forgetting the dismissal lets the assistant offer again', () => {
    const storage = memory()
    writeDismissed(storage, new Date())
    clearDismissed(storage)
    expect(readDismissed(storage)).toBe(false)
  })
  test('an undefined storage is harmless in both directions', () => {
    expect(readDismissed(undefined)).toBe(false)
    expect(() => writeDismissed(undefined, new Date())).not.toThrow()
    expect(() => clearDismissed(undefined)).not.toThrow()
  })
})
