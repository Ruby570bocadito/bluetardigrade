// The console's audit trail (CONSOLE_AUDIT_FILE): every write sent
// through the engine proxy, allowed or refused, with the account that
// sent it. Administrators only; newest first.

import { hostAllowed, principalFor, unauthorizedResponse } from '@/lib/access'
import { auditFile, readAudit, roleAtLeast } from '@/lib/users'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const principal = await principalFor(request)
  if (!principal) return unauthorizedResponse()
  if (!roleAtLeast(principal.role, 'admin')) {
    return Response.json({ error: 'role_forbidden', hint: 'Solo un administrador puede ver la auditoría de la consola.' }, { status: 403 })
  }
  if (!hostAllowed(request) || request.headers.get('sec-fetch-site') === 'cross-site') {
    // Host-pinning anti-DNS-rebinding (sesión 100agentes-2, agente 3):
    // sec-fetch-site no detiene el rebinding (la página rebotada es
    // same-origin); paridad con hub-token y el proxy del motor.
    return Response.json({ error: 'host_not_allowed' }, { status: 403 })
  }
  const requested = Number(new URL(request.url).searchParams.get('limit') ?? 200)
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 1000) : 200
  const { entries, error } = readAudit(limit)
  return Response.json({ enabled: auditFile() !== '', entries, error }, { headers: { 'cache-control': 'no-store' } })
}
