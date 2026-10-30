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
  UserPlus,
  X,
  XCircle,
  ArrowCounterClockwise,
} from '@phosphor-icons/react'
import { ConsoleDialog } from './console-dialog'
import { useEngine } from './engine-provider'
import { useIncidents } from './incidents-provider'
import { useI18n } from './i18n-provider'
import { useConsoleUser } from './user-session'
import { SeverityBadge } from './ui-bits'
import { Meter } from '@/components/charts/bars'
import { postAlertAssignBatch, postAlertStatus, type AssignBatchResult } from '@/lib/lifecycle'
import { alertKey } from '@/lib/engine-client'
import { csvCell } from '@/lib/chart-export'
import {
  addIncidentAlerts,
  createIncident,
  createSuppression,
  expiryInDays,
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

// csvCell comes from lib/chart-export: the same guarded cell the table
// twins use (engine formula rule + RFC 4180 quoting). One definition.

// ---- bulk action bar ------------------------------------------------------

export function AlertActionBar({ alerts, onClear, onAnalyze, onAnalyzeGroup, onOpenIncident }: {
  alerts: SfAlert[]
  onClear: () => void
  onAnalyze?: (alert: SfAlert) => void
  onAnalyzeGroup?: (alerts: SfAlert[]) => void
  onOpenIncident?: (id: string) => void
}) {
  const { applyTriage } = useEngine()
  const { dict } = useI18n()
  const w = dict.alertActions
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
    setMessage(w.triageResult(ok, errors.length, errors[0] ?? ''))
  }

  const [assignOpen, setAssignOpen] = useState(false)

  function exportSelection(format: 'jsonl' | 'csv') {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    if (format === 'jsonl') {
      download(`${w.exportName}-${stamp}.jsonl`, alerts.map((a) => JSON.stringify(a)).join('\n') + '\n', 'application/x-ndjson')
      return
    }
    const cols = ['id', 'timestamp', 'severity', 'rule_id', 'rule_name', 'host', 'user', 'event_type', 'status', 'summary'] as const
    const rows = alerts.map((a) => cols.map((c) => csvCell(a[c])).join(','))
    download(`${w.exportName}-${stamp}.csv`, [cols.join(','), ...rows].join('\n') + '\n', 'text/csv')
  }

  const top = [...alerts].sort((a, b) => RANK[b.severity] - RANK[a.severity])[0]

  return (
    <div role="region" aria-label={w.selectionAria} className="sticky top-16 z-10 mb-3 rounded-xl border border-primary/25 bg-zinc-900/95 px-3 py-2.5 shadow-lg backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-primary-soft">{w.selected(alerts.length)}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} aria-label={w.noteAria} placeholder={w.notePlaceholder}
          className="h-8 w-44 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-100 placeholder:text-zinc-600" />
        <button type="button" className={btn} disabled={busy || withId.length === 0} onClick={() => void triage('acknowledged')}>
          <Eye size={13} aria-hidden /> {w.acknowledge(withId.length)}
        </button>
        <button type="button" className={btn} disabled={busy || withId.length === 0} onClick={() => void triage('closed')}>
          <XCircle size={13} aria-hidden /> {w.close(withId.length)}
        </button>
        <button type="button" className={btn} disabled={busy || withId.length === 0} onClick={() => void triage('new')}>
          <ArrowCounterClockwise size={13} aria-hidden /> {w.reopen(withId.length)}
        </button>
        <span aria-hidden className="mx-1 h-5 w-px bg-white/10" />
        <button type="button" className={btn} disabled={busy || withId.length === 0} onClick={() => setAssignOpen(true)}>
          <UserPlus size={13} aria-hidden /> {dict.alerts.bulkAssign} ({withId.length})
        </button>
        <button type="button" className={btn} disabled={withId.length === 0} onClick={() => setDialog('incident')}>
          <FolderPlus size={13} aria-hidden /> {w.addToIncident}
        </button>
        <button type="button" className={btn} onClick={() => setDialog('suppress')}>
          <Prohibit size={13} aria-hidden /> {w.suppress}
        </button>
        <button type="button" className={btn} onClick={() => exportSelection('jsonl')}>
          <DownloadSimple size={13} aria-hidden /> JSONL
        </button>
        <button type="button" className={btn} onClick={() => exportSelection('csv')}>
          <DownloadSimple size={13} aria-hidden /> CSV
        </button>
        {onAnalyze && top && (
          <button type="button" className={btn} onClick={() => onAnalyze(top)} title={w.analyzeTopTitle}>
            <Sparkle size={13} weight="fill" aria-hidden /> {w.analyzeTop}
          </button>
        )}
        {onAnalyzeGroup && (
          <button
            type="button"
            className={btn}
            onClick={() => onAnalyzeGroup(alerts)}
            title={w.analyzeGroupTitle}
          >
            <Sparkle size={13} weight="fill" aria-hidden /> {w.analyzeGroup(Math.min(alerts.length, 8))}
          </button>
        )}
        <button type="button" onClick={onClear} aria-label={w.clearSelection} className="ml-auto rounded-md p-1.5 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X size={14} aria-hidden />
        </button>
      </div>
      {message && <p role="status" className="mt-1.5 text-[11px] text-zinc-300">{message}</p>}
      {assignOpen && <AssignDialog alerts={withId} onClose={() => setAssignOpen(false)} />}
      {dialog === 'incident' && <IncidentDialog alerts={withId} onClose={() => setDialog(null)} onOpenIncident={onOpenIncident} />}
      {dialog === 'suppress' && <SuppressDialog alerts={alerts} onClose={() => setDialog(null)} />}
    </div>
  )
}

// ---- assignment (TEAM-3/C-2) -----------------------------------------------

/** Bulk assignment: to me, to another analyst, or unassign. One batch
 * POST per submit; per-id failures (a stale selection hits unknown ids)
 * are listed instead of hiding the ones that made it. The ring updates
 * live through the alert_lifecycle echo; the explicit refresh covers a
 * stream that is temporarily down. */
export function AssignDialog({ alerts, onClose }: {
  alerts: SfAlert[]
  onClose: () => void
}) {
  const { dict } = useI18n()
  const { refresh } = useEngine()
  const me = useConsoleUser()
  const id = useId()
  const first = useRef<HTMLInputElement>(null)
  const [target, setTarget] = useState<'me' | 'other' | 'none'>('me')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<AssignBatchResult | null>(null)

  const ids = alerts.map((a) => a.id!).filter(Boolean)
  const needsName = target === 'other' && !name.trim()

  async function submit() {
    setBusy(true)
    setError('')
    // In accounts mode the write is signed with the session account, the
    // same identity the engine proxy stamps on triage; open/token mode
    // keeps the shared 'consola' signer.
    const by = me.mode === 'users' ? me.name : 'consola'
    const assignee = target === 'me' ? me.name : target === 'other' ? name.trim() : ''
    const ack = await postAlertAssignBatch(ids, assignee, by)
    setBusy(false)
    if (!ack.ok) {
      setError(ack.error)
      return
    }
    setResult(ack.result)
    refresh()
  }

  return (
    <ConsoleDialog open onClose={onClose} titleId={`${id}-t`} initialFocus={first}>
      <div className="border-b border-zinc-800 px-5 py-4">
        <h2 id={`${id}-t`} className="text-sm font-semibold text-zinc-100">{dict.alerts.assignDialogTitle(alerts.length)}</h2>
        <p className="mt-0.5 text-xs text-zinc-500">{dict.alerts.assignDialogIntro}</p>
      </div>
      <div className="space-y-2 px-5 py-4">
        <fieldset className="space-y-1.5">
          <legend className="sr-only">{dict.alerts.assignHeading}</legend>
          <label className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-200">
            <input ref={first} type="radio" name={`${id}-target`} checked={target === 'me'} onChange={() => setTarget('me')} />
            {dict.alerts.mineOption(me.name)}
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-200">
            <input type="radio" name={`${id}-target`} checked={target === 'other'} onChange={() => setTarget('other')} />
            {dict.alerts.otherOption}
          </label>
          {target === 'other' && (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              aria-label={dict.alerts.nameAria}
              placeholder={dict.alerts.namePlaceholder}
              className={field}
            />
          )}
          <label className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-200">
            <input type="radio" name={`${id}-target`} checked={target === 'none'} onChange={() => setTarget('none')} />
            {dict.alerts.noneOption}
          </label>
        </fieldset>
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        {result && (
          <div className="space-y-1.5">
            <p role="status" className="flex items-center gap-2 text-xs text-emerald-300">
              <CheckCircle size={14} weight="fill" aria-hidden />
              {dict.alerts.assignResultOk(result.assigned.length)}
              {result.failed.length > 0 && <span className="text-amber-300"> · {dict.alerts.assignResultFailed(result.failed.length)}</span>}
            </p>
            {result.failed.length > 0 && (
              <ul aria-label={dict.alerts.failedListAria} className="max-h-32 space-y-1 overflow-auto rounded-lg border border-zinc-800 p-2">
                {result.failed.map((f) => (
                  <li key={f.id} className="font-mono text-[11px] text-zinc-400">
                    <span className="text-zinc-300">{f.id.slice(0, 8)}…</span> — {f.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-xs text-zinc-400 hover:text-zinc-100">{result ? dict.alertActions.done : dict.alertActions.cancel}</button>
        {!result && (
          <button type="button" className={primary} disabled={busy || needsName || ids.length === 0} onClick={() => void submit()}>
            {busy ? '…' : target === 'none' ? dict.alerts.submitUnassign : dict.alerts.submitAssign}
          </button>
        )}
      </div>
    </ConsoleDialog>
  )
}

// ---- quick actions of one alert ------------------------------------------

export function AlertQuickActions({ alert, onHost, onOpenIncident }: {
  alert: SfAlert
  onHost?: (host: string) => void
  onOpenIncident?: (id: string) => void
}) {
  const { respondState } = useEngine()
  const w = useI18n().dict.alertActions
  const [dialog, setDialog] = useState<'incident' | 'suppress' | 'kill' | null>(null)
  return (
    <div className="mt-4">
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{w.actions}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {onHost && alert.host && (
          <button type="button" className={btn} onClick={() => onHost(alert.host)}>
            <Desktop size={13} aria-hidden /> {w.hostPage}
          </button>
        )}
        <button type="button" className={btn} disabled={!alert.id} onClick={() => setDialog('incident')}>
          <FolderPlus size={13} aria-hidden /> {w.addToIncident}
        </button>
        <button type="button" className={btn} onClick={() => setDialog('suppress')}>
          <Prohibit size={13} aria-hidden /> {w.suppressHere}
        </button>
        <button
          type="button"
          className={`${btn} border-red-400/25 text-red-200 hover:border-red-400/50`}
          disabled={!respondState}
          title={respondState ? w.containOn : w.containOff}
          onClick={() => setDialog('kill')}
        >
          <Skull size={13} aria-hidden /> {w.contain}
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
  const { dict } = useI18n()
  const w = dict.alertActions
  const active = incidents.filter((i) => i.status !== 'closed')
  const id = useId()
  const first = useRef<HTMLInputElement>(null)
  const [target, setTarget] = useState(active[0]?.id ?? 'new')
  const hosts = [...new Set(alerts.map((a) => a.host).filter(Boolean))]
  const [title, setTitle] = useState(
    alerts.length === 1 ? w.incidentDefaultOne(alerts[0].rule_name, alerts[0].host) : w.incidentDefaultMany(alerts.length, `${hosts.slice(0, 2).join(', ')}${hosts.length > 2 ? '…' : ''}`),
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
    if (!res.ok) return setError(res.status === 404 || res.status === 405 ? w.noIncidents : res.error)
    upsert(res.data)
    setDone(res.data.id)
  }

  return (
    <ConsoleDialog open onClose={onClose} titleId={`${id}-t`} initialFocus={first}>
      <div className="border-b border-zinc-800 px-5 py-4">
        <h2 id={`${id}-t`} className="text-sm font-semibold text-zinc-100">{w.incidentTitle(alerts.length)}</h2>
        <p className="mt-0.5 text-xs text-zinc-500">{w.incidentIntro}</p>
      </div>
      <div className="space-y-2 px-5 py-4">
        {!available && <p className="text-xs text-amber-300">{w.incidentsUnreadable}</p>}
        <fieldset className="space-y-1.5">
          <legend className="sr-only">{w.targetLegend}</legend>
          <label className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-200">
            <input ref={first} type="radio" name={`${id}-target`} checked={target === 'new'} onChange={() => setTarget('new')} />
            {w.newIncident}
          </label>
          {target === 'new' && (
            <label className="block pl-1 text-xs text-zinc-400">
              {w.titleLabel}
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={field} />
            </label>
          )}
          {active.map((inc) => (
            <label key={inc.id} className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-200">
              <input type="radio" name={`${id}-target`} checked={target === inc.id} onChange={() => setTarget(inc.id)} />
              <SeverityBadge severity={inc.severity} />
              <span className="min-w-0 flex-1 truncate">{inc.title}</span>
              <span className="text-[11px] text-zinc-500">{dict.incidents.statusLabels[inc.status]} · {inc.alert_ids.length}</span>
            </label>
          ))}
        </fieldset>
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        {done && (
          <p role="status" className="flex items-center gap-2 text-xs text-emerald-300">
            <CheckCircle size={14} weight="fill" aria-hidden /> {w.savedToIncident}
            {onOpenIncident && <button type="button" onClick={() => { onClose(); onOpenIncident(done) }} className="underline underline-offset-4">{w.openIncident}</button>}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-xs text-zinc-400 hover:text-zinc-100">{done ? w.done : w.cancel}</button>
        {!done && (
          <button type="button" className={primary} disabled={busy || (target === 'new' && !title.trim())} onClick={() => void submit()}>
            {busy ? w.saving : target === 'new' ? w.createIncident : w.add}
          </button>
        )}
      </div>
    </ConsoleDialog>
  )
}

// ---- suppression ------------------------------------------------------------

/** One (rule, host) pair the suppression applies to. The noise report
 * builds targets from a loud rule; the alert actions from the selected
 * alerts. */
export type SuppressionTarget = { rule_id: string; rule_name: string; host: string }

function SuppressDialog({ alerts, onClose }: { alerts: SfAlert[]; onClose: () => void }) {
  const pairs = useMemo(() => {
    const seen = new Map<string, SuppressionTarget>()
    for (const a of alerts) seen.set(`${a.rule_id}|${a.host.toLowerCase()}`, { rule_id: a.rule_id, rule_name: a.rule_name, host: a.host })
    return [...seen.values()]
  }, [alerts])
  return <SuppressionDialog targets={pairs} onClose={onClose} />
}

/** Shared suppression form: reason (mandatory, audited in the YAML),
 * optional fleet-wide scope with its honest warning, and expiry. */
export function SuppressionDialog({ targets, onClose }: { targets: SuppressionTarget[]; onClose: () => void }) {
  const w = useI18n().dict.alertActions
  const id = useId()
  const first = useRef<HTMLTextAreaElement>(null)
  const pairs = targets
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
      else errors.push(res.status === 403 ? w.apiWriteOff : res.error)
    }
    setBusy(false)
    setResult({ ok, errors: [...new Set(errors)] })
  }

  return (
    <ConsoleDialog open onClose={onClose} titleId={`${id}-t`} initialFocus={first}>
      <div className="border-b border-zinc-800 px-5 py-4">
        <h2 id={`${id}-t`} className="text-sm font-semibold text-zinc-100">{w.suppressTitle(pairs.length)}</h2>
        <p className="mt-0.5 text-xs text-zinc-500">{w.suppressIntro}</p>
      </div>
      <div className="space-y-3 px-5 py-4">
        <ul className="space-y-1 rounded-lg border border-zinc-800 p-2">
          {pairs.map((p) => (
            <li key={p.rule_id + p.host} className="flex items-center gap-2 text-xs">
              <Prohibit size={13} aria-hidden className="text-zinc-500" />
              <span className="min-w-0 flex-1 truncate text-zinc-200">{p.rule_name}</span>
              <span className="font-mono text-[11px] text-zinc-500">{allHosts ? w.allHosts : p.host}</span>
            </li>
          ))}
        </ul>
        <label className="flex items-start gap-2 text-xs text-zinc-300">
          <input type="checkbox" checked={allHosts} onChange={(e) => setAllHosts(e.target.checked)} className="mt-0.5" />
          <span>{w.applyAll} <span className="block text-[11px] text-amber-300/90">{w.applyAllWarn}</span></span>
        </label>
        <label className="block text-xs text-zinc-400">
          {w.reasonLabel}
          <textarea ref={first} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} placeholder={w.reasonPlaceholder} className={field} />
        </label>
        <label className="block text-xs text-zinc-400">
          {w.expiry}
          <select value={days} onChange={(e) => setDays(e.target.value)} className={field}>
            <option value="1">{w.expiry24h}</option>
            <option value="7">{w.expiry7d}</option>
            <option value="30">{w.expiry30d}</option>
            <option value="never">{w.expiryNever}</option>
          </select>
        </label>
        {result && (
          <p role={result.errors.length ? 'alert' : 'status'} className={`text-xs ${result.errors.length ? 'text-red-300' : 'text-emerald-300'}`}>
            {w.suppressResult(result.ok, result.errors[0] ?? '')}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-xs text-zinc-400 hover:text-zinc-100">{result && !result.errors.length ? w.done : w.cancel}</button>
        {!(result && !result.errors.length) && (
          <button type="button" className={primary} disabled={busy || reason.trim().length < 5} onClick={() => void submit()}>
            {busy ? w.saving : w.suppress}
          </button>
        )}
      </div>
    </ConsoleDialog>
  )
}

// ---- containment (kill_process) -------------------------------------------

// The engine's refusal codes read as sentences from the dictionary
// (alertActions.denials); an unknown code shows as the engine sent it.

function KillDialog({ alert, onClose }: { alert: SfAlert; onClose: () => void }) {
  const { events } = useEngine()
  const w = useI18n().dict.alertActions
  const id = useId()
  const first = useRef<HTMLInputElement>(null)
  const ev = events.find((e) => e.id === alert.event_id)
  const [pid, setPid] = useState(ev?.process?.pid ? String(ev.process.pid) : '')
  const [name, setName] = useState(ev?.process?.name ?? '')
  const [operator, setOperator] = useState('')
  const [token, setToken] = useState('')
  const [reason, setReason] = useState(w.killReason(alert.rule_name))
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit() {
    setBusy(true)
    const res = await killProcess({ host: alert.host, pid: Number(pid), process_name: name.trim(), operator: operator.trim(), reason: reason.trim(), rule_id: alert.rule_id, alert_id: alert.id }, token)
    setBusy(false)
    setToken('')
    if (res.ok) setOutcome({ ok: true, text: w.killDone(res.data.signal ?? 'SIGKILL', res.data.action_id) })
    else setOutcome({ ok: false, text: w.denials[res.error] ?? res.error })
  }

  const valid = Number(pid) > 1 && name.trim() && operator.trim() && token && reason.trim() && confirmed
  return (
    <ConsoleDialog open onClose={onClose} titleId={`${id}-t`} initialFocus={first}>
      <div className="border-b border-red-400/20 px-5 py-4">
        <h2 id={`${id}-t`} className="flex items-center gap-2 text-sm font-semibold text-red-200"><Skull size={16} aria-hidden /> {w.killTitle}</h2>
        <p className="mt-0.5 text-xs text-zinc-500">{w.killIntro}</p>
      </div>
      <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
        <label className="text-xs text-zinc-400">{w.hostLabel}<input value={alert.host} readOnly className={field + ' opacity-70'} /></label>
        <label className="text-xs text-zinc-400">PID<input ref={first} value={pid} onChange={(e) => setPid(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className={field} /></label>
        <label className="text-xs text-zinc-400 sm:col-span-2">{w.processLabel}<input value={name} onChange={(e) => setName(e.target.value)} className={field} /></label>
        <label className="text-xs text-zinc-400">{w.operatorLabel}<input value={operator} onChange={(e) => setOperator(e.target.value)} autoComplete="username" className={field} /></label>
        <label className="text-xs text-zinc-400">{w.credentialLabel}<input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="current-password" className={field} /></label>
        <label className="text-xs text-zinc-400 sm:col-span-2">{w.reasonShort}<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={512} className={field} /></label>
        <label className="flex items-start gap-2 text-xs text-zinc-300 sm:col-span-2">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
          {w.killConfirm}
        </label>
        {!ev && <p className="text-[11px] text-amber-300/90 sm:col-span-2">{w.eventGone}</p>}
        {outcome && <p role={outcome.ok ? 'status' : 'alert'} className={`text-xs sm:col-span-2 ${outcome.ok ? 'text-emerald-300' : 'text-red-300'}`}>{outcome.text}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-xs text-zinc-400 hover:text-zinc-100">{outcome?.ok ? w.done : w.cancel}</button>
        {!outcome?.ok && (
          <button type="button" disabled={!valid || busy} onClick={() => void submit()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-3.5 py-2 text-xs font-medium text-white hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Skull size={13} aria-hidden /> {busy ? w.sending : w.killSubmit}
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
  const w = useI18n().dict.alertActions
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
    setReports((r) => ({ ...r, [value]: w.querying }))
    const res = await lookupReputation(kind, value)
    setReports((r) => ({ ...r, [value]: res.ok ? res.data : res.error }))
  }

  return (
    <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-300"><Globe size={13} aria-hidden className="text-primary" /> {w.reputationTitle}</p>
      <ul className="mt-2 space-y-2">
        {indicators.map(({ kind, value }) => {
          const r = reports[value]
          return (
            <li key={value}>
              <div className="flex min-w-0 items-center gap-2">
                {kind === 'hash' && <span className="shrink-0 rounded bg-white/[0.06] px-1 text-[10px] text-zinc-400">SHA-256</span>}
                <span className="min-w-0 truncate font-mono text-xs text-zinc-200" title={value}>{value}</span>
                {!r && <button type="button" className={btn + ' ml-auto shrink-0 py-1'} onClick={() => void lookup(kind, value)}>{w.lookup}</button>}
                {typeof r === 'string' && <span className="ml-auto text-[11px] text-zinc-400">{r}</span>}
              </div>
              {r && typeof r !== 'string' && (
                <ul className="mt-1.5 space-y-1.5">
                  {r.results.map((res) => (
                    <li key={res.provider} className="text-[11px] text-zinc-400">
                      <span className="font-medium text-zinc-200">{res.provider === 'abuseipdb' ? 'AbuseIPDB' : 'VirusTotal'}</span>
                      {res.status !== 'ok' ? (
                        <span> · {res.status === 'not_found' ? w.noData : res.detail ?? res.status}</span>
                      ) : res.provider === 'abuseipdb' ? (
                        <span className="mt-1 flex items-center gap-2">
                          <Meter className="max-w-40 flex-1" value={res.score ?? 0} max={100} color={(res.score ?? 0) >= 75 ? 'var(--status-critical)' : (res.score ?? 0) >= 25 ? 'var(--status-warning)' : 'var(--status-good)'} />
                          <span className="tabular-nums text-zinc-200">{res.score}%</span> {w.abuse} · {w.reports(res.reports ?? 0)}{res.country ? ` · ${res.country}` : ''}
                        </span>
                      ) : (
                        <span> · <span className={res.malicious ? 'text-red-300' : 'text-zinc-200'}>{w.vtMalicious(res.malicious ?? 0)}</span> {w.of} {(res.malicious ?? 0) + (res.suspicious ?? 0) + (res.harmless ?? 0) + (res.undetected ?? 0)}{res.owner ? ` · ${res.owner}` : ''}</span>
                      )}
                      {res.link && <a href={res.link} target="_blank" rel="noreferrer noopener" className="ml-1 text-primary-link underline-offset-4 hover:underline">{w.view}</a>}
                    </li>
                  ))}
                  {r.cached && <li className="text-[10px] text-zinc-500">{w.cached}</li>}
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
