'use client'

// Actions on alerts: the bar shown while alerts are selected in the
// queue (bulk triage, incident, suppression, export, AI analysis) and
// the quick actions of the alert detail (host page, incident,
// suppression, containment, reputation). Every write goes through the
// engine, which validates it again; failures are shown inline with the
// engine's own message.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  CheckCircle,
  Desktop,
  DownloadSimple,
  Eye,
  FolderPlus,
  Globe,
  Prohibit,
  Skull,
  Sparkle,
  X,
  XCircle,
  ArrowCounterClockwise,
} from '@phosphor-icons/react'
import { ConsoleDialog } from './console-dialog'
import { useEngine } from './engine-provider'
import { useIncidents } from './incidents-provider'
import { SeverityBadge } from './ui-bits'
import { Meter } from '@/components/charts/bars'
import { postAlertStatus } from '@/lib/lifecycle'
import { alertKey } from '@/lib/engine-client'
import {
  addIncidentAlerts,
  createIncident,
  createSuppression,
  expiryInDays,
  INCIDENT_STATUS_LABEL,
  isPublicIPv4,
  killProcess,
  eventSha256,
  lookupReputation,
  reputationProviders,
  type ReputationReport,
} from '@/lib/engine-writes'
import type { Severity, SfAlert, SfAlertStatus } from '@/lib/console-types'

const RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }

const btn =
  'inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-zinc-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const field =
  'mt-1 block w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const primary =
  'inline-flex items-center gap-1.5 rounded-lg bg-primary-strong px-3.5 py-2 text-xs font-medium text-white hover:bg-primary-tint disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

function worstOf(alerts: SfAlert[]): Severity {
  return alerts.reduce<Severity>((w, a) => (RANK[a.severity] > RANK[w] ? a.severity : w), 'info')
}

function download(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value)
  // spreadsheet formula injection guard (same rule as the engine export)
  const safe = /^[=+\-@\t\r]/.test(text) ? "'" + text : text
  return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe
}

// ---- bulk action bar ------------------------------------------------------

export function AlertActionBar({ alerts, onClear, onAnalyze, onAnalyzeGroup, onOpenIncident }: {
  alerts: SfAlert[]
  onClear: () => void
  onAnalyze?: (alert: SfAlert) => void
  onAnalyzeGroup?: (alerts: SfAlert[]) => void
  onOpenIncident?: (id: string) => void
}) {
  const { applyTriage } = useEngine()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [dialog, setDialog] = useState<'incident' | 'suppress' | null>(null)
  const withId = alerts.filter((a) => a.id)

  async function triage(status: SfAlertStatus) {
    setBusy(true)
    setMessage('')
    let ok = 0
    const errors: string[] = []
    for (const a of withId) {
      const ack = await postAlertStatus({ alert_id: a.id!, status, note: note.trim(), by: 'consola' })
      if (ack.ok) {
        ok++
        if (ack.entry) applyTriage(ack.entry)
      } else errors.push(ack.error)
    }
    setBusy(false)
    setNote('')
    setMessage(errors.length ? `${ok} actualizadas, ${errors.length} con error: ${errors[0]}` : `${ok} alertas actualizadas.`)
  }

  function exportSelection(format: 'jsonl' | 'csv') {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    if (format === 'jsonl') {
      download(`alertas-seleccion-${stamp}.jsonl`, alerts.map((a) => JSON.stringify(a)).join('\n') + '\n', 'application/x-ndjson')
      return
    }
    const cols = ['id', 'timestamp', 'severity', 'rule_id', 'rule_name', 'host', 'user', 'event_type', 'status', 'summary'] as const
    const rows = alerts.map((a) => cols.map((c) => csvCell(a[c])).join(','))
    download(`alertas-seleccion-${stamp}.csv`, [cols.join(','), ...rows].join('\n') + '\n', 'text/csv')
  }

  const top = [...alerts].sort((a, b) => RANK[b.severity] - RANK[a.severity])[0]

  return (
    <div role="region" aria-label="Acciones sobre la selección" className="sticky top-16 z-10 mb-3 rounded-xl border border-primary/25 bg-zinc-900/95 px-3 py-2.5 shadow-lg backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-primary-soft">{alerts.length} seleccionadas</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} aria-label="Nota común para el triaje" placeholder="nota común (opcional)"
          className="h-8 w-44 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-100 placeholder:text-zinc-600" />
        <button type="button" className={btn} disabled={busy || withId.length === 0} onClick={() => void triage('acknowledged')}>
          <Eye size={13} aria-hidden /> Reconocer ({withId.length})
        </button>
        <button type="button" className={btn} disabled={busy || withId.length === 0} onClick={() => void triage('closed')}>
          <XCircle size={13} aria-hidden /> Cerrar ({withId.length})
        </button>
        <button type="button" className={btn} disabled={busy || withId.length === 0} onClick={() => void triage('new')}>
          <ArrowCounterClockwise size={13} aria-hidden /> Reabrir ({withId.length})
        </button>
        <span aria-hidden className="mx-1 h-5 w-px bg-white/10" />
        <button type="button" className={btn} disabled={withId.length === 0} onClick={() => setDialog('incident')}>
          <FolderPlus size={13} aria-hidden /> Añadir a incidente
        </button>
        <button type="button" className={btn} onClick={() => setDialog('suppress')}>
          <Prohibit size={13} aria-hidden /> Suprimir
        </button>
        <button type="button" className={btn} onClick={() => exportSelection('jsonl')}>
          <DownloadSimple size={13} aria-hidden /> JSONL
        </button>
        <button type="button" className={btn} onClick={() => exportSelection('csv')}>
          <DownloadSimple size={13} aria-hidden /> CSV
        </button>
        {onAnalyze && top && (
          <button type="button" className={btn} onClick={() => onAnalyze(top)} title="El analista estudia la alerta más grave de la selección">
            <Sparkle size={13} weight="fill" aria-hidden /> Analizar la más grave
          </button>
        )}
        {onAnalyzeGroup && (
          <button
            type="button"
            className={btn}
            onClick={() => onAnalyzeGroup(alerts)}
            title="El analista estudia la selección como conjunto: agrupa por equipo y ventana y adjunta el bundle forense de la alerta más grave"
          >
            <Sparkle size={13} weight="fill" aria-hidden /> Analizar la selección ({Math.min(alerts.length, 8)})
          </button>
        )}
        <button type="button" onClick={onClear} aria-label="Quitar la selección" className="ml-auto rounded-md p-1.5 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X size={14} aria-hidden />
        </button>
      </div>
      {message && <p role="status" className="mt-1.5 text-[11px] text-zinc-300">{message}</p>}
      {dialog === 'incident' && <IncidentDialog alerts={withId} onClose={() => setDialog(null)} onOpenIncident={onOpenIncident} />}
      {dialog === 'suppress' && <SuppressDialog alerts={alerts} onClose={() => setDialog(null)} />}
    </div>
  )
}

// ---- quick actions of one alert ------------------------------------------

export function AlertQuickActions({ alert, onHost, onOpenIncident }: {
  alert: SfAlert
  onHost?: (host: string) => void
  onOpenIncident?: (id: string) => void
}) {
  const { respondState } = useEngine()
  const [dialog, setDialog] = useState<'incident' | 'suppress' | 'kill' | null>(null)
  return (
    <div className="mt-4">
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">Acciones</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {onHost && alert.host && (
          <button type="button" className={btn} onClick={() => onHost(alert.host)}>
            <Desktop size={13} aria-hidden /> Ficha del equipo
          </button>
        )}
        <button type="button" className={btn} disabled={!alert.id} onClick={() => setDialog('incident')}>
          <FolderPlus size={13} aria-hidden /> Añadir a incidente
        </button>
        <button type="button" className={btn} onClick={() => setDialog('suppress')}>
          <Prohibit size={13} aria-hidden /> Suprimir en este equipo
        </button>
        <button
          type="button"
          className={`${btn} border-red-400/25 text-red-200 hover:border-red-400/50`}
          disabled={!respondState}
          title={respondState ? 'Terminar el proceso en el equipo (credencial de operador)' : 'La respuesta activa no está armada en el motor'}
          onClick={() => setDialog('kill')}
        >
          <Skull size={13} aria-hidden /> Contener proceso
        </button>
      </div>
      <ReputationPanel alert={alert} />
      {dialog === 'incident' && alert.id && <IncidentDialog alerts={[alert]} onClose={() => setDialog(null)} onOpenIncident={onOpenIncident} />}
      {dialog === 'suppress' && <SuppressDialog alerts={[alert]} onClose={() => setDialog(null)} />}
      {dialog === 'kill' && <KillDialog alert={alert} onClose={() => setDialog(null)} />}
    </div>
  )
}

// ---- add to incident ---------------------------------------------------

function IncidentDialog({ alerts, onClose, onOpenIncident }: {
  alerts: SfAlert[]
  onClose: () => void
  onOpenIncident?: (id: string) => void
}) {
  const { incidents, available, upsert } = useIncidents()
  const active = incidents.filter((i) => i.status !== 'closed')
  const id = useId()
  const first = useRef<HTMLInputElement>(null)
  const [target, setTarget] = useState(active[0]?.id ?? 'new')
  const hosts = [...new Set(alerts.map((a) => a.host).filter(Boolean))]
  const [title, setTitle] = useState(
    alerts.length === 1 ? `${alerts[0].rule_name} en ${alerts[0].host}` : `${alerts.length} alertas en ${hosts.slice(0, 2).join(', ')}${hosts.length > 2 ? '…' : ''}`,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError('')
    const ids = alerts.map((a) => a.id!).slice(0, 500)
    const res = target === 'new'
      ? await createIncident({ title, severity: worstOf(alerts), alert_ids: ids, hosts })
      : await addIncidentAlerts(target, ids, hosts)
    setBusy(false)
    if (!res.ok) return setError(res.status === 404 || res.status === 405 ? 'Este motor no ofrece incidentes: actualiza la instalación.' : res.error)
    upsert(res.data)
    setDone(res.data.id)
  }

  return (
    <ConsoleDialog open onClose={onClose} titleId={`${id}-t`} initialFocus={first}>
      <div className="border-b border-zinc-800 px-5 py-4">
        <h2 id={`${id}-t`} className="text-sm font-semibold text-zinc-100">Añadir {alerts.length === 1 ? 'la alerta' : `${alerts.length} alertas`} a un incidente</h2>
        <p className="mt-0.5 text-xs text-zinc-500">Los equipos y la severidad del caso se actualizan con las alertas.</p>
      </div>
      <div className="space-y-2 px-5 py-4">
        {!available && <p className="text-xs text-amber-300">No se pudo leer la lista de incidentes del motor.</p>}
        <fieldset className="space-y-1.5">
          <legend className="sr-only">Incidente de destino</legend>
          <label className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-200">
            <input ref={first} type="radio" name={`${id}-target`} checked={target === 'new'} onChange={() => setTarget('new')} />
            Nuevo incidente
          </label>
          {target === 'new' && (
            <label className="block pl-1 text-xs text-zinc-400">
              Título
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={field} />
            </label>
          )}
          {active.map((inc) => (
            <label key={inc.id} className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-200">
              <input type="radio" name={`${id}-target`} checked={target === inc.id} onChange={() => setTarget(inc.id)} />
              <SeverityBadge severity={inc.severity} />
              <span className="min-w-0 flex-1 truncate">{inc.title}</span>
              <span className="text-[11px] text-zinc-500">{INCIDENT_STATUS_LABEL[inc.status]} · {inc.alert_ids.length}</span>
            </label>
          ))}
        </fieldset>
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        {done && (
          <p role="status" className="flex items-center gap-2 text-xs text-emerald-300">
            <CheckCircle size={14} weight="fill" aria-hidden /> Guardado en el incidente.
            {onOpenIncident && <button type="button" onClick={() => { onClose(); onOpenIncident(done) }} className="underline underline-offset-4">Abrir incidente</button>}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-xs text-zinc-400 hover:text-zinc-100">{done ? 'Hecho' : 'Cancelar'}</button>
        {!done && (
          <button type="button" className={primary} disabled={busy || (target === 'new' && !title.trim())} onClick={() => void submit()}>
            {busy ? 'Guardando…' : target === 'new' ? 'Crear incidente' : 'Añadir'}
          </button>
        )}
      </div>
    </ConsoleDialog>
  )
}

// ---- suppression ------------------------------------------------------------

function SuppressDialog({ alerts, onClose }: { alerts: SfAlert[]; onClose: () => void }) {
  const id = useId()
  const first = useRef<HTMLTextAreaElement>(null)
  const pairs = useMemo(() => {
    const seen = new Map<string, { rule_id: string; rule_name: string; host: string }>()
    for (const a of alerts) seen.set(`${a.rule_id}|${a.host.toLowerCase()}`, { rule_id: a.rule_id, rule_name: a.rule_name, host: a.host })
    return [...seen.values()]
  }, [alerts])
  const [allHosts, setAllHosts] = useState(false)
  const [reason, setReason] = useState('')
  const [days, setDays] = useState('7')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: number; errors: string[] } | null>(null)

  async function submit() {
    setBusy(true)
    const errors: string[] = []
    let ok = 0
    const unique = allHosts ? [...new Map(pairs.map((p) => [p.rule_id, { ...p, host: '' }])).values()] : pairs
    for (const p of unique) {
      const res = await createSuppression({ rule_id: p.rule_id, host: p.host || undefined, reason: reason.trim(), expires: days === 'never' ? undefined : expiryInDays(Number(days)) })
      if (res.ok) ok++
      else errors.push(res.status === 403 ? 'el motor no acepta supresiones desde la API: arráncalo con -api-write (sf-console lo hace tras actualizar)' : res.error)
    }
    setBusy(false)
    setResult({ ok, errors: [...new Set(errors)] })
  }

  return (
    <ConsoleDialog open onClose={onClose} titleId={`${id}-t`} initialFocus={first}>
      <div className="border-b border-zinc-800 px-5 py-4">
        <h2 id={`${id}-t`} className="text-sm font-semibold text-zinc-100">Suprimir {pairs.length === 1 ? 'la regla' : `${pairs.length} reglas`}</h2>
        <p className="mt-0.5 text-xs text-zinc-500">Los eventos que coincidan dejarán de generar alertas, de llegar al webhook y de contar para las cadenas.</p>
      </div>
      <div className="space-y-3 px-5 py-4">
        <ul className="space-y-1 rounded-lg border border-zinc-800 p-2">
          {pairs.map((p) => (
            <li key={p.rule_id + p.host} className="flex items-center gap-2 text-xs">
              <Prohibit size={13} aria-hidden className="text-zinc-500" />
              <span className="min-w-0 flex-1 truncate text-zinc-200">{p.rule_name}</span>
              <span className="font-mono text-[11px] text-zinc-500">{allHosts ? 'todos los equipos' : p.host}</span>
            </li>
          ))}
        </ul>
        <label className="flex items-start gap-2 text-xs text-zinc-300">
          <input type="checkbox" checked={allHosts} onChange={(e) => setAllHosts(e.target.checked)} className="mt-0.5" />
          <span>Aplicar a todos los equipos <span className="block text-[11px] text-amber-300/90">Desaconsejado: también silencia a un atacante que haga lo mismo en otra máquina.</span></span>
        </label>
        <label className="block text-xs text-zinc-400">
          Motivo (obligatorio, queda en suppressions.yaml)
          <textarea ref={first} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} placeholder="p. ej. copia nocturna aprobada (CHG-2207)" className={field} />
        </label>
        <label className="block text-xs text-zinc-400">
          Caducidad
          <select value={days} onChange={(e) => setDays(e.target.value)} className={field}>
            <option value="1">24 horas</option>
            <option value="7">7 días</option>
            <option value="30">30 días</option>
            <option value="never">Sin caducidad</option>
          </select>
        </label>
        {result && (
          <p role={result.errors.length ? 'alert' : 'status'} className={`text-xs ${result.errors.length ? 'text-red-300' : 'text-emerald-300'}`}>
            {result.ok} supresiones guardadas{result.errors.length ? `. Error: ${result.errors[0]}` : '. El motor ya las aplica.'}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-xs text-zinc-400 hover:text-zinc-100">{result && !result.errors.length ? 'Hecho' : 'Cancelar'}</button>
        {!(result && !result.errors.length) && (
          <button type="button" className={primary} disabled={busy || reason.trim().length < 5} onClick={() => void submit()}>
            {busy ? 'Guardando…' : 'Suprimir'}
          </button>
        )}
      </div>
    </ConsoleDialog>
  )
}

// ---- containment (kill_process) -------------------------------------------

const DENIAL: Record<string, string> = {
  operator_credential_invalid: 'La credencial de operador no es válida.',
  operator_not_allowed: 'Ese operador no está en la lista autorizada del motor.',
  pid_mismatch: 'El PID ya no corresponde a ese proceso (terminó o se reutilizó).',
  pid_invalid: 'PID no válido.',
  host_mismatch: 'Solo se pueden contener procesos del equipo donde corre el motor.',
  protected_process: 'Es un proceso protegido del sistema: el motor se niega a terminarlo.',
  process_not_found: 'El proceso ya no existe.',
  audit_unavailable: 'El registro de auditoría no está disponible: el motor no actúa sin auditar.',
}

function KillDialog({ alert, onClose }: { alert: SfAlert; onClose: () => void }) {
  const { events } = useEngine()
  const id = useId()
  const first = useRef<HTMLInputElement>(null)
  const ev = events.find((e) => e.id === alert.event_id)
  const [pid, setPid] = useState(ev?.process?.pid ? String(ev.process.pid) : '')
  const [name, setName] = useState(ev?.process?.name ?? '')
  const [operator, setOperator] = useState('')
  const [token, setToken] = useState('')
  const [reason, setReason] = useState(`Contención de la alerta «${alert.rule_name}»`)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit() {
    setBusy(true)
    const res = await killProcess({ host: alert.host, pid: Number(pid), process_name: name.trim(), operator: operator.trim(), reason: reason.trim(), rule_id: alert.rule_id, alert_id: alert.id }, token)
    setBusy(false)
    setToken('')
    if (res.ok) setOutcome({ ok: true, text: `Proceso terminado (${res.data.signal ?? 'SIGKILL'}). Acción ${res.data.action_id} registrada en el audit.` })
    else setOutcome({ ok: false, text: DENIAL[res.error] ?? res.error })
  }

  const valid = Number(pid) > 1 && name.trim() && operator.trim() && token && reason.trim() && confirmed
  return (
    <ConsoleDialog open onClose={onClose} titleId={`${id}-t`} initialFocus={first}>
      <div className="border-b border-red-400/20 px-5 py-4">
        <h2 id={`${id}-t`} className="flex items-center gap-2 text-sm font-semibold text-red-200"><Skull size={16} aria-hidden /> Contener: terminar el proceso</h2>
        <p className="mt-0.5 text-xs text-zinc-500">El motor verifica el nombre real del PID, tu credencial de operador y la lista de procesos protegidos, y deja el intento en el audit antes de actuar.</p>
      </div>
      <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
        <label className="text-xs text-zinc-400">Equipo<input value={alert.host} readOnly className={field + ' opacity-70'} /></label>
        <label className="text-xs text-zinc-400">PID<input ref={first} value={pid} onChange={(e) => setPid(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className={field} /></label>
        <label className="text-xs text-zinc-400 sm:col-span-2">Proceso (nombre real esperado)<input value={name} onChange={(e) => setName(e.target.value)} className={field} /></label>
        <label className="text-xs text-zinc-400">Operador<input value={operator} onChange={(e) => setOperator(e.target.value)} autoComplete="username" className={field} /></label>
        <label className="text-xs text-zinc-400">Credencial de operador<input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="current-password" className={field} /></label>
        <label className="text-xs text-zinc-400 sm:col-span-2">Motivo<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={512} className={field} /></label>
        <label className="flex items-start gap-2 text-xs text-zinc-300 sm:col-span-2">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
          Entiendo que el proceso se termina de inmediato y sin guardar su trabajo.
        </label>
        {!ev && <p className="text-[11px] text-amber-300/90 sm:col-span-2">El evento de la alerta ya no está en la ventana: comprueba el PID en la evidencia forense antes de actuar.</p>}
        {outcome && <p role={outcome.ok ? 'status' : 'alert'} className={`text-xs sm:col-span-2 ${outcome.ok ? 'text-emerald-300' : 'text-red-300'}`}>{outcome.text}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-xs text-zinc-400 hover:text-zinc-100">{outcome?.ok ? 'Hecho' : 'Cancelar'}</button>
        {!outcome?.ok && (
          <button type="button" disabled={!valid || busy} onClick={() => void submit()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-3.5 py-2 text-xs font-medium text-white hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Skull size={13} aria-hidden /> {busy ? 'Enviando…' : 'Terminar proceso'}
          </button>
        )}
      </div>
    </ConsoleDialog>
  )
}

// ---- reputation -------------------------------------------------------------

let providersOnce: Promise<Record<string, boolean>> | null = null
function useReputationProviders(): Record<string, boolean> {
  const [providers, setProviders] = useState<Record<string, boolean>>({})
  useEffect(() => {
    providersOnce ??= reputationProviders().then((r) => (r.ok ? r.data.providers : {}))
    let alive = true
    void providersOnce.then((p) => alive && setProviders(p))
    return () => {
      alive = false
    }
  }, [])
  return providers
}

function ReputationPanel({ alert }: { alert: SfAlert }) {
  const providers = useReputationProviders()
  const { events } = useEngine()
  const enabled = Object.values(providers).some(Boolean)
  const ev = events.find((e) => e.id === alert.event_id)
  const ips = [...new Set([alert.network?.destination_ip, alert.network?.source_ip, ev?.network?.destination_ip].filter(isPublicIPv4))]
  // file hashes go to VirusTotal only (AbuseIPDB knows addresses)
  const hashes = providers.virustotal ? eventSha256(ev) : []
  const indicators: { kind: 'ip' | 'hash'; value: string }[] = [
    ...ips.map((value) => ({ kind: 'ip' as const, value })),
    ...hashes.map((value) => ({ kind: 'hash' as const, value })),
  ]
  const [reports, setReports] = useState<Record<string, ReputationReport | string>>({})
  if (!enabled || indicators.length === 0) return null

  async function lookup(kind: 'ip' | 'hash', value: string) {
    setReports((r) => ({ ...r, [value]: 'consultando…' }))
    const res = await lookupReputation(kind, value)
    setReports((r) => ({ ...r, [value]: res.ok ? res.data : res.error }))
  }

  return (
    <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-300"><Globe size={13} aria-hidden className="text-primary" /> Reputación (consulta bajo demanda)</p>
      <ul className="mt-2 space-y-2">
        {indicators.map(({ kind, value }) => {
          const r = reports[value]
          return (
            <li key={value}>
              <div className="flex min-w-0 items-center gap-2">
                {kind === 'hash' && <span className="shrink-0 rounded bg-white/[0.06] px-1 text-[10px] text-zinc-400">SHA-256</span>}
                <span className="min-w-0 truncate font-mono text-xs text-zinc-200" title={value}>{value}</span>
                {!r && <button type="button" className={btn + ' ml-auto shrink-0 py-1'} onClick={() => void lookup(kind, value)}>Consultar</button>}
                {typeof r === 'string' && <span className="ml-auto text-[11px] text-zinc-400">{r}</span>}
              </div>
              {r && typeof r !== 'string' && (
                <ul className="mt-1.5 space-y-1.5">
                  {r.results.map((res) => (
                    <li key={res.provider} className="text-[11px] text-zinc-400">
                      <span className="font-medium text-zinc-200">{res.provider === 'abuseipdb' ? 'AbuseIPDB' : 'VirusTotal'}</span>
                      {res.status !== 'ok' ? (
                        <span> · {res.status === 'not_found' ? 'sin datos' : res.detail ?? res.status}</span>
                      ) : res.provider === 'abuseipdb' ? (
                        <span className="mt-1 flex items-center gap-2">
                          <Meter className="max-w-40 flex-1" value={res.score ?? 0} max={100} color={(res.score ?? 0) >= 75 ? 'var(--status-critical)' : (res.score ?? 0) >= 25 ? 'var(--status-warning)' : 'var(--status-good)'} />
                          <span className="tabular-nums text-zinc-200">{res.score}%</span> abuso · {res.reports} informes{res.country ? ` · ${res.country}` : ''}
                        </span>
                      ) : (
                        <span> · <span className={res.malicious ? 'text-red-300' : 'text-zinc-200'}>{res.malicious ?? 0} motores lo marcan malicioso</span> de {(res.malicious ?? 0) + (res.suspicious ?? 0) + (res.harmless ?? 0) + (res.undetected ?? 0)}{res.owner ? ` · ${res.owner}` : ''}</span>
                      )}
                      {res.link && <a href={res.link} target="_blank" rel="noreferrer noopener" className="ml-1 text-primary-link underline-offset-4 hover:underline">ver</a>}
                    </li>
                  ))}
                  {r.cached && <li className="text-[10px] text-zinc-500">respuesta en caché del motor</li>}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function useAlertSelection(visibleKeys: string[]) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const allPicked = visibleKeys.length > 0 && visibleKeys.every((k) => picked.has(k))
  return {
    picked,
    toggle: (key: string) =>
      setPicked((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      }),
    toggleAll: () => setPicked(allPicked ? new Set() : new Set(visibleKeys)),
    clear: () => setPicked(new Set()),
    allPicked,
  }
}

export { alertKey }
