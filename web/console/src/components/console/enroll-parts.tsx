'use client'

// Enrollment pieces of the Equipos view: the token wizard of the "Añadir
// equipos" dialog, the panel of machines waiting for approval and the
// revoke control of the host page. Creating tokens and deciding on
// machines is an administrator's call (the console proxy enforces it too);
// the console never contacts a machine.

import { useState } from 'react'
import { CheckCircle, Copy, Key, ShieldWarning, Timer, UserCirclePlus, WarningCircle, XCircle } from '@phosphor-icons/react'
import { useFleet } from './fleet-provider'
import { useConsoleUser } from './user-session'
import {
  createEnrollToken,
  decideEnrolledHost,
  HOST_STATE_LABEL,
  isValidPattern,
  isValidServer,
  revokeEnrollToken,
  serviceEnrollmentCommand,
  TOKEN_LIFETIMES,
  TOKEN_STATUS_LABEL,
  tokenEnrollmentPlan,
  type EnrolledHost,
  type EnrollToken,
  type HostAction,
} from '@/lib/enroll'
import { formatDuration, secondsSince } from '@/lib/fleet'
import { formatDateTime } from '@/lib/console-types'

const INPUT = 'mt-1 block w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const PRIMARY = 'rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const QUIET = 'rounded-md border border-white/10 px-2.5 py-1 text-[11px] text-zinc-300 hover:border-white/20 hover:text-zinc-100 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const WHERE = {
  'server-admin': 'En este servidor · PowerShell de administrador',
  'remote-admin': 'En el equipo nuevo · PowerShell de administrador',
} as const

function CopyBox({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 1500)
    } catch {
      setDone(false)
    }
  }
  return (
    <div className="mt-2 flex items-start gap-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-md bg-black/40 px-2.5 py-2 font-mono text-[11px] text-zinc-200">{text}</code>
      <button type="button" onClick={() => void copy()} aria-label={label} className="shrink-0 rounded-md border border-white/10 p-1.5 text-zinc-400 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {done ? <CheckCircle size={14} weight="fill" aria-hidden className="text-emerald-400" /> : <Copy size={14} aria-hidden />}
      </button>
    </div>
  )
}

/** Why the token wizard cannot be used right now, or null when it can. */
function useEnrollBlocker(): string | null {
  const { enroll, loaded } = useFleet()
  const me = useConsoleUser()
  if (!loaded) return 'Consultando el motor…'
  if (!enroll) return 'El motor no responde o es una versión sin alta de equipos: actualízalo (sf-update).'
  if (!enroll.enabled) {
    return `${enroll.hint ?? 'El alta de equipos está apagada en el motor.'} En la instalación de Windows se activa sola al crear el certificado de ingesta (docs/FLOTA-REMOTA.md, «Certificado TLS del servidor») y reiniciar con sf-console -Stop; sf-console. Mientras tanto, usa la pestaña Manual.`
  }
  if (!enroll.writes) return 'El motor no tiene token de API: el alta de equipos lo necesita (arranca el motor con -api-token o SF_API_TOKEN).'
  if (me.role !== 'admin') return 'Solo un administrador puede crear tokens de alta. Pídeselo a quien administre la consola.'
  return null
}

/** The token tab of the "Añadir equipos" dialog. */
export function TokenEnrollment() {
  const { enroll, refresh } = useFleet()
  const me = useConsoleUser()
  const blocker = useEnrollBlocker()
  const [label, setLabel] = useState('')
  const [uses, setUses] = useState(1)
  const [hours, setHours] = useState<number>(TOKEN_LIFETIMES[0].hours)
  const [pattern, setPattern] = useState('')
  const [server, setServer] = useState('')
  const [tls, setTls] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<{ token: EnrollToken; secret: string } | null>(null)

  const serverOk = isValidServer(server.trim())
  const patternOk = isValidPattern(pattern.trim())
  const usesOk = Number.isInteger(uses) && uses >= 1 && uses <= 10000

  async function create() {
    setBusy(true)
    setError('')
    const res = await createEnrollToken({ label: label.trim(), max_uses: uses, ttl_hours: hours, auto_approve: pattern.trim(), by: me.name })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setCreated(res.data)
    void refresh()
  }

  if (blocker) {
    return <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center text-xs leading-relaxed text-zinc-400">{blocker}</p>
  }

  if (created) {
    const host = server.trim()
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/[0.06] p-3">
          <p className="flex items-center gap-2 text-xs font-medium text-amber-200">
            <Key size={14} aria-hidden /> Token de alta «{created.token.label}»: se muestra solo esta vez
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
            Vale para {created.token.max_uses === 1 ? 'un equipo' : `${created.token.max_uses} equipos`} hasta el {formatDateTime(created.token.expires_at)}.
            El motor guarda solo su huella. Si se pierde, crea otro.
          </p>
          <CopyBox text={created.secret} label="Copiar el token de alta" />
        </div>
        <ol className="space-y-3">
          {tokenEnrollmentPlan(created.secret, host, tls).map((step, i) => (
            <li key={i} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
              <p className="flex items-center gap-2 text-[11px] font-medium text-zinc-400">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/[0.08] text-[10px] text-zinc-200">{i + 1}</span>
                {WHERE[step.where]}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-300">{step.text}</p>
              {step.cmd && <CopyBox text={step.cmd} label={`Copiar el comando del paso ${i + 1}`} />}
            </li>
          ))}
        </ol>
        <div className="rounded-lg border border-zinc-800 p-3">
          <p className="text-[11px] font-medium text-zinc-400">Si el equipo tiene bluetardigrade instalado, en su lugar déjalo como servicio (PowerShell normal; pide administrador una vez):</p>
          <CopyBox text={serviceEnrollmentCommand(created.secret, host, tls)} label="Copiar el comando del servicio" />
        </div>
        {!tls && (
          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-amber-300">
            <WarningCircle size={14} aria-hidden className="mt-0.5 shrink-0" />
            Sin TLS solo funciona en este mismo servidor y con un motor sin TLS: la credencial que entrega el alta no puede viajar en claro por la red. La instalación de Windows activa el alta siempre con TLS.
          </p>
        )}
        <p className="text-[11px] leading-relaxed text-zinc-500">
          Cuando el sensor arranque, el equipo aparece arriba en «Pendientes de aprobación»{created.token.auto_approve ? ` (o entra solo si su nombre cumple ${created.token.auto_approve})` : ''}.
        </p>
        <button type="button" onClick={() => setCreated(null)} className={QUIET}>Crear otro token</button>
      </div>
    )
  }

  const usable = (enroll?.tokens ?? []).filter((t) => t.status === 'active')
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-zinc-400">
          Para qué es
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Aula 3, portátil de Ana…" maxLength={64} className={INPUT} />
        </label>
        <label className="text-xs text-zinc-400">
          IP o nombre de este servidor en la red
          <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="192.168.1.10" maxLength={253} className={`${INPUT} font-mono`} />
        </label>
        <label className="text-xs text-zinc-400">
          Cuántos equipos pueden usarlo
          <input type="number" min={1} max={10000} value={uses} onChange={(e) => setUses(Math.trunc(Number(e.target.value)))} className={INPUT} />
        </label>
        <label className="text-xs text-zinc-400">
          Caduca en
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className={INPUT}>
            {TOKEN_LIFETIMES.map((l) => <option key={l.hours} value={l.hours}>{l.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-zinc-400 sm:col-span-2">
          Aprobar solos los equipos cuyo nombre cumpla (opcional)
          <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="PC-CONTA-*" maxLength={64} className={`${INPUT} font-mono`} />
          <span className="mt-1 block text-[11px] leading-relaxed text-zinc-500">
            Vacío: cada equipo espera a que un administrador lo apruebe (recomendado). Un equipo cuyo nombre ya usa otro sensor nunca entra solo.
          </span>
        </label>
      </div>
      <label className="flex items-center gap-2 text-xs text-zinc-300">
        <input type="checkbox" checked={tls} onChange={(e) => setTls(e.target.checked)} />
        Cifrar con TLS (necesario para dar de alta equipos de la red)
      </label>
      {!patternOk && <p className="text-[11px] text-amber-300">El patrón admite letras, números, guiones, puntos y los comodines * y ?.</p>}
      {!usesOk && <p className="text-[11px] text-amber-300">Entre 1 y 10.000 equipos.</p>}
      {error && <p role="alert" className="text-[11px] text-red-300">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="button" disabled={busy || !serverOk || !patternOk || !usesOk} onClick={() => void create()} className={PRIMARY}>
          {busy ? 'Creando…' : 'Crear token de alta'}
        </button>
        {!serverOk && <span className="text-[11px] text-zinc-500">Escribe la dirección del servidor para preparar los comandos.</span>}
      </div>
      {usable.length > 0 && <TokenList tokens={usable} />}
    </div>
  )
}

function TokenList({ tokens }: { tokens: EnrollToken[] }) {
  const { refresh } = useFleet()
  const me = useConsoleUser()
  const [error, setError] = useState('')
  async function revoke(id: string) {
    setError('')
    const res = await revokeEnrollToken(id, me.name)
    if (!res.ok) setError(res.error)
    void refresh()
  }
  return (
    <section aria-label="Tokens de alta en uso" className="border-t border-zinc-800 pt-3">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Tokens en uso</h3>
      <ul className="mt-2 divide-y divide-zinc-800/70">
        {tokens.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-xs">
            <span className="font-medium text-zinc-200">{t.label}</span>
            <span className="text-zinc-500">{t.uses} de {t.max_uses} equipos · caduca {formatDateTime(t.expires_at)}{t.auto_approve ? ` · aprueba ${t.auto_approve}` : ''}</span>
            <span className="text-[11px] text-zinc-500">{TOKEN_STATUS_LABEL[t.status]}{t.created_by ? ` · creado por ${t.created_by}` : ''}</span>
            <button type="button" onClick={() => void revoke(t.id)} className={`${QUIET} ml-auto`}>Revocar</button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-1 text-[11px] text-red-300">{error}</p>}
    </section>
  )
}

/** Machines that enrolled and wait for an administrator. */
export function PendingHosts() {
  const { enroll, refresh } = useFleet()
  const me = useConsoleUser()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [now] = useState(() => Date.now())
  const pending = (enroll?.hosts ?? []).filter((h) => h.state === 'pending')
  if (!enroll?.enabled || pending.length === 0) return null
  const admin = me.role === 'admin' && enroll.writes
  const tokenLabel = (id: string) => enroll.tokens.find((t) => t.id === id)?.label ?? id

  async function decide(h: EnrolledHost, action: HostAction) {
    setBusy(h.name + action)
    setError('')
    const res = await decideEnrolledHost(h.name, action, me.name)
    setBusy('')
    if (!res.ok) setError(`${h.host}: ${res.error}`)
    void refresh()
  }

  return (
    <section aria-label="Equipos pendientes de aprobación" className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-5 py-3">
        <UserCirclePlus size={16} aria-hidden className="text-zinc-300" />
        <h2 className="text-sm font-medium text-zinc-100">Pendientes de aprobación</h2>
        <span className="rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">{pending.length}</span>
        <span className="ml-auto text-[11px] text-zinc-500">
          {admin ? 'Sus eventos esperan en el disco del equipo hasta que lo apruebes.' : 'Un administrador debe aprobarlos.'}
        </span>
      </div>
      <ul className="divide-y divide-white/[0.06]">
        {pending.map((h) => {
          const waited = secondsSince(h.last_attempt, now)
          return (
            <li key={h.name} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
              <div className="min-w-0">
                <p className="font-mono text-sm text-zinc-100">{h.host}</p>
                <p className="text-[11px] text-zinc-500">
                  alta {formatDateTime(h.enrolled_at)}{h.peer ? ` desde ${h.peer}` : ''} · token «{tokenLabel(h.token_id)}»
                  {waited !== null && <> · <Timer size={11} aria-hidden className="inline" /> último intento hace {formatDuration(waited)}</>}
                </p>
                {h.conflict && (
                  <p className="mt-1 flex items-start gap-1.5 text-[11px] text-amber-300">
                    <ShieldWarning size={13} aria-hidden className="mt-0.5 shrink-0" /> {h.conflict}
                  </p>
                )}
              </div>
              {admin && (
                <div className="ml-auto flex gap-2">
                  <button type="button" disabled={busy !== ''} onClick={() => void decide(h, 'approve')}
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <CheckCircle size={13} aria-hidden /> Aprobar
                  </button>
                  <button type="button" disabled={busy !== ''} onClick={() => void decide(h, 'reject')}
                    className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1 text-[11px] text-zinc-300 hover:border-red-400/40 hover:text-red-200 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <XCircle size={13} aria-hidden /> Rechazar
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {error && <p role="alert" className="border-t border-white/[0.06] px-5 py-2 text-[11px] text-red-300">{error}</p>}
    </section>
  )
}

/** How a host joined, and the revoke control for an administrator. */
export function EnrollmentRow({ record }: { record: EnrolledHost }) {
  const { refresh, enroll } = useFleet()
  const me = useConsoleUser()
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  const canRevoke = me.role === 'admin' && !!enroll?.writes && (record.state === 'active' || record.state === 'pending')

  async function revoke() {
    setError('')
    const res = await decideEnrolledHost(record.name, 'revoke', me.name)
    setConfirm(false)
    if (!res.ok) setError(res.error)
    void refresh()
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/[0.06] px-5 py-3 text-[11px]">
      <span className="text-zinc-500">Alta por token:</span>
      <span className="text-zinc-200">{HOST_STATE_LABEL[record.state]}</span>
      <span className="text-zinc-500">
        {record.auto_approved ? 'aprobado solo por el patrón del token' : record.decided_by ? `por ${record.decided_by}` : ''}
        {record.decided_at ? ` · ${formatDateTime(record.decided_at)}` : ''}
      </span>
      {canRevoke && !confirm && <button type="button" onClick={() => setConfirm(true)} className={`${QUIET} ml-auto`}>Revocar identidad</button>}
      {canRevoke && confirm && (
        <span className="ml-auto flex items-center gap-2">
          <span className="text-amber-300">Deja de aceptar sus datos al momento.</span>
          <button type="button" onClick={() => void revoke()} className="rounded-md border border-red-400/40 bg-red-500/10 px-2.5 py-1 text-red-200 hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Revocar</button>
          <button type="button" onClick={() => setConfirm(false)} className={QUIET}>Cancelar</button>
        </span>
      )}
      {error && <p role="alert" className="w-full text-red-300">{error}</p>}
    </div>
  )
}
