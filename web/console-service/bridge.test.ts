// Adversarial round (agent 04) for the engine bridge:
// 1. The change-only caches for suppressions/sequences must reset on
//    every (re)connect. The console CLEARS its lists when the engine
//    goes down (onDown pushes []), so after the engine comes back with
//    an unchanged payload the hub must still re-emit it — otherwise the
//    Cadenas/Supresiones views stay empty until the YAML changes.
// 2. mapStats must forward the store fields both type contracts declare
//    ("forwarded by the hub when the engine reports it").
//
// The engine's HTTP API is stubbed at fetch level: health/rules/events/
// alerts/stats/suppressions/sequences answer JSON, /api/stream returns
// a ReadableStream we hold open and close on demand to simulate the
// engine disappearing. No real network, no real engine.

import { afterEach, describe, expect, test } from 'bun:test'
import { EngineBridge, type EngineBridgeCallbacks } from './bridge'
import type { HubStats, SfSequence, SfSuppression } from './types'

const SEQS: SfSequence[] = [
  { id: 'seq-1', name: 'Cadena A', description: 'd', severity: 'high', window_seconds: 600, tags: [], steps: ['rule-a'] },
]
const SUPS = { entries: [{ rule_id: 'rule-a' }] as SfSuppression[] }
const STATS: Record<string, unknown> = {
  mode: 'engine',
  events_total: 1,
  store_enabled: true,
  store_events: 7,
  store_alerts: 2,
}

type Recorder = {
  seqs: SfSequence[][]
  sups: SfSuppression[][]
  stats: HubStats[]
  ups: number
  downs: number
  cb: EngineBridgeCallbacks
}

function recorder(): Recorder {
  const rec: Recorder = {
    seqs: [],
    sups: [],
    stats: [],
    ups: 0,
    downs: 0,
    cb: null as unknown as EngineBridgeCallbacks,
  }
  rec.cb = {
    onEvent: () => {},
    onAlert: () => {},
    onRules: () => {},
    onStats: (st) => rec.stats.push(st),
    onSuppressions: (entries) => rec.sups.push(entries),
    onSequences: (seqs) => rec.seqs.push(seqs),
    onLifecycle: () => {},
    onUp: () => rec.ups++,
    onDown: () => rec.downs++,
  }
  return rec
}

async function until(cond: () => boolean, timeoutMs: number, what: string) {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

function stubEngine(opts: {
  sequences: unknown
  suppressions: unknown
  stats: Record<string, unknown>
  streams: ReadableStreamDefaultController<Uint8Array>[]
}) {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/api/health')) return { ok: true }
    if (url.endsWith('/api/rules')) return { ok: true, json: async () => [] }
    if (url.includes('/api/events')) return { ok: true, json: async () => [] }
    if (url.includes('/api/alerts')) return { ok: true, json: async () => [] }
    if (url.endsWith('/api/stream')) {
      // never-ending body: the bridge stays "connected" until the test
      // closes the controller (engine flap)
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          opts.streams.push(c)
        },
      })
      return { ok: true, body }
    }
    if (url.endsWith('/api/stats')) return { ok: true, json: async () => opts.stats }
    if (url.endsWith('/api/suppressions')) return { ok: true, json: async () => opts.suppressions }
    if (url.endsWith('/api/sequences')) return { ok: true, json: async () => opts.sequences }
    return { ok: false }
  }) as unknown as typeof fetch
}

const origFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = origFetch
})

describe('EngineBridge (agent-04 hardening)', () => {
  test('re-emits unchanged sequences/suppressions after an engine flap and forwards store stats', async () => {
    const rec = recorder()
    const streams: ReadableStreamDefaultController<Uint8Array>[] = []
    globalThis.fetch = stubEngine({ sequences: SEQS, suppressions: SUPS, stats: STATS, streams })

    const bridge = new EngineBridge(rec.cb, { retryMs: 25 })
    const running = bridge.start()

    // first connect: snapshot flows through
    await until(() => rec.seqs.length >= 1, 2000, 'first sequences emit')
    await until(() => rec.stats.length >= 1, 2000, 'first stats')
    await until(() => rec.sups.length >= 1, 2000, 'first suppressions emit')
    expect(rec.seqs[0]).toEqual(SEQS)
    // change-only contract inside ONE connection: no duplicate emits
    await new Promise((r) => setTimeout(r, 80))
    expect(rec.seqs.length).toBe(1)
    // F2: the store trio declared by both type contracts is forwarded
    expect(rec.stats[0].store_enabled).toBe(true)
    expect(rec.stats[0].store_events).toBe(7)
    expect(rec.stats[0].store_alerts).toBe(2)

    // engine flap: the SSE stream closes, the bridge reports down and
    // reconnects to an engine whose payloads did NOT change
    expect(rec.downs).toBe(0)
    streams[streams.length - 1].close()
    await until(() => rec.downs >= 1, 2000, 'engine-down report')
    const nSeq = rec.seqs.length
    const nSup = rec.sups.length
    await until(() => rec.seqs.length > nSeq, 4000, 'sequences re-emit after flap')
    await until(() => rec.sups.length > nSup, 4000, 'suppressions re-emit after flap')
    expect(rec.seqs[nSeq]).toEqual(SEQS) // same payload, still re-emitted

    // tidy shutdown: close the live stream so start() can return
    streams[streams.length - 1].close()
    bridge.stop()
    await Promise.race([running, new Promise((r) => setTimeout(r, 500))])
  }, 15000)
})
