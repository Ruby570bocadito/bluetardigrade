'use client'

// NOC mode: a full-screen, read-only rotation for a wall monitor. Three
// slides (situation, investigation graph, coverage and hosts) cycle
// every 20 s; arrows switch, Space pauses, Escape (or leaving browser
// full screen) exits. Everything reads the same live engine state as
// the console; no slide fabricates data when the engine is down.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CaretLeft, CaretRight, Pause, Play, X } from '@phosphor-icons/react'
import { useEngine } from './engine-provider'
import { BrandMark } from './brand-mark'
import { useI18n } from './i18n-provider'
import { ActivityChart, useActivity } from './activity-chart'
import { AnimatedContent } from '@/components/reactbits/animated-content'
import { CountUp } from '@/components/reactbits/count-up'
import { ShinyText } from '@/components/reactbits/shiny-text'
import { EntityGraphView, GraphLegend } from '@/components/charts/entity-graph'
import { AttackMatrix } from '@/components/charts/attack-matrix'
import { HostTacticHeatmap } from '@/components/charts/heatmap'
import { BarList, Meter } from '@/components/charts/bars'
import { SEV_COLOR, SeverityIcon } from '@/components/charts/severity'
import { buildEntityGraph } from '@/lib/entity-graph'
import { resolveTheme, THEME_EVENT, THEME_STORAGE_KEY } from '@/lib/theme'
import { hostTacticMatrix, SEVERITIES, SEVERITY_LABEL, severityCounts, tacticCoverage, topCounts } from '@/lib/soc-metrics'
import { triageSummary } from '@/lib/operations'
import { formatTime } from '@/lib/console-types'

const SLIDE_MS = 20_000
// Stable slide identity between languages; the labels live in the dictionaries.
const SLIDE_KEYS = ['situacion', 'grafo', 'cobertura'] as const

/** Locale for client-side number formatting: it follows the console
 * language (browser preference), never the engine. */
function numberLocale(lang: 'es' | 'en'): string {
  return lang === 'en' ? 'en-US' : 'es-ES'
}

export function NocMode({ onClose }: { onClose: () => void }) {
  const { status, stats } = useEngine()
  const { dict } = useI18n()
  const slides = SLIDE_KEYS.map((key) => dict.noc.slides[key])
  const [slide, setSlide] = useState(0)
  const [paused, setPaused] = useState(false)
  const [cycle, setCycle] = useState(0)
  const exitRef = useRef<HTMLButtonElement>(null)
  const enteredFullscreen = useRef(false)

  const go = useCallback((delta: number) => {
    setSlide((s) => (s + delta + SLIDE_KEYS.length) % SLIDE_KEYS.length)
    setCycle((c) => c + 1)
  }, [])

  // Rotation; any manual switch restarts the 20 s period.
  useEffect(() => {
    if (paused) return
    const timer = setTimeout(() => go(1), SLIDE_MS)
    return () => clearTimeout(timer)
  }, [paused, slide, cycle, go])

  // Full screen when the browser allows it; leaving it closes the mode.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    exitRef.current?.focus({ preventScroll: true })
    document.documentElement.requestFullscreen?.().then(() => { enteredFullscreen.current = true }).catch(() => {})
    const onChange = () => { if (enteredFullscreen.current && !document.fullscreenElement) onClose() }
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.documentElement.style.overflow = overflow
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [onClose])

  // THEME-1: the NOC wall stays dark whatever the operator's theme is.
  // While mounted, the light class is lifted from <html> — the wall is
  // opaque and covers the viewport, so nothing else is visible — and on
  // exit the operator's stored choice is re-resolved (it may have changed
  // in another tab meanwhile) and the canvas layers repaint for both
  // transitions.
  useEffect(() => {
    const root = document.documentElement
    const wasLight = root.classList.contains('light')
    if (!wasLight) return
    root.classList.remove('light')
    root.classList.add('dark')
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: 'dark' }))
    return () => {
      root.classList.remove('dark')
      let stored: string | null = null
      try {
        stored = localStorage.getItem(THEME_STORAGE_KEY)
      } catch {
        // Storage blocked: fall back to the OS preference, like the boot.
      }
      const light = resolveTheme(stored, window.matchMedia('(prefers-color-scheme: light)').matches) === 'light'
      root.classList.toggle('light', light)
      window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: light ? 'light' : 'dark' }))
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
      else if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); setPaused((p) => !p) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [go, onClose])

  return (
    <div role="dialog" aria-modal="true" aria-label={dict.noc.ariaLabel} className="fixed inset-0 z-[60] flex flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center gap-4 border-b border-white/[0.06] px-6 py-3">
        <BrandMark size={30} live={status === 'live'} />
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight">bluetardigrade · NOC</p>
          <p className="text-xs text-zinc-500" aria-live="polite">{slides[slide]}</p>
        </div>
        <div className="ml-6 hidden items-center gap-1.5 md:flex" role="tablist" aria-label={dict.noc.screens}>
          {slides.map((name, i) => (
            <button
              key={SLIDE_KEYS[i]}
              type="button"
              role="tab"
              aria-selected={i === slide}
              aria-label={name}
              onClick={() => { setSlide(i); setCycle((c) => c + 1) }}
              className={`h-1.5 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${i === slide ? 'w-8 bg-primary' : 'w-3 bg-zinc-700 hover:bg-zinc-500'}`}
            />
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="flex items-center gap-2 rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-xs">
            <span aria-hidden className={`h-2 w-2 rounded-full ${status === 'live' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-400' : 'bg-red-500'}`} />
            {status === 'live' ? <ShinyText>{dict.chrome.live}</ShinyText> : status === 'connecting' ? dict.chrome.connecting : dict.chrome.engineOffline}
          </span>
          <NocClock />
          <button type="button" onClick={() => go(-1)} aria-label={dict.noc.prev} className={iconBtn}><CaretLeft size={16} aria-hidden /></button>
          <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? dict.noc.resume : dict.noc.pause} className={iconBtn}>
            {paused ? <Play size={16} aria-hidden /> : <Pause size={16} aria-hidden />}
          </button>
          <button type="button" onClick={() => go(1)} aria-label={dict.noc.next} className={iconBtn}><CaretRight size={16} aria-hidden /></button>
          <button ref={exitRef} type="button" onClick={onClose} className="ml-1 inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X size={14} aria-hidden /> {dict.noc.exit} <kbd className="rounded border border-zinc-700 px-1 font-mono text-[10px] text-zinc-400">Esc</kbd>
          </button>
        </div>
      </header>
      {/* progress of the current slide; restarts on every switch */}
      <div aria-hidden className="h-0.5 bg-white/[0.04]">
        {!paused && <div key={`${slide}:${cycle}`} className="noc-progress h-full bg-primary/70" style={{ animationDuration: `${SLIDE_MS}ms` }} />}
      </div>

      <main className="min-h-0 flex-1 overflow-hidden p-6">
        {status === 'down' || !stats ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-2xl font-semibold text-zinc-200">{status === 'connecting' ? dict.noc.connectingTitle : dict.noc.offlineTitle}</p>
            <p className="max-w-lg text-sm text-zinc-500">{dict.noc.offlineProse}</p>
          </div>
        ) : (
          <AnimatedContent key={slide} className="h-full">
            {slide === 0 ? <SituationSlide /> : slide === 1 ? <GraphSlide /> : <CoverageSlide />}
          </AnimatedContent>
        )}
      </main>
    </div>
  )
}

const iconBtn = 'rounded-lg border border-white/10 p-1.5 text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

function NocClock() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!now) return null
  return (
    <span className="rounded-lg border border-white/[0.08] px-2.5 py-1.5 font-mono text-xs tabular-nums text-zinc-300">
      <span className="text-zinc-500">UTC </span>{now.toISOString().slice(11, 19)}
    </span>
  )
}

function BigStat({ label, value, tone = 'text-zinc-50', hint }: { label: string; value: number; tone?: string; hint?: string }) {
  return (
    <div className="panel px-5 py-4">
      <p className="text-sm text-zinc-400">{label}</p>
      <CountUp to={value} className={`mt-1 block text-5xl font-semibold tracking-tight ${tone}`} />
      {hint && <p className="mt-1 truncate text-xs text-zinc-500">{hint}</p>}
    </div>
  )
}

function SituationSlide() {
  const { alerts, events, stats } = useEngine()
  const { dict, lang } = useI18n()
  const noc = dict.noc.situation
  const activity = useActivity(events, alerts)
  const summary = triageSummary(alerts)
  const counts = severityCounts(alerts)
  const top = stats?.hot_hosts?.[0]
  const [chartHeight, setChartHeight] = useState(320)
  useEffect(() => setChartHeight(Math.max(220, window.innerHeight - 350)), [])
  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <BigStat label={noc.criticalOpen} value={summary.critical} tone={summary.critical > 0 ? 'text-red-300' : 'text-zinc-50'} hint={noc.criticalHint(summary.pending, summary.acknowledged)} />
        <BigStat label={noc.eventsPerMin} value={stats?.events_per_min ?? 0} hint={noc.eventsHint((stats?.events_total ?? 0).toLocaleString(numberLocale(lang)))} />
        <BigStat label={noc.alerts} value={stats?.alerts_total ?? 0} hint={noc.alertsHint(alerts.length)} />
        <BigStat label={noc.riskHosts} value={stats?.risk_hosts_tracked ?? 0} hint={top ? noc.riskHint(top.host, top.score.toFixed(1)) : noc.noRisk} />
      </div>
      <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-label={noc.activityAria} className="panel flex min-h-0 flex-col px-5 py-4">
          <h2 className="text-base font-medium text-zinc-100">{noc.activityTitle}</h2>
          <div className="mt-3 min-h-0 flex-1">
            <ActivityChart activity={activity} withMarkers height={chartHeight} />
          </div>
        </section>
        <section aria-label={noc.severityAria} className="panel px-5 py-4">
          <h2 className="text-base font-medium text-zinc-100">{noc.severityTitle}</h2>
          <BarList
            className="mt-4 space-y-4"
            rows={SEVERITIES.map((s) => ({
              key: s,
              label: <span className="flex items-center gap-2 text-sm"><SeverityIcon severity={s} size={16} />{SEVERITY_LABEL[s]}</span>,
              value: counts[s],
              color: SEV_COLOR[s],
            }))}
          />
          <ul className="mt-6 space-y-2 border-t border-white/[0.06] pt-4">
            {alerts.filter((a) => a.severity === 'critical' && a.status !== 'closed').slice(0, 5).map((a, i) => (
              <li key={(a.id ?? a.timestamp) + i} className="flex items-center gap-2 text-sm">
                <SeverityIcon severity="critical" size={14} />
                <span className="min-w-0 flex-1 truncate text-zinc-200">{a.rule_name}</span>
                <span className="font-mono text-xs text-zinc-500">{a.host} · {formatTime(a.timestamp)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

function GraphSlide() {
  const { alerts, events } = useEngine()
  const { dict } = useI18n()
  const graph = useMemo(() => buildEntityGraph(alerts, events), [alerts, events])
  const [height, setHeight] = useState(600)
  useEffect(() => setHeight(Math.max(380, window.innerHeight - 220)), [])
  return (
    <section aria-label={dict.noc.graph.ariaLabel} className="panel flex h-full flex-col px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-medium text-zinc-100">{dict.noc.graph.title(graph.nodes.length)}</h2>
        <GraphLegend graph={graph} />
      </div>
      <div className="mt-3 min-h-0 flex-1">
        {graph.nodes.length === 0 ? (
          <p className="pt-20 text-center text-sm text-zinc-500">{dict.noc.graph.empty}</p>
        ) : (
          <EntityGraphView graph={graph} height={height} ariaLabel={dict.noc.graph.canvasAria(graph.nodes.length, graph.edges.length)} />
        )}
      </div>
    </section>
  )
}

function CoverageSlide() {
  const { alerts, rules, stats, events } = useEngine()
  const { dict } = useI18n()
  const cov = dict.noc.coverage
  const cells = useMemo(() => tacticCoverage(rules, alerts), [rules, alerts])
  const matrix = useMemo(() => hostTacticMatrix(alerts), [alerts])
  const topRules = useMemo(() => topCounts(alerts, (a) => a.rule_name, 6), [alerts])
  const destinations = useMemo(
    () => topCounts(events.filter((e) => e.type === 'network.connect'), (e) => e.network?.domain || e.network?.destination_ip, 6),
    [events],
  )
  const hot = stats?.hot_hosts ?? []
  const max = hot.reduce((m, h) => Math.max(m, h.score), 0)
  return (
    <div className="grid h-full gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col gap-5">
        <section aria-label={cov.matrixAria} className="panel px-5 py-4">
          <h2 className="text-base font-medium text-zinc-100">{cov.matrixTitle(cells.filter((c) => c.rules > 0).length)}</h2>
          <div className="mt-3"><AttackMatrix cells={cells} /></div>
        </section>
        <section aria-label={cov.hostsAria} className="panel px-5 py-4">
          <h2 className="text-base font-medium text-zinc-100">{cov.hostsTitle}</h2>
          <div className="mt-3">
            {matrix.hosts.length === 0 ? <p className="text-sm text-zinc-500">{cov.hostsEmpty}</p> : <HostTacticHeatmap matrix={matrix} />}
          </div>
        </section>
        <section aria-label={cov.rulesAria} className="panel min-h-0 flex-1 overflow-hidden px-5 py-4">
          <h2 className="text-base font-medium text-zinc-100">{cov.rulesTitle}</h2>
          <BarList className="mt-4 space-y-3" rows={topRules.top.map((r) => ({ key: r.key, label: <span className="text-sm">{r.key}</span>, value: r.count }))} empty={<p className="mt-4 text-sm text-zinc-500">{cov.rulesEmpty}</p>} />
        </section>
      </div>
      <section aria-label={cov.riskAria} className="panel px-5 py-4">
        <h2 className="text-base font-medium text-zinc-100">{cov.riskTitle}</h2>
        {hot.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">{cov.riskEmpty}</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {hot.map((h) => {
              const color = h.score >= 20 ? 'var(--status-critical)' : h.score >= 5 ? 'var(--status-warning)' : 'var(--series-1)'
              return (
                <li key={h.host}>
                  <div className="flex items-baseline gap-3">
                    <span className="min-w-0 flex-1 truncate font-mono text-sm text-zinc-100">{h.host}</span>
                    <span className="text-2xl font-semibold text-zinc-50">{h.score.toFixed(1)}</span>
                  </div>
                  <Meter className="mt-2 h-2" value={h.score} max={max} color={color} />
                  <p className="mt-1 text-xs text-zinc-500">{cov.riskSeen(h.alerts, formatTime(h.last_seen))}</p>
                </li>
              )
            })}
          </ul>
        )}
        <h2 className="mt-8 border-t border-white/[0.06] pt-5 text-base font-medium text-zinc-100">{cov.destTitle}</h2>
        <BarList
          className="mt-4 space-y-3"
          color="var(--series-2)"
          rows={destinations.top.map((d) => ({ key: d.key, label: <span className="font-mono text-sm">{d.key}</span>, value: d.count }))}
          empty={<p className="mt-4 text-sm text-zinc-500">{cov.destEmpty}</p>}
        />
      </section>
    </div>
  )
}
