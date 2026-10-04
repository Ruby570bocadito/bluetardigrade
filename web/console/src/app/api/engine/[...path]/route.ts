// Local pass-through to the Go engine's local API (default
// http://127.0.0.1:7778, see internal/api). The browser talks to this
// same-origin route, so the engine needs no CORS headers and the SSE
// stream, the JSON endpoints and the JSONL/CSV exports all behave
// exactly as the engine serves them.
//
// Surface policy: everything the engine serves as GET is forwarded as
// is. Writes go through a closed allowlist (WRITES below): alert triage,
// incidents, the rule tester dry run, suppressions (the engine refuses
// them unless started with -api-write) and kill_process (armed only by
// -allow-kill, and it still demands the operator's own credential, the
// one header forwarded on that path alone). Any other method or path is
// rejected here, before the engine sees it.
//
// Boundary posture (mirrors the engine's own: loopback friction-free,
// beyond loopback loud): this route is the one listener that bridges a
// browser to the engine, so it carries two guards of its own.
//
// 1. Host pinning. `next dev`/`next start` bind beyond loopback, which
//    would let the proxy serve engine telemetry to any LAN host — and
//    a DNS-rebinding page could reach it as "same-origin" — while the
//    engine itself only answers 127.0.0.1. Forwarded requests are
//    therefore served only when the Host header matches the loopback
//    allowlist (localhost / 127.0.0.1 / ::1) or, for non-loopback
//    deployments, the explicit CONSOLE_ALLOWED_HOSTS list. Everything
//    else gets a 403 that names the escape hatch — fail-loud, like the
//    engine's 0.0.0.0-without-token warning.
//
// 2. Same-origin writes. The triage POST is forwarded only when there
//    is no evidence of a cross-site browser context (Origin header
//    mismatch or Sec-Fetch-Site: cross-site). A hostile page in the
//    operator's browser can fire a "simple request" at the console
//    with a JSON body in text/plain — the engine's status handler
//    parses the body regardless of content type — so the guard must
//    live here, before anything is forwarded. Headerless clients
//    (curl, REST tooling, the dev-tests smokes) keep working: no
//    browser context, no CSRF.
//
// 3. Credentials. Host pinning cannot stop a NON-browser client: curl
//    sends whatever Host it likes. When the console is reachable beyond
//    loopback, CONSOLE_ACCESS_TOKEN (lib/access.ts, enforced for every
//    path by src/proxy.ts and re-checked here) is the boundary. Allowing
//    extra hosts without it is refused unless the operator states that
//    something in front already authenticates
//    (CONSOLE_ALLOW_UNAUTHENTICATED=1).

import { accessToken, authorized, unauthorizedResponse } from '@/lib/access'

const ENGINE_URL = process.env.ENGINE_API_URL || 'http://127.0.0.1:7778'

const PASS_HEADERS = ['content-type', 'content-disposition', 'cache-control']

// Writes the console performs: method, path and body cap. The caps
// mirror the engine's own limits so oversized bodies stop here.
type WriteRoute = { method: string; path: RegExp; limit: number; operatorToken?: boolean }
const KIB = 1024
const WRITES: WriteRoute[] = [
  { method: 'POST', path: /^\/api\/alerts\/[0-9a-f]{16}\/status$/, limit: 8 * KIB },
  { method: 'POST', path: /^\/api\/incidents$/, limit: 32 * KIB },
  { method: 'PATCH', path: /^\/api\/incidents\/[0-9a-f]{16}$/, limit: 32 * KIB },
  { method: 'POST', path: /^\/api\/incidents\/[0-9a-f]{16}\/(alerts|notes)$/, limit: 32 * KIB },
  { method: 'POST', path: /^\/api\/rules\/test$/, limit: 32 * KIB },
  { method: 'POST', path: /^\/api\/suppressions$/, limit: 8 * KIB },
  { method: 'DELETE', path: /^\/api\/suppressions$/, limit: 0 },
  { method: 'POST', path: /^\/api\/respond\/kill$/, limit: 8 * KIB, operatorToken: true },
]

function writeRoute(method: string, path: string): WriteRoute | undefined {
  return WRITES.find((route) => route.method === method && route.path.test(path))
}

// Loopback hostnames served by default; everything else must be
// allowlisted explicitly via CONSOLE_ALLOWED_HOSTS.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

// Read per request (not at module load) so operators and tests can
// toggle the environment without restarting the module graph.
function apiToken(): string {
  return process.env.SF_API_TOKEN || ''
}

function extraHosts(): string[] {
  return (process.env.CONSOLE_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
}

function allowedHosts(): Set<string> {
  return new Set([...LOOPBACK_HOSTS, ...extraHosts()])
}

// exposedWithoutCredentials: the operator allowed hosts beyond loopback
// but configured no console credential and did not declare an
// authenticating front end.
function exposedWithoutCredentials(): boolean {
  const beyondLoopback = extraHosts().some((h) => !LOOPBACK_HOSTS.has(h))
  return beyondLoopback && !accessToken() && process.env.CONSOLE_ALLOW_UNAUTHENTICATED !== '1'
}

// hostAllowed checks the Host header (falling back to the request URL
// host): hostname compared without port, IPv6 brackets and any trailing
// dot normalized away, so `127.0.0.1:3000`, `LOCALHOST.` and
// `[::1]:3000` all match the loopback set.
function hostAllowed(request: Request): boolean {
  const raw = request.headers.get('host') ?? new URL(request.url).host
  // Parse the entire authority: splitting on ':' breaks [::1]:3000.
  // Reject userinfo and delimiters instead of letting URL normalization
  // turn an invalid Host into a trusted loopback hostname.
  if (/[\s/@\\?#]/.test(raw)) return false
  let hostname: string
  try {
    hostname = new URL('http://' + raw).hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  } catch {
    return false
  }
  return allowedHosts().has(hostname)
}

// crossSiteContext reports whether the request carries browser evidence
// of a cross-site sender. Headerless non-browser clients (curl, the
// dev-tests smokes) carry neither header and stay allowed.
function crossSiteContext(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (origin) {
    const host = request.headers.get('host') ?? new URL(request.url).host
    try {
      if (new URL(origin).host.toLowerCase() !== host.toLowerCase()) return true
    } catch {
      return true // malformed Origin: never forward on its behalf
    }
  }
  return request.headers.get('sec-fetch-site') === 'cross-site'
}

export const dynamic = 'force-dynamic'

function engineTarget(request: Request): string {
  const { pathname, search } = new URL(request.url)
  // strip this route's own prefix, keep the rest verbatim
  const path = pathname.replace(/^\/api\/engine/, '') || '/'
  return `${ENGINE_URL}${path}${search}`
}

async function forward(request: Request, body?: string, operatorToken = false): Promise<Response> {
  // Bearer pass-through (SF_API_TOKEN, the same env var the engine and
  // the console-service bridge honor): without it a token-protected
  // engine (-api-token) would leave this console stuck in 401s, and the
  // only "fix" an operator would find is disarming the API.
  const token = apiToken()
  const headers: Record<string, string> = {
    accept: request.headers.get('accept') ?? '*/*',
  }
  // write bodies are JSON; the engine caps each route itself too
  if (request.method !== 'GET' && request.headers.get('content-type')) {
    headers['content-type'] = request.headers.get('content-type') as string
  }
  // the operator's own credential travels on the kill route only
  const operator = request.headers.get('x-sf-operator-token')
  if (operatorToken && operator) headers['x-sf-operator-token'] = operator
  if (token) headers.authorization = `Bearer ${token}`
  let upstream: Response
  try {
    upstream = await fetch(engineTarget(request), {
      method: request.method,
      headers,
      body,
      cache: 'no-store',
      // no transparent redirects: a 3xx emitted by the engine (or by
      // anything sitting in front of it) would make this same-origin
      // proxy serve another host's response - with the engine's
      // content-type - as console origin. Hand the redirect status back
      // to the browser instead of following it.
      redirect: 'manual',
      signal: request.signal,
    })
  } catch {
    return Response.json(
      { error: 'engine_unreachable', hint: 'El motor no responde: arranca cmd/engine y revisa ENGINE_API_URL.' },
      { status: 502 },
    )
  }
  const outHeaders = new Headers()
  for (const name of PASS_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) outHeaders.set(name, value)
  }
  // the SSE stream must never be buffered or cached by the proxy layer
  outHeaders.set('cache-control', 'no-store, no-transform')
  return new Response(upstream.body, { status: upstream.status, headers: outHeaders })
}

// Match the engine's body caps before buffering or forwarding. Count
// bytes, not characters, and cancel oversized streamed bodies.
async function writeBody(request: Request, limit: number): Promise<string | Response> {
  const tooLarge = () => Response.json({ error: 'body_too_large' }, { status: 413 })
  if (Number(request.headers.get('content-length')) > limit) return tooLarge()
  if (!request.body) return ''
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let body = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return body + decoder.decode()
      bytes += value.byteLength
      if (bytes > limit) {
        await reader.cancel()
        return tooLarge()
      }
      body += decoder.decode(value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
}

function reject(request: Request, error: string, hint: string): Response {
  const from = request.headers.get('host') ?? new URL(request.url).host
  return Response.json({ error, hint, host: from }, { status: 403 })
}

// The boundary every forwarded request crosses: credentials and the
// exposure check first, then host pinning (it protects reads and
// writes alike), then the same-origin write guard.
async function refused(request: Request): Promise<Response | null> {
  if (!(await authorized(request))) return unauthorizedResponse()
  if (exposedWithoutCredentials()) {
    return reject(
      request,
      'console_auth_not_configured',
      'CONSOLE_ALLOWED_HOSTS expone la consola más allá de loopback sin credenciales: define CONSOLE_ACCESS_TOKEN (o CONSOLE_ALLOW_UNAUTHENTICATED=1 si un proxy inverso ya autentica a los operadores).',
    )
  }
  if (!hostAllowed(request)) {
    return reject(
      request,
      'host_not_allowed',
      'La consola solo responde en loopback (localhost/127.0.0.1/::1). Para otro host añádelo a CONSOLE_ALLOWED_HOSTS y asume que quien alcance la consola alcanza la telemetría del motor.',
    )
  }
  if (request.method !== 'GET' && crossSiteContext(request)) {
    return reject(
      request,
      'cross_site_write',
      'Escritura rechazada: contexto cross-site. Solo la propia consola (mismo origen) puede escribir en el motor.',
    )
  }
  return null
}

export async function GET(request: Request): Promise<Response> {
  const guard = await refused(request)
  if (guard) return guard
  return forward(request)
}

async function write(request: Request): Promise<Response> {
  const guard = await refused(request)
  if (guard) return guard
  const { pathname } = new URL(request.url)
  const path = pathname.replace(/^\/api\/engine/, '') || '/'
  const route = writeRoute(request.method, path)
  if (!route) {
    return Response.json(
      {
        error: 'read_only',
        hint: 'La consola solo reenvía al motor el triaje, los incidentes, el probador de reglas, las supresiones y la respuesta activa.',
      },
      { status: 405 },
    )
  }
  if (route.limit === 0) return forward(request, undefined, route.operatorToken)
  const body = await writeBody(request, route.limit)
  if (body instanceof Response) return body
  return forward(request, body, route.operatorToken)
}

export async function POST(request: Request): Promise<Response> {
  return write(request)
}

export async function PATCH(request: Request): Promise<Response> {
  return write(request)
}

export async function DELETE(request: Request): Promise<Response> {
  return write(request)
}
