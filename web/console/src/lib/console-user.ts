// Client side of the console accounts (server: lib/users.ts): who am I,
// what may I do, and the audit trail for administrators. Pure helpers
// plus two fetches of the console's own routes (not the engine).

import type { Lang } from './i18n'

export type ConsoleRole = 'admin' | 'analyst' | 'viewer'

export type ConsoleMe = {
  name: string
  role: ConsoleRole
  mode: 'users' | 'token' | 'open'
  // 'domain': a domain account (AD-7) — no password or second step to
  // manage here, the directory owns both
  source?: 'domain'
  can_triage: boolean
  can_respond: boolean
  audit: boolean
  // the host groups the account is limited to; null (or absent, older
  // servers) when it sees every machine
  scope?: string[] | null
  // two-step sign-in, accounts of the users file only
  mfa?: { enrolled: boolean; required: boolean; recovery_left: number }
  // true only before /api/console/me has answered (see PENDING_ME)
  pending?: boolean
}

export type ConsoleAuditEntry = {
  at: string
  user: string
  // '' for a rejected sign-in
  role: ConsoleRole | ''
  mode: ConsoleMe['mode']
  method: string
  path: string
  status: number
  outcome: 'ok' | 'error' | 'denied'
  // the account an administrator acted on
  target?: string
}

// The words travel with the helpers (same pattern as lib/platform-status):
// Spanish is the default so existing call sites keep today's output, and
// the session panel passes the console language.
const WORDS = {
  es: {
    roles: { admin: 'Administrador', analyst: 'Analista', viewer: 'Lector' } as Record<ConsoleRole, string>,
    mode: {
      domain: 'Cuenta del dominio: el rol lo dan tus grupos de Active Directory',
      users: 'Cuenta de analista (CONSOLE_USERS_FILE)',
      token: 'Token compartido (CONSOLE_ACCESS_TOKEN): todos actúan como administrador',
      open: 'Sin cuentas: acceso por loopback, actúas como administrador',
    },
    scopeAll: 'Ves todos los equipos.',
    scopeSome: (one: boolean, list: string): string =>
      `Ves solo los equipos ${one ? 'del grupo' : 'de los grupos'} ${list}: alertas, eventos, incidentes e informes de los demás no te aparecen, y el analista IA no está disponible.`,
    perms: ['Ver alertas, eventos, equipos e informes', 'Probar reglas (sin cambiar nada)', 'Triaje de alertas, incidentes y notas', 'Supresiones', 'Respuesta activa (con credencial de operador)'],
    outcomes: { ok: 'Hecho', error: 'Error del motor', denied: 'Denegado por rol' } as Record<ConsoleAuditEntry['outcome'], string>,
    credentialsRejected: 'Credenciales rechazadas',
    passwordRejected: 'Contraseña rechazada',
    codeRejected: 'Código rechazado',
    rejected: 'Rechazado',
    mfaOn: 'Activada',
    mfaRecovery: (n: number): string => `${n} código${n === 1 ? '' : 's'} de recuperación${n <= 2 ? ': genera nuevos antes de quedarte sin ninguno' : ''}`,
    mfaPending: 'Pendiente',
    mfaPendingDetail: 'Tu rol la exige: configúrala ahora o en tu próximo inicio de sesión',
    mfaOff: 'Desactivada',
    mfaOffDetail: 'Entras solo con la contraseña',
    networkError: 'error de red',
  },
  en: {
    roles: { admin: 'Administrator', analyst: 'Analyst', viewer: 'Viewer' } as Record<ConsoleRole, string>,
    mode: {
      domain: 'Domain account: your Active Directory groups give the role',
      users: 'Analyst account (CONSOLE_USERS_FILE)',
      token: 'Shared token (CONSOLE_ACCESS_TOKEN): everyone acts as administrator',
      open: 'No accounts: loopback access, you act as administrator',
    },
    scopeAll: 'You see every host.',
    scopeSome: (one: boolean, list: string): string =>
      `You only see the hosts of the ${one ? 'group' : 'groups'} ${list}: alerts, events, incidents and reports of the others do not show, and the AI analyst is not available.`,
    perms: ['View alerts, events, hosts and reports', 'Test rules (without changing anything)', 'Triage alerts, incidents and notes', 'Suppressions', 'Active response (with an operator credential)'],
    outcomes: { ok: 'Done', error: 'Engine error', denied: 'Denied by role' } as Record<ConsoleAuditEntry['outcome'], string>,
    credentialsRejected: 'Credentials rejected',
    passwordRejected: 'Password rejected',
    codeRejected: 'Code rejected',
    rejected: 'Rejected',
    mfaOn: 'On',
    mfaRecovery: (n: number): string => `${n} recovery code${n === 1 ? '' : 's'}${n <= 2 ? ': generate new ones before you run out' : ''}`,
    mfaPending: 'Pending',
    mfaPendingDetail: 'Your role requires it: set it up now or at your next sign-in',
    mfaOff: 'Off',
    mfaOffDetail: 'You sign in with the password only',
    networkError: 'network error',
  },
} satisfies Record<Lang, unknown>

export const ROLE_TEXT: Record<ConsoleRole, string> = WORDS.es.roles

export function roleText(role: ConsoleRole, lang: Lang = 'es'): string {
  return WORDS[lang].roles[role] ?? role
}

// Until /api/console/me answers, the UI behaves like a console without
// accounts (the server enforces the real role either way).
export const DEFAULT_ME: ConsoleMe = { name: 'local', role: 'admin', mode: 'open', can_triage: true, can_respond: true, audit: false }

// PENDING_ME is the session until /api/console/me answers: no name and
// no rights. Starting from DEFAULT_ME showed every account as «local ·
// Administrador», with the triage buttons live, for that first moment;
// the server always refused the writes, but the screen should not offer
// them. A failed lookup still falls back to DEFAULT_ME (open consoles).
export const PENDING_ME: ConsoleMe = { name: '', role: 'viewer', mode: 'open', can_triage: false, can_respond: false, audit: false, pending: true }

export function modeText(me: ConsoleMe, lang: Lang = 'es'): string {
  const words = WORDS[lang].mode
  if (me.source === 'domain') return words.domain
  if (me.mode === 'users') return words.users
  if (me.mode === 'token') return words.token
  return words.open
}

// scopeText says which machines the account sees, for the session panel.
export function scopeText(me: ConsoleMe, lang: Lang = 'es'): string {
  if (!me.scope?.length) return WORDS[lang].scopeAll
  return WORDS[lang].scopeSome(me.scope.length === 1, me.scope.join(', '))
}

// permissions lists what the role allows, for the session panel.
export function permissions(me: ConsoleMe, lang: Lang = 'es'): { label: string; allowed: boolean }[] {
  const [view, test, triage, suppress, respond] = WORDS[lang].perms
  return [
    { label: view, allowed: true },
    { label: test, allowed: true },
    { label: triage, allowed: me.can_triage },
    { label: suppress, allowed: me.can_triage },
    { label: respond, allowed: me.can_respond },
  ]
}

const ACTIONS: [RegExp, Record<Lang, string>][] = [
  [/^POST \/login$/, { es: 'Inicio de sesión', en: 'Sign-in' }],
  [/^POST \/login\/codigo$/, { es: 'Código del segundo paso', en: 'Second-step code' }],
  [/^POST \/login\/activar$/, { es: 'Activación del segundo paso al entrar', en: 'Second step enabled at sign-in' }],
  [/^POST \/login\/recuperacion$/, { es: 'Entrada con código de recuperación', en: 'Sign-in with a recovery code' }],
  [/^POST \/login\/contrasena$/, { es: 'Contraseña propia tras un restablecimiento', en: 'Own password after a reset' }],
  [/^POST \/cuenta\/contrasena$/, { es: 'Cambio de contraseña', en: 'Password change' }],
  [/^POST \/accounts\/crear$/, { es: 'Cuenta creada', en: 'Account created' }],
  [/^POST \/accounts\/rol$/, { es: 'Rol de cuenta cambiado', en: 'Account role changed' }],
  [/^POST \/accounts\/grupos$/, { es: 'Grupos de equipos de una cuenta cambiados', en: 'Account host groups changed' }],
  [/^POST \/accounts\/deshabilitar$/, { es: 'Cuenta deshabilitada', en: 'Account disabled' }],
  [/^POST \/accounts\/habilitar$/, { es: 'Cuenta habilitada', en: 'Account enabled' }],
  [/^POST \/accounts\/restablecer$/, { es: 'Contraseña restablecida', en: 'Password reset' }],
  [/^POST \/accounts\/quitar-mfa$/, { es: 'Dos pasos quitados a una cuenta', en: 'Two-step removed from an account' }],
  [/^POST \/accounts\/eliminar$/, { es: 'Cuenta eliminada', en: 'Account deleted' }],
  [/^POST \/logout$/, { es: 'Cierre de sesión', en: 'Sign-out' }],
  [/^POST \/mfa\/activar$/, { es: 'Verificación en dos pasos activada', en: 'Two-step verification enabled' }],
  [/^POST \/mfa\/recuperacion$/, { es: 'Nuevos códigos de recuperación', en: 'New recovery codes' }],
  [/^POST \/mfa\/desactivar$/, { es: 'Verificación en dos pasos desactivada', en: 'Two-step verification disabled' }],
  [/^POST \/api\/alerts\/[0-9a-f]{16}\/status$/, { es: 'Triaje de alerta', en: 'Alert triage' }],
  [/^POST \/api\/incidents$/, { es: 'Nuevo incidente', en: 'New incident' }],
  [/^PATCH \/api\/incidents\/[0-9a-f]{16}$/, { es: 'Cambio en incidente', en: 'Incident change' }],
  [/^POST \/api\/incidents\/[0-9a-f]{16}\/alerts$/, { es: 'Alertas añadidas a incidente', en: 'Alerts added to an incident' }],
  [/^POST \/api\/incidents\/[0-9a-f]{16}\/notes$/, { es: 'Nota en incidente', en: 'Incident note' }],
  [/^POST \/api\/rules\/test$/, { es: 'Prueba de regla', en: 'Rule test' }],
  [/^POST \/api\/suppressions$/, { es: 'Nueva supresión', en: 'New suppression' }],
  [/^DELETE \/api\/suppressions$/, { es: 'Supresión eliminada', en: 'Suppression removed' }],
  [/^POST \/api\/respond\/kill$/, { es: 'Respuesta: terminar proceso', en: 'Response: kill process' }],
]

export function describeAction(entry: Pick<ConsoleAuditEntry, 'method' | 'path'>, lang: Lang = 'es'): string {
  const key = `${entry.method} ${entry.path}`
  return ACTIONS.find(([re]) => re.test(key))?.[1][lang] ?? key
}

export const OUTCOME_TEXT: Record<ConsoleAuditEntry['outcome'], string> = WORDS.es.outcomes

// outcomeText: a refused sign-in is a credential problem, not a role one.
export function outcomeText(entry: Pick<ConsoleAuditEntry, 'outcome' | 'path'>, lang: Lang = 'es'): string {
  const words = WORDS[lang]
  if (entry.path === '/login' && entry.outcome === 'denied') return words.credentialsRejected
  if ((entry.path === '/login/contrasena' || entry.path === '/cuenta/contrasena') && entry.outcome === 'denied') return words.passwordRejected
  if ((entry.path.startsWith('/login/') || entry.path.startsWith('/mfa/')) && entry.outcome === 'denied') return words.codeRejected
  if (entry.path.startsWith('/accounts/') && entry.outcome === 'denied') return words.rejected
  return words.outcomes[entry.outcome] ?? entry.outcome
}

// mfaText describes the account's two-step sign-in for the session panel.
export function mfaText(mfa: NonNullable<ConsoleMe['mfa']>, lang: Lang = 'es'): { label: string; detail: string; warn: boolean } {
  const words = WORDS[lang]
  if (mfa.enrolled) {
    const n = mfa.recovery_left
    return { label: words.mfaOn, detail: words.mfaRecovery(n), warn: n <= 2 }
  }
  if (mfa.required) return { label: words.mfaPending, detail: words.mfaPendingDetail, warn: true }
  return { label: words.mfaOff, detail: words.mfaOffDetail, warn: false }
}

export async function fetchMe(): Promise<ConsoleMe | null> {
  try {
    const res = await fetch('/api/console/me', { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const body = (await res.json()) as Partial<ConsoleMe>
    if (typeof body.name !== 'string' || !(body.role === 'admin' || body.role === 'analyst' || body.role === 'viewer')) return null
    return { ...DEFAULT_ME, ...body } as ConsoleMe
  } catch {
    return null
  }
}

export async function fetchAudit(limit = 100, lang: Lang = 'es'): Promise<{ ok: true; enabled: boolean; entries: ConsoleAuditEntry[]; error?: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/console/audit?limit=${limit}`, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    const body = (await res.json().catch(() => null)) as { enabled?: boolean; entries?: ConsoleAuditEntry[]; error?: string; hint?: string } | null
    if (!res.ok) return { ok: false, error: body?.hint || body?.error || `HTTP ${res.status}` }
    return { ok: true, enabled: Boolean(body?.enabled), entries: Array.isArray(body?.entries) ? body.entries : [], error: body?.error }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : WORDS[lang].networkError }
  }
}
