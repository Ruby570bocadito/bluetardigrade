// Unit tests for the hub state (ring buffers, snapshot contract,
// health payload) and the slot limiter. No network involved.

import { describe, expect, test } from 'bun:test'
import { HubState, MAX_ALERTS, MAX_EVENTS } from './hub-state'
import { createSlotLimiter } from './limiter'
import type { HubStats, SfAlert, SfEvent } from './types'

const ev = (id: string): SfEvent => ({
  id,
  timestamp: '2026-09-30T10:00:00Z',
  type: 'process.create',
  source: 'sf-sensor (Sysmon real)',
  host: 'LAB-WKS-01',
})
const al = (id: string): SfAlert => ({
  id,
  timestamp: '2026-09-30T10:00:00Z',
  rule_id: 'r1',
  rule_name: 'rule',
  severity: 'high',
  host: 'LAB-WKS-01',
  event_id: 'e1',
  event_type: 'process.create',
  summary: 's',
  matched_on: [],
  tags: [],
})

describe('HubState ring buffers', () => {
  test('keeps events newest first and trims to MAX_EVENTS', () => {
    const st = new HubState({})
    for (let i = 0; i < MAX_EVENTS + 5; i++) st.recordEvent(ev(`e${i}`))
    expect(st.events.length).toBe(MAX_EVENTS)
    expect(st.events[0]?.id).toBe(`e${MAX_EVENTS + 4}`)
    expect(st.events[MAX_EVENTS - 1]?.id).toBe('e5')
  })

  test('keeps alerts newest first and trims to MAX_ALERTS', () => {
    const st = new HubState({})
    for (let i = 0; i < MAX_ALERTS + 3; i++) st.recordAlert(al(`a${i}`))
    expect(st.alerts.length).toBe(MAX_ALERTS)
    expect(st.alerts[0]?.id).toBe(`a${MAX_ALERTS + 2}`)
  })
})

describe('HubState snapshot', () => {
  test('keeps the exact console contract shape', () => {
    const st = new HubState({})
    st.recordEvent(ev('e1'))
    st.recordAlert(al('a1'))
    st.setRules([{ id: 'r1', name: 'n', description: '', severity: 'low', event_type: 't', mitre: '', tactic: '', tags: [], conditions: [] }])
    const snap = st.snapshot()
    expect(Object.keys(snap).sort()).toEqual(['alerts', 'events', 'rules', 'sequences', 'started_at', 'stats', 'suppressions'])
    expect(snap.events.map((e) => e.id)).toEqual(['e1'])
    expect(snap.rules.length).toBe(1)
    expect(snap.stats.mode).toBe('sin-motor')
    expect(Number.isNaN(new Date(snap.started_at).getTime())).toBe(false)
  })
})

describe('HubState health', () => {
  test('degraded while the engine is down, ok once attached', () => {
    const st = new HubState({
      ANALYST_BASE_URL: 'http://x/v1',
      ANALYST_API_KEY: 'secret-key-value',
      ANALYST_MODEL: 'm1',
    })
    let h = st.health('0.0.0-test')
    expect(h.service).toBe('console-service')
    expect(h.status).toBe('degraded')
    expect(h.mode).toBe('sin-motor')
    expect(h.engine.connected).toBe(false)
    expect(h.engine.last_stats_age_s).toBeNull()

    st.setUp('http://127.0.0.1:7778')
    const stats: HubStats = {
      events_total: 5,
      alerts_total: 1,
      by_severity: { high: 1 },
      events_per_min: 3,
      uptime_s: 90,
      interval_ms: 0,
      mode: 'engine',
    }
    st.setStats(stats)
    st.recordEvent(ev('e1'))
    st.recordAlert(al('a1'))
    st.incClients()
    st.incClients()
    h = st.health('0.0.0-test')
    expect(h.status).toBe('ok')
    expect(h.mode).toBe('engine')
    expect(h.engine.endpoint).toBe('http://127.0.0.1:7778')
    expect(h.engine.uptime_s).toBe(90)
    expect(h.engine.events_total).toBe(5)
    expect(h.buffers).toEqual({ events: 1, alerts: 1, max_events: MAX_EVENTS, max_alerts: MAX_ALERTS })
    expect(h.clients).toEqual({ connected: 2, total: 2 })
    expect(h.analyst.configured).toBe(true)
    expect(h.analyst.model).toBe('m1')
    // the health payload must never leak the API key
    expect(JSON.stringify(h)).not.toContain('secret-key-value')
  })

  test('lists the missing analyst variables without throwing', () => {
    const st = new HubState({})
    expect(st.health('0.0.0-test').analyst).toEqual({
      configured: false,
      missing: ['ANALYST_BASE_URL', 'ANALYST_API_KEY', 'ANALYST_MODEL'],
      model: '',
      base_url: '',
    })
  })

  test('setDown resets the last stats so stale numbers never leak', () => {
    const st = new HubState({})
    st.setUp('http://e')
    st.setStats({ events_total: 9, alerts_total: 0, by_severity: {}, events_per_min: 1, uptime_s: 10, interval_ms: 0, mode: 'engine' })
    st.setDown()
    expect(st.stats().events_total).toBe(0)
    expect(st.stats().mode).toBe('sin-motor')
    expect(st.health('0.0.0-test').status).toBe('degraded')
  })
})

describe('createSlotLimiter', () => {
  test('caps concurrency and restores slots on release', () => {
    const lim = createSlotLimiter(2)
    expect(lim.max).toBe(2)
    expect(lim.tryAcquire()).toBe(true)
    expect(lim.tryAcquire()).toBe(true)
    expect(lim.tryAcquire()).toBe(false)
    expect(lim.inFlight()).toBe(2)
    lim.release()
    expect(lim.tryAcquire()).toBe(true)
    expect(lim.inFlight()).toBe(2)
    lim.release()
    lim.release()
    expect(lim.inFlight()).toBe(0)
  })
})
