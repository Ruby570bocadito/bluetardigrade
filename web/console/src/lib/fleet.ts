// Machine inventory (engine GET /api/fleet) and the enrollment commands
// for a new remote machine. Read-only towards the machines: the console
// lists what reports to the engine; nothing is sent to an endpoint.

import { engineCall, type EngineResult } from './engine-writes'

export type FleetStatus = 'online' | 'silent' | 'idle'

export type FleetSensor = {
  kind?: string
  version?: string
  os?: string
  capture?: string
  interval_s: number
  uptime_s: number
  queue_cap?: number
  spooled: number
  dropped: number
  last_heartbeat: string
}

export type FleetHost = {
  host: string
  status: FleetStatus
  first_seen: string
  last_seen: string
  last_event_type?: string
  events: number
  events_last_5m: number
  sources: string[]
  peers: string[]
  identity?: string
  sensor?: FleetSensor
  silent_since?: string
}

export type FleetPayload = {
  enabled: boolean
  hosts: FleetHost[]
  online: number
  silent: number
  idle: number
  heartbeat_grace_min_s: number
}

export function fetchFleet(): Promise<EngineResult<FleetPayload>> {
  return engineCall<FleetPayload>('GET', '/api/fleet')
}

export const FLEET_STATUS_LABEL: Record<FleetStatus, string> = {
  online: 'en línea',
  silent: 'sin señal',
  idle: 'inactivo',
}

/** 59 -> "59 s", 3600 -> "1 h", 90061 -> "1 d 1 h". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const s = Math.floor(seconds)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
  const d = Math.floor(h / 24)
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`
}

/** Seconds between an RFC 3339 instant and now (null when unreadable). */
export function secondsSince(iso: string | undefined, now: number): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.max(0, (now - t) / 1000)
}

/** Host names as Windows reports them: letters, digits and hyphens, max 15. */
export function isValidHostName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,14}$/.test(name)
}

/** Identity names for the ingest-identity command. */
export function identityName(host: string): string {
  return host.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'equipo'
}

export type EnrollmentStep = {
  /** where the step runs */
  where: 'server' | 'server-admin' | 'remote-admin'
  text: string
  cmd?: string
}

const SENSOR_DIR = 'C:\\Program Files\\bluetardigrade'

/**
 * Steps to enroll a remote Windows machine you administer: its own
 * ingest identity on the server (token bound to its host name), the
 * firewall opening, then the single sensor executable on the machine
 * pointed at the server. The token is never part of the plan: the server
 * command prints it once and the operator types it on the machine.
 */
export function enrollmentPlan(host: string, serverAddress: string, tls: boolean): EnrollmentStep[] {
  const id = identityName(host)
  const tlsArg = tls ? ` --tls-ca "${SENSOR_DIR}\\ingest-cert.pem"` : ''
  const steps: EnrollmentStep[] = [
    {
      where: 'server',
      text: `Crea la identidad de ${host}: el comando muestra su token una sola vez y la entrada YAML con su huella.`,
      cmd: `sf-engine ingest-identity --name ${id} --host ${host}`,
    },
    {
      where: 'server',
      text: 'Pega la entrada en el fichero de identidades (la primera vez, empieza el fichero con «version: 1» y «identities:»). El motor lo recarga solo.',
      cmd: 'notepad "$env:LOCALAPPDATA\\bluetardigrade\\tools\\config\\ingest-identities.yaml"',
    },
    {
      where: 'server',
      text: 'Solo la primera vez: reinicia para que el motor escuche a los equipos de la red (siempre con identidad).',
      cmd: 'sf-console -Stop; sf-console',
    },
    {
      where: 'server-admin',
      text: 'Solo la primera vez: abre el puerto 7777 a la red local (perfiles de dominio y privado).',
      cmd: 'New-NetFirewallRule -DisplayName "bluetardigrade ingest" -Direction Inbound -Protocol TCP -LocalPort 7777 -Action Allow -Profile Domain,Private',
    },
    {
      where: 'remote-admin',
      text: `Copia a ${host} el archivo bin\\security-sensor.exe del servidor${tls ? ' y tools\\config\\ingest-cert.pem' : ''} en ${SENSOR_DIR}.`,
      cmd: `New-Item -ItemType Directory -Force "${SENSOR_DIR}"`,
    },
    {
      where: 'remote-admin',
      text: 'Arranca el sensor apuntando al servidor, con el token de su identidad. En menos de un minuto aparece aquí «en línea».',
      cmd: `& "${SENSOR_DIR}\\security-sensor.exe" --addr ${serverAddress}:7777 --token "<token de ${id}>"${tlsArg} --spool "C:\\ProgramData\\bluetardigrade\\sensor-spool.ndjson"`,
    },
  ]
  return steps
}
