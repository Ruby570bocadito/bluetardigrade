// Request guards shared by the routes that act on a browser's behalf:
// the engine proxy (app/api/engine), the login routes and the console's
// own API (app/api/console, app/api/hub-token). Host pinning stops DNS
// rebinding; the cross-site check stops another page from driving a
// write (or a login) through the operator's browser, or from firing a
// read that has a cost or an answer worth probing.

// Loopback hostnames served by default; everything else must be
// allowlisted explicitly via CONSOLE_ALLOWED_HOSTS.
export const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

// Read per request (not at module load) so operators and tests can
// toggle the environment without restarting the module graph.
export function extraHosts(): string[] {
  return (process.env.CONSOLE_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
}

function allowedHosts(): Set<string> {
  return new Set([...LOOPBACK_HOSTS, ...extraHosts()])
}

// hostAllowed checks the Host header (falling back to the request URL
// host): hostname compared without port, IPv6 brackets and any trailing
// dot normalized away, so `127.0.0.1:3000`, `LOCALHOST.` and
// `[::1]:3000` all match the loopback set.
export function hostAllowed(request: Request): boolean {
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
//
// "Origin: null" is what the console's own forms send (sign-in, sign-out):
// under its Referrer-Policy no-referrer, a form POST serializes the
// origin as null. It also comes from sandboxed and opaque-origin
// documents, so null passes only with Sec-Fetch-Site: same-origin, a
// header a page cannot set and that an opaque origin never earns.
export function crossSiteContext(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (origin === 'null') return request.headers.get('sec-fetch-site') !== 'same-origin'
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

// readRefused is the guard of the console's own GET handlers (who am I,
// the audit trail, the accounts, the hub credential): the pinned Host,
// and no cross-site browser context. It returns the 403 to send, or
// null when the read may go on. Same-origin fetches and navigations
// pass; so do clients without browser headers (curl, scripts).
export function readRefused(request: Request): Response | null {
  if (hostAllowed(request) && !crossSiteContext(request)) return null
  return Response.json({ error: 'host_not_allowed' }, { status: 403, headers: { 'cache-control': 'no-store' } })
}
