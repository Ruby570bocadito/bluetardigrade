// Who the console thinks the caller is (lib/users.ts): the account and
// role with CONSOLE_USERS_FILE, or the implicit admin of a console
// without accounts. The UI shows it in the header and hides what the
// role cannot do; route.ts enforces it either way.

import { principalFor, unauthorizedResponse } from '@/lib/access'
import { mfaState } from '@/lib/mfa'
import { auditFile, roleAtLeast, scopeOf } from '@/lib/users'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const principal = await principalFor(request)
  if (!principal) return unauthorizedResponse()
  // two-step sign-in, for accounts of the users file only
  const mfa = principal.mode === 'users' ? mfaState(principal.name) : null
  return Response.json(
    {
      ...principal,
      can_triage: roleAtLeast(principal.role, 'analyst'),
      can_respond: roleAtLeast(principal.role, 'admin'),
      // the host groups the account is limited to, or null for all
      scope: scopeOf(principal),
      audit: auditFile() !== '',
      ...(mfa ? { mfa: { enrolled: mfa.enrolled, required: mfa.required, recovery_left: mfa.recoveryLeft } } : {}),
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
