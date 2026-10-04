// Who the console thinks the caller is (lib/users.ts): the account and
// role with CONSOLE_USERS_FILE, or the implicit admin of a console
// without accounts. The UI shows it in the header and hides what the
// role cannot do; route.ts enforces it either way.

import { principalFor, unauthorizedResponse } from '@/lib/access'
import { auditFile, roleAtLeast } from '@/lib/users'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const principal = await principalFor(request)
  if (!principal) return unauthorizedResponse()
  return Response.json(
    {
      ...principal,
      can_triage: roleAtLeast(principal.role, 'analyst'),
      can_respond: roleAtLeast(principal.role, 'admin'),
      audit: auditFile() !== '',
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
