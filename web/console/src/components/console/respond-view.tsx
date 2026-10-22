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
import { CheckCircle, Crosshair, Lightning, LockKey, Prohibit, Scales, UserCircle, Warning } from '@phosphor-icons/react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useEngine } from './engine-provider'
import { useI18n } from './i18n-provider'
import { EmptyState, SectionHeader, MonoTag } from './ui-bits'
import { AuditExportButton } from './export-menu'
import { AnimatedItem } from '@/components/reactbits/animated-list'
import { ChartCard } from '@/components/charts/chart-frame'
import { BarList, Meter, SegmentBar } from '@/components/charts/bars'
import { topCounts } from '@/lib/soc-metrics'
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
  const { dict } = useI18n()

  return (
    <section aria-label={dict.respond.sectionAria}>
      <SectionHeader
        title={dict.respond.title}
        count={respondAudit?.records.length}
        hint={dict.respond.killHint}
      />

      <p className="max-w-[80ch] pb-4 text-xs leading-relaxed text-zinc-500">
        {dict.respond.introA}
        <span className="text-zinc-400">kill_process</span>
        {dict.respond.introB}
        <span className="text-emerald-300">{dict.respond.introExecuted}</span>
        {dict.respond.introOr}
        <span className="text-red-300">{dict.respond.introDenied}</span>
        {dict.respond.introC}
        <span className="text-zinc-400">{dict.respond.introBefore}</span>
        {dict.respond.introD}
      </p>

      {status !== 'live' && respondState === null ? (
        <div className="h-24 animate-pulse rounded bg-white/5" />
      ) : respondState === null ? (
        <EmptyState
          icon={LockKey}
          title={dict.respond.unavailableTitle}
          hint={dict.respond.unavailableHint}
        />
      ) : (
        <div className="space-y-5">
          <SurfaceCard state={respondState} />
          <AuditSummary />
          <AuditFeed />
        </div>
      )}
    </section>
  )
}

/** Flags + live counters + audit file health of the armed surface. */
function SurfaceCard({ state }: { state: SfRespondState }) {
  const { dict } = useI18n()
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
          <p className="text-sm font-medium text-zinc-100">{dict.respond.armedTitle}</p>
          <span className="ml-auto rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
            {dict.respond.signalFixed(state.signal)}
          </span>
        </div>
        <dl className="mt-3 space-y-2 text-xs">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-zinc-500">{dict.respond.operatorsLabel}</dt>
            <dd className="font-mono tabular-nums text-zinc-200">{state.operators_count}</dd>
          </div>
          {state.operators_path && (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-zinc-500">{dict.respond.allowlistLabel}</dt>
              <dd className="truncate font-mono text-[11px] text-zinc-400">{state.operators_path}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-zinc-500">{dict.respond.protectedLabel}</dt>
            <dd className="font-mono tabular-nums text-zinc-200">{state.protected_count}</dd>
          </div>
          {state.protected_path && (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-zinc-500">{dict.respond.protectedShort}</dt>
              <dd className="truncate font-mono text-[11px] text-zinc-400">{state.protected_path}</dd>
            </div>
          )}
        </dl>
        <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
          {dict.respond.countsNote}
        </p>
      </div>

      <div className="panel px-4 py-4">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-zinc-100">{dict.respond.auditTitle}</p>
          <span
            className={`ml-auto rounded border px-1.5 py-0.5 font-mono text-[10px] ${
              nearCeiling
                ? 'border-red-400/40 bg-red-400/10 text-red-300'
                : 'border-white/10 text-zinc-400'
            }`}
          >
            {dict.respond.ceilingPct(pct.toFixed(pct < 10 ? 1 : 0))}
          </span>
        </div>
        <Meter className="mt-3" value={state.audit_size} max={state.audit_ceiling} color={nearCeiling ? 'var(--status-critical)' : 'var(--series-1)'} />
        <dl className="mt-3 space-y-2 text-xs">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-zinc-500">{dict.respond.sizeLabel}</dt>
            <dd className="font-mono tabular-nums text-zinc-200">
              {formatBytes(state.audit_size)} / {formatBytes(state.audit_ceiling)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-zinc-500">{dict.respond.pathLabel}</dt>
            <dd className="truncate font-mono text-[11px] text-zinc-400">{state.audit_path}</dd>
          </div>
        </dl>
        {nearCeiling ? (
          <p className="mt-3 text-[11px] leading-relaxed text-red-300">
            {dict.respond.nearCeilingA}
            <span className="font-mono">audit_unavailable</span>
            {dict.respond.nearCeilingB}
          </p>
        ) : (
          <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
            {dict.respond.appendOnlyNote}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Audit window at a glance: decisions (executed / denied / followup),
 * denial codes and attempts per operator. Outcome colors are status
 * colors and always carry a label.
 */
function AuditSummary() {
  const { respondAudit } = useEngine()
  const { dict } = useI18n()
  const s = dict.respond.summary
  const records = respondAudit?.records ?? []
  if (records.length === 0) return null
  const executed = records.filter((r) => r.decision === 'executed' && !r.followup).length
  const followups = records.filter((r) => r.followup).length
  const denied = records.filter((r) => r.decision === 'denied' && !r.followup).length
  const codes = topCounts(records.filter((r) => r.decision === 'denied'), (r) => r.code || s.noCode, 5)
  const operators = topCounts(records, (r) => r.operator || s.noOperator, 5)
  const outcomes = [
    { key: 'executed', label: s.executed, value: executed, color: 'var(--status-good)', Icon: CheckCircle },
    { key: 'denied', label: s.denied, value: denied, color: 'var(--status-critical)', Icon: Prohibit },
    { key: 'followup', label: s.followups, value: followups, color: 'var(--status-warning)', Icon: Warning },
  ]
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ChartCard
        title={s.decisionsTitle}
        subtitle={s.decisionsSubtitle(records.length)}
        icon={Scales}
        table={{ caption: s.decisionsCaption, columns: [s.decisionCol, s.attemptsCol], rows: outcomes.map((o) => [o.label, o.value]) }}
      >
        <SegmentBar segments={outcomes} className="mt-1" />
        <ul className="mt-3 grid grid-cols-3 gap-2">
          {outcomes.map(({ key, label, value, color, Icon }) => (
            <li key={key} className="rounded-lg border border-zinc-800 px-2.5 py-2">
              <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                <Icon size={12} weight="fill" aria-hidden style={{ color }} />
                {label}
              </span>
              <span className="mt-0.5 block text-xl font-semibold text-zinc-50">{value}</span>
            </li>
          ))}
        </ul>
      </ChartCard>
      <ChartCard
        title={s.denialsTitle}
        subtitle={s.denialsSubtitle}
        icon={Prohibit}
        table={{ caption: s.denialsCaption, columns: [s.codeCol, s.attemptsCol], rows: codes.top.map((c) => [c.key, c.count]) }}
      >
        <BarList
          color="var(--status-critical)"
          rows={codes.top.map((c) => ({ key: c.key, label: <span className="font-mono">{c.key}</span>, value: c.count }))}
          empty={<p className="py-6 text-center text-xs text-zinc-500">{s.noDenials}</p>}
        />
      </ChartCard>
      <ChartCard
        title={s.operatorsTitle}
        subtitle={s.operatorsSubtitle}
        icon={UserCircle}
        table={{ caption: s.operatorsCaption, columns: [s.operatorCol, s.attemptsCol], rows: operators.top.map((o) => [o.key, o.count]) }}
      >
        <BarList rows={operators.top.map((o) => ({ key: o.key, label: o.key, value: o.count }))} />
      </ChartCard>
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
// the active lens (O4, cross-ref 04-B 19h45 §2.C). The words come from
// the dictionary (respond.summary) — same vocabulary as the summary.

function AuditFeed() {
  const { respondAudit, auditLimit, setAuditLimit } = useEngine()
  const { dict } = useI18n()
  const f = dict.respond.feed
  const s = dict.respond.summary
  const KIND_LABEL: Record<Exclude<AuditKindFilter, 'all'>, string> = {
    executed: s.executed,
    denied: s.denied,
    followup: s.followups,
  }
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
        title={f.recentTitle}
        count={visible.length}
        hint={filtering ? f.windowHint(records.length) : f.recentHint}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={kindFilter} onValueChange={setKindFilter}>
              <SelectTrigger
                className="h-8 w-[130px] rounded-md border-zinc-800 bg-zinc-900 font-mono text-xs"
                aria-label={f.classAria}
              >
                <SelectValue placeholder={f.classPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{f.all}</SelectItem>
                <SelectItem value="executed">{s.executed}</SelectItem>
                <SelectItem value="denied">{s.denied}</SelectItem>
                <SelectItem value="followup">{s.followups}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={String(auditLimit)} onValueChange={(v) => setAuditLimit(v === '500' ? 500 : 100)}>
              <SelectTrigger
                className="h-8 w-[110px] rounded-md border-zinc-800 bg-zinc-900 font-mono text-xs"
                aria-label={f.windowAria}
                title={f.windowTitle}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="100">{f.queue(100)}</SelectItem>
                <SelectItem value="500">{f.queue(500)}</SelectItem>
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
          {f.bookkeeping}{respondAudit.skipped > 0 && f.skippedLines(respondAudit.skipped)}
          {respondAudit.truncated && `${respondAudit.skipped > 0 ? ' ·' : ''}${f.olderOutside}`}
        </p>
      )}
      {records.length === 0 ? (
        <EmptyState
          icon={Crosshair}
          title={f.emptyTitle}
          hint={f.emptyHint}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Crosshair}
          title={f.classEmptyTitle}
          hint={f.classEmptyHint(records.length)}
          action={
            <Button
              variant="outline"
              size="sm"
              className="rounded-md border-zinc-800 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
              onClick={() => setKindFilter('all')}
            >
              {f.clearFilter}
            </Button>
          }
        />
      ) : (
        <ul className="panel divide-y divide-zinc-800/70 overflow-hidden">
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
  const { dict } = useI18n()
  const f = dict.respond.feed
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
            <span title={f.resolvedTitle}>
              <MonoTag>{f.realPrefix}{rec.resolved_name}</MonoTag>
            </span>
          )}
          {rec.code && (
            <span className="rounded border border-red-400/30 bg-red-400/10 px-1.5 py-0.5 font-mono text-[10px] text-red-300">
              {rec.code}
            </span>
          )}
          {rec.mechanism && (
            <span title={f.mechTitle}>
              <MonoTag>{rec.mechanism}</MonoTag>
            </span>
          )}
          {rec.mechanism === 'fallback' && rec.fallback_reason && (
            <span title={f.fallbackTitle}>
              <MonoTag>pidfd: {rec.fallback_reason}</MonoTag>
            </span>
          )}
          <span className="ml-auto font-mono text-[11px] tabular-nums text-zinc-500">{formatDateTime(rec.ts)}</span>
        </div>
        <p className="mt-1 pl-1 text-xs leading-relaxed text-zinc-400">
          {rec.reason}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-1 font-mono text-[11px] text-zinc-500">
          <span>{f.operatorPrefix}{rec.operator}</span>
          <span>{f.hostPrefix}{rec.host}</span>
          <span>{f.sourcePrefix}{rec.source}</span>
          {rec.rule_id && <span>{f.rulePrefix}{rec.rule_id}</span>}
          {rec.alert_id && <span>{f.alertPrefix}{rec.alert_id}</span>}
          <span title={f.actionTitle} className="truncate">
            {f.actionPrefix}{rec.action_id}
          </span>
        </p>
      </AnimatedItem>
    </li>
  )
}
