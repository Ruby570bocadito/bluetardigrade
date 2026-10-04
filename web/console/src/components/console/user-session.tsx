'use client'

// Who is using the console (GET /api/console/me) and, for
// administrators, the audit trail of console writes. The role only
// shapes the UI here; the engine proxy enforces it on every write.

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ArrowClockwise, Check, Eye, Prohibit, UserCircle, X } from '@phosphor-icons/react'
import { ConsoleDialog } from './console-dialog'
import {
  DEFAULT_ME,
  OUTCOME_TEXT,
  ROLE_TEXT,
  describeAction,
  fetchAudit,
  fetchMe,
  modeText,
  permissions,
  type ConsoleAuditEntry,
  type ConsoleMe,
} from '@/lib/console-user'

const Ctx = createContext<ConsoleMe>(DEFAULT_ME)

export function ConsoleUserProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<ConsoleMe>(DEFAULT_ME)
  useEffect(() => {
    let alive = true
    void fetchMe().then((next) => { if (alive && next) setMe(next) })
    return () => { alive = false }
  }, [])
  return <Ctx.Provider value={me}>{children}</Ctx.Provider>
}

export function useConsoleUser(): ConsoleMe {
  return useContext(Ctx)
}

const OUTCOME_CLASS: Record<ConsoleAuditEntry['outcome'], string> = {
  ok: 'text-emerald-300',
  error: 'text-amber-300',
  denied: 'text-rose-300',
}

function AuditTable() {
  const [state, setState] = useState<{ loading: boolean; entries: ConsoleAuditEntry[]; enabled: boolean; error: string }>({ loading: true, entries: [], enabled: true, error: '' })
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    const res = await fetchAudit(100)
    if (res.ok) setState({ loading: false, entries: res.entries, enabled: res.enabled, error: res.error ?? '' })
    else setState({ loading: false, entries: [], enabled: true, error: res.error })
  }, [])
  useEffect(() => { void load() }, [load])

  return (
    <section aria-labelledby="audit-title" className="mt-5">
      <div className="flex items-center justify-between gap-2">
        <h3 id="audit-title" className="text-sm font-medium text-zinc-100">Auditoría de la consola</h3>
        <button type="button" onClick={() => void load()} className="chip gap-1.5 px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowClockwise size={12} aria-hidden className={state.loading ? 'animate-spin motion-reduce:animate-none' : ''} /> Actualizar
        </button>
      </div>
      <p className="mt-0.5 text-[11px] text-zinc-500">Cada cambio enviado al motor desde la consola, permitido o denegado, con la cuenta que lo hizo. Lo más reciente primero.</p>
      {!state.enabled && <p className="mt-3 text-xs text-zinc-400">La auditoría está desactivada: define CONSOLE_AUDIT_FILE (el lanzador de Windows la guarda en data\console-audit.jsonl).</p>}
      {state.error && <p role="alert" className="mt-3 text-xs text-amber-300">{state.error}</p>}
      {state.enabled && !state.error && !state.loading && state.entries.length === 0 && <p className="mt-3 text-xs text-zinc-500">Todavía no hay cambios registrados.</p>}
      {state.entries.length > 0 && (
        <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-white/[0.06]">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
              <tr>
                <th scope="col" className="px-2 py-1.5 font-medium">Hora (UTC)</th>
                <th scope="col" className="px-2 py-1.5 font-medium">Cuenta</th>
                <th scope="col" className="px-2 py-1.5 font-medium">Acción</th>
                <th scope="col" className="px-2 py-1.5 font-medium">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {state.entries.map((e, i) => (
                <tr key={`${e.at}-${i}`} className="border-t border-white/[0.04] text-zinc-300">
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums text-zinc-400">{e.at.replace('T', ' ').slice(0, 19)}</td>
                  <td className="px-2 py-1.5">{e.user} <span className="text-zinc-500">· {ROLE_TEXT[e.role] ?? e.role}</span></td>
                  <td className="px-2 py-1.5" title={`${e.method} ${e.path}`}>{describeAction(e)}</td>
                  <td className={`whitespace-nowrap px-2 py-1.5 ${OUTCOME_CLASS[e.outcome] ?? ''}`}>{OUTCOME_TEXT[e.outcome] ?? e.outcome} <span className="text-zinc-500">({e.status})</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function UserChip() {
  const me = useConsoleUser()
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const descId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const viewer = me.role === 'viewer'
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Sesión: ${me.name}, ${ROLE_TEXT[me.role]}`}
        title={`${me.name} · ${ROLE_TEXT[me.role]}`}
        className="chip shrink-0 gap-1.5 whitespace-nowrap px-2.5 py-1.5 text-zinc-300 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {viewer ? <Eye size={15} aria-hidden className="text-zinc-400" /> : <UserCircle size={15} aria-hidden className="text-zinc-400" />}
        <span className="max-w-[9rem] truncate text-xs">{me.name}</span>
        <span className="hidden rounded bg-white/[0.06] px-1 text-[10px] text-zinc-400 sm:inline">{ROLE_TEXT[me.role]}</span>
      </button>
      <ConsoleDialog open={open} onClose={() => setOpen(false)} titleId={titleId} descriptionId={descId} initialFocus={closeRef} className="max-w-2xl">
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id={titleId} className="text-base font-semibold text-zinc-50">{me.name}</h2>
              <p id={descId} className="mt-0.5 text-xs text-zinc-400">{ROLE_TEXT[me.role]} · {modeText(me)}</p>
            </div>
            <button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label="Cerrar" className="rounded-md p-1 text-zinc-400 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X size={16} aria-hidden />
            </button>
          </div>
          <ul className="mt-4 space-y-1.5" aria-label="Permisos de tu rol">
            {permissions(me).map((p) => (
              <li key={p.label} className={`flex items-center gap-2 text-xs ${p.allowed ? 'text-zinc-200' : 'text-zinc-500'}`}>
                {p.allowed ? <Check size={13} aria-hidden className="text-emerald-400" /> : <Prohibit size={13} aria-hidden className="text-zinc-500" />}
                <span>{p.label}</span>
                <span className="sr-only">{p.allowed ? 'permitido' : 'no permitido'}</span>
              </li>
            ))}
          </ul>
          {me.mode === 'users' && <p className="mt-3 text-[11px] text-zinc-500">Tus cambios quedan firmados en el motor con tu nombre de cuenta.</p>}
          {me.role === 'admin' && <AuditTable />}
        </div>
      </ConsoleDialog>
    </>
  )
}

// ReadOnlyBanner tells a viewer, once, why write controls answer with
// an error.
export function ReadOnlyBanner() {
  const me = useConsoleUser()
  if (me.role !== 'viewer') return null
  return (
    <div role="status" className="border-b border-white/[0.06] bg-zinc-900/70 px-4 py-1.5 text-center text-[11px] text-zinc-400 lg:px-8">
      <Eye size={12} aria-hidden className="mr-1 inline align-[-2px]" /> Modo lectura: tu cuenta ({me.name}) puede consultar todo, pero no cambiar alertas, incidentes, supresiones ni lanzar respuesta.
    </div>
  )
}
