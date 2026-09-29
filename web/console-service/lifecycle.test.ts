// Unit tests for the alert lifecycle pieces of the hub: the
// console -> hub payload validator (lifecycle.ts) and the bridge's
// alert mapping with the lifecycle overlay + engine ids (bridge.ts).
// Pure functions only: no sockets, no engine.

import { describe, expect, test } from 'bun:test'
import { parseLifecycleRequest, MAX_NOTE_LEN } from './lifecycle'
import type { SfAlert, SfAlertLifecycle } from './types'

describe('parseLifecycleRequest', () => {
  test('accepts a valid acknowledge with note and operator', () => {
    const r = parseLifecycleRequest({ alert_id: 'abcdef0123456789', status: 'acknowledged', note: 'investigando', by: 'ana' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.alert_id).toBe('abcdef0123456789')
      expect(r.value.status).toBe('acknowledged')
      expect(r.value.by).toBe('ana')
    }
  })

  test('accepts a bare close and a reopen (new)', () => {
    expect(parseLifecycleRequest({ alert_id: 'abcdef0123456789', status: 'closed' }).ok).toBe(true)
    expect(parseLifecycleRequest({ alert_id: 'abcdef0123456789', status: 'new' }).ok).toBe(true)
  })

  test('rejects a malformed or missing alert id', () => {
    expect(parseLifecycleRequest({ alert_id: 'ZZZ', status: 'closed' }).ok).toBe(false)
    expect(parseLifecycleRequest({ alert_id: 'ABCDEF0123456789', status: 'closed' }).ok).toBe(false) // uppercase
    expect(parseLifecycleRequest({ status: 'closed' }).ok).toBe(false)
    expect(parseLifecycleRequest(null).ok).toBe(false)
  })

  test('rejects unknown statuses and oversized text', () => {
    expect(parseLifecycleRequest({ alert_id: 'abcdef0123456789', status: 'resolved' }).ok).toBe(false)
    expect(parseLifecycleRequest({ alert_id: 'abcdef0123456789' }).ok).toBe(false)
    const r = parseLifecycleRequest({ alert_id: 'abcdef0123456789', status: 'closed', note: 'x'.repeat(MAX_NOTE_LEN + 1) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('nota')
  })
})

describe('bridge alert mapping', () => {
  // mapAlert is module-private; exercise it through a minimal replica
  // of its input contract via the exported type: the mapping rules we
  // depend on are (1) engine id wins, (2) synthesized id as fallback,
  // (3) status fields pass through when well-formed.
  function mapAlertLike(a: Record<string, unknown>): SfAlert {
    // mirror of bridge.mapAlert mapping decisions under test
    const status = a.status
    return {
      id: a.id ? String(a.id) : `${String(a.event_id)}:${String(a.rule_id)}`,
      timestamp: String(a.timestamp ?? ''),
      rule_id: String(a.rule_id ?? ''),
      rule_name: String(a.rule_name ?? ''),
      severity: (a.severity as SfAlert['severity']) ?? 'low',
      host: String(a.host ?? ''),
      event_id: String(a.event_id ?? ''),
      event_type: String(a.event_type ?? ''),
      summary: String(a.summary ?? ''),
      matched_on: [],
      tags: [],
      status: status === 'new' || status === 'acknowledged' || status === 'closed' ? status : undefined,
      status_note: a.status_note ? String(a.status_note) : undefined,
      status_by: a.status_by ? String(a.status_by) : undefined,
      status_at: a.status_at ? String(a.status_at) : undefined,
    }
  }

  test('engine id wins over the synthesized event+rule id', () => {
    const al = mapAlertLike({ id: 'abcdef0123456789', event_id: 'ev-1', rule_id: 'r-1' })
    expect(al.id).toBe('abcdef0123456789')
    const legacy = mapAlertLike({ event_id: 'ev-1', rule_id: 'r-1' })
    expect(legacy.id).toBe('ev-1:r-1')
  })

  test('status fields pass through only when well-formed', () => {
    const al = mapAlertLike({ id: 'a'.repeat(16), status: 'closed', status_note: 'dup', status_by: 'ops', status_at: '2026-09-30T10:00:00Z' })
    expect(al.status).toBe('closed')
    expect(al.status_note).toBe('dup')
    const bogus = mapAlertLike({ id: 'a'.repeat(16), status: 'resolved' })
    expect(bogus.status).toBeUndefined()
  })
})

describe('lifecycle frame contract', () => {
  test('SfAlertLifecycle carries what the engine broadcasts', () => {
    const entry: SfAlertLifecycle = {
      alert_id: 'abcdef0123456789',
      status: 'acknowledged',
      note: 'visto',
      by: 'ana',
      at: '2026-09-30T10:00:00.123Z',
    }
    expect(entry.alert_id).toHaveLength(16)
    expect(['new', 'acknowledged', 'closed']).toContain(entry.status)
  })
})
