'use client'

// SIM-4 — detection-validation battery screen. Launch the lab battery
// (whole library or a selection), watch the run in flight (live progress
// polled from the engine), read the history and the pass-rate trend.
// The surface only exists on an engine started with -scenarios: a 501
// renders the honest «no armada» state with the engine's own hint —
// never a fake battery.

import { useCallback, useEffect, useState } from 'react'
import { BatteryCharging, CheckCircle, Warning, X } from '@phosphor-icons/react'
import { useEngine } from './engine-provider'
import { useI18n } from './i18n-provider'
import { EmptyState, SkeletonRows, StatTile } from './ui-bits'
import { LineChart, type LineSlot } from '@/components/charts/line-chart'
import { Meter } from '@/components/charts/bars'
import { readLensState, currentSearch, pushOperatorState, writeScenarioLensToSearch } from '@/lib/url-state'
import {
  detectedShare,
  fetchScenarioRun,
  fetchScenarioRuns,
  fetchScenarioSurface,
  launchScenarioRun,
  passRatePercent,
  scenarioTacticSlugs,
  type ScenarioLibrary,
  type ScenarioRun,
  type ScenarioSurface,
} from '@/lib/simulation'

import type { TacticSlug } from '@/lib/soc-metrics'

const POLL_RUNNING_MS = 2000
const RUN_HISTORY_LIMIT = 20

const primaryBtn =
  'inline-flex items-center gap-1.5 rounded-lg bg-primary-strong px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-primary-tint disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const RESULT_STYLE: Record<string, string> = {
  detected: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  missing: 'border-red-400/40 bg-red-400/10 text-red-300',
  catalog: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  error: 'border-red-400/40 bg-red-400/10 text-red-300',
}

export function ScenarioView({ onOpenRule }: { onOpenRule?: (id: string) => void }) {
  const { dict } = useI18n()
  const { rules, sequences } = useEngine()

  const [surface, setSurface] = useState<ScenarioSurface | null>(null)
  const [runs, setRuns] = useState<ScenarioRun[] | null>(null)
  // the run in flight, polled until the engine marks it completed
  const [live, setLive] = useState<ScenarioRun | null>(null)
  const [detail, setDetail] = useState<ScenarioRun | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [launching, setLaunching] = useState(false)

  // tactic filter lens (?sc=), written by the ATT&CK matrix (SIM-3)
  const [tacticFilter, setTacticFilter] = useState<TacticSlug | ''>('')
  useEffect(() => {
    setTacticFilter((readLensState(currentSearch()).sc || '') as TacticSlug | '')
  }, [])

  const loadRuns = useCallback(async () => {
    const res = await fetchScenarioRuns(RUN_HISTORY_LIMIT)
    if (!res.ok) return
    setRuns(res.data.runs)
    setLive((prev) => {
      if (!prev) return res.data.runs.find((run) => run.status === 'running') ?? null
      // a finished run stays on screen until the operator closes it; a
      // vanished in-flight run (engine restart lost the memory history)
      // is dropped instead of polled forever
      return prev.status === 'running'
        ? res.data.runs.find((run) => run.run_id === prev.run_id && run.status === 'running') ?? null
        : prev
    })
  }, [])

  const handleRunDone = useCallback(() => {
    void loadRuns()
  }, [loadRuns])

  // one library call (the engine reloads it from disk per request);
  // the history poll keeps the «en curso» state honest
  useEffect(() => {
    let alive = true
    fetchScenarioSurface().then((s) => {
      if (!alive) return
      setSurface(s)
      if (s.state === 'armed') void loadRuns()
    })
    return () => {
      alive = false
    }
  }, [loadRuns])

  // live progress of an in-flight run
  useEffect(() => {
    if (!live || live.status !== 'running') return
    let alive = true
    const timer = setInterval(async () => {
      const res = await fetchScenarioRun(live.run_id)
      if (!alive || !res.ok) return
      setLive(res.data)
      if (res.data.status !== 'running') void loadRuns()
    }, POLL_RUNNING_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [live, loadRuns])

  const openRunDetail = async (runId: string) => {
    setNotice(null)
    const res = await fetchScenarioRun(runId)
    if (!res.ok) return setNotice({ ok: false, text: dict.validation.readError(res.error) })
    setDetail(res.data)
  }

  const launch = async (only?: string[]) => {
    setLaunching(true)
    setNotice(null)
    const res = await launchScenarioRun(only)
    setLaunching(false)
    if (!res.ok) {
      setNotice(
        res.status === 409
          ? { ok: false, text: dict.validation.conflictNotice }
          : res.status === 501
            ? { ok: false, text: dict.validation.unarmedNotice }
            : { ok: false, text: res.error },
      )
      return
    }
    setLive(res.data)
    setDetail(null)
    void loadRuns()
  }

  if (!surface) {
    return (
      <section aria-label={dict.validation.sectionAria} className="panel px-4 py-6">
        <SkeletonRows rows={4} />
      </section>
    )
  }

  if (surface.state !== 'armed') {
    return (
      <section aria-label={dict.validation.sectionAria} className="panel px-4 py-6">
        <EmptyState
          icon={BatteryCharging}
          title={surface.state === 'unarmed' ? dict.validation.unarmedTitle : dict.validation.unavailableTitle}
          hint={
            surface.state === 'unarmed'
              ? `${surface.hint}${dict.validation.unarmedHintB}`
              : dict.validation.downHint
          }
        />
      </section>
    )
  }

  const library = surface.library
  const filtered = tacticFilter
    ? library.scenarios.filter((s) => scenarioTacticSlugs(s, rules, sequences).has(tacticFilter))
    : library.scenarios
  const lastCompleted = runs?.find((r) => r.status === 'completed') ?? null
  const trend = (runs ?? []).filter((r) => r.status === 'completed').slice().reverse()

  return (
    <section aria-label={dict.validation.sectionAria} className="space-y-4">
      <p className="max-w-[100ch] text-xs leading-relaxed text-zinc-500">
        {dict.validation.proseA}<span className="text-zinc-300">{dict.validation.proseSynthetic}</span>{dict.validation.proseB}<code className="rounded bg-white/[0.06] px-1 font-mono text-[11px] text-zinc-300">LAB-SIM-*</code>{dict.validation.proseC}
        <code className="rounded bg-white/[0.06] px-1 font-mono text-[11px] text-zinc-300">{library.dir}</code>.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile icon={BatteryCharging} label={dict.validation.loadedLabel} value={library.count} hint={dict.validation.loadedHint} />
        <StatTile
          icon={CheckCircle}
          label={dict.validation.lastLabel}
          value={lastCompleted ? passRatePercent(lastCompleted.pass_rate) : dict.validation.noData}
          hint={lastCompleted ? dict.validation.lastHint(lastCompleted.detected, lastCompleted.total, detectedShare(lastCompleted)) : dict.validation.lastEmptyHint}
        />
        <StatTile
          icon={Warning}
          label={dict.validation.liveLabel}
          value={live?.status === 'running' ? dict.validation.yes : dict.validation.no}
          hint={live?.status === 'running' ? dict.validation.runningHint(live.run_id) : live ? dict.validation.doneHint(live.run_id) : dict.validation.idleHint}
          warn={live?.status === 'running'}
        />
      </div>

      {tacticFilter && (
        <p className="flex items-center gap-2 text-xs text-zinc-400">
          {dict.validation.filterA}<span className="font-mono text-zinc-200">{tacticFilter}</span>{dict.validation.filterB}{filtered.length}{dict.validation.filterC}{library.count}{dict.validation.filterD}
          <button
            type="button"
            onClick={() => {
              setTacticFilter('')
              pushOperatorState((search) => writeScenarioLensToSearch(search, ''))
            }}
            className="inline-flex items-center gap-1 rounded text-primary-link underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={12} aria-hidden /> {dict.validation.clearFilter}
          </button>
        </p>
      )}

      {notice && (
        <p role={notice.ok ? 'status' : 'alert'} className={`text-xs ${notice.ok ? 'text-emerald-300' : 'text-red-300'}`}>
          {notice.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={primaryBtn} disabled={launching || live?.status === 'running' || filtered.length === 0} onClick={() => void launch(tacticFilter ? filtered.map((s) => s.id) : undefined)}>
          {launching ? dict.validation.launching : filtered.length < library.count ? dict.validation.launchFiltered(filtered.length) : dict.validation.launchAll}
        </button>
        {selected.size > 0 && (
          <button type="button" className="chip px-3 py-2 text-xs text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={launching || live?.status === 'running'} onClick={() => void launch([...selected])}>
            {dict.validation.launchSelection(selected.size)}
          </button>
        )}
        {live?.status === 'running' && <span className="text-xs text-amber-200">{dict.validation.liveNotice(live.run_id)}</span>}
      </div>

      {live && <LiveRunPanel run={live} onClose={() => setLive(null)} onDone={handleRunDone} />}

      {/* Tendencia: pass rate of the last completed runs, oldest first. */}
      <div className="panel px-4 pb-3 pt-3.5">
        <div className="flex flex-wrap items-baseline gap-2 pb-2">
          <h2 className="text-sm font-medium text-zinc-100">{dict.validation.trend.title}</h2>
          <span className="text-xs text-zinc-500">{dict.validation.trend.subtitle(trend.length)}</span>
        </div>
        {!runs ? (
          <SkeletonRows rows={3} />
        ) : trend.length >= 2 ? (
          <LineChart
            series={[{ key: 'pass', label: dict.validation.trend.series, color: 'var(--series-2)' }]}
            slots={trend.map((run): LineSlot => ({ t: Date.parse(run.started_at), values: { pass: Math.round(run.pass_rate * 1000) / 10 } }))}
            height={180}
            ariaLabel={dict.validation.trend.aria(trend.length, passRatePercent(trend[0].pass_rate), passRatePercent(trend[trend.length - 1].pass_rate))}
            valueLabel={dict.validation.trend.valueLabel}
            formatT={(t) => new Date(t).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}
          />
        ) : (
          <EmptyState icon={BatteryCharging} title={dict.validation.trend.emptyTitle} hint={dict.validation.trend.emptyHint} />
        )}
      </div>

      {/* Historial */}
      <div className="panel overflow-hidden">
        <div className="flex items-baseline gap-2 px-4 pt-3.5 pb-2">
          <h2 className="text-sm font-medium text-zinc-100">{dict.validation.history.title}</h2>
          <span className="text-xs text-zinc-500">{dict.validation.history.subtitle(runs?.length ?? 0)}</span>
        </div>
        {!runs ? (
          <div className="px-4 pb-4"><SkeletonRows rows={3} /></div>
        ) : runs.length === 0 ? (
          <div className="px-4 pb-4">
            <EmptyState icon={BatteryCharging} title={dict.validation.history.emptyTitle} hint={dict.validation.history.emptyHint} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">{dict.validation.history.caption}</caption>
              <thead>
                <tr className="bg-zinc-900">
                  {[dict.validation.history.cols.started, dict.validation.history.cols.state, dict.validation.history.cols.detected, dict.validation.history.cols.missing, dict.validation.history.cols.catalog, dict.validation.history.cols.errors, dict.validation.history.cols.duration, dict.validation.history.cols.rate].map((h) => (
                    <th key={h} scope="col" className="border-b border-zinc-800 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {runs.map((run) => (
                  <tr
                    key={run.run_id}
                    onClick={() => void openRunDetail(run.run_id)}
                    className="cursor-pointer transition-colors hover:bg-zinc-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        void openRunDetail(run.run_id)
                      }
                    }}
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-zinc-300">{run.started_at.replace('T', ' ').slice(0, 19)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <span className={`rounded-md border px-1.5 py-0.5 text-[11px] ${run.status === 'running' ? 'border-amber-400/30 bg-amber-400/10 text-amber-200' : 'border-zinc-700 text-zinc-300'}`}>
                        {run.status === 'running' ? dict.validation.history.running : dict.validation.history.completed}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-emerald-300">{run.detected}</td>
                    <td className="px-4 py-2.5 tabular-nums text-zinc-300">{run.missing}</td>
                    <td className="px-4 py-2.5 tabular-nums text-zinc-400">{run.catalog_errors}</td>
                    <td className="px-4 py-2.5 tabular-nums text-zinc-400">{run.errors}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-zinc-400">{run.status === 'running' ? '—' : `${(run.duration_ms / 1000).toFixed(1)} s`}</td>
                    <td className="px-4 py-2.5 tabular-nums text-zinc-100">{run.status === 'running' ? '—' : passRatePercent(run.pass_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail && <RunDetail run={detail} onClose={() => setDetail(null)} onOpenRule={onOpenRule} />}

      <ScenarioList
        scenarios={filtered}
        filtered={Boolean(tacticFilter)}
        selected={selected}
        onToggle={(id) =>
          setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
          })
        }
      />
    </section>
  )
}

/** Progress of the run in flight: totals plus the results as each
 * scenario finishes (the engine serves them incrementally). */
function LiveRunPanel({ run, onClose, onDone }: { run: ScenarioRun; onClose: () => void; onDone: () => void }) {
  const { dict } = useI18n()
  const done = run.detected + run.missing + run.catalog_errors + run.errors
  useEffect(() => {
    if (run.status !== 'running') onDone()
  }, [run.status, onDone])
  return (
    <div className="panel px-4 pb-3 pt-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium text-zinc-100">{dict.validation.livePanel.title}</h2>
        <span className="font-mono text-[11px] text-zinc-500">{run.run_id}</span>
        {run.status === 'running' && <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[11px] text-amber-200">{dict.validation.livePanel.inflight}</span>}
        {run.status === 'completed' && (
          <span className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[11px] text-emerald-300">
            {dict.validation.livePanel.completed(run.detected, run.total, passRatePercent(run.pass_rate), (run.duration_ms / 1000).toFixed(1))}
          </span>
        )}
        <button type="button" onClick={onClose} className="ml-auto rounded p-1 text-zinc-500 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={dict.validation.livePanel.closeAria}>
          <X size={14} aria-hidden />
        </button>
      </div>
      <div className="mt-3">
        <Meter value={done} max={run.total} color={run.missing > 0 ? 'var(--status-warning)' : 'var(--series-2)'} />
        <p className="mt-1.5 flex flex-wrap gap-x-4 text-[11px] text-zinc-500">
          <span className="tabular-nums">{dict.validation.livePanel.processed(done, run.total)}</span>
          <span className="tabular-nums text-emerald-300">{dict.validation.livePanel.detected(run.detected)}</span>
          {run.missing > 0 && <span className="tabular-nums text-red-300">{dict.validation.livePanel.missing(run.missing)}</span>}
          {run.catalog_errors > 0 && <span className="tabular-nums text-amber-200">{dict.validation.livePanel.catalog(run.catalog_errors)}</span>}
          {run.errors > 0 && <span className="tabular-nums text-red-300">{dict.validation.livePanel.errored(run.errors)}</span>}
        </p>
      </div>
    </div>
  )
}

/** Per-scenario results of a finished (or in-flight) run. */
function RunDetail({ run, onClose, onOpenRule }: { run: ScenarioRun; onClose: () => void; onOpenRule?: (id: string) => void }) {
  const { dict } = useI18n()
  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-3">
        <h2 className="text-sm font-medium text-zinc-100">{dict.validation.detail.title}</h2>
        <span className="font-mono text-[11px] text-zinc-500">{run.run_id}</span>
        <button type="button" onClick={onClose} className="ml-auto rounded p-1 text-zinc-500 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={dict.validation.detail.closeAria}>
          <X size={14} aria-hidden />
        </button>
      </div>
      {!run.results || run.results.length === 0 ? (
        <div className="px-4 py-4">
          <EmptyState icon={BatteryCharging} title={dict.validation.detail.emptyTitle} hint={dict.validation.detail.emptyHint} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">{dict.validation.detail.caption(run.run_id)}</caption>
            <thead>
              <tr className="bg-zinc-900">
                {[dict.validation.detail.cols.scenario, dict.validation.detail.cols.techniques, dict.validation.detail.cols.result, dict.validation.detail.cols.events, dict.validation.detail.cols.latency, dict.validation.detail.cols.expected].map((h) => (
                  <th key={h} scope="col" className="border-b border-zinc-800 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {run.results.map((r) => (
                <tr key={r.scenario_id} className="align-top transition-colors hover:bg-zinc-900/60">
                  <td className="max-w-[280px] px-4 py-3">
                    <span className="block truncate text-[13px] text-zinc-100" title={r.name}>{r.name}</span>
                    <span className="block truncate font-mono text-[11px] text-zinc-500">{r.scenario_id}</span>
                    {r.detail && <span className="mt-0.5 block text-[11px] text-amber-200/90">{r.detail}</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-zinc-400">{r.attack.join(', ') || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className={`rounded-md border px-1.5 py-0.5 text-[11px] ${RESULT_STYLE[r.status] ?? 'border-zinc-700 text-zinc-300'}`}>{dict.validation.resultLabels[r.status]}</span>
                    {(r.untagged ?? 0) > 0 && <span className="ml-1 rounded-md border border-amber-400/30 bg-amber-400/10 px-1 text-[10px] text-amber-200" title={dict.validation.detail.untaggedTitle}>{dict.validation.detail.untagged(r.untagged ?? 0)}</span>}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-zinc-400">{r.events_sent}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-400">{r.duration_ms} ms</td>
                  <td className="px-4 py-3">
                    {r.missing && r.missing.length > 0 ? (
                      <ul className="space-y-0.5">
                        {r.missing.map((m) => (
                          <li key={m.rule} className="text-[11px] text-red-300">
                            {m.fired}/{m.expected}{' '}
                            {onOpenRule ? (
                              <button type="button" onClick={() => onOpenRule(m.rule)} className="font-mono underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                {m.rule}
                              </button>
                            ) : (
                              <span className="font-mono">{m.rule}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-[11px] text-zinc-500">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Rows rendered at once: the library holds one scenario per rule and
 * chain (127 today), and listing them all made the page ~13,000 px tall. */
const SCENARIO_PAGE = 20

/** The lab library itself, with per-scenario selection for a partial run.
 * A search box (name, id, technique, host) and a "show more" pager keep it
 * one screen tall; selections survive filtering and paging. */
function ScenarioList({
  scenarios,
  filtered,
  selected,
  onToggle,
}: {
  scenarios: ScenarioLibrary['scenarios']
  filtered: boolean
  selected: Set<string>
  onToggle: (id: string) => void
}) {
  const { dict } = useI18n()
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(SCENARIO_PAGE)
  const q = query.trim().toLowerCase()
  const matching = q
    ? scenarios.filter((s) => [s.name, s.id, s.host, s.attack.join(' ')].some((v) => v.toLowerCase().includes(q)))
    : scenarios
  const page = matching.slice(0, shown)
  const rest = matching.length - page.length
  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-baseline gap-2 px-4 pt-3.5 pb-2">
        <h2 className="text-sm font-medium text-zinc-100">{dict.validation.list.title}</h2>
        <span className="text-xs text-zinc-500">
          {dict.validation.list.count(scenarios.length)}{filtered ? dict.validation.list.filteredSuffix : ''}{dict.validation.list.tail}
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setShown(SCENARIO_PAGE)
          }}
          placeholder={dict.validation.list.searchPlaceholder}
          aria-label={dict.validation.list.searchAria}
          className="ml-auto w-full max-w-xs rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-64"
        />
      </div>
      {matching.length === 0 ? (
        <div className="px-4 pb-4">
          <EmptyState
            icon={BatteryCharging}
            title={dict.validation.list.emptyTitle}
            hint={q ? dict.validation.list.emptyHintQuery : dict.validation.list.emptyHintFilter}
          />
        </div>
      ) : (
        <>
        <ul className="divide-y divide-zinc-800/70 border-t border-zinc-800">
          {page.map((s) => (
            <li key={s.id} className="flex items-start gap-3 px-4 py-3">
              <input
                type="checkbox"
                checked={selected.has(s.id)}
                onChange={() => onToggle(s.id)}
                aria-label={dict.validation.list.selectAria(s.name)}
                className="mt-1"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[13px] text-zinc-100">{s.name}</span>
                  <span className="font-mono text-[11px] text-zinc-500">{s.id}</span>
                  <span className="text-[11px] tabular-nums text-zinc-500">{dict.validation.list.events(s.events)}</span>
                </span>
                <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-zinc-400" title={s.description}>{s.description}</span>
                <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-500">
                  <span>{dict.validation.list.techniques}<span className="font-mono text-zinc-400">{s.attack.join(', ') || '—'}</span></span>
                  <span>
                    {dict.validation.list.expects}{s.expected.map((e) => e.rule).join(', ') || '—'}
                  </span>
                  <span>{dict.validation.list.host}<span className="font-mono text-zinc-400">{s.host}</span></span>
                </span>
              </span>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3 border-t border-zinc-800 px-4 py-2.5 text-xs text-zinc-500">
          <span>
            {dict.validation.list.shownOf(page.length, matching.length)}
            {q ? dict.validation.list.matchingSuffix(query.trim()) : ''}
          </span>
          {rest > 0 && (
            <button
              type="button"
              onClick={() => setShown((n) => n + SCENARIO_PAGE)}
              className="ml-auto rounded-md border border-white/10 px-2.5 py-1 text-xs text-zinc-300 hover:border-white/20 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {dict.validation.list.showMore(Math.min(SCENARIO_PAGE, rest), rest)}
            </button>
          )}
        </div>
        </>
      )}
    </div>
  )
}
