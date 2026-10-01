// Local pass-through to the Go engine's local API (default
// http://127.0.0.1:7778, see internal/api). The browser talks to this
// same-origin route, so the engine needs no CORS headers and the SSE
// stream, the JSON endpoints and the JSONL/CSV exports all behave
// exactly as the engine serves them.
//
// Surface policy: everything the engine serves as GET is forwarded as
// is. The ONE write path (r6 alert triage,
// POST /api/alerts/{id}/status) is forwarded too — it is how the
// console's reconocer/cerrar/reabrir actions reach the engine. Every
// other write method stays rejected: configuration, rules and
// suppressions remain flag/YAML-driven, never writable through here.
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

const ENGINE_URL = process.env.ENGINE_API_URL || 'http://127.0.0.1:7778'

const PASS_HEADERS = ['content-type', 'content-disposition', 'cache-control']

// The triage endpoint is the only POST the proxy forwards.
const TRIAGE_RE = /^\/api\/alerts\/[0-9a-f]{16}\/status$/

// Loopback hostnames served by default; everything else must be
// allowlisted explicitly via CONSOLE_ALLOWED_HOSTS.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

// Read per request (not at module load) so operators and tests can
// toggle the environment without restarting the module graph.
function apiToken(): string {
  return process.env.SF_API_TOKEN || ''
}

function allowedHosts(): Set<string> {
  const extra = (process.env.CONSOLE_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  return new Set([...LOOPBACK_HOSTS, ...extra])
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

async function forward(request: Request, body?: string): Promise<Response> {
  // Bearer pass-through (SF_API_TOKEN, the same env var the engine and
  // the console-service bridge honor): without it a token-protected
  // engine (-api-token) would leave this console stuck in 401s, and the
  // only "fix" an operator would find is disarming the API.
  const token = apiToken()
  const headers: Record<string, string> = {
    accept: request.headers.get('accept') ?? '*/*',
  }
  // the triage POST carries a JSON body; the engine caps it at 8 KiB
  if (request.method === 'POST' && request.headers.get('content-type')) {
    headers['content-type'] = request.headers.get('content-type') as string
  }
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

// Match the engine's 8 KiB triage cap before buffering or forwarding.
// Count bytes, not characters, and cancel oversized streamed bodies.
async function triageBody(request: Request): Promise<string | Response> {
  const limit = 8 * 1024
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

// The boundary every forwarded request crosses: host pinning first (it
// protects reads and writes alike), then the same-origin write guard.
function refused(request: Request): Response | null {
  if (!hostAllowed(request)) {
    return reject(
      request,
      'host_not_allowed',
      'La consola solo responde en loopback (localhost/127.0.0.1/::1). Para otro host añádelo a CONSOLE_ALLOWED_HOSTS y asume que quien alcance la consola alcanza la telemetría del motor.',
    )
  }
  if (request.method === 'POST' && crossSiteContext(request)) {
    return reject(
      request,
      'cross_site_write',
      'Escritura de triaje rechazada: contexto cross-site. Solo la propia consola (mismo origen) puede mover el estado de una alerta.',
    )
  }
  return null
}

export async function GET(request: Request): Promise<Response> {
  const guard = refused(request)
  if (guard) return guard
  return forward(request)
}

export async function POST(request: Request): Promise<Response> {
  const guard = refused(request)
  if (guard) return guard
  const { pathname } = new URL(request.url)
  const path = pathname.replace(/^\/api\/engine/, '') || '/'
  if (!TRIAGE_RE.test(path)) {
    return Response.json(
      {
        error: 'read_only',
        hint: 'La API del motor solo acepta escrituras de triaje en POST /api/alerts/{id}/status.',
      },
      { status: 405 },
    )
  }
  const body = await triageBody(request)
  if (body instanceof Response) return body
  return forward(request, body)
}
