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
