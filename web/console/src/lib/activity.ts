import type { SfEvent } from './console-types'

export const ACTIVITY_WINDOW_MS = 4 * 60 * 1000
export const ACTIVITY_BUCKET_MS = 5000

// Half-open rolling window: (now - window, now]. Future, invalid and
// expired timestamps never contribute to sensor activity.
export function activityBuckets(events: readonly Pick<SfEvent, 'timestamp'>[], now: number): number[] {
  const out: number[] = new Array(ACTIVITY_WINDOW_MS / ACTIVITY_BUCKET_MS).fill(0)
  for (const event of events) {
    const age = now - Date.parse(event.timestamp)
    if (!Number.isFinite(age) || age < 0 || age >= ACTIVITY_WINDOW_MS) continue
    const index = out.length - 1 - Math.floor(age / ACTIVITY_BUCKET_MS)
    out[index]++
  }
  return out
}
