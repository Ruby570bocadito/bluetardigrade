// Next.js request proxy (formerly "middleware"): the console-wide
// access gate. Every page, asset and API route passes through here
// first; see lib/access.ts for the threat model.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authorized, unauthorizedResponse } from './lib/access'

export async function proxy(request: NextRequest) {
  if (await authorized(request)) return NextResponse.next()
  return unauthorizedResponse()
}

export const config = {
  // everything, including /_next assets: a gated console must not leak
  // its bundle (which names the hub URL and the API surface) either
  matcher: '/:path*',
}
