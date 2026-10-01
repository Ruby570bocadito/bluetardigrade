// Unit tests for the forensic bundle read path (forensic.ts): the
// id gate, the status-code tri-state mapping (404 missing / 501
// disabled / other error / 200 bundle) and the timeline line
// rendering. They run the REAL module with a stubbed global fetch —
// no server, no engine.
//
//   bun test            (from web/console/)

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { readForensicBundle, forensicEventLine, buildForensicExport, type ForensicBundle } from './forensic'

const realFetch = globalThis.fetch
const realApiBase = process.env.NEXT_PUBLIC_ENGINE_API

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
    if (realApiBase === undefined) delete process.env.NEXT_PUBLIC_ENGINE_API
    else process.env.NEXT_PUBLIC_ENGINE_API = realApiBase
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

  test('incomplete summaries and malformed events fail before rendering', async () => {
    for (const b of [
      { ...bundle(), summary: null },
      { ...bundle(), summary: {} },
      { ...bundle(), summary: { ...bundle().summary, distinct_images: [42] } },
      { ...bundle(), timeline: [null] },
      { ...bundle(), timeline: [{ ...bundle().timeline[0], process: { name: ['cmd.exe'] } }] },
      { ...bundle(), timeline: [{ ...bundle().timeline[0], process: { name: 'cmd.exe', pid: {} } }] },
      { ...bundle(), timeline: [{ ...bundle().timeline[0], host: 'OTHER-HOST' }] },
      { ...bundle(), summary: { ...bundle().summary, events: 200 } },
    ]) {
      responder = () => Response.json(b)
      expect((await readForensicBundle('0123456789abcdef')).kind).toBe('error')
    }
  })

  test('evidence for a different alert id cannot be displayed as this alert', async () => {
    responder = () => Response.json(bundle({ alert: { id: 'fedcba9876543210' } }))
    expect((await readForensicBundle('0123456789abcdef')).kind).toBe('error')
  })

  test('empty collections from older engines normalize to usable arrays', async () => {
    responder = () => Response.json({ ...bundle(), timeline: null, summary: { ...bundle().summary, events: 0, process_creates: 0, distinct_images: null } })
    const res = await readForensicBundle('0123456789abcdef')
    expect(res.kind).toBe('bundle')
    if (res.kind === 'bundle') {
      expect(res.bundle.timeline).toEqual([])
      expect(res.bundle.summary.distinct_images).toEqual([])
    }
  })

  test('the explicit engine API base is honored', async () => {
    process.env.NEXT_PUBLIC_ENGINE_API = 'https://engine.example'
    responder = () => Response.json(bundle())
    expect((await readForensicBundle('0123456789abcdef')).kind).toBe('bundle')
    expect(urls[0]).toBe('https://engine.example/api/alerts/0123456789abcdef/forensics')
  })
})

describe('frozen evidence exports', () => {
  const full = {
    ...bundle(),
    alert: { id: '0123456789abcdef', rule_name: 'Evidence', matched_on: ['file.path'], enrichment: { parent_name: 'winword.exe' } },
    extension_metadata: { preserved: true },
    timeline: [{ ...bundle().timeline[0], source: 'sysmon', tags: ['sensor:file'], enrichment: { trace: 'línea 1\nlínea 2' } }],
  }

  test('JSON round-trips the complete alert, events and unknown fields', () => {
    const exported = buildForensicExport(full, 'json')
    expect(JSON.parse(exported.contents)).toEqual(full)
    expect(exported.filename).toBe('forensic-0123456789abcdef.json')
    expect(exported.mime.startsWith('application/json')).toBe(true)
  })

  test('JSONL has one metadata envelope plus complete, independently parseable events', () => {
    const exported = buildForensicExport(full, 'jsonl')
    const rows = exported.contents.trimEnd().split('\n').map((line) => JSON.parse(line))
    expect(rows).toHaveLength(2)
    expect(rows[0].record_type).toBe('forensic.bundle')
    expect(rows[0].version).toBe(1)
    expect(rows[1].record_type).toBe('forensic.event')
    expect({ ...rows[0].bundle, timeline: rows.slice(1).map((row) => row.event) }).toEqual(full)
    expect(exported.filename).toBe('forensic-0123456789abcdef.jsonl')
  })

  test('an empty timeline still exports its alert and metadata', () => {
    const b = bundle({ timeline: [], summary: { ...bundle().summary, events: 0, process_creates: 0, distinct_images: [] } })
    const rows = buildForensicExport(b, 'jsonl').contents.trimEnd().split('\n').map((line) => JSON.parse(line))
    expect(rows).toHaveLength(1)
    expect(rows[0].bundle.alert.id).toBe(b.alert.id)
  })

  test('untrusted ids cannot become download filenames', () => {
    expect(() => buildForensicExport(bundle({ alert: { id: '../host/name' } }), 'json')).toThrow()
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

  test('process access names the target and mask; module load names the file', () => {
    expect(forensicEventLine({ id: 'a', timestamp: '', type: 'process.access', host: 'h', process: { pid: 1, name: 'dump.exe' },
      target: { pid: 2, name: 'lsass.exe' }, access: { granted_access: '0x1010' },
    })).toBe('dump.exe accede a lsass.exe (0x1010)')
    expect(forensicEventLine({ id: 'a', timestamp: '', type: 'image.load', host: 'h', file: { path: 'C:\\Temp\\version.dll' } })).toBe('carga C:\\Temp\\version.dll')
  })
})
