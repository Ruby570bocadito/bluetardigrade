import { afterEach, describe, expect, test } from 'bun:test'
import { createSuppression, deleteSuppression, engineCall, eventSha256, expiryInDays, isPublicIPv4, killProcess } from './engine-writes'

const realFetch = globalThis.fetch
let sent: { url: string; init: RequestInit }[] = []

function respond(status: number, body: string) {
  sent = []
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} })
    return new Response(body, { status })
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('engine write client', () => {
  test('JSON errors, plain-text errors and network failures become sentences', async () => {
    respond(403, '{"error":"api writes are disabled: restart the engine with -api-write"}')
    const forbidden = await createSuppression({ rule_id: 'r', host: 'lab', reason: 'x' })
    expect(forbidden).toEqual({ ok: false, status: 403, error: 'api writes are disabled: restart the engine with -api-write' })

    respond(400, 'rule_id and host are both empty\n')
    const plain = await deleteSuppression('', '')
    expect(plain.ok).toBe(false)
    if (!plain.ok) expect(plain.error).toBe('rule_id and host are both empty')

    globalThis.fetch = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    const down = await engineCall('GET', '/api/incidents')
    expect(down.ok).toBe(false)
    if (!down.ok) expect(down.error).toContain('offline')
  })

  test('deletes address the entry by query and kills carry the operator header', async () => {
    respond(200, '{}')
    await deleteSuppression('rule-1', 'LAB-WKS-01')
    expect(sent[0].url).toBe('/api/engine/api/suppressions?rule_id=rule-1&host=LAB-WKS-01')
    expect(sent[0].init.method).toBe('DELETE')
    respond(200, '{"action_id":"a","status":"executed"}')
    const ok = await killProcess({ host: 'LAB', pid: 42, process_name: 'x.exe', operator: 'ana', reason: 'contencion' }, 'secret')
    expect(ok.ok).toBe(true)
    expect((sent[0].init.headers as Record<string, string>)['X-SF-Operator-Token']).toBe('secret')
    expect(JSON.parse(String(sent[0].init.body))).toMatchObject({ pid: 42, operator: 'ana' })
  })

  test('expiry stamps are whole-second RFC 3339 UTC', () => {
    expect(expiryInDays(7, Date.parse('2026-10-04T10:00:00.123Z'))).toBe('2026-10-11T10:00:00Z')
  })

  test('only public IPv4 addresses are offered for reputation lookups', () => {
    for (const ip of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '127.0.0.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '300.1.1.1', 'nope', undefined]) {
      expect(isPublicIPv4(ip)).toBe(false)
    }
    for (const ip of ['185.220.101.47', '8.8.8.8', '172.32.0.1']) expect(isPublicIPv4(ip)).toBe(true)
  })
})

test('eventSha256 collects valid image and file digests once', () => {
  const h = 'AB'.repeat(32)
  expect(eventSha256({ process: { pid: 1, name: 'x.exe', hashes: { SHA256: h, md5: 'd41d8cd98f00b204e9800998ecf8427e' } }, file: { path: 'C:\\x', hashes: { sha256: h.toLowerCase() } } })).toEqual(['ab'.repeat(32)])
  expect(eventSha256({ process: { pid: 1, name: 'x', hashes: { sha256: 'nope' } } })).toEqual([])
  expect(eventSha256(undefined)).toEqual([])
})
