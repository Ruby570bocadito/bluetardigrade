'use client'

// Inteligencia: the offline indicator lists the engine matches every
// event against (intel/*.txt|*.list, placed by the operator, re-read on
// change; the engine downloads nothing) and the per-host baseline of
// processes that flags what a machine never ran before. Read-only, like
// the rest of the detection content: the lists are files on the engine
// host.

import { useCallback, useEffect, useState } from 'react'
import { ArrowClockwise, Fingerprint, ListMagnifyingGlass, Sparkle, Timer } from '@phosphor-icons/react'
import { useEngine } from './engine-provider'
import { useI18n } from './i18n-provider'
import { EmptyState, SeverityBadge, StatTile } from './ui-bits'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeadRow, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateTime, formatTime } from '@/lib/console-types'
import { BASELINE_RULE_ID, fetchIntel, intelAlerts, kindBreakdown, learnText, listOfAlert, type IntelPayload } from '@/lib/intel'

const POLL_MS = 30_000

export function IntelView() {
  const { dict, lang } = useI18n()
  const { alerts } = useEngine()
  const [intel, setIntel] = useState<IntelPayload | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const res = await fetchIntel()
    setLoading(false)
    if (res.ok && res.data && Array.isArray(res.data.lists)) {
      setIntel(res.data)
      setError('')
    } else if (!res.ok) {
      setError(res.status === 404 ? dict.intel.notFound : res.error)
    }
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), POLL_MS)
    return () => clearInterval(t)
  }, [load])

  const recent = intelAlerts(alerts)
  const listHits = recent.filter((a) => a.rule_id !== BASELINE_RULE_ID).length
  const novelties = recent.length - listHits
  const baseline = intel?.baseline

  return (
    <section aria-label={dict.intel.sectionAria} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile icon={ListMagnifyingGlass} label={dict.intel.loadedLabel} value={intel?.total ?? '—'} hint={intel ? dict.intel.listsHint(intel.lists.length, intel.lists.length === 1 ? dict.intel.listWordOne : dict.intel.listWordMany, intel.dir || dict.intel.intelDir) : dict.intel.loading} />
        <StatTile icon={Fingerprint} label={dict.intel.hitsLabel} value={listHits} hint={dict.intel.hitsHint(alerts.length)} warn={listHits > 0} />
        <StatTile icon={Timer} label={dict.intel.baselineLabel} value={baseline?.hosts ?? '—'} hint={baseline ? (baseline.enabled ? dict.intel.baselineHintLearning(baseline.learning, learnText(baseline.learn_s, dict.intel.units)) : dict.intel.baselineDisabled) : dict.intel.loading} />
        <StatTile icon={Sparkle} label={dict.intel.noveltiesLabel} value={novelties} hint={dict.intel.noveltiesHint} />
      </div>

      <p className="max-w-[90ch] text-xs leading-relaxed text-zinc-500">
        {dict.intel.prose}
        <code className="rounded bg-white/[0.06] px-1 font-mono text-[11px] text-zinc-300">intel/</code>
        {dict.intel.proseTail}
      </p>

      {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}

      <div className="panel min-w-0">
        <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
          <h2 className="text-sm font-medium text-zinc-100">{dict.intel.listsTitle}</h2>
          <Button type="button" variant="ghost" size="sm" onClick={() => { setLoading(true); void load() }} className="h-7 gap-1.5 px-2 text-[11px] text-zinc-400 hover:text-zinc-100">
            <ArrowClockwise size={12} aria-hidden className={loading ? 'animate-spin motion-reduce:animate-none' : ''} /> {dict.intel.refresh}
          </Button>
        </div>
        {loading && !intel ? (
          <div className="m-4 h-16 animate-pulse rounded-lg bg-white/5" />
        ) : !intel || intel.lists.length === 0 ? (
          <EmptyState
            icon={ListMagnifyingGlass}
            title={intel && !intel.enabled ? dict.intel.disabledTitle : dict.intel.emptyTitle}
            hint={
              intel && !intel.enabled
                ? dict.intel.disabledHint
                : `${dict.intel.emptyHintA}${intel?.dir || dict.intel.intelDir}${dict.intel.emptyHintB}`
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[640px] text-xs">
              <TableCaption>{dict.intel.tableCaption}</TableCaption>
              <TableHeader>
                <TableHeadRow className="border-b-0">
                  <TableHead compact className="px-4 py-2">{dict.intel.cols.list}</TableHead>
                  <TableHead compact className="px-4 py-2">{dict.intel.cols.indicators}</TableHead>
                  <TableHead compact className="px-4 py-2">{dict.intel.cols.byKind}</TableHead>
                  <TableHead compact className="px-4 py-2">{dict.intel.cols.skipped}</TableHead>
                  <TableHead compact className="px-4 py-2">{dict.intel.cols.modified}</TableHead>
                </TableHeadRow>
              </TableHeader>
              <TableBody className="divide-white/[0.04]">
                {intel.lists.map((l) => (
                  <TableRow key={l.file} className="text-zinc-300">
                    <TableCell className="px-4 py-2">
                      <span className="font-medium text-zinc-100">{l.name}</span>
                      <span className="ml-2 font-mono text-[10px] text-zinc-500">{l.file}</span>
                    </TableCell>
                    <TableCell className="px-4 py-2 tabular-nums">{l.indicators.toLocaleString('es-ES')}</TableCell>
                    <TableCell className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {kindBreakdown(l, dict.intel.kindLabels).map((k) => (
                          <span key={k.kind} className="rounded-md border border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                            {k.label} <span className="tabular-nums text-zinc-200">{k.count.toLocaleString('es-ES')}</span>
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className={`px-4 py-2 tabular-nums ${l.skipped > 0 ? 'text-amber-300' : 'text-zinc-500'}`} title={l.skipped > 0 ? dict.intel.skippedTitle : undefined}>
                      {l.skipped}
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-4 py-2 text-zinc-500">{formatDateTime(l.modified, lang)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="panel min-w-0">
        <h2 className="border-b border-white/[0.06] px-4 py-3 text-sm font-medium text-zinc-100">{dict.intel.recentTitle}</h2>
        {recent.length === 0 ? (
          <EmptyState icon={Fingerprint} title={dict.intel.recentEmptyTitle} hint={dict.intel.recentEmptyHint} />
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {recent.map((a, i) => {
              const list = listOfAlert(a)
              return (
                <li key={(a.id ?? a.event_id) + i} className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs">
                  <SeverityBadge severity={a.severity} />
                  <span className="rounded-md border border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{list ? dict.intel.listTag(list) : dict.intel.baselineTag}</span>
                  <span className="min-w-0 flex-1 truncate text-zinc-200" title={a.summary}>{a.summary}</span>
                  <span className="font-mono text-[11px] text-zinc-500">{a.host}</span>
                  <span className="text-[11px] tabular-nums text-zinc-500">{formatTime(a.timestamp, lang)}</span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
