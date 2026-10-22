'use client'

import { observationSearch } from '@/lib/source-observation'

// Live telemetry stream. Rows enter with a short fade (feedback for new
// events, skipped while paused), the stream can be frozen for
// inspection and the whole buffer exports as JSONL/CSV. The type filter
// is derived from the types the engine actually delivered: no hardcoded
// inventories anywhere.

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ActivityIcon, Globe, MagnifyingGlass, Pause, Play, Pulse, Stack } from '@phosphor-icons/react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useEngine } from './engine-provider'
import { useI18n } from './i18n-provider'
import { EmptyState, LiveAnnouncer, SkeletonRows } from './ui-bits'
import { ActivityChart, useActivity } from './activity-chart'
import { ChartCard } from '@/components/charts/chart-frame'
import { BarList } from '@/components/charts/bars'
import { eventTypeMix, formatAgo, topCounts } from '@/lib/soc-metrics'
import { ExportButtons } from './export-menu'
import { SavedSearches } from './saved-searches'
import { eventSearchLens, searchForSavedLens, type SavedLens } from '@/lib/saved-searches'
import {
  currentSearch,
  feedTypeFromParam,
  readLensState,
  pushOperatorState,
  replaceOperatorState,
  writeFeedToSearch,
  MAX_QUERY_CHARS,
} from '@/lib/url-state'
import { eventDetail, formatTime, type SfEvent } from '@/lib/console-types'

export function LiveFeed() {
  const { events, status } = useEngine()
  const { dict, lang } = useI18n()
  const reduce = useReducedMotion()
  const [typeFilter, setTypeFilterState] = useState<string>('all')
  const [query, setQueryState] = useState('')
  const [paused, setPaused] = useState(false)
  const [frozen, setFrozen] = useState<SfEvent[]>([])
  const [announcement, setAnnouncement] = useState('')
  const knownTop = useRef<string | null>(null)

  // The feed lenses live in the URL (url-state.ts, ?tipo=&fq=): a hunt
  // survives a refresh and a filtered stream is a shareable link. Keys
  // are SEPARATE from the alerts queue's (?q) on purpose — lenses don't
  // contaminate each other across navigation. Read AFTER mount
  // (hydration-safe); the type select writes immediately, the query
  // debounces (250 ms, no replaceState thrash); popstate re-syncs both.
  const lensRef = useRef<{ tipo: string; fq: string }>({ tipo: 'all', fq: '' })
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const apply = () => {
      const lens = readLensState(currentSearch())
      lensRef.current = { tipo: lens.tipo, fq: lens.fq }
      setTypeFilterState(lens.tipo)
      setQueryState(lens.fq)
    }
    apply()
    window.addEventListener('popstate', apply)
    return () => {
      window.removeEventListener('popstate', apply)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const setTypeFilter = (next: string) => {
    const tipo = feedTypeFromParam(next)
    lensRef.current = { ...lensRef.current, tipo }
    setTypeFilterState(tipo)
    replaceOperatorState((search) => writeFeedToSearch(search, tipo, lensRef.current.fq))
  }
  const setQuery = (raw: string) => {
    const next = raw.slice(0, MAX_QUERY_CHARS)
    lensRef.current = { ...lensRef.current, fq: next }
    setQueryState(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(
      () => replaceOperatorState((search) => writeFeedToSearch(search, lensRef.current.tipo, lensRef.current.fq)),
      250,
    )
  }

  const applySaved = (lens: SavedLens) => {
    if (lens.kind !== 'events') return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    lensRef.current = { tipo: lens.eventType, fq: lens.q }
    setTypeFilterState(lens.eventType)
    setQueryState(lens.q)
    pushOperatorState((search) => searchForSavedLens(search, lens))
  }

  const source = paused ? frozen : events

  // Screen readers get one polite line per batch, not one per row.
  useEffect(() => {
    if (paused) return
    const top = events[0]
    if (!top) return
    if (knownTop.current === null) {
      knownTop.current = top.id
      return
    }
    if (knownTop.current !== top.id) {
      knownTop.current = top.id
      setAnnouncement(dict.feed.newEvent(top.type, top.host))
    }
  }, [events, paused, dict])

  const activity = useActivity(events)
  const mix = useMemo(() => eventTypeMix(events, 6), [events])
  const destinations = useMemo(
    () => topCounts(events.filter((e) => e.type === 'network.connect'), (e) => {
      const host = e.network?.domain || e.network?.destination_ip
      return host ? (e.network?.destination_port ? `${host}:${e.network.destination_port}` : host) : null
    }, 6),
    [events],
  )

  const types = useMemo(() => {
    const set = new Set<string>()
    for (const ev of events.slice(0, 160)) set.add(ev.type)
    return [...set].sort()
  }, [events])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = source.filter((e) => {
      if (typeFilter !== 'all' && e.type !== typeFilter) return false
      if (!q) return true
      const haystack = [
        e.id, e.type, e.source, e.host, e.user ?? '', eventDetail(e),
        e.process ? `pid ${e.process.pid}` : '',
        ...observationSearch(e.attributes, e.network),
      ].join(' ').toLowerCase()
      return haystack.includes(q)
    })
    return list
  }, [source, typeFilter, query])

  // Display window (unchanged): the header/footer numbers keep showing
  // the capped view; `filtered` stays uncapped so the export tooltip can
  // state exactly how much the active filter hides.
  const visible = filtered.slice(0, 80)

  // O4 honesty (export-menu): with a filter active, the export tooltips
  // declare that the bulk file ignores the lens — and how much it keeps.
  const filtering = typeFilter !== 'all' || query.trim() !== ''
  const activeFilterLabel =
    filtering
      ?
        [
          typeFilter !== 'all' ? dict.feed.typeLens(typeFilter) : null,
          query.trim() !== '' ? dict.feed.searchLens(query.trim()) : null,
        ]
          .filter(Boolean)
          .join(' + ') || undefined
      : undefined
  const hiddenByFilter = filtering ? source.length - filtered.length : undefined

  const togglePause = (on: boolean) => {
    if (on) setFrozen(events)
    setPaused(on)
  }

  return (
    <section aria-label={dict.feed.sectionAria} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <ChartCard
          className="lg:col-span-2"
          title={dict.feed.pace.title}
          subtitle={dict.feed.pace.subtitle}
          icon={Pulse}
          table={{
            caption: dict.feed.pace.caption,
            columns: [dict.feed.pace.intervalCol, dict.feed.pace.eventsCol],
            rows: activity.points.slice().reverse().map((p) => [formatAgo(activity.now - p.end, lang), p.value]),
          }}
          footer={
            <span className="flex flex-wrap gap-x-4">
              <span>{dict.feed.pace.peak} <span className="font-medium tabular-nums text-zinc-300">{activity.peak}</span> {dict.feed.pace.perInterval}</span>
              <span>{dict.feed.pace.total} <span className="font-medium tabular-nums text-zinc-300">{activity.total}</span> {dict.feed.pace.inWindow}</span>
              {paused && <span className="text-primary-link">{dict.feed.pace.pausedNote}</span>}
            </span>
          }
        >
          {status === 'down' ? (
            <EmptyState icon={ActivityIcon} title={dict.feed.pace.downTitle} hint={dict.feed.pace.downHint} />
          ) : (
            <ActivityChart activity={activity} height={150} />
          )}
        </ChartCard>
        <ChartCard
          title={dict.feed.types.title}
          subtitle={dict.feed.types.subtitle}
          icon={Stack}
          table={{ caption: dict.feed.types.caption, columns: [dict.feed.types.typeCol, dict.feed.pace.eventsCol], rows: mix.top.map((r) => [r.key, r.count]) }}
          footer={mix.rest > 0 ? dict.feed.types.restFooter(mix.rest, mix.distinct - mix.top.length) : undefined}
        >
          <BarList
            color="var(--series-2)"
            rows={mix.top.map((r) => ({
              key: r.key,
              label: <span className="font-mono">{r.key}</span>,
              value: r.count,
              onSelect: () => setTypeFilter(typeFilter === r.key ? 'all' : r.key),
              selectLabel: typeFilter === r.key ? dict.feed.types.filterOff(r.key) : dict.feed.types.filterOn(r.key, r.count),
            }))}
            empty={<EmptyState icon={ActivityIcon} title={dict.feed.types.emptyTitle} hint={dict.feed.types.emptyHint} />}
          />
        </ChartCard>
        <ChartCard
          title={dict.feed.destinations.title}
          subtitle={dict.feed.destinations.subtitle}
          icon={Globe}
          table={{ caption: dict.feed.destinations.caption, columns: [dict.feed.destinations.destCol, dict.feed.destinations.connCol], rows: destinations.top.map((r) => [r.key, r.count]) }}
          footer={destinations.rest > 0 ? dict.feed.destinations.restFooter(destinations.rest, destinations.distinct - destinations.top.length) : undefined}
        >
          <BarList
            color="var(--series-4)"
            rows={destinations.top.map((r) => ({
              key: r.key,
              label: <span className="font-mono">{r.key}</span>,
              value: r.count,
              onSelect: () => setQuery(query === r.key.replace(/:\d+$/, '') ? '' : r.key.replace(/:\d+$/, '')),
              selectLabel: dict.feed.destinations.searchOn(r.key, r.count),
            }))}
            empty={<EmptyState icon={Globe} title={dict.feed.destinations.emptyTitle} hint={dict.feed.destinations.emptyHint} />}
          />
        </ChartCard>
      </div>

      <div className="panel overflow-hidden">
        <div className="panel-head justify-between">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="text-sm font-medium text-zinc-100">{dict.feed.stream.title}</h2>
            <span className="text-xs tabular-nums text-zinc-500">{visible.length}</span>
            {paused && <span className="rounded bg-primary-tint/10 px-1.5 text-[11px] text-primary-link">{dict.feed.stream.pausedBadge}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <MagnifyingGlass
                size={13}
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setQuery('')
                }}
                placeholder={dict.feed.stream.searchPlaceholder}
                aria-label={dict.feed.stream.searchAria}
                maxLength={MAX_QUERY_CHARS}
                className="h-8 w-[220px] rounded-md border-zinc-800 bg-zinc-900 pl-7 text-xs text-zinc-200 placeholder:text-zinc-500"
              />
            </div>
            <label className="chip px-2.5 py-1.5 text-xs text-zinc-400">
              {paused ? <Play size={13} aria-hidden className="text-primary" /> : <Pause size={13} aria-hidden />}
              <span className="hidden sm:inline">{paused ? dict.feed.stream.resume : dict.feed.stream.pause}</span>
              <Switch checked={paused} onCheckedChange={togglePause} aria-label={dict.feed.stream.pauseAria} />
            </label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 w-[180px] rounded-md border-zinc-800 bg-zinc-900 font-mono text-xs" aria-label={dict.feed.stream.typeAria}>
                <SelectValue placeholder={dict.feed.stream.typePlaceholder} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{dict.feed.stream.allTypes}</SelectItem>
                {types.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
                {/* Honesty: a deep-linked type the buffer has not delivered
                    yet stays a visible, selectable lens instead of an
                    invisible value — the feed shows the real empty state. */}
                {typeFilter !== 'all' && !types.includes(typeFilter) && (
                  <SelectItem value={typeFilter}>{typeFilter}</SelectItem>
                )}
              </SelectContent>
            </Select>
            <ExportButtons kind="events" filterLabel={activeFilterLabel} hiddenCount={hiddenByFilter} />
          </div>
        </div>
        <div className="px-4 pt-3 [&>div]:mb-3">
          <SavedSearches kind="events" getLens={() => eventSearchLens(lensRef.current.tipo, lensRef.current.fq)} onApply={applySaved} />
        </div>
        <div className="max-h-[64vh] overflow-y-auto" tabIndex={0} aria-label={dict.feed.stream.resultsAria}>
          {status !== 'live' && source.length === 0 ? (
            <div className="px-4 py-8">
              <SkeletonRows rows={8} />
            </div>
          ) : source.length === 0 ? (
            <EmptyState
              icon={ActivityIcon}
              title={dict.feed.stream.waitingTitle}
              hint={dict.feed.stream.waitingHint}
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={MagnifyingGlass}
              title={dict.feed.stream.noResultsTitle}
              hint={dict.feed.stream.noResultsHint}
            />
          ) : (
            <table className="w-full table-fixed border-collapse text-left text-sm">
              <caption className="sr-only">{dict.feed.stream.caption}</caption>
              <thead className="sticky top-0 z-10">
                <tr className="bg-zinc-900">
                  <th scope="col" className="w-[92px] border-b border-zinc-800 py-2 pl-4 pr-3 text-[11px] font-medium uppercase tracking-wider text-zinc-500">{dict.feed.stream.colTime}</th>
                  <th scope="col" className="w-[150px] border-b border-zinc-800 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500 sm:w-[170px]">{dict.feed.stream.colType}</th>
                  <th scope="col" className="border-b border-zinc-800 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">{dict.feed.stream.colDetail}</th>
                  <th scope="col" className="hidden w-[80px] border-b border-zinc-800 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500 md:table-cell">PID</th>
                  <th scope="col" className="hidden w-[170px] border-b border-zinc-800 px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-zinc-500 md:table-cell">{dict.feed.stream.colHost}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {visible.map((ev) => (
                  <motion.tr
                    key={ev.id}
                    initial={reduce || paused ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                  >
                    <td className="whitespace-nowrap py-2 pl-4 pr-3 font-mono text-xs tabular-nums text-zinc-500">
                      {formatTime(ev.timestamp)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className="rounded border border-primary/20 bg-primary-tint/[0.08] px-1.5 py-0.5 font-mono text-[11px] text-primary-soft">{ev.type}</span>
                    </td>
                    <td className="max-w-0 px-3 py-2">
                      <span className="block truncate font-mono text-xs text-zinc-300" title={eventDetail(ev, lang)}>
                        {eventDetail(ev, lang)}
                      </span>
                    </td>
                    <td className="hidden px-3 py-2 font-mono text-xs tabular-nums text-zinc-500 md:table-cell">
                      {ev.process ? ev.process.pid : ''}
                    </td>
                    <td className="hidden truncate px-3 py-2 text-right font-mono text-xs text-zinc-500 md:table-cell">
                      {ev.host}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="flex items-center gap-1.5 border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-500">
          <ActivityIcon size={12} aria-hidden />
          {dict.feed.stream.windowShown(visible.length, source.length)}
        </p>
      </div>
      <LiveAnnouncer message={announcement} />
    </section>
  )
}
