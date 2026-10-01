// Slot limiter for per-connection concurrency caps. Used by the hub so a
// single console socket cannot hammer the LLM provider with parallel
// analyst requests (each one is a paid / rate-limited call).

export type SlotLimiter = {
  /** Tries to take one slot; false when every slot is busy. */
  tryAcquire(): boolean
  /** Frees a previously acquired slot. Idempotent-safe on over-release. */
  release(): void
  /** Slots currently in use. */
  inFlight(): number
  readonly max: number
}

export function createSlotLimiter(max: number): SlotLimiter {
  const slots = Math.max(1, Math.floor(max))
  let used = 0
  return {
    max: slots,
    tryAcquire() {
      if (used >= slots) return false
      used += 1
      return true
    },
    release() {
      used = Math.max(0, used - 1)
    },
    inFlight() {
      return used
    },
  }
}

/** Sliding-window rate limiter. The slot limiter above bounds
 * CONCURRENCY only: a socket could still fire unbounded SEQUENTIAL
 * analyst requests (each a paid call on the operator's API key), so
 * the hub also caps the per-connection request rate per time window.
 * The window slides per request: old stamps age out lazily, no
 * timers, nothing to clean up on disconnect. */
export type RateLimiter = {
  /** Records one request; false when the window budget is exhausted. */
  tryTake(): boolean
  /** Requests taken inside the current window (after pruning). */
  taken(): number
  readonly max: number
  readonly windowMs: number
}

export function createRateLimiter(max: number, windowMs: number, now: () => number = Date.now): RateLimiter {
  const budget = Math.max(1, Math.floor(max))
  const window = Math.max(1, Math.floor(windowMs))
  const stamps: number[] = []
  const prune = (t: number) => {
    while (stamps.length > 0 && t - stamps[0]! >= window) stamps.shift()
  }
  return {
    max: budget,
    windowMs: window,
    tryTake() {
      const t = now()
      prune(t)
      if (stamps.length >= budget) return false
      stamps.push(t)
      return true
    },
    taken() {
      prune(now())
      return stamps.length
    },
  }
}
