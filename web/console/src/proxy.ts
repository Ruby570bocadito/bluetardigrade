// Next.js request proxy (formerly "middleware"): the console-wide
// access gate plus the per-request content security policy. Every
// page, asset and API route passes through here first; see
// lib/access.ts for the access threat model.
//
// CSP: the console renders attacker-controllable telemetry (command
// lines, file paths, registry values) fetched from monitored endpoints.
// React escapes text nodes, but defense in depth demands the browser
// itself refuse anything the app did not ask for. Production script-src
// is nonce-based: this proxy mints a fresh nonce per request, publishes
// the policy on the REQUEST headers (Next.js parses it and signs its
// bootstrap/flight scripts with the same nonce) and on the response.
// 'strict-dynamic' lets the signed bootstrap load its own chunks while
// every external script origin stays blocked. The one hand-written
// inline script (theme boot in app/layout.tsx) carries the nonce via
// the x-nonce request header. Dev keeps 'unsafe-inline'/'unsafe-eval'
// for the React refresh runtime. style-src stays 'unsafe-inline':
// Tailwind + component-level inline styles and the reactbits
// animation keyframes.
// The engine stays same-origin; the local analyst hub has its own port.
// Keep HTTP polling and WebSocket origins aligned with the client URL
// (NEXT_PUBLIC_CONSOLE_URL, same value the client bundle inlines).
//   - img-src data:: inline chart markers and data URIs.
// X-Frame-Options + frame-ancestors (next.config.ts): the console must
// never be framed (clickjacking on a kill-adjacent UI).
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authorized, unauthorizedResponse } from './lib/access'

const isDev = process.env.NODE_ENV !== 'production'

const hubUrl = new URL(process.env.NEXT_PUBLIC_CONSOLE_URL || 'http://localhost:3003', 'http://localhost:3000')
if (!['http:', 'https:'].includes(hubUrl.protocol)) throw new Error('NEXT_PUBLIC_CONSOLE_URL must use HTTP(S)')
const hubOrigin = hubUrl.origin
const hubSocketOrigin = hubOrigin.replace(/^http/, 'ws')

function contentSecurityPolicy(nonce: string): string {
  const scriptSrc = isDev
    ? "'self' 'unsafe-inline' 'unsafe-eval'"
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src 'self' ${hubOrigin} ${hubSocketOrigin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

export async function proxy(request: NextRequest) {
  if (!(await authorized(request))) return unauthorizedResponse()
  // 122 bits of entropy from randomUUID, base64url-free ASCII (48 chars,
  // no padding): safe inside a header and a quoted CSP source list.
  const nonce = btoa(crypto.randomUUID())
  const policy = contentSecurityPolicy(nonce)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  // Request-header copy: Next.js reads it to sign its own bootstrap
  // scripts. Response copy: what the browser actually enforces.
  requestHeaders.set('Content-Security-Policy', policy)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', policy)
  return response
}

export const config = {
  // everything, including /_next assets: a gated console must not leak
  // its bundle (which names the hub URL and the API surface) either
  matcher: '/:path*',
}
