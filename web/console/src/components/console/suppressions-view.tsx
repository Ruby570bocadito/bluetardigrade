'use client'

// Operator allowlist view (read-only, mirrors GET /api/suppressions via
// the hub). Suppressed rule/host pairs raise no alert, so they are easy
// to forget: this view makes the "holes" in the alert queue visible and
// states plainly that editing happens in suppressions.yaml (hot-reloaded
// by the engine every 15 s) - there is no write API by design.

import { useEffect, useState } from 'react'
import { Prohibit, Timer, Warning } from '@phosphor-icons/react'
import { useEngine } from './engine-provider'
import { useI18n } from './i18n-provider'
import { EmptyState, StatTile } from './ui-bits'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeadRow, TableHeader, TableRow } from '@/components/ui/table'
import type { SfSuppression } from '@/lib/console-types'

/** Re-renders every 30 s so the expiry countdowns stay truthful. */
function useSlowTick() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])
}

function countdown(iso: string | undefined, now: Date, words: { expired: string; expiresIn: (rest: string) => string }): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const ms = t - now.getTime()
  if (ms <= 0) return words.expired
  const min = Math.floor(ms / 60_000)
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  if (d > 0) return words.expiresIn(`${d}d ${h}h`)
  if (h > 0) return words.expiresIn(`${h}h ${m}m`)
  return words.expiresIn(`${m}m`)
}

export function SuppressionsView() {
  const { dict } = useI18n()
  const { suppressions, rules, status } = useEngine()
  useSlowTick()
  const now = new Date()

  const ruleName = (id: string) => rules.find((r) => r.id === id)?.name
  const withExpiry = suppressions.filter((s) => s.expires).length
  const expired = suppressions.filter((s) => countdown(s.expires, now, dict.suppressions) === dict.suppressions.expired).length
  const broad = suppressions.filter((s) => !s.host || !s.rule_id).length

  return (
    <section aria-label={dict.suppressions.sectionAria} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile icon={Prohibit} label={dict.suppressions.activeLabel} value={suppressions.length} hint={dict.suppressions.activeHint} />
        <StatTile icon={Timer} label={dict.suppressions.expiringLabel} value={withExpiry} hint={dict.suppressions.expiringHint(expired)} warn={expired > 0} />
        <StatTile icon={Warning} label={dict.suppressions.broadLabel} value={broad} hint={dict.suppressions.broadHint} warn={broad > 0} />
      </div>

      <p className="max-w-[90ch] text-xs leading-relaxed text-zinc-500">
        {dict.suppressions.proseA}<span className="text-zinc-300">{dict.suppressions.proseBold}</span>{dict.suppressions.proseB}
        <code className="rounded bg-white/[0.06] px-1 font-mono text-[11px] text-zinc-300">suppressions.yaml</code>
        {dict.suppressions.proseC}
      </p>

      {status !== 'live' && suppressions.length === 0 ? (
        <div className="panel px-4 py-6">
          <div className="h-24 animate-pulse rounded bg-white/5" />
        </div>
      ) : suppressions.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={Prohibit}
            title={dict.suppressions.emptyTitle}
            hint={dict.suppressions.emptyHint}
          />
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableCaption>{dict.suppressions.tableCaption}</TableCaption>
              <TableHeader>
                <TableHeadRow>
                  {[dict.suppressions.cols.rule, dict.suppressions.cols.scope, dict.suppressions.cols.reason, dict.suppressions.cols.expiry].map((h) => (
                    <TableHead key={h}>{h}</TableHead>
                  ))}
                </TableHeadRow>
              </TableHeader>
              <TableBody>
                {suppressions.map((s, i) => (
                  <SuppressionRow key={`${s.rule_id}:${s.host ?? '*'}:${i}`} entry={s} ruleName={ruleName(s.rule_id)} now={now} />
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </section>
  )
}

function SuppressionRow({ entry, ruleName, now }: { entry: SfSuppression; ruleName?: string; now: Date }) {
  const { dict } = useI18n()
  const left = countdown(entry.expires, now, dict.suppressions)
  return (
    <TableRow className="align-top">
      <TableCell className="max-w-[320px] px-4 py-3">
        <span className="flex items-center gap-2">
          <Prohibit size={14} weight="fill" aria-hidden className="shrink-0 text-zinc-500" />
          <span className="min-w-0">
            <span className="block truncate text-[13px] text-zinc-100">{ruleName ?? (entry.rule_id ? dict.suppressions.unloadedRule : dict.suppressions.allRules)}</span>
            {entry.rule_id && <span className="block truncate font-mono text-[11px] text-zinc-500">{entry.rule_id}</span>}
          </span>
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap px-4 py-3">
        <span
          className={`rounded-md border px-1.5 py-0.5 font-mono text-[11px] ${
            entry.host ? 'border-zinc-700 text-zinc-300' : 'border-amber-300/30 bg-amber-300/10 text-amber-200'
          }`}
        >
          {entry.host ? entry.host : dict.suppressions.allHosts}
        </span>
      </TableCell>
      <TableCell className="min-w-[220px] px-4 py-3 text-xs leading-relaxed text-zinc-400">{entry.reason || <span className="text-zinc-500">{dict.suppressions.noReason}</span>}</TableCell>
      <TableCell className="whitespace-nowrap px-4 py-3">
        {left ? (
          <span
            title={entry.expires}
            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${
              left === dict.suppressions.expired ? 'border-red-400/30 bg-red-400/10 text-red-300' : 'border-zinc-700 text-zinc-300'
            }`}
          >
            <Timer size={12} aria-hidden />
            {left}
          </span>
        ) : (
          <span className="text-[11px] text-zinc-500">{dict.suppressions.noExpiry}</span>
        )}
      </TableCell>
    </TableRow>
  )
}
