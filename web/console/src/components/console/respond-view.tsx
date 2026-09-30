'use client'

// Active response view (C3 console visibility, 02-B): the armed state
// of the kill surface (flags, live allowlist counts, audit file health)
// and the tail of the audit JSONL — executed AND denied attempts,
// newest first. Everything reads from the engine's read surface
// (GET /api/respond/state + /api/respond/audit via the same-origin
// proxy); a disarmed engine answers a real 404 and this view shows a
// real "no disponible": the §2.1 contract reaches the console intact.
// Read-only by design: the kill is invoked through POST
// /api/respond/kill by an operator (R8), never from the console UI.

import { useEffect, useMemo, useState } from 'react'
import { Crosshair, Lightning, LockKey } from '@phosphor-icons/react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useEngine } from './engine-provider'
import { EmptyState, SectionHeader, MonoTag } from './ui-bits'
import { AuditExportButton } from './export-menu'
import { AnimatedItem } from '@/components/reactbits/animated-list'
import { formatDateTime, type SfRespondRecord, type SfRespondState } from '@/lib/console-types'
import {
  auditKindFromParam,
  currentSearch,
  readLensState,
  replaceOperatorState,
  writeAuditKindToSearch,
  type AuditKindFilter,
} from '@/lib/url-state'

function formatBytes(n: number): string {
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MiB`
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(1)} KiB`
  return `${n} B`
}

export function RespondView() {
  const { respondState, respondAudit, status } = useEngine()

  return (
    <section aria-label="Respuesta activa">
      <SectionHeader
        title="Respuesta activa"
        count={respondAudit?.records.length}
        hint="kill_process · iteración 1"
      />

      <p className="max-w-[80ch] pb-4 text-xs leading-relaxed text-zinc-500">
        La única acción activa del motor: <span className="text-zinc-400">kill_process</span> con SIGKILL fijo,
        invocada por un operador humano a través de la API (nunca por reglas ni automatismos). Cada intento —
        <span className="text-emerald-300"> ejecutado</span> o <span className="text-red-300">denegado</span>— queda
        en el audit JSONL <span className="text-zinc-400">antes</span> de la señal; esta vista es de solo lectura.
      </p>

      {status !== 'live' && respondState === null ? (
        <div className="h-24 animate-pulse rounded bg-white/5" />
      ) : respondState === null ? (
        <EmptyState
          icon={LockKey}
          title="Superficie no disponible"
          hint="El motor está corriendo sin -allow-kill (o sin token, o su archivo de audit no abrió): la ruta no existe para esta consola, igual que para cualquier sonda. Arranca el motor con -allow-kill, -respond-operators y -respond-audit para armarla."
        />
      ) : (
        <div className="space-y-6">
          <SurfaceCard state={respondState} />
          <AuditFeed />
        </div>
      )}
    </section>
  )
}

/** Flags + live counters + audit file health of the armed surface. */
function SurfaceCard({ state }: { state: SfRespondState }) {
  const pct = state.audit_ceiling > 0 ? Math.min(100, (state.audit_size / state.audit_ceiling) * 100) : 0
  const nearCeiling = pct >= 80
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="panel px-4 py-4">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex h-6 w-6 items-center justify-center rounded-md border border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
          >
            <Lightning size={13} weight="fill" />
          </span>
          <p className="text-sm font-medium text-zinc-100">Superficie armada</p>
          <span className="ml-auto rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
            {state.signal} fijo
          </span>
        </div>
        <dl className="mt-3 space-y-2 text-xs">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-zinc-500">Operadores en allowlist</dt>
            <dd className="font-mono tabular-nums text-zinc-200">{state.operators_count}</dd>
          </div>
          {state.operators_path && (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-zinc-500">allowlist</dt>
              <dd className="truncate font-mono text-[11px] text-zinc-400">{state.operators_path}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-zinc-500">Procesos protegidos (fichero)</dt>
            <dd className="font-mono tabular-nums text-zinc-200">{state.protected_count}</dd>
          </div>
          {state.protected_path && (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-zinc-500">protegidos</dt>
              <dd className="truncate font-mono text-[11px] text-zinc-400">{state.protected_path}</dd>
            </div>
          )}
        </dl>
        <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
          Los recuentos son vivos: el motor recarga allowlist y protegidos cada 15 s. Los valores por defecto de
          plataforma se aplican en el momento de la comprobación.
        </p>
      </div>

      <div className="panel px-4 py-4">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-zinc-100">Archivo de audit</p>
          <span
            className={`ml-auto rounded border px-1.5 py-0.5 font-mono text-[10px] ${
              nearCeiling
                ? 'border-red-400/40 bg-red-400/10 text-red-300'
                : 'border-white/10 text-zinc-400'
            }`}
          >
            {pct.toFixed(pct < 10 ? 1 : 0)}% del techo
          </span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800" role="presentation">
          <div
            className={`h-full rounded-full ${nearCeiling ? 'bg-red-500' : 'bg-emerald-500'}`}
            style={{ width: `${Math.max(pct, 1.5)}%` }}
          />
        </div>
        <dl className="mt-3 space-y-2 text-xs">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-zinc-500">Tamaño / techo</dt>
            <dd className="font-mono tabular-nums text-zinc-200">
              {formatBytes(state.audit_size)} / {formatBytes(state.audit_ceiling)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-zinc-500">ruta</dt>
            <dd className="truncate font-mono text-[11px] text-zinc-400">{state.audit_path}</dd>
          </div>
        </dl>
        {nearCeiling ? (
          <p className="mt-3 text-[11px] leading-relaxed text-red-300">
            Cerca del techo de 64 MiB: cada acción denegará con <span className="font-mono">audit_unavailable</span>{' '}
            hasta que el operador rote el archivo (append-only, nunca se trunca).
          </p>
        ) : (
          <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
            Append-only con fsync por línea: la prueba de cada acción vive aquí, y la rotación es tarea del
            operador.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Audit tail: executed AND denied attempts, newest first, with a class
 * filter, an operator-controlled window (100/500) and a client-side
 * JSONL export of the visible tail.
 */

// Class of attempt for the queue filter: the two decisions the audit
// records plus the followup line (denied by construction — the signal
// failed after the commit). The vocabulary lives in url-state.ts (the
// URL contract is its single source of truth; the view imports it).

// Human labels of the filter classes, handed to the export tooltip so
// it can state that the JSONL export is the WHOLE window regardless of
// the active lens (O4, cross-ref 04-B 19h45 §2.C).
const KIND_LABEL: Record<Exclude<AuditKindFilter, 'all'>, string> = {
  executed: 'ejecutados',
  denied: 'denegados',
  followup: 'followups',
}

function AuditFeed() {
  const { respondAudit, auditLimit, setAuditLimit } = useEngine()
  const [kindFilter, setKindFilterState] = useState<AuditKindFilter>('all')
  const records = respondAudit?.records ?? []

  // The audit lens lives in the URL (url-state.ts, ?clase=): a forensic
  // review of denials survives a refresh and a filtered queue is a
  // shareable link. Read AFTER mount (hydration-safe, like the shell
  // view); the select writes immediately (replaceState, no history
  // spam); popstate re-syncs.
  useEffect(() => {
    const apply = () => setKindFilterState(readLensState(currentSearch()).clase)
    apply()
    window.addEventListener('popstate', apply)
    return () => window.removeEventListener('popstate', apply)
  }, [])

  const setKindFilter = (next: string) => {
    const clase = auditKindFromParam(next)
    setKindFilterState(clase)
    replaceOperatorState((search) => writeAuditKindToSearch(search, clase))
  }

  const visible = useMemo(() => {
    if (kindFilter === 'all') return records
    if (kindFilter === 'followup') return records.filter((r) => r.followup === true)
    return records.filter((r) => r.decision === kindFilter)
  }, [records, kindFilter])
  const filtering = kindFilter !== 'all'

  return (
    <div>
      <SectionHeader
        title="Intentos recientes"
        count={visible.length}
        hint={filtering ? `de ${records.length} en la ventana` : 'más recientes primero'}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={kindFilter} onValueChange={setKindFilter}>
              <SelectTrigger
                className="h-8 w-[130px] rounded-md border-zinc-800 bg-zinc-900 font-mono text-xs"
                aria-label="Filtrar la cola del audit por clase de intento"
              >
                <SelectValue placeholder="Clase" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">todas</SelectItem>
                <SelectItem value="executed">ejecutados</SelectItem>
                <SelectItem value="denied">denegados</SelectItem>
                <SelectItem value="followup">followups</SelectItem>
              </SelectContent>
            </Select>
            <Select value={String(auditLimit)} onValueChange={(v) => setAuditLimit(v === '500' ? 500 : 100)}>
              <SelectTrigger
                className="h-8 w-[110px] rounded-md border-zinc-800 bg-zinc-900 font-mono text-xs"
                aria-label="Tamaño de la ventana de la cola del audit"
                title="El motor satura en 500; el tamaño aplica en el siguiente sondeo (2 s)"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="100">cola 100</SelectItem>
                <SelectItem value="500">cola 500</SelectItem>
              </SelectContent>
            </Select>
            <AuditExportButton
              audit={respondAudit}
              filterLabel={kindFilter === 'all' ? undefined : KIND_LABEL[kindFilter]}
              hiddenCount={kindFilter === 'all' ? undefined : records.length - visible.length}
            />
          </div>
        }
      />
      {respondAudit && (respondAudit.skipped > 0 || respondAudit.truncated) && (
        <p className="pb-2 font-mono text-[11px] text-zinc-500">
          bookkeeping del barrido:{respondAudit.skipped > 0 && ` ${respondAudit.skipped} línea(s) incompleta(s) omitida(s)`}
          {respondAudit.truncated && `${respondAudit.skipped > 0 ? ' ·' : ''} hay registros más antiguos fuera de la ventana`}
        </p>
      )}
      {records.length === 0 ? (
        <EmptyState
          icon={Crosshair}
          title="Ningún intento registrado"
          hint="La superficie está armada pero nadie ha invocado kill_process todavía: ni ejecuciones ni denegaciones en la cola del audit."
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Crosshair}
          title="Ningún intento de esa clase"
          hint={`El filtro actual no coincide con ninguno de los ${records.length} intentos de la ventana.`}
          action={
            <Button
              variant="outline"
              size="sm"
              className="rounded-md border-zinc-800 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
              onClick={() => setKindFilter('all')}
            >
              Quitar filtro
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-white/[0.06] border-y border-white/[0.08]">
          {visible.map((r, i) => (
            // Composite key WITHOUT the index (F3, cross-ref 04-B 20h04 §2
            // + 20h43 class sweep): the kill flow writes TWO JSONL lines
            // with the SAME action_id when the signal fails after the
            // commit — the pre-signal line and the followup line — so the
            // class disambiguates the pair. Uniqueness holds by source
            // invariants: every attempt mints its own 128-bit crypto/rand
            // action_id (respond.go:263, audit.go:174-175), and the only
            // same-action_id pair is pre-signal (followup absent) +
            // followup (respond.go:313-337), separated by the 'p'/'f'
            // suffix. Index-free means the key is stable across polls:
            // rows mount and animate only when genuinely new, instead of
            // remounting the whole list as the newest-first tail shifts.
            <AttemptRow key={`${r.action_id}:${r.followup ? 'f' : 'p'}`} index={i} rec={r} />
          ))}
        </ul>
      )}
    </div>
  )
}

function AttemptRow({ index, rec }: { index: number; rec: SfRespondRecord }) {
  const executed = rec.decision === 'executed'
  return (
    <li>
      <AnimatedItem index={index} className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
              executed
                ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                : 'border-red-400/40 bg-red-400/10 text-red-300'
            }`}
          >
            {rec.decision}
          </span>
          {rec.followup && (
            <span className="rounded border border-amber-300/30 bg-amber-300/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">
              followup
            </span>
          )}
          <span className="font-mono text-sm text-zinc-100">
            {rec.process_name}
            <span className="text-zinc-500"> · pid {rec.pid}</span>
          </span>
          {rec.resolved_name && rec.resolved_name !== rec.process_name && (
            <span title="nombre real resuelto por la plataforma (R5a/O1)">
              <MonoTag>real: {rec.resolved_name}</MonoTag>
            </span>
          )}
          {rec.code && (
            <span className="rounded border border-red-400/30 bg-red-400/10 px-1.5 py-0.5 font-mono text-[10px] text-red-300">
              {rec.code}
            </span>
          )}
          {rec.mechanism && (
            <span title="mecanismo de señalización (R1)">
              <MonoTag>{rec.mechanism}</MonoTag>
            </span>
          )}
          {rec.mechanism === 'fallback' && rec.fallback_reason && (
            <span title="causa de la apertura fallida de pidfd (R7b): enosys = kernel sin pidfd (permanente y esperado); emfile/enfile = exhaustion transitoria de descriptores (alarmable); resto, errnos de la misma familia">
              <MonoTag>pidfd: {rec.fallback_reason}</MonoTag>
            </span>
          )}
          <span className="ml-auto font-mono text-[11px] tabular-nums text-zinc-500">{formatDateTime(rec.ts)}</span>
        </div>
        <p className="mt-1 pl-1 text-xs leading-relaxed text-zinc-400">
          {rec.reason}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-1 font-mono text-[11px] text-zinc-500">
          <span>operador: {rec.operator}</span>
          <span>host: {rec.host}</span>
          <span>origen: {rec.source}</span>
          {rec.rule_id && <span>regla: {rec.rule_id}</span>}
          {rec.alert_id && <span>alerta: {rec.alert_id}</span>}
          <span title="id compartido con la respuesta de la API y la línea del audit" className="truncate">
            acción: {rec.action_id}
          </span>
        </p>
      </AnimatedItem>
    </li>
  )
}
