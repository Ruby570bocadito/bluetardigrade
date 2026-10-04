'use client'

// Fleet pieces of the Equipos view: the summary strip, the status pill of
// each machine, the sensor health card of the host page and the
// enrollment assistant for a new remote machine. Everything is read from
// the engine inventory (GET /api/fleet); nothing is sent to a machine.

import { useEffect, useId, useRef, useState } from 'react'
import { Broadcast, CheckCircle, Copy, Cpu, Desktop, Fingerprint, HardDrives, PlugsConnected, Plus, ShieldCheck, Timer, WarningCircle, WifiSlash } from '@phosphor-icons/react'
import { ConsoleDialog } from './console-dialog'
import { StatTile } from './ui-bits'
import { useFleet } from './fleet-provider'
import { enrollmentPlan, FLEET_STATUS_LABEL, formatDuration, isValidHostName, secondsSince, type FleetHost, type FleetStatus } from '@/lib/fleet'
import { formatDateTime } from '@/lib/console-types'

const STATUS_STYLE: Record<FleetStatus, { dot: string; text: string; ring: string }> = {
  online: { dot: 'bg-emerald-500', text: 'text-emerald-300', ring: 'border-emerald-400/30 bg-emerald-400/10' },
  silent: { dot: 'bg-red-500', text: 'text-red-300', ring: 'border-red-400/40 bg-red-500/10' },
  idle: { dot: 'bg-zinc-500', text: 'text-zinc-400', ring: 'border-white/10 bg-white/[0.03]' },
}

export function FleetStatusPill({ host }: { host?: FleetHost }) {
  if (!host) {
    return <span className="rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-500" title="El motor no tiene este equipo en su inventario (solo aparece en alertas o eventos antiguos)">sin inventario</span>
  }
  const s = STATUS_STYLE[host.status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] ${s.ring} ${s.text}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${s.dot} ${host.status === 'online' ? 'animate-pulse motion-reduce:animate-none' : ''}`} />
      {FLEET_STATUS_LABEL[host.status]}
    </span>
  )
}

/** Summary of the inventory with the enrollment entry point. */
export function FleetSummary({ onEnroll }: { onEnroll: () => void }) {
  const { fleet, available, loaded } = useFleet()
  const withSensor = fleet?.hosts.filter((h) => h.sensor).length ?? 0
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
      <StatTile icon={Desktop} label="Equipos en el inventario" value={fleet ? fleet.hosts.length : '—'} hint={!loaded ? 'consultando el motor' : available ? `${withSensor} con sensor que envía latido` : 'este motor no ofrece inventario: actualízalo'} />
      <StatTile icon={PlugsConnected} label="En línea" value={fleet ? fleet.online : '—'} hint="latido o telemetría reciente" />
      <StatTile icon={WifiSlash} label="Sin señal" value={fleet ? fleet.silent : '—'} hint={fleet?.silent ? 'su sensor dejó de enviar latido' : 'ningún sensor callado'} warn={(fleet?.silent ?? 0) > 0} />
      <StatTile icon={Timer} label="Inactivos" value={fleet ? fleet.idle : '—'} hint="sin latido y sin datos en 10 min" />
      <button
        type="button"
        onClick={onEnroll}
        className="panel flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium text-blue-200 transition-colors hover:border-blue-400/40 hover:bg-blue-500/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus size={16} aria-hidden /> Añadir equipo remoto
      </button>
    </div>
  )
}

/** Health of the sensor on one host. */
export function SensorCard({ host }: { host?: FleetHost }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])
  if (!host) {
    return (
      <section aria-label="Sensor del equipo" className="panel px-5 py-4 text-xs text-zinc-500">
        Este equipo no está en el inventario del motor: sus datos vienen de alertas o eventos antiguos, o de una importación sin sensor.
      </section>
    )
  }
  const s = host.sensor
  const beatAgo = secondsSince(s?.last_heartbeat, now)
  const silentFor = secondsSince(host.silent_since, now)
  const rows: { icon: React.ElementType; label: string; value: React.ReactNode }[] = [
    { icon: Cpu, label: 'Sensor', value: s ? `${s.kind ?? 'desconocido'}${s.version ? ` · ${s.version}` : ''}` : 'sin latido (sensor antiguo o importación)' },
    { icon: HardDrives, label: 'Sistema', value: s?.os || '—' },
    { icon: ShieldCheck, label: 'Captura', value: s?.capture || host.sources.join(', ') || '—' },
    { icon: Broadcast, label: 'Último latido', value: beatAgo === null ? '—' : `hace ${formatDuration(beatAgo)} (cada ${s?.interval_s ?? 60} s)` },
    { icon: Timer, label: 'Sensor activo desde hace', value: s ? formatDuration(s.uptime_s) : '—' },
    { icon: PlugsConnected, label: 'Conexión desde', value: host.peers.length ? host.peers.join(', ') : '—' },
    { icon: Fingerprint, label: 'Identidad de ingesta', value: host.identity || 'token compartido o sin autenticación' },
  ]
  return (
    <section aria-label="Sensor del equipo" className="panel overflow-hidden">
      {host.status === 'silent' && (
        <div role="alert" className="flex items-start gap-2 border-b border-red-400/20 bg-red-500/[0.08] px-5 py-3 text-xs text-red-200">
          <WarningCircle size={16} weight="fill" aria-hidden className="mt-0.5 shrink-0" />
          <span>
            Sin señal {silentFor !== null ? `desde hace ${formatDuration(silentFor)}` : ''}. Comprueba si el equipo está encendido y con red, y si el sensor sigue en marcha:
            detenerlo es lo primero que hace un atacante para trabajar sin ser visto.
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
        <h3 className="text-sm font-medium text-zinc-100">Sensor y conexión</h3>
        <FleetStatusPill host={host} />
        <span className="ml-auto text-[11px] text-zinc-500">en el inventario desde {formatDateTime(host.first_seen)}</span>
      </div>
      <dl className="grid gap-x-6 gap-y-2.5 px-5 py-4 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="flex min-w-0 items-start gap-2">
            <row.icon size={14} aria-hidden className="mt-0.5 shrink-0 text-zinc-500" />
            <div className="min-w-0">
              <dt className="text-[11px] text-zinc-500">{row.label}</dt>
              <dd className="truncate text-xs text-zinc-200" title={typeof row.value === 'string' ? row.value : undefined}>{row.value}</dd>
            </div>
          </div>
        ))}
      </dl>
      <div className="grid grid-cols-3 border-t border-white/[0.06] text-center">
        {[
          { label: 'Eventos (5 min)', value: host.events_last_5m },
          { label: 'En cola de disco', value: s ? s.spooled : '—', warn: (s?.spooled ?? 0) > 0 },
          { label: 'Descartados', value: s ? s.dropped : '—', warn: (s?.dropped ?? 0) > 0 },
        ].map((cell) => (
          <div key={cell.label} className="px-3 py-3">
            <p className={`text-lg font-semibold ${cell.warn ? 'text-amber-300' : 'text-zinc-50'}`}>{cell.value}</p>
            <p className="text-[11px] text-zinc-500">{cell.label}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

const WHERE_LABEL = {
  server: 'En este servidor · PowerShell normal',
  'server-admin': 'En este servidor · PowerShell de administrador',
  'remote-admin': 'En el equipo remoto · PowerShell de administrador',
} as const

/** Step-by-step enrollment of a remote Windows machine you administer. */
export function EnrollDialog({ onClose }: { onClose: () => void }) {
  const id = useId()
  const first = useRef<HTMLInputElement>(null)
  const [host, setHost] = useState('')
  const [server, setServer] = useState('')
  const [tls, setTls] = useState(true)
  const [copied, setCopied] = useState<number | null>(null)
  const hostOk = isValidHostName(host.trim())
  const serverOk = /^[A-Za-z0-9.-]{1,253}$/.test(server.trim())
  const steps = hostOk && serverOk ? enrollmentPlan(host.trim(), server.trim(), tls) : []

  async function copy(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(index)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      setCopied(null)
    }
  }

  return (
    <ConsoleDialog open onClose={onClose} titleId={`${id}-t`} initialFocus={first} className="sm:max-w-3xl">
      <div className="border-b border-zinc-800 px-5 py-4">
        <h2 id={`${id}-t`} className="text-sm font-semibold text-zinc-100">Añadir un equipo remoto</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
          El equipo envía su telemetría a este servidor con su propia identidad (un token atado a su nombre) y un latido cada minuto.
          La consola no se conecta al equipo ni ejecuta nada en él. Guía completa: docs/FLOTA-REMOTA.md.
        </p>
      </div>
      <div className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="text-xs text-zinc-400">
          Nombre del equipo remoto
          <input ref={first} value={host} onChange={(e) => setHost(e.target.value)} placeholder="PC-CONTA-01" maxLength={15}
            className="mt-1 block w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </label>
        <label className="text-xs text-zinc-400">
          IP o nombre de este servidor en la red
          <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="192.168.1.10" maxLength={253}
            className="mt-1 block w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </label>
        <label className="flex items-center gap-2 pb-1.5 text-xs text-zinc-300">
          <input type="checkbox" checked={tls} onChange={(e) => setTls(e.target.checked)} />
          Cifrar con TLS (recomendado)
        </label>
      </div>
      {host && !hostOk && <p className="px-5 text-[11px] text-amber-300">El nombre de un equipo Windows tiene hasta 15 letras, números o guiones.</p>}
      <div className="max-h-[50vh] overflow-y-auto px-5 pb-4">
        {steps.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-500">Escribe el nombre del equipo y la dirección del servidor para ver los pasos con los comandos ya preparados.</p>
        ) : (
          <ol className="space-y-3">
            {steps.map((step, i) => (
              <li key={i} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                <p className="flex items-center gap-2 text-[11px] font-medium text-zinc-400">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500/20 text-[10px] text-blue-200">{i + 1}</span>
                  {WHERE_LABEL[step.where]}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-300">{step.text}</p>
                {step.cmd && (
                  <div className="mt-2 flex items-start gap-2">
                    <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-md bg-black/40 px-2.5 py-2 font-mono text-[11px] text-zinc-200">{step.cmd}</code>
                    <button type="button" onClick={() => void copy(step.cmd!, i)} aria-label={`Copiar el comando del paso ${i + 1}`}
                      className="shrink-0 rounded-md border border-white/10 p-1.5 text-zinc-400 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {copied === i ? <CheckCircle size={14} weight="fill" aria-hidden className="text-emerald-400" /> : <Copy size={14} aria-hidden />}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
        {tls && steps.length > 0 && (
          <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
            TLS necesita un certificado del servidor en tools\config\ingest-cert.pem e ingest-key.pem (cómo crearlo: docs/FLOTA-REMOTA.md). Sin él, el motor no activa TLS y el sensor rechazará conectar.
          </p>
        )}
      </div>
      <div className="flex justify-end border-t border-zinc-800 px-5 py-3">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-xs text-zinc-300 hover:text-zinc-100">Cerrar</button>
      </div>
    </ConsoleDialog>
  )
}
