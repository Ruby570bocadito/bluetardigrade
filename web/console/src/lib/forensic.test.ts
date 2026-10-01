// Unit tests for the forensic bundle read path (forensic.ts): the
// id gate, the status-code tri-state mapping (404 missing / 501
// disabled / other error / 200 bundle) and the timeline line
// rendering. They run the REAL module with a stubbed global fetch —
// no server, no engine.
//
//   bun test            (from web/console/)

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { readForensicBundle, forensicEventLine, type ForensicBundle } from './forensic'

const realFetch = globalThis.fetch

function bundle(overrides: Partial<ForensicBundle> = {}): ForensicBundle {
  return {
    alert: { id: '0123456789abcdef' },
    captured_at: '2026-10-01T12:00:00Z',
    host: 'LAB-01',
    window: '5m before alert',
    timeline: [
      {
        id: 'e1',
        timestamp: '2026-10-01T11:59:00Z',
        type: 'process.create',
        host: 'LAB-01',
        process: { pid: 4242, name: 'cmd.exe', command_line: 'cmd.exe /c whoami' },
      },
    ],
    summary: {
      events: 1,
      process_creates: 1,
      network_connects: 0,
      file_writes: 0,
      registry_sets: 0,
      process_accesses: 0,
      other: 0,
      distinct_users: 1,
      distinct_images: ['C:\\Windows\\cmd.exe'],
    },
    ...overrides,
  }
}

describe('readForensicBundle', () => {
  let responder: () => Response
  let urls: string[]

  beforeEach(() => {
    urls = []
    delete process.env.NEXT_PUBLIC_ENGINE_API
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input))
      return responder()
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    if (process.env.NEXT_PUBLIC_ENGINE_API === undefined) delete process.env.NEXT_PUBLIC_ENGINE_API
  })

  test('malformed ids fail fast as "missing" without touching the network', async () => {
    responder = () => {
      throw new Error('the network must not be reached for a malformed id')
    }
    for (const id of ['', 'short', '0123456789ABCDEF', '0123456789abcdeG']) {
      expect((await readForensicBundle(id)).kind).toBe('missing')
    }
    expect(urls).toHaveLength(0)
  })

  test('maps 404 to missing, 501 to disabled, anything else to error', async () => {
    responder = () => new Response('{"error":"x"}', { status: 404 })
    expect((await readForensicBundle('0123456789abcdef')).kind).toBe('missing')

    responder = () => new Response('{"error":"x"}', { status: 501 })
    expect((await readForensicBundle('0123456789abcdef')).kind).toBe('disabled')

    responder = () => new Response('boom', { status: 500 })
    expect((await readForensicBundle('0123456789abcdef')).kind).toBe('error')

    responder = () => {
      throw new TypeError('network down')
    }
    expect((await readForensicBundle('0123456789abcdef')).kind).toBe('error')
  })

  test('a valid bundle decodes through the same-origin proxy path', async () => {
    const b = bundle()
    responder = () => new Response(JSON.stringify(b), { status: 200 })
    const res = await readForensicBundle('0123456789abcdef')
    expect(res.kind).toBe('bundle')
    if (res.kind === 'bundle') {
      expect(res.bundle.host).toBe('LAB-01')
      expect(res.bundle.summary.process_creates).toBe(1)
    }
    expect(urls[0]).toBe('/api/engine/api/alerts/0123456789abcdef/forensics')
  })

  test('a 200 whose body is not a bundle degrades to error, not to a broken panel', async () => {
    responder = () => new Response('{"unexpected": true}', { status: 200 })
    expect((await readForensicBundle('0123456789abcdef')).kind).toBe('error')
  })
})

describe('forensicEventLine (the vocabulary of the timeline)', () => {
  test('process.create prefers the full command line, then the name', () => {
    expect(forensicEventLine({
      id: 'a', timestamp: '', type: 'process.create', host: 'h',
      process: { pid: 1, name: 'cmd.exe', command_line: 'cmd.exe /c whoami' },
    })).toBe('cmd.exe /c whoami')
    expect(forensicEventLine({
      id: 'a', timestamp: '', type: 'process.create', host: 'h',
      process: { pid: 1, name: 'cmd.exe' },
    })).toBe('cmd.exe')
  })

  test('network.connect renders protocol, destination domain/ip and port', () => {
    expect(forensicEventLine({
      id: 'a', timestamp: '', type: 'network.connect', host: 'h',
      network: { protocol: 'tcp', domain: 'c2.example', destination_port: 443 },
    })).toBe('tcp -> c2.example:443')
    expect(forensicEventLine({
      id: 'a', timestamp: '', type: 'network.connect', host: 'h',
      network: { protocol: 'udp', destination_ip: '10.0.0.9' },
    })).toBe('udp -> 10.0.0.9')
  })

  test('file.write and registry.set name their target', () => {
    expect(forensicEventLine({
      id: 'a', timestamp: '', type: 'file.write', host: 'h', file: { path: 'C:\\x\\p.exe' },
    })).toBe('escribe C:\\x\\p.exe')
    expect(forensicEventLine({
      id: 'a', timestamp: '', type: 'registry.set', host: 'h', registry: { key: 'HKCU\\...\\Run' },
    })).toBe('registro HKCU\\...\\Run')
  })

  test('unknown types fall back to the raw type, never to a crash', () => {
    expect(forensicEventLine({ id: 'a', timestamp: '', type: 'dns.query', host: 'h' })).toBe('dns.query')
  })
})
