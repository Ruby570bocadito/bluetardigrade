// Sensor enrollment (engine -enroll, GET/POST /api/enroll...): tokens the
// operator hands to a new machine, the hosts waiting for approval and the
// decisions on them. The console never contacts a machine: it creates a
// token, shows the commands to run there, and approves what reports back.

import { engineCall, type EngineResult } from './engine-writes'

export type EnrollTokenStatus = 'active' | 'expired' | 'used_up' | 'revoked'

export type EnrollToken = {
  id: string
  label: string
  max_uses: number
  uses: number
  auto_approve?: string
  created_at: string
  expires_at: string
  created_by?: string
  revoked?: boolean
  revoked_by?: string
  status: EnrollTokenStatus
}

export type EnrolledHostState = 'pending' | 'active' | 'rejected' | 'revoked'

export type EnrolledHost = {
  name: string
  host: string
  state: EnrolledHostState
  token_id: string
  peer?: string
  enrolled_at: string
  decided_at?: string
  decided_by?: string
  auto_approved?: boolean
  conflict?: string
  last_attempt?: string
}

export type EnrollState = {
  enabled: boolean
  hint?: string
  pending: number
  active: number
  usable_tokens: number
  writes: boolean
  tokens: EnrollToken[]
  hosts: EnrolledHost[]
}

export function fetchEnroll(): Promise<EngineResult<EnrollState>> {
  return engineCall<EnrollState>('GET', '/api/enroll')
}

// "by" names who acts; with console accounts the proxy replaces it with
// the account name, so it only matters for the audit of an open console.
export type TokenRequest = { label: string; max_uses: number; ttl_hours: number; auto_approve: string; by: string }

export function createEnrollToken(req: TokenRequest): Promise<EngineResult<{ token: EnrollToken; secret: string }>> {
  return engineCall('POST', '/api/enroll/tokens', req)
}

export function revokeEnrollToken(id: string, by: string): Promise<EngineResult<EnrollToken>> {
  return engineCall('POST', `/api/enroll/tokens/${encodeURIComponent(id)}/revoke`, { by })
}

export type HostAction = 'approve' | 'reject' | 'revoke'

export function decideEnrolledHost(name: string, action: HostAction, by: string): Promise<EngineResult<EnrolledHost>> {
  return engineCall('POST', `/api/enroll/hosts/${encodeURIComponent(name)}/${action}`, { by })
}

export const TOKEN_STATUS_LABEL: Record<EnrollTokenStatus, string> = {
  active: 'en uso',
  expired: 'caducado',
  used_up: 'agotado',
  revoked: 'revocado',
}

export const HOST_STATE_LABEL: Record<EnrolledHostState, string> = {
  pending: 'pendiente',
  active: 'aprobado',
  rejected: 'rechazado',
  revoked: 'revocado',
}

/** Lifetimes offered in the wizard, in hours. */
export const TOKEN_LIFETIMES = [
  { hours: 24, label: '24 horas' },
  { hours: 24 * 7, label: '7 días' },
  { hours: 24 * 30, label: '30 días' },
] as const

/** Hostname patterns the engine accepts for auto-approval (* and ?). */
export function isValidPattern(pattern: string): boolean {
  return pattern === '' || /^[A-Za-z0-9.*?_-]{1,64}$/.test(pattern)
}

/** Server address as typed in the wizard (IP or DNS name). */
export function isValidServer(server: string): boolean {
  return /^[A-Za-z0-9.-]{1,253}$/.test(server)
}

/** The enrolled host record for an inventory host, if it joined by token. */
export function enrolledFor(state: EnrollState | null, host: string, identity?: string): EnrolledHost | undefined {
  if (!state) return undefined
  const byIdentity = identity ? state.hosts.find((h) => h.name === identity) : undefined
  return byIdentity ?? state.hosts.find((h) => h.state === 'active' && h.host.toLowerCase() === host.toLowerCase())
}

export type EnrollStep = {
  where: 'server-admin' | 'remote-admin'
  text: string
  cmd?: string
}

const SENSOR_DIR = 'C:\\Program Files\\bluetardigrade'
const DATA_DIR = 'C:\\ProgramData\\bluetardigrade\\sensor'

/**
 * Commands that enroll a machine with a token. The sensor trades the token
 * for a credential of its own on its first start (kept in ingest.token,
 * in a folder only SYSTEM and Administrators can read) and the host shows
 * up as pending until someone approves it here. Over the network the
 * engine only accepts enrollment through TLS.
 */
export function tokenEnrollmentPlan(secret: string, server: string, tls: boolean): EnrollStep[] {
  const ca = tls ? ` --tls-ca "${SENSOR_DIR}\\ingest-cert.pem"` : ''
  return [
    {
      where: 'server-admin',
      text: 'Solo la primera vez: abre el puerto 7777 a la red local (perfiles de dominio y privado).',
      cmd: 'New-NetFirewallRule -DisplayName "bluetardigrade ingest" -Direction Inbound -Protocol TCP -LocalPort 7777 -Action Allow -Profile Domain,Private',
    },
    {
      where: 'remote-admin',
      text: `Copia al equipo el archivo bin\\security-sensor.exe del servidor${tls ? ' y tools\\config\\ingest-cert.pem' : ''} en ${SENSOR_DIR}, y crea la carpeta de datos del sensor solo para SYSTEM y Administradores.`,
      cmd: `New-Item -ItemType Directory -Force "${SENSOR_DIR}","${DATA_DIR}" | Out-Null; icacls "${DATA_DIR}" /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F"`,
    },
    {
      where: 'remote-admin',
      text: 'Arranca el sensor con el token de alta. La primera vez lo cambia por una credencial propia y el equipo aparece en Equipos como pendiente; sus eventos esperan en el disco hasta que lo apruebes.',
      cmd: `& "${SENSOR_DIR}\\security-sensor.exe" --addr ${server}:7777 --enroll-token ${secret} --token-file "${DATA_DIR}\\ingest.token"${ca} --spool "${DATA_DIR}\\spool.ndjson"`,
    },
  ]
}

/** The same enrollment for a machine with bluetardigrade installed: a service. */
export function serviceEnrollmentCommand(secret: string, server: string, tls: boolean): string {
  return `sf-etw -Install -Addr ${server}:7777 -EnrollToken ${secret}${tls ? ' -TlsCa "<ruta>\\ingest-cert.pem"' : ''}`
}
