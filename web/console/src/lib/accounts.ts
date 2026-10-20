// Account management from the console (TEAM-2): what an administrator
// can do to the accounts of the users file without a terminal. Server
// only; app/api/console/accounts checks the caller is a signed-in
// administrator and audits every action.
//
// Two rules keep the console reachable whatever is clicked:
//   - an administrator does not act on their own account here (role,
//     disable, reset, two-step removal, deletion): the session panel and
//     the terminal cover their own account;
//   - every change must leave at least one enabled administrator.
// A new account, or a reset password, gets a temporary password shown
// once to the administrator and "must_change": its owner sets their own
// at the next sign-in. A reset keeps the account's two-step sign-in.

import {
  MAX_PASSWORD, MIN_PASSWORD, ROLES, editUsers, loadAccounts, mfaRequiredFor, passwordHash, passwordMatches, sameUser,
  temporaryPassword, type Principal, type Role, type UsersDoc,
} from './users'

const NAME_RE = /^[\p{L}\p{N}._@-]{1,64}$/u

export type AccountView = {
  user: string
  role: Role
  disabled: boolean
  must_change: boolean
  mfa: boolean
  mfa_required: boolean
  recovery_left: number
}

export function listAccounts(): { accounts: AccountView[]; mfa_required: Role[] } | { error: string } {
  const { accounts, mfaRequired, error } = loadAccounts()
  if (error) return { error }
  return {
    accounts: accounts.map((a) => ({
      user: a.user,
      role: a.role,
      disabled: a.disabled,
      must_change: a.mustChange,
      mfa: a.totp !== null,
      mfa_required: mfaRequiredFor(a.role),
      recovery_left: a.recovery.length,
    })),
    mfa_required: mfaRequired,
  }
}

export const ACCOUNT_ACTIONS = ['crear', 'rol', 'deshabilitar', 'habilitar', 'restablecer', 'quitar-mfa', 'eliminar'] as const
export type AccountAction = (typeof ACCOUNT_ACTIONS)[number]

// Error codes the console translates (lib/i18n): the API never sends
// prose, so the page shows them in the operator's language.
export type AccountError =
  | 'accion' | 'nombre' | 'existe' | 'no-existe' | 'rol' | 'propia' | 'ultimo-admin' | 'sin-mfa' | 'escritura'

export type AccountResult =
  | { ok: true; user: string; password?: string }
  | { ok: false; error: AccountError; status: number }

function enabledAdmins(doc: UsersDoc): number {
  return doc.users.filter((u) => u.role === 'admin' && u.disabled !== true).length
}

export async function accountAction(actor: Principal, action: string, input: { user?: unknown; role?: unknown }): Promise<AccountResult> {
  const fail = (error: AccountError, status = 400): AccountResult => ({ ok: false, error, status })
  if (!(ACCOUNT_ACTIONS as readonly string[]).includes(action)) return fail('accion')
  const user = typeof input.user === 'string' ? input.user.trim() : ''
  if (!NAME_RE.test(user)) return fail('nombre')
  const role = input.role
  if ((action === 'crear' || action === 'rol') && !(typeof role === 'string' && (ROLES as string[]).includes(role))) return fail('rol')
  if (action !== 'crear' && user.toLowerCase() === actor.name.toLowerCase()) return fail('propia', 403)

  // the slow derivation runs before the file is read, never inside the
  // synchronous edit
  const password = action === 'crear' || action === 'restablecer' ? temporaryPassword() : undefined
  const hash = password ? await passwordHash(password) : undefined

  let code: AccountError | null = null
  let stored = user
  const error = editUsers((doc) => {
    const at = doc.users.findIndex((e) => sameUser(e, user))
    const entry = doc.users[at]
    if (action === 'crear') {
      if (entry) return (code = 'existe')
      doc.users.push({ user, role, password: hash, must_change: true })
      return null
    }
    if (!entry) return (code = 'no-existe')
    stored = String(entry.user)
    switch (action as Exclude<AccountAction, 'crear'>) {
      case 'rol':
        entry.role = role
        break
      case 'deshabilitar':
        entry.disabled = true
        break
      case 'habilitar':
        delete entry.disabled
        break
      case 'restablecer':
        entry.password = hash
        entry.must_change = true
        break
      case 'quitar-mfa':
        if (!entry.totp) return (code = 'sin-mfa')
        delete entry.totp
        delete entry.recovery
        break
      case 'eliminar':
        doc.users.splice(at, 1)
        break
    }
    if (enabledAdmins(doc) === 0) return (code = 'ultimo-admin')
    return null
  })
  if (code) return fail(code, code === 'no-existe' ? 404 : code === 'existe' ? 409 : 400)
  if (error) return fail('escritura', 500)
  return { ok: true, user: stored, ...(password ? { password } : {}) }
}

// newPasswordProblem applies the password rules of the console (the
// same minimum as scripts/console-user.mjs) to a change: a message key
// of lib/login.ts, or null when the new password is acceptable.
export async function newPasswordProblem(user: string, password: string, repeat: string): Promise<'corta' | 'larga' | 'distintas' | 'igual' | null> {
  if (password.length < MIN_PASSWORD) return 'corta'
  if (password.length > MAX_PASSWORD) return 'larga'
  if (password !== repeat) return 'distintas'
  if (await passwordMatches(user, password)) return 'igual'
  return null
}
