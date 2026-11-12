import { afterEach, describe, expect, test } from 'bun:test'
import {
  alertKey, engineDisplayEndpoint, mergeNewest, prependLive, prependLiveBatch,
  readEngineJson, readOptionalEngineJson, readRoleGatedEngineJson, settledBatch, streamRetryPlan,
} from './engine-client'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })
const signal = () => new AbortController().signal
const stub = (fn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) => {
  globalThis.fetch = fn as typeof fetch
}
const alert = (id: string, second: number, status = 'new') => ({
  id, timestamp: new Date(second * 1000).toISOString(), event_id: 'event', rule_id: 'rule', status,
})

describe('engine snapshots and SSE replay', () => {
  test('keeps frames arriving during REST sync and sorts newest first', () => {
    const merged = mergeNewest([alert('during-sync', 3)], [alert('older', 1), alert('snapshot', 2)], alertKey, 128)
    expect(merged.map((a) => a.id)).toEqual(['during-sync', 'snapshot', 'older'])
  })
  test('replayed frames preserve existing triage decisions', () => {
    const previous = [alert('same', 1, 'closed')]
    const merged = prependLive(alert('same', 1), previous, alertKey, 128)
    expect(merged).toBe(previous)
    expect(merged[0].status).toBe('closed')
  })
  test('a batch of live frames merges once and keeps existing entries', () => {
    const previous = [alert('same', 1, 'closed'), alert('old', 0)]
    const merged = prependLiveBatch([alert('b', 3), alert('same', 1), alert('a', 2), alert('b', 3)], previous, alertKey, 3)
    expect(merged.map((a) => a.id)).toEqual(['b', 'a', 'same'])
    expect(merged.find((a) => a.id === 'same')?.status).toBe('closed')
    expect(prependLiveBatch([alert('same', 1)], previous, alertKey, 3)).toBe(previous)
  })
  test('deduplicates snapshots and caps the retained window', () => {
    const merged = mergeNewest([alert('same', 3, 'acknowledged')], [alert('same', 3), alert('two', 2), alert('one', 1)], alertKey, 2)
    expect(merged).toHaveLength(2)
    expect(merged[0].status).toBe('acknowledged')
    expect(merged[1].id).toBe('two')
  })
  test('legacy keys remain stable and distinguish later re-alerts', () => {
    const a = { ...alert('', 1), id: undefined }
    expect(alertKey({ ...a })).toBe(alertKey(a))
    expect(alertKey({ ...a, timestamp: alert('', 2).timestamp })).not.toBe(alertKey(a))
  })
})

describe('bounded requests and optional surfaces', () => {
  test('a failed batch settles siblings before a later poll can start', async () => {
    let completed = false
    const sibling = new Promise<void>((resolve) => setTimeout(() => { completed = true; resolve() }, 10))
    await expect(settledBatch([Promise.reject(new Error('first failed')), sibling])).rejects.toThrow('first failed')
    expect(completed).toBe(true)
  })
  test('forwards no-store and aborts when the provider is disposed', async () => {
    const controller = new AbortController()
    let received: RequestInit | undefined
    stub(async (_input, init) => {
      received = init
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    })
    const pending = readEngineJson('/api/engine', '/api/stats', controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow('aborted')
    expect(received?.cache).toBe('no-store')
    expect(received?.signal?.aborted).toBe(true)
  })
  test('a stalled request times out', async () => {
    stub(async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('timeout')), { once: true })
    }))
    await expect(readEngineJson('/api/engine', '/api/stats', signal())).rejects.toThrow('timeout')
  }, 7000)
  test('404 clears an optional surface, transient failures preserve it', async () => {
    stub(async () => new Response('', { status: 404 }))
    expect(await readOptionalEngineJson('/api/engine', '/api/respond/state', signal())).toBeNull()
    stub(async () => new Response('', { status: 503 }))
    expect(await readOptionalEngineJson('/api/engine', '/api/respond/state', signal())).toBeUndefined()
    stub(async () => { throw new Error('network') })
    expect(await readOptionalEngineJson('/api/engine', '/api/respond/state', signal())).toBeUndefined()
  })
  test('display endpoints exclude userinfo, secret paths and query strings', () => {
    expect(engineDisplayEndpoint('https://user:secret@engine.example/private?token=hidden')).toBe('https://engine.example')
    expect(engineDisplayEndpoint('/api/engine')).toBe('proxy local · /api/engine')
    expect(engineDisplayEndpoint('bad URL')).toBe('API del motor')
  })
})

describe('reads refused to the account role', () => {
  test('the first 403 ends the polling of that read; other failures do not', async () => {
    let calls = 0
    let status = 500
    stub(async () => {
      calls++
      return status === 200 ? Response.json({ records: [] }) : new Response('{}', { status })
    })
    const gate = { denied: false }
    // a transient failure keeps the gate open and reports "unknown"
    expect(await readRoleGatedEngineJson('', '/api/respond/audit', signal(), gate)).toBeUndefined()
    expect(gate.denied).toBe(false)
    status = 404
    expect(await readRoleGatedEngineJson('', '/api/respond/audit', signal(), gate)).toBeNull()
    status = 200
    expect(await readRoleGatedEngineJson<{ records: unknown[] }>('', '/api/respond/audit', signal(), gate)).toEqual({ records: [] })
    status = 403
    expect(await readRoleGatedEngineJson('', '/api/respond/audit', signal(), gate)).toBeUndefined()
    expect(gate.denied).toBe(true)
    // from here on nothing is requested, whatever the server would say
    status = 200
    const before = calls
    for (let i = 0; i < 5; i++) expect(await readRoleGatedEngineJson('', '/api/respond/audit', signal(), gate)).toBeUndefined()
    expect(calls).toBe(before)
  })
})

describe('live stream retry', () => {
  test('a stream the browser is still retrying is left alone', () => {
    expect(streamRetryPlan(false, 1000, 15000)).toEqual({ recreateAfterMs: null, nextRetryMs: 1000 })
  })
  test('a closed stream is recreated with a delay that doubles up to the ceiling', () => {
    const delays: number[] = []
    let retry = 1000
    for (let i = 0; i < 7; i++) {
      const plan = streamRetryPlan(true, retry, 15000)
      delays.push(plan.recreateAfterMs as number)
      retry = plan.nextRetryMs
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 15000, 15000, 15000])
  })
})
