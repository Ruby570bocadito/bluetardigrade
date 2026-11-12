// The engine reads that need more than an account (app/api/engine).
// Kept out of the route file, which may only export its handlers.

import type { Role } from './users'

// Reads that are administration, not telemetry: the configuration an
// administrator edits in Ajustes, the enrollment tokens and the machines
// waiting for approval, the forensic audit of active response, and the
// process metrics. Their writes need an administrator; so does reading
// them. Every other GET stays open to any account, viewers included.
const READS: { path: RegExp; role: Role }[] = [
  { path: /^\/api\/settings(\/|$)/, role: 'admin' },
  { path: /^\/api\/enroll(\/|$)/, role: 'admin' },
  { path: /^\/api\/respond\/audit(\/|$)/, role: 'admin' },
  { path: /^\/metrics(\/|$)/, role: 'admin' },
]

// readRole is the least role a GET of this path needs, null when any
// account may read it, or 'malformed' for a path that cannot be decoded.
// The path is compared the way the engine will route it: its router
// percent-decodes and collapses repeated slashes, so /api/%73ettings/ad
// and /api//settings/ad must not slip past a pattern written for
// /api/settings/ad.
export function readRole(path: string): Role | null | 'malformed' {
  let decoded: string
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return 'malformed'
  }
  const clean = decoded.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  if (/(^|\/)\.\.?(\/|$)/.test(clean)) return 'malformed'
  return READS.find((route) => route.path.test(clean))?.role ?? null
}
