import { describe, expect, test } from 'bun:test'
import { createRateLimiter, createSlotLimiter } from './limiter'

describe('createRateLimiter', () => {
  test('allows the budget inside the window and refuses beyond it', () => {
    let t = 1_000
    const rl = createRateLimiter(3, 60_000, () => t)
    expect(rl.tryTake()).toBe(true)
    expect(rl.tryTake()).toBe(true)
    expect(rl.tryTake()).toBe(true)
    expect(rl.tryTake()).toBe(false)
    expect(rl.taken()).toBe(3)
  })

  test('the window slides: old stamps age out and the budget returns', () => {
    let t = 10_000
    const rl = createRateLimiter(2, 60_000, () => t)
    expect(rl.tryTake()).toBe(true)
    t += 30_000
    expect(rl.tryTake()).toBe(true)
    expect(rl.tryTake()).toBe(false) // budget spent inside the window
    t += 31_000 // first stamp is now 61s old, outside the window
    expect(rl.tryTake()).toBe(true)
    expect(rl.taken()).toBe(2)
  })

  test('boundary: a stamp exactly windowMs old is released', () => {
    let t = 0
    const rl = createRateLimiter(1, 1_000, () => t)
    expect(rl.tryTake()).toBe(true)
    expect(rl.tryTake()).toBe(false)
    t += 1_000
    expect(rl.tryTake()).toBe(true)
  })

  test('degenerate budgets are clamped to at least one request', () => {
    const rl = createRateLimiter(0, 1_000, () => 0)
    expect(rl.max).toBe(1)
    expect(rl.tryTake()).toBe(true)
  })
})

describe('createSlotLimiter (regression)', () => {
  test('concurrency cap and release semantics stay intact', () => {
    const sl = createSlotLimiter(2)
    expect(sl.tryAcquire()).toBe(true)
    expect(sl.tryAcquire()).toBe(true)
    expect(sl.tryAcquire()).toBe(false)
    sl.release()
    expect(sl.tryAcquire()).toBe(true)
    expect(sl.inFlight()).toBe(2)
    sl.release()
    sl.release()
    expect(sl.inFlight()).toBe(0)
    sl.release() // over-release must not corrupt the counter
    expect(sl.inFlight()).toBe(0)
  })
})
