// Local pass-through to the Go engine's read-only API (default
// http://127.0.0.1:7778, see internal/api). The browser talks to this
// same-origin route, so the engine needs no CORS headers and the SSE
// stream, the JSON endpoints and the JSONL/CSV exports all behave
// exactly as the engine serves them. Read-only by design: only GET is
// forwarded, mirroring the engine's surface.

const ENGINE_URL = process.env.ENGINE_API_URL || 'http://127.0.0.1:7778'

const PASS_HEADERS = ['content-type', 'content-disposition', 'cache-control']

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
      method: 'GET',
      headers: { accept: request.headers.get('accept') ?? '*/*' },
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

export async function POST(): Promise<Response> {
  return Response.json({ error: 'read_only', hint: 'La API del motor es de solo lectura.' }, { status: 405 })
}
