// Client side of account management (server: lib/accounts.ts and
// app/api/console/accounts): the list for administrators and one call
// per action. Errors come back as codes the page translates.

import type { ConsoleRole } from './console-user'

export type AccountRow = {
  user: string
  role: ConsoleRole
  disabled: boolean
  must_change: boolean
  mfa: boolean
  mfa_required: boolean
  recovery_left: number
  // host groups the account is limited to ([] = every machine; absent
  // from older servers)
  groups?: string[]
}

export type AccountActionName = 'crear' | 'rol' | 'grupos' | 'deshabilitar' | 'habilitar' | 'restablecer' | 'quitar-mfa' | 'eliminar'

export type AccountsList = { ok: true; accounts: AccountRow[]; mfaRequired: ConsoleRole[] } | { ok: false; error: string }

export async function fetchAccounts(): Promise<AccountsList> {
  try {
    const res = await fetch('/api/console/accounts', { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    const body = (await res.json().catch(() => null)) as { accounts?: AccountRow[]; mfa_required?: ConsoleRole[]; error?: string } | null
    if (!res.ok || !Array.isArray(body?.accounts)) return { ok: false, error: body?.error ?? 'red' }
    return { ok: true, accounts: body.accounts, mfaRequired: Array.isArray(body.mfa_required) ? body.mfa_required : [] }
  } catch {
    return { ok: false, error: 'red' }
  }
}

export type AccountActionResult = { ok: true; user: string; password?: string } | { ok: false; error: string }

export async function postAccountAction(action: AccountActionName, user: string, role?: ConsoleRole, groups?: string[]): Promise<AccountActionResult> {
  try {
    const res = await fetch('/api/console/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, user, ...(role ? { role } : {}), ...(groups ? { groups } : {}) }),
      cache: 'no-store',
      // a creation or a reset derives a password hash on the server
      signal: AbortSignal.timeout(15000),
    })
    const body = (await res.json().catch(() => null)) as { user?: string; password?: string; error?: string } | null
    if (!res.ok || typeof body?.user !== 'string') return { ok: false, error: body?.error ?? 'red' }
    return { ok: true, user: body.user, ...(typeof body.password === 'string' ? { password: body.password } : {}) }
  } catch {
    return { ok: false, error: 'red' }
  }
}
