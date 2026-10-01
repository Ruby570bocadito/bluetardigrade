import { describe, expect, test } from 'bun:test'
import { activityBuckets, ACTIVITY_WINDOW_MS } from './activity'

const now = Date.parse('2026-09-30T20:00:00Z')
const at = (age: number) => ({ timestamp: new Date(now - age).toISOString() })

describe('sensor activity window', () => {
  test('ages out activity without receiving any new events', () => {
    const events = [at(0)]
    expect(activityBuckets(events, now).at(-1)).toBe(1)
    expect(activityBuckets(events, now + 5000).at(-2)).toBe(1)
    expect(activityBuckets(events, now + ACTIVITY_WINDOW_MS).every((n) => n === 0)).toBe(true)
  })
  test('excludes future, invalid and expired timestamps', () => {
    const buckets = activityBuckets([at(-1), at(ACTIVITY_WINDOW_MS), { timestamp: 'invalid' }], now)
    expect(buckets.reduce((a, b) => a + b, 0)).toBe(0)
    expect(Math.max(...buckets)).toBe(0)
  })
  test('counts exact bucket boundaries only once', () => {
    const buckets = activityBuckets([at(0), at(4999), at(5000), at(ACTIVITY_WINDOW_MS - 1)], now)
    expect(buckets.at(-1)).toBe(2)
    expect(buckets.at(-2)).toBe(1)
    expect(buckets[0]).toBe(1)
    expect(buckets.reduce((a, b) => a + b, 0)).toBe(4)
  })
})
