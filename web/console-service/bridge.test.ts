// Adversarial round (agent 04) for the engine bridge:
// 1. The change-only caches for suppressions/sequences must reset on
//    every (re)connect. The console CLEARS its lists when the engine
//    goes down (onDown pushes []), so after the engine comes back with
//    an unchanged payload the hub must still re-emit it — otherwise the
//    Cadenas/Supresiones views stay empty until the YAML changes.
// 2. mapStats must forward the store fields both type contracts declare
//    ("forwarded by the hub when the engine reports it"), the A1 hot-host
//    surface and the A2/A3 detector trios (beacons_*, threshold_*) the
//    OpenAPI Stats schema documents — the console header chips read them.
//
// The engine's HTTP API is stubbed at fetch level: health/rules/events/
// alerts/stats/suppressions/sequences answer JSON, /api/stream returns
// a ReadableStream we hold open and close on demand to simulate the
// engine disappearing. No real network, no real engine.

import { afterEach, describe, expect, test } from 'bun:test'
import { EngineBridge, type EngineBridgeCallbacks } from './bridge'
import type { HubStats, SfSequence, SfSuppression, SfAlert } from './types'

const SEQS: SfSequence[] = [
  { id: 'seq-1', name: 'Cadena A', description: 'd', severity: 'high', window_seconds: 600, tags: [], steps: ['rule-a'] },
]
const SUPS = { entries: [{ rule_id: 'rule-a' }] as SfSuppression[] }
const STATS: Record<string, unknown> = {
  mode: 'engine',
  events_total: 1,
  store_enabled: true,
  store_write_failures: 2,
  store_events: 7,
  store_alerts: 2,
  risk_hosts_tracked: 2,
  hot_hosts: [
    { host: 'PC-A', score: 15, alerts: 2, last_seen: '2026-09-30T12:00:00Z' },
    { host: 42, score: 'nine' }, // malformed row: the bridge must drop it
    { host: 'PC-B', score: 1, alerts: 1, last_seen: '2026-09-30T12:00:00Z' },
    { host: 'PC-C', score: 3, alerts: 'many' }, // non-finite alerts: dropped too (agent-04 cross-review)
  ],
  beacons_tracked: 12,
  beacons_cap: 8192,
  beacons_fired: 3,
  threshold_rules: 2,
  threshold_keys: 5,
  threshold_fired: 1,
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
  test('stop during a probe or snapshot cannot reopen SSE or emit late snapshots', async () => {
    for (const phase of ['probe', 'snapshot']) {
      const rec = recorder(); const streams: ReadableStreamDefaultController<Uint8Array>[] = []
      const base = stubEngine({ sequences: [], suppressions: { entries: [] }, stats: STATS, streams })
      let release: (() => void) | undefined
      globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const target = String(input)
        if (target.endsWith(phase === 'probe' ? '/api/health' : '/api/rules')) await new Promise<void>((done) => { release = done })
        return base(input, init)
      }) as typeof fetch
      const bridge = new EngineBridge(rec.cb, { retryMs: 5 }); const running = bridge.start()
      await until(() => Boolean(release), 2000, phase)
      bridge.stop(); release!(); await running
      expect(streams).toHaveLength(0); expect(rec.ups).toBe(0); expect(rec.stats).toHaveLength(0)
    }
  })
  test('stop cancels a live stream reader and releases polling', async () => {
    const rec = recorder(); const streams: ReadableStreamDefaultController<Uint8Array>[] = []
    const base = stubEngine({ sequences: [], suppressions: { entries: [] }, stats: STATS, streams }); let cancelled = false
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => String(input).endsWith('/api/stream')
      ? { ok: true, body: new ReadableStream<Uint8Array>({ cancel() { cancelled = true } }) } : base(input, init)) as typeof fetch
    const bridge = new EngineBridge(rec.cb, { retryMs: 5 }); const running = bridge.start()
    await until(() => rec.ups === 1, 2000, 'connected'); bridge.stop(); await running
    expect(cancelled).toBe(true); expect(rec.downs).toBe(0)
  })
  test('imported source evidence and info severity survive hub mapping', async () => {
    const rec = recorder(); const seen: SfAlert[] = []; rec.cb.onAlert = (value) => seen.push(value)
    const streams: ReadableStreamDefaultController<Uint8Array>[] = []
    globalThis.fetch = stubEngine({ sequences: [], suppressions: { entries: [] }, stats: STATS, streams })
    const bridge = new EngineBridge(rec.cb, { retryMs: 5 }); const running = bridge.start()
    await until(() => streams.length === 1, 2000, 'stream')
    streams[0].enqueue(new TextEncoder().encode('event: alert\ndata: ' + JSON.stringify({ id: '0123456789abcdef', source: 'suricata', severity: 'info', attributes: { ids_action: 'allowed', ids_verdict: 'drop' }, network: { destination_port: 443, source_ip: '10.0.0.1' }, actions: ['alert'], enrichment: { owner: 'SOC' } }) + '\n\n'))
    await until(() => seen.length === 1, 2000, 'source alert')
    expect(seen[0].severity).toBe('info'); expect(seen[0].source).toBe('suricata'); expect(seen[0].attributes!.ids_verdict).toBe('drop'); expect(seen[0].network!.destination_port).toBe(443); expect(seen[0].enrichment!.owner).toBe('SOC')
    bridge.stop(); await running
  })
  test('oversized incomplete SSE frames fail visibly and release the reader', async () => {
    const rec = recorder(); const streams: ReadableStreamDefaultController<Uint8Array>[] = []
    globalThis.fetch = stubEngine({ sequences: [], suppressions: { entries: [] }, stats: STATS, streams })
    const bridge = new EngineBridge(rec.cb, { retryMs: 5 }); rec.cb.onDown = () => { rec.downs++; bridge.stop() }; const running = bridge.start()
    await until(() => streams.length === 1, 2000, 'stream'); streams[0].enqueue(new TextEncoder().encode('x'.repeat(2 * 1024 * 1024 + 1)))
    await running; expect(rec.downs).toBe(1)
  })
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
    expect(rec.stats[0].store_write_failures).toBe(2)
    expect(rec.stats[0].store_events).toBe(7)
    expect(rec.stats[0].store_alerts).toBe(2)
    // A1: hot hosts forwarded, malformed rows dropped, count forwarded
    expect(rec.stats[0].risk_hosts_tracked).toBe(2)
    expect(rec.stats[0].hot_hosts).toEqual([
      { host: 'PC-A', score: 15, alerts: 2, last_seen: '2026-09-30T12:00:00Z' },
      { host: 'PC-B', score: 1, alerts: 1, last_seen: '2026-09-30T12:00:00Z' },
    ]) // PC-C (alerts: 'many' -> NaN) dropped: a count must be finite like the score
    // A3/A2: both detector trios documented in the OpenAPI Stats schema
    // are forwarded for the header chips (beacons, volumetric thresholds)
    expect(rec.stats[0].beacons_tracked).toBe(12)
    expect(rec.stats[0].beacons_cap).toBe(8192)
    expect(rec.stats[0].beacons_fired).toBe(3)
    expect(rec.stats[0].threshold_rules).toBe(2)
    expect(rec.stats[0].threshold_keys).toBe(5)
    expect(rec.stats[0].threshold_fired).toBe(1)

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

  test('degrades the A2/A3 detector trios to zeros for engines predating them', async () => {
    const rec = recorder()
    const streams: ReadableStreamDefaultController<Uint8Array>[] = []
    // legacy stats payload: no beacons_*/threshold_* fields at all
    const legacy = { ...STATS }
    for (const k of ['beacons_tracked', 'beacons_cap', 'beacons_fired', 'threshold_rules', 'threshold_keys', 'threshold_fired']) {
      delete legacy[k]
    }
    globalThis.fetch = stubEngine({ sequences: [], suppressions: { entries: [] }, stats: legacy, streams })

    const bridge = new EngineBridge(rec.cb, { retryMs: 25 })
    const running = bridge.start()

    await until(() => rec.stats.length >= 1, 2000, 'first stats')
    // zeros, never NaN: the header chips hide on all-zero trios
    expect(rec.stats[0].beacons_tracked).toBe(0)
    expect(rec.stats[0].beacons_cap).toBe(0)
    expect(rec.stats[0].beacons_fired).toBe(0)
    expect(rec.stats[0].threshold_rules).toBe(0)
    expect(rec.stats[0].threshold_keys).toBe(0)
    expect(rec.stats[0].threshold_fired).toBe(0)

    streams[streams.length - 1].close()
    bridge.stop()
    await Promise.race([running, new Promise((r) => setTimeout(r, 500))])
  }, 15000)
})
