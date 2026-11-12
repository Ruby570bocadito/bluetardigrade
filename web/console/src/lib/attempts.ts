// Attempt limit for the shared console token (CONSOLE_ACCESS_TOKEN).
// Server-only.
//
// Accounts have a lockout per account (lib/users.ts). The shared token
// has no account to lock, so a console gated by it alone would let
// anyone who reaches it guess without end, at the sign-in form or with
// HTTP Basic. Failures are counted per client address, and across all
// addresses: the address comes from X-Forwarded-For, which a client
// that reaches the console directly can set to anything, so the
// per-client count slows an honest mistake or a single source and the
// global ceiling is the bound that holds against one that rotates it.
//
// A limit that is reached refuses new token checks until its window
// passes; sessions already open keep working (they do not present the
// token). The counters live on globalThis for the same reason the
// sessions do (lib/sessions.ts): the request proxy and the route
// handlers are bundled separately and each would otherwise count alone.

export const TOKEN_FAIL_LIMIT = 10
export const TOKEN_GLOBAL_FAIL_LIMIT = 200
export const TOKEN_FAIL_WINDOW_MS = 5 * 60 * 1000
const MAX_CLIENTS = 2048
const UNKNOWN_CLIENT = 'unknown'

type Count = { count: number; since: number }
type Store = { clients: Map<string, Count>; all: Count }

const shared = globalThis as typeof globalThis & { __sfConsoleTokenAttempts?: Store }

function store(): Store {
  if (!shared.__sfConsoleTokenAttempts) shared.__sfConsoleTokenAttempts = { clients: new Map(), all: { count: 0, since: 0 } }
  return shared.__sfConsoleTokenAttempts
}

const live = (c: Count | undefined, now: number): c is Count => c !== undefined && now - c.since < TOKEN_FAIL_WINDOW_MS

// clientAddress names the sender for the per-client count: the first
// hop of X-Forwarded-For (the server fills it in with the socket address
// when no proxy did), bounded and lower-cased. Requests without one
// share a single bucket.
export function clientAddress(request: Request): string {
  const first = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim().toLowerCase()
  return first && first.length <= 64 && /^[0-9a-f.:[\]%a-z-]+$/.test(first) ? first : UNKNOWN_CLIENT
}

// tokenAttemptAllowed says whether a token may be checked for this
// client now. Call it before comparing; a refused attempt is not
// compared at all, so a locked-out guess learns nothing.
export function tokenAttemptAllowed(client: string, now = Date.now()): boolean {
  const s = store()
  if (live(s.all, now) && s.all.count >= TOKEN_GLOBAL_FAIL_LIMIT) return false
  const mine = s.clients.get(client)
  return !(live(mine, now) && mine.count >= TOKEN_FAIL_LIMIT)
}

export function tokenAttemptFailed(client: string, now = Date.now()): void {
  const s = store()
  s.all = live(s.all, now) ? { count: s.all.count + 1, since: s.all.since } : { count: 1, since: now }
  let key = client
  if (!s.clients.has(key) && s.clients.size >= MAX_CLIENTS) {
    for (const [k, c] of s.clients) if (!live(c, now)) s.clients.delete(k)
    // still full of live entries: the newcomers share one bucket rather
    // than pushing out the counts of clients already being limited
    if (s.clients.size >= MAX_CLIENTS) key = UNKNOWN_CLIENT
  }
  const mine = s.clients.get(key)
  s.clients.set(key, live(mine, now) ? { count: mine.count + 1, since: mine.since } : { count: 1, since: now })
}

// A correct token clears the client's own count. The global one only
// ages out: one valid sign-in must not reset a guessing run in progress
// from other addresses.
export function tokenAttemptSucceeded(client: string): void {
  store().clients.delete(client)
}

// test hook
export function resetTokenAttempts(): void {
  shared.__sfConsoleTokenAttempts = undefined
}
