// Unit tests for the engine proxy boundary (route.ts). They run the
// REAL route handlers with a stubbed global fetch, so the guards (host
// pinning, same-origin writes) and the bearer pass-through are
// exercised exactly as Next invokes them — no server, no engine.
//
//   bun test            (from web/console/)
//
// The stub records every (url, init) it receives and answers 200 with
// the headers it got, so each assertion can check both what was
// forwarded and whether anything was forwarded at all.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'

type Captured = { url: string; init: RequestInit }

let captured: Captured[] = []

const realFetch = globalThis.fetch

function stubFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({
      url: String(input),
      init: init ?? {},
    })
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}

// Import the route module fresh with the env already in place: the
// ENGINE_URL constant is read at module load, the guards read their
// env per request.
async function loadRoute() {
  return import('./route')
}

const ENV_KEYS = ['SF_API_TOKEN', 'CONSOLE_ALLOWED_HOSTS', 'ENGINE_API_URL'] as const
const savedEnv: Record<string, string | undefined> = {}

describe('engine proxy boundary', () => {
  beforeEach(() => {
    captured = []
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k]
      delete process.env[k]
    }
    stubFetch()
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
  })

  const triageUrl = 'http://127.0.0.1:3000/api/engine/api/alerts/0123456789abcdef/status'

  test('GET loopback is forwarded with no authorization when no token is set', async () => {
    const { GET } = await loadRoute()
    const res = await GET(new Request('http://127.0.0.1:3000/api/engine/api/stats'))
    expect(res.status).toBe(200)
    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('http://127.0.0.1:7778/api/stats')
    expect((captured[0].init.headers as Record<string, string>).authorization).toBeUndefined()
  })

  test('SF_API_TOKEN rides every forwarded request (the README promise)', async () => {
    process.env.SF_API_TOKEN = 'secret-token'
    const { GET, POST } = await loadRoute()
    await GET(new Request('http://127.0.0.1:3000/api/engine/api/stats'))
    expect((captured[0].init.headers as Record<string, string>).authorization).toBe('Bearer secret-token')
    const res = await POST(
      new Request(triageUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3000' },
        body: JSON.stringify({ status: 'closed' }),
      }),
    )
    expect(res.status).toBe(200)
    expect((captured[1].init.headers as Record<string, string>).authorization).toBe('Bearer secret-token')
    expect(captured[1].init.body).toBe(JSON.stringify({ status: 'closed' }))
  })

  test('non-loopback host is refused loud (fail-loud, names the escape hatch)', async () => {
    const { GET } = await loadRoute()
    const res = await GET(new Request('http://evil.example:3000/api/engine/api/stats'))
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string; hint: string }
    expect(body.error).toBe('host_not_allowed')
    expect(body.hint).toContain('CONSOLE_ALLOWED_HOSTS')
    expect(captured).toHaveLength(0) // nothing reached the engine
  })

  test('CONSOLE_ALLOWED_HOSTS opens a non-loopback host explicitly', async () => {
    process.env.CONSOLE_ALLOWED_HOSTS = 'lab.example'
    const { GET } = await loadRoute()
    const res = await GET(new Request('http://lab.example:3000/api/engine/api/stats'))
    expect(res.status).toBe(200)
    expect(captured).toHaveLength(1)
  })

  test('cross-site triage POST is refused before anything is forwarded', async () => {
    const { POST } = await loadRoute()
    const res = await POST(
      new Request(triageUrl, {
        method: 'POST',
        headers: { 'content-type': 'text/plain', origin: 'http://evil.example' },
        body: JSON.stringify({ status: 'closed' }),
      }),
    )
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('cross_site_write')
    expect(captured).toHaveLength(0)
  })

  test('sec-fetch-site cross-site is refused even with a matching origin-less request', async () => {
    const { POST } = await loadRoute()
    const res = await POST(
      new Request(triageUrl, {
        method: 'POST',
        headers: { 'sec-fetch-site': 'cross-site' },
        body: JSON.stringify({ status: 'closed' }),
      }),
    )
    expect(res.status).toBe(403)
    expect(captured).toHaveLength(0)
  })

  test('headerless clients (curl, smokes) keep forwarding the triage POST', async () => {
    const { POST } = await loadRoute()
    const res = await POST(
      new Request(triageUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'acknowledged', note: 'from the dev smoke' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('http://127.0.0.1:7778/api/alerts/0123456789abcdef/status')
  })

  test('same-origin POST (the console itself) still works', async () => {
    const { POST } = await loadRoute()
    const res = await POST(
      new Request(triageUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3000' },
        body: JSON.stringify({ status: 'closed' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(captured).toHaveLength(1)
  })

  test('malformed Origin is never forwarded on', async () => {
    const { POST } = await loadRoute()
    const res = await POST(
      new Request(triageUrl, {
        method: 'POST',
        headers: { origin: 'not-a-url' },
        body: JSON.stringify({ status: 'closed' }),
      }),
    )
    expect(res.status).toBe(403)
    expect(captured).toHaveLength(0)
  })

  test('the read-only contract is untouched: non-triage POST answers 405', async () => {
    const { POST } = await loadRoute()
    const res = await POST(
      new Request('http://127.0.0.1:3000/api/engine/api/rules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rule: 'x' }),
      }),
    )
    expect(res.status).toBe(405)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('read_only')
    expect(captured).toHaveLength(0)
  })
})
