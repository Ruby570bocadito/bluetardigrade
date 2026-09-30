// Unit tests for the alert lifecycle write path (lifecycle.ts): the
// client-side validation gate (isTriageActionValid) and the
// postAlertStatus fetch wrapper. They run the REAL module with a
// stubbed global fetch, so the triage vocabulary (the client-side
// mirror of the engine's r6 validation) and the error mapping are
// exercised exactly as the triage panel invokes them — no server, no
// engine.
//
//   bun test            (from web/console/)

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { isTriageActionValid, postAlertStatus, type TriageAction } from './lifecycle'
import type { SfAlertStatus } from './console-types'

const realFetch = globalThis.fetch

function validAction(): TriageAction {
  return { alert_id: '0123456789abcdef', status: 'acknowledged' }
}

describe('isTriageActionValid (client-side r6 gate)', () => {
  test('accepts every status of the closed vocabulary with optional fields absent', () => {
    for (const status of ['new', 'acknowledged', 'closed'] as const) {
      expect(isTriageActionValid({ alert_id: '0123456789abcdef', status })).toBe(true)
    }
  })

  test('rejects malformed ids: short, non-hex, uppercase, empty', () => {
    // The engine assigns lowercase 16-hex ids; the pattern is the whole
    // gate, so each failure class is pinned on its own.
    expect(isTriageActionValid({ ...validAction(), alert_id: '0123456789abcde' })).toBe(false)
    expect(isTriageActionValid({ ...validAction(), alert_id: '0123456789abcdeg' })).toBe(false)
    expect(isTriageActionValid({ ...validAction(), alert_id: '0123456789ABCDEF' })).toBe(false)
    expect(isTriageActionValid({ ...validAction(), alert_id: '' })).toBe(false)
  })

  test('rejects statuses outside the vocabulary', () => {
    expect(isTriageActionValid({ ...validAction(), status: 'triaged' as SfAlertStatus })).toBe(false)
    expect(isTriageActionValid({ ...validAction(), status: '' as SfAlertStatus })).toBe(false)
  })

  test('enforces the note and by ceilings exactly (2000 / 200)', () => {
    expect(isTriageActionValid({ ...validAction(), note: 'x'.repeat(2000) })).toBe(true)
    expect(isTriageActionValid({ ...validAction(), note: 'x'.repeat(2001) })).toBe(false)
    expect(isTriageActionValid({ ...validAction(), by: 'x'.repeat(200) })).toBe(true)
    expect(isTriageActionValid({ ...validAction(), by: 'x'.repeat(201) })).toBe(false)
  })
})

describe('postAlertStatus', () => {
  let calls: { url: string; init: RequestInit }[]
  let responder: () => Response

  beforeEach(() => {
    calls = []
    delete process.env.NEXT_PUBLIC_ENGINE_API
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} })
      return responder()
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    if (process.env.NEXT_PUBLIC_ENGINE_API === undefined) delete process.env.NEXT_PUBLIC_ENGINE_API
  })

  test('an invalid action fails fast without touching the network', async () => {
    responder = () => {
      throw new Error('the network must not be reached for an invalid action')
    }
    const ack = await postAlertStatus({ ...validAction(), alert_id: 'no-soy-hex' })
    expect(ack.ok).toBe(false)
    if (!ack.ok) expect(ack.error).toBe('accion de triaje invalida (id, estado o nota fuera de rango)')
    expect(calls.length).toBe(0)
  })

  test('a valid action POSTs through the same-origin proxy with the default note/by', async () => {
    responder = () =>
      new Response(
        JSON.stringify({ alert_id: '0123456789abcdef', status: 'acknowledged', at: '2026-09-30T18:00:00Z', by: 'consola', note: '' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    const ack = await postAlertStatus(validAction())
    expect(calls.length).toBe(1)
    expect(calls[0].url).toBe('/api/engine/api/alerts/0123456789abcdef/status')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      status: 'acknowledged',
      note: '',
      by: 'consola',
    })
    expect(ack.ok).toBe(true)
    if (ack.ok) expect(ack.entry?.status).toBe('acknowledged')
  })

  test('an engine error body names the problem and the ack forwards it verbatim', async () => {
    responder = () => new Response(JSON.stringify({ error: 'cooldown activo para este pid' }), { status: 429 })
    const ack = await postAlertStatus(validAction())
    expect(ack.ok).toBe(false)
    if (!ack.ok) expect(ack.error).toBe('cooldown activo para este pid')
    expect(calls.length).toBe(1)
  })

  test('an unparseable error body falls back to the status line', async () => {
    responder = () => new Response('<html>gateway timeout</html>', { status: 504 })
    const ack = await postAlertStatus(validAction())
    expect(ack.ok).toBe(false)
    if (!ack.ok) expect(ack.error).toBe('el motor respondio 504')
  })

  test('a network failure maps to an actionable error, never a throw', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      void input
      void init
      throw new Error('connection refused')
    }) as typeof fetch
    const ack = await postAlertStatus(validAction())
    expect(ack.ok).toBe(false)
    if (!ack.ok) expect(ack.error).toBe('no se pudo registrar el estado: connection refused')
  })
})
