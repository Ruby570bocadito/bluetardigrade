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
import {
  isAssignActionValid,
  isAssignBatchValid,
  isTriageActionValid,
  MAX_ASSIGN_BATCH_IDS,
  postAlertAssign,
  postAlertAssignBatch,
  postAlertStatus,
  type AssignAction,
  type TriageAction,
} from './lifecycle'
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

// ---- assignment (TEAM-3/M-1) -----------------------------------------------

function validAssign(): AssignAction {
  return { alert_id: '0123456789abcdef', assignee: 'ana', by: 'carlos' }
}

describe('isAssignActionValid (client-side mirror of the engine ceilings)', () => {
  test('accepts a normal assignment and the empty-assignee unassign', () => {
    expect(isAssignActionValid(validAssign())).toBe(true)
    expect(isAssignActionValid({ alert_id: '0123456789abcdef', assignee: '' })).toBe(true)
    expect(isAssignActionValid({ alert_id: '0123456789abcdef', assignee: '' })).toBe(true)
  })

  test('rejects malformed ids like the triage gate', () => {
    expect(isAssignActionValid({ ...validAssign(), alert_id: 'zzzz' })).toBe(false)
    expect(isAssignActionValid({ ...validAssign(), alert_id: '' })).toBe(false)
  })

  test('enforces the 200-character ceilings for assignee and by', () => {
    expect(isAssignActionValid({ ...validAssign(), assignee: 'x'.repeat(200) })).toBe(true)
    expect(isAssignActionValid({ ...validAssign(), assignee: 'x'.repeat(201) })).toBe(false)
    expect(isAssignActionValid({ ...validAssign(), by: 'x'.repeat(201) })).toBe(false)
  })
})

describe('isAssignBatchValid', () => {
  test('accepts a normal batch and rejects empty, oversized or malformed ones', () => {
    expect(isAssignBatchValid(['0123456789abcdef', 'ffffffffffffffff'], 'ana', 'carlos')).toBe(true)
    expect(isAssignBatchValid([], 'ana', 'carlos')).toBe(false)
    expect(isAssignBatchValid(['nope'], 'ana', 'carlos')).toBe(false)
    expect(isAssignBatchValid(['0123456789abcdef'], 'ana', 'carlos')).toBe(true)
    expect(isAssignBatchValid(Array.from({ length: MAX_ASSIGN_BATCH_IDS }, () => '0123456789abcdef'), 'ana', 'carlos')).toBe(true)
    expect(isAssignBatchValid(Array.from({ length: MAX_ASSIGN_BATCH_IDS + 1 }, () => '0123456789abcdef'), 'ana', 'carlos')).toBe(false)
    expect(isAssignBatchValid(['0123456789abcdef'], 'x'.repeat(201), 'carlos')).toBe(false)
    expect(isAssignBatchValid(['0123456789abcdef'], 'ana', 'x'.repeat(201))).toBe(false)
  })
})

describe('postAlertAssign', () => {
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
    const ack = await postAlertAssign({ ...validAssign(), alert_id: 'no-soy-hex' })
    expect(ack.ok).toBe(false)
    if (!ack.ok) expect(ack.error).toBe('accion de asignacion invalida (id o nombre fuera de rango)')
    expect(calls.length).toBe(0)
  })

  test('a valid assignment POSTs the engine body verbatim and returns the entry with the trio', async () => {
    responder = () =>
      new Response(
        JSON.stringify({
          alert_id: '0123456789abcdef',
          status: 'new',
          by: 'consola',
          at: '2026-10-22T10:00:00Z',
          assignee: 'ana',
          assigned_by: 'carlos',
          assigned_at: '2026-10-22T10:00:00Z',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    const ack = await postAlertAssign(validAssign())
    expect(calls.length).toBe(1)
    expect(calls[0].url).toBe('/api/engine/api/alerts/0123456789abcdef/assign')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ assignee: 'ana', by: 'carlos' })
    expect(ack.ok).toBe(true)
    if (ack.ok) {
      expect(ack.entry.assignee).toBe('ana')
      expect(ack.entry.assigned_by).toBe('carlos')
    }
  })

  test('a role refusal forwards the engine hint, another error names the problem', async () => {
    responder = () => new Response(JSON.stringify({ error: 'role_forbidden', hint: 'tu rol no permite triaje' }), { status: 403 })
    const denied = await postAlertAssign(validAssign())
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error).toBe('tu rol no permite triaje')

    responder = () => new Response(JSON.stringify({ error: 'assignee longer than 200 characters' }), { status: 400 })
    const bad = await postAlertAssign(validAssign())
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toBe('assignee longer than 200 characters')
  })

  test('a network failure maps to an actionable error, never a throw', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      void input
      void init
      throw new Error('connection refused')
    }) as typeof fetch
    const ack = await postAlertAssign(validAssign())
    expect(ack.ok).toBe(false)
    if (!ack.ok) expect(ack.error).toBe('no se pudo asignar: connection refused')
  })
})

describe('postAlertAssignBatch', () => {
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

  test('a valid selection POSTs the batch body and returns assigned/failed per id', async () => {
    responder = () =>
      new Response(
        JSON.stringify({
          assigned: ['0123456789abcdef'],
          failed: [{ id: 'ffffffffffffffff', error: 'unknown alert id' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    const ack = await postAlertAssignBatch(['0123456789abcdef', 'ffffffffffffffff', '0123456789abcdef'], 'ana', 'carlos')
    expect(calls.length).toBe(1)
    expect(calls[0].url).toBe('/api/engine/api/alerts/assign-batch')
    // duplicates collapse and the body keeps the engine shape
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      ids: ['0123456789abcdef', 'ffffffffffffffff'],
      assignee: 'ana',
      by: 'carlos',
    })
    expect(ack.ok).toBe(true)
    if (ack.ok) {
      expect(ack.result.assigned).toEqual(['0123456789abcdef'])
      expect(ack.result.failed).toEqual([{ id: 'ffffffffffffffff', error: 'unknown alert id' }])
    }
  })

  test('an oversized selection is sliced to the engine cap before the POST', async () => {
    responder = () => new Response(JSON.stringify({ assigned: [], failed: [] }), { status: 200 })
    const ids = Array.from({ length: MAX_ASSIGN_BATCH_IDS + 25 }, (_, i) => i.toString(16).padStart(16, '0'))
    const ack = await postAlertAssignBatch(ids, '', 'consola')
    expect(ack.ok).toBe(true)
    expect(JSON.parse(String(calls[0].init.body)).ids.length).toBe(MAX_ASSIGN_BATCH_IDS)
  })

  test('an empty selection fails fast without touching the network', async () => {
    responder = () => {
      throw new Error('the network must not be reached for an invalid batch')
    }
    const ack = await postAlertAssignBatch([], 'ana', 'carlos')
    expect(ack.ok).toBe(false)
    if (!ack.ok) expect(ack.error).toBe('lote de asignacion invalido (ids, nombre o tamaño fuera de rango)')
    expect(calls.length).toBe(0)
  })

  test('a role refusal forwards the engine hint and a network failure never throws', async () => {
    responder = () => new Response(JSON.stringify({ error: 'role_forbidden', hint: 'tu rol no permite triaje' }), { status: 403 })
    const denied = await postAlertAssignBatch(['0123456789abcdef'], 'ana', 'carlos')
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error).toBe('tu rol no permite triaje')

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      void input
      void init
      throw new Error('connection refused')
    }) as typeof fetch
    const down = await postAlertAssignBatch(['0123456789abcdef'], 'ana', 'carlos')
    expect(down.ok).toBe(false)
    if (!down.ok) expect(down.error).toBe('no se pudo asignar el lote: connection refused')
  })
})
