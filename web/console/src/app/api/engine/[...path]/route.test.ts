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
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pbkdf2Sync } from 'node:crypto'
import { resetUsersCache } from '@/lib/users'

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

const ENV_KEYS = [
  'SF_API_TOKEN',
  'CONSOLE_ALLOWED_HOSTS',
  'ENGINE_API_URL',
  'CONSOLE_ACCESS_TOKEN',
  'CONSOLE_ALLOW_UNAUTHENTICATED',
  'CONSOLE_USERS_FILE',
  'CONSOLE_AUDIT_FILE',
] as const

const basic = (password: string, user = 'ana') => 'Basic ' + btoa(`${user}:${password}`)
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
    expect(captured[0].init.body).toBeUndefined()
    expect(captured[0].init.signal).toBeDefined()
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

  test('CONSOLE_ALLOWED_HOSTS opens a non-loopback host only with credentials', async () => {
    process.env.CONSOLE_ALLOWED_HOSTS = 'lab.example'
    const { GET } = await loadRoute()
    // exposed beyond loopback with no credential configured: refused
    let res = await GET(new Request('http://lab.example:3000/api/engine/api/stats'))
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toBe('console_auth_not_configured')
    // ...and that refusal covers spoofed loopback Host headers too
    res = await GET(new Request('http://lab.example:3000/api/engine/api/stats', { headers: { host: 'localhost' } }))
    expect(res.status).toBe(403)
    expect(captured).toHaveLength(0)
    // with a console token the host is served to authenticated callers
    process.env.CONSOLE_ACCESS_TOKEN = 'console-secret'
    res = await GET(new Request('http://lab.example:3000/api/engine/api/stats', { headers: { authorization: basic('console-secret') } }))
    expect(res.status).toBe(200)
    expect(captured).toHaveLength(1)
  })

  test('CONSOLE_ALLOW_UNAUTHENTICATED declares an authenticating front end', async () => {
    process.env.CONSOLE_ALLOWED_HOSTS = 'lab.example'
    process.env.CONSOLE_ALLOW_UNAUTHENTICATED = '1'
    const { GET } = await loadRoute()
    const res = await GET(new Request('http://lab.example:3000/api/engine/api/stats'))
    expect(res.status).toBe(200)
    expect(captured).toHaveLength(1)
  })

  test('CONSOLE_ACCESS_TOKEN gates every request, spoofed loopback Host included', async () => {
    process.env.CONSOLE_ACCESS_TOKEN = 'console-secret'
    process.env.SF_API_TOKEN = 'engine-secret'
    const { GET, POST } = await loadRoute()
    for (const authorization of [undefined, basic('wrong'), 'Bearer console-secret', 'Basic !!!']) {
      const headers: Record<string, string> = { host: 'localhost:3000' }
      if (authorization) headers.authorization = authorization
      const res = await GET(new Request('http://127.0.0.1:3000/api/engine/api/alerts', { headers }))
      expect(res.status).toBe(401)
      expect(res.headers.get('www-authenticate')).toContain('Basic')
    }
    const post = await POST(new Request(triageUrl, { method: 'POST', body: JSON.stringify({ status: 'closed' }) }))
    expect(post.status).toBe(401)
    expect(captured).toHaveLength(0) // the engine token never left the console
    const ok = await GET(new Request('http://127.0.0.1:3000/api/engine/api/alerts', { headers: { authorization: basic('console-secret', 'any user') } }))
    expect(ok.status).toBe(200)
    expect((captured[0].init.headers as Record<string, string>).authorization).toBe('Bearer engine-secret')
  })

  test('IPv6 loopback and normalized DNS loopback are accepted', async () => {
    const { GET } = await loadRoute()
    for (const host of ['[::1]:3000', 'LOCALHOST.:3000', '127.0.0.1:3000']) {
      const res = await GET(new Request('http://localhost:3000/api/engine/api/stats', { headers: { host } }))
      expect(res.status).toBe(200)
    }
    expect(captured).toHaveLength(3)
  })

  test('malformed authorities and lookalike loopback hosts fail closed', async () => {
    const { GET } = await loadRoute()
    for (const host of ['localhost@evil.example', 'localhost.evil.example', 'localhost/path', 'localhost?x=1', '[::1', 'localhost:bad']) {
      const res = await GET(new Request('http://localhost:3000/api/engine/api/stats', { headers: { host } }))
      expect(res.status).toBe(403)
    }
    expect(captured).toHaveLength(0)
  })

  test('oversized triage is refused before forwarding, including multibyte text', async () => {
    const { POST } = await loadRoute()
    for (const body of ['x'.repeat(8193), '€'.repeat(3000)]) {
      const res = await POST(new Request(triageUrl, { method: 'POST', body }))
      expect(res.status).toBe(413)
    }
    expect(captured).toHaveLength(0)
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

  test('the write allowlist forwards each console write with its own method', async () => {
    const { POST, PATCH, DELETE } = await loadRoute()
    const base = 'http://127.0.0.1:3000/api/engine'
    const calls: [typeof POST, string, string][] = [
      [POST, 'POST', '/api/incidents'],
      [PATCH, 'PATCH', '/api/incidents/0123456789abcdef'],
      [POST, 'POST', '/api/incidents/0123456789abcdef/alerts'],
      [POST, 'POST', '/api/incidents/0123456789abcdef/notes'],
      [POST, 'POST', '/api/rules/test'],
      [POST, 'POST', '/api/suppressions'],
      [DELETE, 'DELETE', '/api/suppressions?rule_id=r&host=lab'],
    ]
    for (const [handler, method, path] of calls) {
      const res = await handler(new Request(base + path, {
        method,
        headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3000' },
        body: method === 'DELETE' ? undefined : JSON.stringify({ title: 'x' }),
      }))
      expect(res.status).toBe(200)
    }
    expect(captured.map((c) => `${c.init.method} ${new URL(c.url).pathname}`)).toEqual(
      calls.map(([, method, path]) => `${method} ${path.split('?')[0]}`),
    )
    expect(captured[6].url).toContain('?rule_id=r&host=lab')
  })

  test('the operator credential is forwarded on the kill route only', async () => {
    const { POST } = await loadRoute()
    const headers = { 'content-type': 'application/json', 'x-sf-operator-token': 'operator-secret' }
    await POST(new Request('http://127.0.0.1:3000/api/engine/api/respond/kill', { method: 'POST', headers, body: '{}' }))
    await POST(new Request('http://127.0.0.1:3000/api/engine/api/incidents', { method: 'POST', headers, body: '{}' }))
    const sent: (string | undefined)[] = captured.map((c) => (c.init.headers as Record<string, string | undefined>)['x-sf-operator-token'])
    expect(sent).toEqual(['operator-secret', undefined])
  })

  test('PATCH outside incidents, unknown ids and oversized incident bodies are refused', async () => {
    const { PATCH, POST, DELETE } = await loadRoute()
    const base = 'http://127.0.0.1:3000/api/engine'
    expect((await PATCH(new Request(base + '/api/rules', { method: 'PATCH', body: '{}' }))).status).toBe(405)
    expect((await PATCH(new Request(base + '/api/incidents/NOT-AN-ID', { method: 'PATCH', body: '{}' }))).status).toBe(405)
    expect((await DELETE(new Request(base + '/api/incidents/0123456789abcdef', { method: 'DELETE' }))).status).toBe(405)
    const big = await POST(new Request(base + '/api/incidents', { method: 'POST', body: 'x'.repeat(33 * 1024) }))
    expect(big.status).toBe(413)
    expect(captured).toHaveLength(0)
  })

  test('cross-site PATCH and DELETE are refused like POST', async () => {
    const { PATCH, DELETE } = await loadRoute()
    const base = 'http://127.0.0.1:3000/api/engine'
    const cross = { 'sec-fetch-site': 'cross-site' }
    expect((await PATCH(new Request(base + '/api/incidents/0123456789abcdef', { method: 'PATCH', headers: cross, body: '{}' }))).status).toBe(403)
    expect((await DELETE(new Request(base + '/api/suppressions?rule_id=r', { method: 'DELETE', headers: cross }))).status).toBe(403)
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

describe('engine proxy with analyst accounts', () => {
  const SALT = Buffer.from('fedcba9876543210')
  const account = (user: string, role: string) => ({
    user,
    role,
    password: `pbkdf2-sha256$100000$${SALT.toString('base64url')}$${pbkdf2Sync(`clave-de-${user}`, SALT, 100_000, 32, 'sha256').toString('base64url')}`,
  })
  const as = (user: string) => ({ authorization: basic(`clave-de-${user}`, user), 'content-type': 'application/json' })
  const base = 'http://127.0.0.1:3000/api/engine'
  let audit = ''

  beforeEach(() => {
    captured = []
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k]
      delete process.env[k]
    }
    const dir = mkdtempSync(join(tmpdir(), 'sf-route-users-'))
    const users = join(dir, 'users.json')
    writeFileSync(users, JSON.stringify({ users: [account('ana', 'analyst'), account('luis', 'viewer'), account('jefa', 'admin')] }))
    audit = join(dir, 'audit.jsonl')
    process.env.CONSOLE_USERS_FILE = users
    process.env.CONSOLE_AUDIT_FILE = audit
    resetUsersCache()
    stubFetch()
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
  })

  test('reads need an account', async () => {
    const { GET } = await loadRoute()
    expect((await GET(new Request(base + '/api/stats'))).status).toBe(401)
    expect((await GET(new Request(base + '/api/stats', { headers: as('luis') }))).status).toBe(200)
    expect(captured).toHaveLength(1)
  })

  test('the account name replaces "by" on attributed writes', async () => {
    const { POST } = await loadRoute()
    const res = await POST(new Request(base + '/api/alerts/0123456789abcdef/status', { method: 'POST', headers: as('ana'), body: JSON.stringify({ status: 'closed', by: 'consola' }) }))
    expect(res.status).toBe(200)
    expect(JSON.parse(String(captured[0].init.body))).toEqual({ status: 'closed', by: 'ana' })
    await POST(new Request(base + '/api/incidents/0123456789abcdef/notes', { method: 'POST', headers: as('ana'), body: JSON.stringify({ text: 'revisado', by: 'otra persona' }) }))
    expect(JSON.parse(String(captured[1].init.body)).by).toBe('ana')
  })

  test('a viewer cannot triage, an analyst cannot kill, and both are audited', async () => {
    const { POST, DELETE } = await loadRoute()
    const denied = await POST(new Request(base + '/api/alerts/0123456789abcdef/status', { method: 'POST', headers: as('luis'), body: '{"status":"closed"}' }))
    expect(denied.status).toBe(403)
    expect(((await denied.json()) as { error: string }).error).toBe('role_forbidden')
    expect((await DELETE(new Request(base + '/api/suppressions?rule_id=r', { method: 'DELETE', headers: as('luis') }))).status).toBe(403)
    expect((await POST(new Request(base + '/api/respond/kill', { method: 'POST', headers: as('ana'), body: '{}' }))).status).toBe(403)
    expect(captured).toHaveLength(0)
    // a viewer may still dry-run a rule: it changes nothing
    expect((await POST(new Request(base + '/api/rules/test', { method: 'POST', headers: as('luis'), body: '{}' }))).status).toBe(200)
    expect((await POST(new Request(base + '/api/respond/kill', { method: 'POST', headers: as('jefa'), body: '{}' }))).status).toBe(200)
    const lines = readFileSync(audit, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.map((l) => `${l.user}:${l.outcome}`)).toEqual(['luis:denied', 'luis:denied', 'ana:denied', 'luis:ok', 'jefa:ok'])
    expect(lines[4]).toMatchObject({ method: 'POST', path: '/api/respond/kill', role: 'admin', status: 200 })
  })

  test('only an administrator enrolls machines, under their own name', async () => {
    const { POST } = await loadRoute()
    const approve = base + '/api/enroll/hosts/enr-pc-aula3-01-a1b2c3/approve'
    expect((await POST(new Request(base + '/api/enroll/tokens', { method: 'POST', headers: as('ana'), body: '{}' }))).status).toBe(403)
    expect((await POST(new Request(approve, { method: 'POST', headers: as('ana'), body: '{}' }))).status).toBe(403)
    expect(captured).toHaveLength(0)
    expect((await POST(new Request(base + '/api/enroll/tokens', { method: 'POST', headers: as('jefa'), body: JSON.stringify({ label: 'aula 3', by: 'otra' }) }))).status).toBe(200)
    expect(JSON.parse(String(captured[0].init.body))).toEqual({ label: 'aula 3', by: 'jefa' })
    expect((await POST(new Request(approve, { method: 'POST', headers: as('jefa'), body: '{}' }))).status).toBe(200)
    expect((await POST(new Request(base + '/api/enroll/tokens/0a1b2c3d/revoke', { method: 'POST', headers: as('jefa'), body: '{}' }))).status).toBe(200)
    // any other shape never reaches the engine
    for (const path of ['/api/enroll/hosts/enr-pc-1-a1b2c3/delete', '/api/enroll/hosts/../tokens/approve', '/api/enroll/tokens/xyz/revoke']) {
      expect((await POST(new Request(base + path, { method: 'POST', headers: as('jefa'), body: '{}' }))).status).toBe(405)
    }
    expect(captured).toHaveLength(3)
    const lines = readFileSync(audit, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.map((l) => `${l.user}:${l.outcome}`)).toEqual(['ana:denied', 'ana:denied', 'jefa:ok', 'jefa:ok', 'jefa:ok'])
  })
})
