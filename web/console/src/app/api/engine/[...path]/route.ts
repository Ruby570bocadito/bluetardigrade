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

const ENGINE_URL = process.env.ENGINE_API_URL || 'http://127.0.0.1:7778'

const PASS_HEADERS = ['content-type', 'content-disposition', 'cache-control']

// The triage endpoint is the only POST the proxy forwards.
const TRIAGE_RE = /^\/api\/alerts\/[0-9a-f]{16}\/status$/

export const dynamic = 'force-dynamic'

function engineTarget(request: Request): string {
  const { pathname, search } = new URL(request.url)
  // strip this route's own prefix, keep the rest verbatim
  const path = pathname.replace(/^\/api\/engine/, '') || '/'
  return `${ENGINE_URL}${path}${search}`
}

async function forward(request: Request): Promise<Response> {
  let upstream: Response
  try {
    upstream = await fetch(engineTarget(request), {
      method: request.method,
      headers: {
        accept: request.headers.get('accept') ?? '*/*',
        // the triage POST carries a JSON body; the engine caps it at 8 KiB
        ...(request.method === 'POST' && request.headers.get('content-type')
          ? { 'content-type': request.headers.get('content-type') as string }
          : {}),
      },
      body: request.method === 'POST' ? await request.text() : undefined,
      cache: 'no-store',
    })
  } catch {
    return Response.json(
      { error: 'engine_unreachable', hint: 'El motor no responde: arranca cmd/engine y revisa ENGINE_API_URL.' },
      { status: 502 },
    )
  }
  const headers = new Headers()
  for (const name of PASS_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  // the SSE stream must never be buffered or cached by the proxy layer
  headers.set('cache-control', 'no-store, no-transform')
  return new Response(upstream.body, { status: upstream.status, headers })
}

export async function GET(request: Request): Promise<Response> {
  return forward(request)
}

export async function POST(request: Request): Promise<Response> {
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
  return forward(request)
}
