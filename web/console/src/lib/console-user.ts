// Client side of the console accounts (server: lib/users.ts): who am I,
// what may I do, and the audit trail for administrators. Pure helpers
// plus two fetches of the console's own routes (not the engine).

export type ConsoleRole = 'admin' | 'analyst' | 'viewer'

export type ConsoleMe = {
  name: string
  role: ConsoleRole
  mode: 'users' | 'token' | 'open'
  can_triage: boolean
  can_respond: boolean
  audit: boolean
  // the host groups the account is limited to; null (or absent, older
  // servers) when it sees every machine
  scope?: string[] | null
  // two-step sign-in, accounts of the users file only
  mfa?: { enrolled: boolean; required: boolean; recovery_left: number }
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

export const ROLE_TEXT: Record<ConsoleRole, string> = { admin: 'Administrador', analyst: 'Analista', viewer: 'Lector' }

// Until /api/console/me answers, the UI behaves like a console without
// accounts (the server enforces the real role either way).
export const DEFAULT_ME: ConsoleMe = { name: 'local', role: 'admin', mode: 'open', can_triage: true, can_respond: true, audit: false }

export function modeText(me: ConsoleMe): string {
  if (me.mode === 'users') return 'Cuenta de analista (CONSOLE_USERS_FILE)'
  if (me.mode === 'token') return 'Token compartido (CONSOLE_ACCESS_TOKEN): todos actúan como administrador'
  return 'Sin cuentas: acceso por loopback, actúas como administrador'
}

// scopeText says which machines the account sees, for the session panel.
export function scopeText(me: ConsoleMe): string {
  if (!me.scope?.length) return 'Ves todos los equipos.'
  const list = me.scope.join(', ')
  return `Ves solo los equipos de ${me.scope.length === 1 ? 'el grupo' : 'los grupos'} ${list}: alertas, eventos, incidentes e informes de los demás no te aparecen, y el analista IA no está disponible.`
}

// permissions lists what the role allows, for the session panel.
export function permissions(me: ConsoleMe): { label: string; allowed: boolean }[] {
  return [
    { label: 'Ver alertas, eventos, equipos e informes', allowed: true },
    { label: 'Probar reglas (sin cambiar nada)', allowed: true },
    { label: 'Triaje de alertas, incidentes y notas', allowed: me.can_triage },
    { label: 'Supresiones', allowed: me.can_triage },
    { label: 'Respuesta activa (con credencial de operador)', allowed: me.can_respond },
  ]
}

const ACTIONS: [RegExp, string][] = [
  [/^POST \/login$/, 'Inicio de sesión'],
  [/^POST \/login\/codigo$/, 'Código del segundo paso'],
  [/^POST \/login\/activar$/, 'Activación del segundo paso al entrar'],
  [/^POST \/login\/recuperacion$/, 'Entrada con código de recuperación'],
  [/^POST \/login\/contrasena$/, 'Contraseña propia tras un restablecimiento'],
  [/^POST \/cuenta\/contrasena$/, 'Cambio de contraseña'],
  [/^POST \/accounts\/crear$/, 'Cuenta creada'],
  [/^POST \/accounts\/rol$/, 'Rol de cuenta cambiado'],
  [/^POST \/accounts\/deshabilitar$/, 'Cuenta deshabilitada'],
  [/^POST \/accounts\/habilitar$/, 'Cuenta habilitada'],
  [/^POST \/accounts\/restablecer$/, 'Contraseña restablecida'],
  [/^POST \/accounts\/quitar-mfa$/, 'Dos pasos quitados a una cuenta'],
  [/^POST \/accounts\/eliminar$/, 'Cuenta eliminada'],
  [/^POST \/logout$/, 'Cierre de sesión'],
  [/^POST \/mfa\/activar$/, 'Verificación en dos pasos activada'],
  [/^POST \/mfa\/recuperacion$/, 'Nuevos códigos de recuperación'],
  [/^POST \/mfa\/desactivar$/, 'Verificación en dos pasos desactivada'],
  [/^POST \/api\/alerts\/[0-9a-f]{16}\/status$/, 'Triaje de alerta'],
  [/^POST \/api\/incidents$/, 'Nuevo incidente'],
  [/^PATCH \/api\/incidents\/[0-9a-f]{16}$/, 'Cambio en incidente'],
  [/^POST \/api\/incidents\/[0-9a-f]{16}\/alerts$/, 'Alertas añadidas a incidente'],
  [/^POST \/api\/incidents\/[0-9a-f]{16}\/notes$/, 'Nota en incidente'],
  [/^POST \/api\/rules\/test$/, 'Prueba de regla'],
  [/^POST \/api\/suppressions$/, 'Nueva supresión'],
  [/^DELETE \/api\/suppressions$/, 'Supresión eliminada'],
  [/^POST \/api\/respond\/kill$/, 'Respuesta: terminar proceso'],
]

export function describeAction(entry: Pick<ConsoleAuditEntry, 'method' | 'path'>): string {
  const key = `${entry.method} ${entry.path}`
  return ACTIONS.find(([re]) => re.test(key))?.[1] ?? key
}

export const OUTCOME_TEXT: Record<ConsoleAuditEntry['outcome'], string> = { ok: 'Hecho', error: 'Error del motor', denied: 'Denegado por rol' }

// outcomeText: a refused sign-in is a credential problem, not a role one.
export function outcomeText(entry: Pick<ConsoleAuditEntry, 'outcome' | 'path'>): string {
  if (entry.path === '/login' && entry.outcome === 'denied') return 'Credenciales rechazadas'
  if ((entry.path === '/login/contrasena' || entry.path === '/cuenta/contrasena') && entry.outcome === 'denied') return 'Contraseña rechazada'
  if ((entry.path.startsWith('/login/') || entry.path.startsWith('/mfa/')) && entry.outcome === 'denied') return 'Código rechazado'
  if (entry.path.startsWith('/accounts/') && entry.outcome === 'denied') return 'Rechazado'
  return OUTCOME_TEXT[entry.outcome] ?? entry.outcome
}

// mfaText describes the account's two-step sign-in for the session panel.
export function mfaText(mfa: NonNullable<ConsoleMe['mfa']>): { label: string; detail: string; warn: boolean } {
  if (mfa.enrolled) {
    const n = mfa.recovery_left
    return {
      label: 'Activada',
      detail: `${n} código${n === 1 ? '' : 's'} de recuperación${n <= 2 ? ': genera nuevos antes de quedarte sin ninguno' : ''}`,
      warn: n <= 2,
    }
  }
  if (mfa.required) return { label: 'Pendiente', detail: 'Tu rol la exige: configúrala ahora o en tu próximo inicio de sesión', warn: true }
  return { label: 'Desactivada', detail: 'Entras solo con la contraseña', warn: false }
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

export async function fetchAudit(limit = 100): Promise<{ ok: true; enabled: boolean; entries: ConsoleAuditEntry[]; error?: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/console/audit?limit=${limit}`, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    const body = (await res.json().catch(() => null)) as { enabled?: boolean; entries?: ConsoleAuditEntry[]; error?: string; hint?: string } | null
    if (!res.ok) return { ok: false, error: body?.hint || body?.error || `la consola respondió ${res.status}` }
    return { ok: true, enabled: Boolean(body?.enabled), entries: Array.isArray(body?.entries) ? body.entries : [], error: body?.error }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'error de red' }
  }
}
