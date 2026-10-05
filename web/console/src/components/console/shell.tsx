'use client'

import { describeTelemetrySources } from '@/lib/telemetry-source'

// Console shell: fixed sidebar on desktop, top bar plus horizontal nav
// on mobile (explicit collapse). The topbar carries the only status dot
// of the chrome: it reflects the real engine connection state.

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ActivityIcon, BatteryCharging, Desktop, Files, Flask, FolderOpen, Gauge, Lightning, Prohibit, ShieldCheck, SpeakerHigh, SquaresFour, Warning, ChatsCircle, FlowArrow, Keyboard, ListMagnifyingGlass, MagnifyingGlass, Monitor } from '@phosphor-icons/react'
import { useEngine } from './engine-provider'
import { BlurText } from '@/components/reactbits/blur-text'
import { ShinyText } from '@/components/reactbits/shiny-text'
import { DotGridLayer } from '@/components/reactbits/dot-grid'
import { DecryptedText } from '@/components/reactbits/decrypted-text'
import { BrandMark } from './brand-mark'
import { Dashboard, type ConsoleView, type HuntLens } from './dashboard'
import { LiveFeed } from './live-feed'
import { AlertsView } from './alerts-view'
import { DetectionHub } from './detection-hub'
import { IncidentsView } from './incidents-view'
import { HostsView } from './hosts-view'
import { useIncidents } from './incidents-provider'
import { useFleet } from './fleet-provider'
import { RespondView } from './respond-view'
import { PlatformStatusView } from './platform-status'
import { AnalystPanel } from './analyst-panel'
import { ShortcutsHelp, type ShortcutHelpRow } from './shortcuts-help'
import { CommandPalette } from './command-palette'
import { NotifyMenu } from './critical-notifier'
import { NocMode } from './noc-mode'
import { DetectorsMenu } from './detectors-menu'
import { ReadOnlyBanner, UserChip } from './user-session'
import { ThemeToggle } from './theme-toggle'
import { ReportsView } from './reports-view'
import { CONSOLE_DESTINATIONS, type ConsoleCommand } from '@/lib/console-commands'
import { formatUptime, type EngineStats, type SfAlert } from '@/lib/console-types'
import { buildIncidentAnalysis, type PendingIncidentAnalysis } from '@/lib/incident-analysis'
import { writeScenarioLensToSearch, currentSearch, isDetectionView, pushOperatorState, readOperatorState, writeAlertLens, writeHostToSearch, writeIncidentToSearch, writeRulesToSearch, writeViewToSearch } from '@/lib/url-state'
import {
  SHORTCUT_ARM_MS,
  SHORTCUT_PREFIX,
  isHelpToggleKey,
  isKeyboardScope,
  isPaletteToggleKey,
  isTypingTarget,
  resolveShortcut,
  shortcutHintFor,
  shortcutRows,
} from '@/lib/keyboard-nav'
import { useAnalystChannel } from './socket-provider'
import { writeTriageDestination, type TriageTarget } from '@/lib/operations'

const NAV_ICONS: Record<ConsoleView, React.ElementType> = {
  panel: SquaresFour, estado: Gauge, flujo: ActivityIcon, alertas: Warning, incidentes: FolderOpen, equipos: Desktop, informes: Files,
  reglas: ShieldCheck, cadenas: FlowArrow, inteligencia: ListMagnifyingGlass, supresiones: Prohibit, probador: Flask,
  ruido: SpeakerHigh, simulacion: BatteryCharging,
  respuesta: Lightning, analista: ChatsCircle,
}
const NAV = CONSOLE_DESTINATIONS.map((item) => ({ ...item, icon: NAV_ICONS[item.id] }))

// Sidebar and mobile nav: the detection tabs collapse into one
// "Detección" entry (the palette and the help sheet keep every view).
const SIDEBAR = NAV.filter((item) => !isDetectionView(item.id) || item.id === 'reglas').map((item) =>
  item.id === 'reglas' ? { ...item, label: 'Detección' } : item,
)
const isCurrent = (id: ConsoleView, view: ConsoleView) => (id === 'reglas' ? isDetectionView(view) : id === view)

// Help sheet rows: the resolver's map (keys, ordered) zipped with the
// NAV labels/groups — both single sources of truth; flatMap drops a row
// only if NAV ever lacks a view (type-impossible today), so the sheet
// can never advertise an unlabeled binding.
const HELP_ROWS: ShortcutHelpRow[] = shortcutRows().flatMap((row) => {
  const nav = NAV.find((item) => item.id === row.view)
  return nav ? [{ key: row.key, label: nav.label, group: nav.group }] : []
})

export function ConsoleShell() {
  const { status, stats, alerts, events, suppressions, sequences, rules, endpoint, refresh, refreshing } = useEngine()
  const { status: analystStatus } = useAnalystChannel()
  const { incidents } = useIncidents()
  const openIncidents = incidents.filter((i) => i.status !== 'closed').length
  const { fleet } = useFleet()
  const silentHosts = fleet?.silent ?? 0
  const [view, setViewState] = useState<ConsoleView>('panel')
  const [helpOpen, setHelpOpen] = useState(false)
  const [nocOpen, setNocOpen] = useState(false)
  const closeNoc = useCallback(() => setNocOpen(false), [])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const helpOpenRef = useRef(false)
  const paletteOpenRef = useRef(false)
  helpOpenRef.current = helpOpen
  paletteOpenRef.current = paletteOpen
  const nocOpenRef = useRef(false)
  nocOpenRef.current = nocOpen

  // Operator state in the URL (url-state.ts): the active view survives a
  // refresh, back/forward navigate between views and deep links open the
  // right section. The URL is read AFTER mount (never during render) so
  // the pre-rendered HTML always matches the default and hydration stays
  // quiet. Every view change pushes a history entry; popstate re-syncs.
  useEffect(() => {
    setViewState(readOperatorState(currentSearch()).view)
    const onPop = () => setViewState(readOperatorState(currentSearch()).view)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const setView = (next: ConsoleView) => {
    setViewState(next)
    if (readOperatorState(currentSearch()).view !== next) {
      pushOperatorState((search) => writeViewToSearch(search, next))
    }
  }
  const openTriage = (target: TriageTarget) => {
    pushOperatorState((search) => writeTriageDestination(search, target))
    setViewState('alertas')
    requestAnimationFrame(() => document.getElementById('console-main')?.focus({ preventScroll: true }))
  }
  // Chart click-through: open the live alert queue with that lens.
  const openHunt = (lens: HuntLens) => {
    pushOperatorState((search) => writeViewToSearch(writeAlertLens(search, lens.sev ?? 'all', lens.q ?? '', 'all', 'live'), 'alertas'))
    setViewState('alertas')
    requestAnimationFrame(() => document.getElementById('console-main')?.focus({ preventScroll: true }))
  }
  const jump = (mutate: (search: string) => string, next: ConsoleView) => {
    pushOperatorState((search) => writeViewToSearch(mutate(search), next))
    setViewState(next)
    requestAnimationFrame(() => document.getElementById('console-main')?.focus({ preventScroll: true }))
  }
  const openHost = (host: string) => jump((search) => writeHostToSearch(search, host), 'equipos')
  const openIncident = (id: string) => jump((search) => writeIncidentToSearch(search, id), 'incidentes')
  const openAlert = (id: string) => jump((search) => writeAlertLens(search, 'all', '', 'all', 'live', id), 'alertas')
  const openRule = (id: string) => jump((search) => writeRulesToSearch(search, '', id), 'reglas')
  // SIM-3 click-through: a validated tactic cell opens the battery filtered by tactic
  const openScenarioTactic = (slug: string) => jump((search) => writeScenarioLensToSearch(search, slug), 'simulacion')
  const hintTitle = (id: ConsoleView): string | undefined => {
    const hint = shortcutHintFor(id)
    return hint ? `Atajo: ${hint}` : undefined
  }

  // g-prefixed navigation (keyboard-nav.ts): 'g' arms a one-key buffer
  // that expires after SHORTCUT_ARM_MS, the next key jumps through the
  // SAME setView path as a click (URL and history stay consistent).
  // Typing targets (queues' search boxes, analyst note, selects) and
  // modifier chords are never hijacked. The ref mirrors setView so the
  // listener stays stable across renders.
  const navRef = useRef(setView)
  navRef.current = setView
  const armedRef = useRef(false)
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const clearPrefix = () => {
      armedRef.current = false
      if (armTimerRef.current) clearTimeout(armTimerRef.current)
      armTimerRef.current = null
    }
    const onKey = (e: KeyboardEvent) => {
      const wasArmed = armedRef.current
      clearPrefix()
      // NOC mode owns the keyboard while it is open.
      if (e.defaultPrevented || e.repeat || e.isComposing || nocOpenRef.current) return
      if (isPaletteToggleKey(e)) {
        if (paletteOpenRef.current || helpOpenRef.current || (!isTypingTarget(e.target) && !isKeyboardScope(e.target))) {
          e.preventDefault()
          setHelpOpen(false)
          setPaletteOpen((value) => !value)
        }
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return
      if (paletteOpenRef.current) return
      if (helpOpenRef.current) {
        if (isHelpToggleKey(e.key)) { e.preventDefault(); setHelpOpen(false) }
        return
      }
      if (isKeyboardScope(e.target)) return
      if (isHelpToggleKey(e.key)) {
        e.preventDefault()
        setHelpOpen(true)
        return
      }
      const result = resolveShortcut({ key: e.key, prefixed: wasArmed })
      if (result.action === 'navigate') { e.preventDefault(); navRef.current(result.view) }
      else if (result.action === 'arm') {
        armedRef.current = true
        armTimerRef.current = setTimeout(() => {
          armedRef.current = false
        }, SHORTCUT_ARM_MS)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', clearPrefix)
    document.addEventListener('focusin', clearPrefix)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', clearPrefix)
      document.removeEventListener('focusin', clearPrefix)
      clearPrefix()
    }
  }, [])
  const reduce = useReducedMotion()

  const executeCommand = (command: ConsoleCommand) => {
    setPaletteOpen(false)
    if (command.kind === 'help') setHelpOpen(true)
    else if (command.kind === 'refresh') refresh()
    else if (command.kind === 'noc') setNocOpen(true)
    else {
      setView(command.view)
      requestAnimationFrame(() => document.getElementById('console-main')?.focus({ preventScroll: true }))
    }
  }

  const telemetry = describeTelemetrySources(events)

  const [pendingAlert, setPendingAlert] = useState<SfAlert | null>(null)
  const [pendingIncident, setPendingIncident] = useState<PendingIncidentAnalysis | null>(null)

  const openInAnalyst = (al: SfAlert) => {
    setPendingAlert(al)
    setView('analista')
  }

  // Multi-alert hand-offs: the payload is built here from real case or
  // selection data (capped by the lib); the panel attaches the frozen
  // bundle of the most severe alert right before emitting.
  const openIncidentInAnalyst = (pending: PendingIncidentAnalysis) => {
    setPendingIncident(pending)
    setView('analista')
  }

  const openSelectionInAnalyst = (alerts: SfAlert[]) => {
    setPendingIncident({
      payload: buildIncidentAnalysis({ source: 'selection', alerts }),
      label: 'Selección de la cola',
    })
    setView('analista')
  }

  const statusColor = status === 'live' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-400' : 'bg-red-500'
  const statusText = status === 'live' ? 'En vivo' : status === 'connecting' ? 'Conectando' : 'Motor offline'
  const openAlerts = alerts.filter((a) => a.status !== 'closed')
  const openCritical = openAlerts.some((a) => a.severity === 'critical')
  const destination = CONSOLE_DESTINATIONS.find((item) => item.id === view)

  return (
    <div className="relative min-h-[100dvh] bg-zinc-950 text-zinc-100">
      <a href="#console-main" className="sr-only z-50 rounded-md bg-primary-link px-4 py-2 text-sm text-zinc-950 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Ir al contenido
      </a>
      {/* DotGrid (React Bits): fondo de toda la consola, reactivo al puntero
          con la misma contención y congelado bajo prefers-reduced-motion. */}
      <DotGridLayer />
      <div className="relative flex min-h-[100dvh] w-full flex-col lg:flex-row">
        <aside className="glass sticky top-0 hidden h-[100dvh] w-64 shrink-0 flex-col border-r border-white/[0.06] lg:flex">
          <BrandBlock live={status === 'live'} />
          <nav aria-label="Secciones de la consola" className="mt-2 flex-1 overflow-y-auto px-3">
            <ul className="space-y-0.5">
              {SIDEBAR.map((item, idx) => {
                const current = isCurrent(item.id, view)
                return (
                  <li key={item.id}>
                    {(idx === 0 || SIDEBAR[idx - 1].group !== item.group) && (
                      <p className="kicker px-3 pb-1.5 pt-4 text-[10px] text-zinc-600">{item.group}</p>
                    )}
                    <button
                      type="button"
                      onClick={() => setView(item.id)}
                      aria-current={current ? 'page' : undefined}
                      title={hintTitle(item.id)}
                      className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        current ? 'text-zinc-50' : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
                      }`}
                    >
                      {/* píldora activa con layoutId: el resalte viaja entre
                          secciones. pointer-events-none: durante el vuelo del
                          spring nunca intercepta clicks de los vecinos. */}
                      {current && (
                        <motion.span
                          layoutId="nav-pill"
                          className="pointer-events-none absolute inset-0 rounded-lg border border-primary/25 bg-gradient-to-r from-primary-tint/[0.16] via-primary-tint/[0.07] to-transparent shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
                          transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 }}
                        />
                      )}
                      {current && (
                        <span aria-hidden className="pointer-events-none absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
                      )}
                      <item.icon size={17} weight={current ? 'fill' : 'regular'} aria-hidden className={`relative ${current ? 'text-primary' : ''}`} />
                      <span className="relative">{item.label}</span>
                      {item.id === 'alertas' && openAlerts.length > 0 && (
                        <span
                          title={`${openAlerts.length} alertas sin cerrar en la ventana${openCritical ? ', con críticas' : ''}`}
                          className={`relative ml-auto rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
                            openCritical ? 'bg-red-500/15 text-red-300' : 'bg-zinc-800 text-zinc-300'
                          }`}
                        >
                          {openAlerts.length}
                        </span>
                      )}
                      {item.id === 'equipos' && silentHosts > 0 && (
                        <span title={`${silentHosts} equipos sin señal de su sensor`} className="relative ml-auto rounded-md bg-red-500/15 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-red-300">
                          {silentHosts}
                        </span>
                      )}
                      {item.id === 'incidentes' && openIncidents > 0 && (
                        <span title={`${openIncidents} incidentes sin cerrar`} className="relative ml-auto rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-amber-200">
                          {openIncidents}
                        </span>
                      )}
                      {item.id === 'reglas' && rules.length > 0 && (
                        <span className="relative ml-auto text-[11px] tabular-nums text-zinc-500">{rules.length}</span>
                      )}
                      {item.id === 'analista' && analystStatus !== 'live' && (
                        <span aria-hidden className="relative ml-auto h-1.5 w-1.5 rounded-full bg-zinc-600" title="servicio de analista sin conexión" />
                      )}
                      {item.id === 'supresiones' && suppressions.length > 0 && (
                        <span className="relative ml-auto text-[11px] tabular-nums text-zinc-500">{suppressions.length}</span>
                      )}
                      {item.id === 'cadenas' && sequences.length > 0 && (
                        <span className="relative ml-auto text-[11px] tabular-nums text-zinc-500">{sequences.length}</span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>
          <div className="space-y-3 px-4 pb-4 pt-3">
            <div className="panel px-3 py-3">
              <p className="flex items-center gap-2 text-xs font-medium text-zinc-200">
                <span className="relative flex h-2 w-2" aria-hidden>
                  {status === 'live' ? (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:hidden" />
                  ) : null}
                  <span aria-hidden className={`relative inline-flex h-2 w-2 rounded-full ${statusColor}`} />
                </span>
                {statusText}
                {stats && status === 'live' && (
                  <span className="ml-auto text-[11px] font-normal tabular-nums text-zinc-500">{formatUptime(stats.uptime_s)}</span>
                )}
              </p>
              <p className="mt-1.5 truncate font-mono text-[11px] text-zinc-500" title={endpoint}>{endpoint}</p>
              <p className="mt-0.5 truncate text-[11px] text-zinc-500" title={telemetry.label}>{telemetry.label}</p>
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-500">
              Solo datos del pipeline real. La demo aparece etiquetada; sin eventos no se inventa telemetría.
            </p>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="inline-flex items-center gap-1.5 rounded text-[11px] text-zinc-500 transition-colors hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Keyboard size={12} aria-hidden />
              Atajos: <span className="font-mono">{SHORTCUT_PREFIX}·vista</span> · <span className="font-mono">?</span>
            </button>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="glass sticky top-0 z-20 border-b border-white/[0.06]">
            <div className="flex min-h-16 items-center justify-between gap-3 px-4 py-2.5 lg:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <div className="lg:hidden">
                  <BrandRow />
                </div>
                <div className="hidden min-w-0 lg:block">
                  {/* BlurText (React Bits): la entrada palabra a palabra marca el
                      cambio de vista; key={view} reinicia la secuencia. */}
                  <h1 className="truncate text-[15px] font-semibold tracking-tight text-zinc-50">
                    <BlurText key={view} text={titleFor(view)} />
                  </h1>
                  {destination && <p className="truncate text-xs text-zinc-500">{destination.description}</p>}
                </div>
              </div>
              <div className="ml-auto flex min-w-0 items-center gap-2 overflow-x-auto">
                <button
                  type="button"
                  onClick={() => { setHelpOpen(false); setPaletteOpen(true) }}
                  aria-label="Abrir comandos"
                  aria-haspopup="dialog"
                  aria-keyshortcuts="Control+k Meta+k"
                  title="Comandos (Ctrl+K / ⌘K)"
                  className="chip shrink-0 gap-2 px-2.5 py-1.5 text-zinc-400 transition-colors hover:border-primary/40 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-w-[200px]"
                >
                  <MagnifyingGlass size={15} aria-hidden />
                  <span className="hidden text-xs sm:inline">Buscar vistas y comandos</span>
                  <kbd aria-hidden className="ml-auto hidden rounded border border-zinc-700 px-1 font-mono text-[10px] text-zinc-400 md:inline">Ctrl K</kbd>
                </button>
                <div className="chip shrink-0 whitespace-nowrap px-2.5 py-1.5">
                  <span className="relative flex h-2 w-2" aria-hidden>
                    {status === 'live' ? (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:hidden" />
                    ) : null}
                    <span aria-hidden className={`relative inline-flex h-2 w-2 rounded-full ${statusColor}`} />
                  </span>
                  <span className="text-xs text-zinc-300">
                    {/* ShinyText (React Bits): el barrido solo corre con el motor
                        en vivo — comunica flujo activo, no decora. */}
                    {status === 'live' ? <ShinyText>En vivo</ShinyText> : statusText}
                  </span>
                  {telemetry.hasDemo && <span className="rounded bg-amber-400/10 px-1 text-[11px] text-amber-300" aria-label="La ventana recibida contiene datos de demostración">demo</span>}
                </div>
                <UserChip />
                <NotifyMenu />
                <ThemeToggle />
                <button
                  type="button"
                  onClick={() => setNocOpen(true)}
                  aria-label="Abrir modo NOC"
                  title="Modo NOC: pantalla completa rotativa para un monitor de sala"
                  className="chip shrink-0 px-2 py-1.5 text-zinc-400 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Monitor size={15} aria-hidden />
                </button>
                <WebhookChip stats={stats} />
                <DetectorsMenu stats={stats} onOpen={setView} />
                <UtcClock />
              </div>
            </div>
            <ReadOnlyBanner />
          </header>

          {/* Mobile nav: explicit collapse of the sidebar */}
          <nav aria-label="Secciones de la consola" className="flex gap-1 overflow-x-auto border-b border-white/[0.06] px-3 py-2 lg:hidden">
            {SIDEBAR.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                aria-current={isCurrent(item.id, view) ? 'page' : undefined}
                title={hintTitle(item.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isCurrent(item.id, view) ? 'border-primary/30 bg-primary-tint/[0.14] text-zinc-100' : 'border-transparent text-zinc-400'
                }`}
              >
                <item.icon size={14} aria-hidden className={isCurrent(item.id, view) ? 'text-primary' : ''} />
                {item.label}
              </button>
            ))}
          </nav>

          <main id="console-main" tabIndex={-1} className="flex-1 px-4 py-5 outline-none lg:px-8 lg:py-6">
            <div className="mx-auto w-full max-w-[1560px]">
              <AnimatedView viewKey={view}>
                {view === 'panel' && <Dashboard onAnalyze={openInAnalyst} onNavigate={setView} onTriage={openTriage} onHunt={openHunt} onHost={openHost} onScenarioTactic={openScenarioTactic} />}
                {view === 'estado' && <PlatformStatusView />}
                {view === 'flujo' && <LiveFeed />}
                {view === 'alertas' && <AlertsView onAnalyze={openInAnalyst} onAnalyzeGroup={openSelectionInAnalyst} onHost={openHost} onOpenIncident={openIncident} />}
                {view === 'incidentes' && <IncidentsView onHost={openHost} onOpenAlert={openAlert} onAnalyze={openIncidentInAnalyst} />}
                {view === 'equipos' && <HostsView onHunt={(q) => openHunt({ q })} onOpenAlert={openAlert} onOpenIncident={openIncident} />}
                {view === 'informes' && <ReportsView />}
                {isDetectionView(view) && <DetectionHub tab={view} onTab={setView} onOpenRule={openRule} />}
                {view === 'respuesta' && <RespondView />}
                {view === 'analista' && (
                  <AnalystPanel
                    pendingAlert={pendingAlert}
                    clearPending={() => setPendingAlert(null)}
                    pendingIncident={pendingIncident}
                    clearPendingIncident={() => setPendingIncident(null)}
                  />
                )}
              </AnimatedView>
            </div>
          </main>

          <footer className="border-t border-white/[0.06] px-4 py-3 lg:px-8">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
              <span>bluetardigrade · consola SOC</span>
              <span aria-hidden>·</span>
              <span>detección, investigación y respuesta para endpoints Windows</span>
            </p>
          </footer>
        </div>
      </div>
      <ShortcutsHelp open={helpOpen} rows={HELP_ROWS} onClose={() => setHelpOpen(false)} />
      {paletteOpen && <CommandPalette open refreshing={refreshing} onClose={() => setPaletteOpen(false)} onExecute={executeCommand} />}
      {nocOpen && <NocMode onClose={closeNoc} />}
    </div>
  )
}

/** Wall clock in UTC (the timezone incident timelines are written in). */
function UtcClock() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  if (!now) return null
  return (
    <span className="chip hidden shrink-0 whitespace-nowrap px-2.5 py-1.5 font-mono text-[11px] tabular-nums text-zinc-400 2xl:flex" title="Hora UTC">
      <span className="text-zinc-600">UTC</span>
      {now.toISOString().slice(11, 19)}
    </span>
  )
}

function titleFor(view: ConsoleView): string {
  switch (view) {
    case 'panel':
      return 'Panel de operaciones'
    case 'estado':
      return 'Estado de la plataforma'
    case 'flujo':
      return 'Flujo en vivo'
    case 'alertas':
      return 'Cola de alertas'
    case 'incidentes':
      return 'Incidentes'
    case 'equipos':
      return 'Equipos'
    case 'informes':
      return 'Informes'
    case 'probador':
      return 'Probador de reglas'
    case 'ruido':
      return 'Informe de ruido'
    case 'simulacion':
      return 'Validación de detecciones'
    case 'reglas':
      return 'Reglas de detección'
    case 'cadenas':
      return 'Cadenas de kill chain'
    case 'inteligencia':
      return 'Inteligencia de amenazas'
    case 'supresiones':
      return 'Supresiones del operador'
    case 'respuesta':
      return 'Respuesta activa'
    case 'analista':
      return 'Analista IA'
  }
}

/**
 * Webhook delivery chip, fed by the engine's own counters
 * (/api/stats -> hub -> this chip). Honest by design:
 * - hidden while there is zero traffic (connector disabled or idle):
 *   an all-green chip for a disabled feature would be a lie;
 * - green only when every delivery attempt succeeded;
 * - red as soon as something failed or was dropped, with the counts
 *   on display so the operator knows the SIEM is missing alerts.
 */
function WebhookChip({ stats }: { stats: EngineStats | null }) {
  // mode is hub-only: with direct engine telemetry the chip shows whenever
  // the engine reports webhook counters (they are real either way).
  if (!stats || (stats.mode && stats.mode !== 'engine')) return null
  const { webhook_sent: sent, webhook_failed: failed, webhook_dropped: dropped } = stats
  const total = sent + failed + dropped
  if (total === 0) return null
  const healthy = failed === 0 && dropped === 0
  return (
    <div
      title={
        healthy
          ? `Webhook: ${sent} alertas entregadas al conector externo`
          : `Webhook con problemas: ${failed} fallidas, ${dropped} descartadas, ${sent} entregadas`
      }
      className={`chip hidden whitespace-nowrap px-2.5 py-1.5 font-mono text-[11px] xl:flex ${
        healthy ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-red-400/40 bg-red-400/10 text-red-300'
      }`}
    >
      <span aria-hidden>{healthy ? '✓' : '✕'}</span>
      <span>
        webhook {sent}
        {failed > 0 && <span> / {failed} err</span>}
        {dropped > 0 && <span> / {dropped} desc</span>}
      </span>
    </div>
  )
}

function BrandBlock({ live }: { live: boolean }) {
  return (
    <div className="px-5 pb-2 pt-5">
      <div className="flex items-center gap-3">
        <BrandMark size={38} live={live} className="shrink-0" />
        <span className="min-w-0 leading-tight">
          <span className="block text-[15px] font-semibold tracking-tight text-zinc-50">bluetardigrade</span>
          {/* DecryptedText (React Bits): la etiqueta se descodifica una vez
              al montar; gesto temático y contenido, cero ruido después. */}
          <DecryptedText text="Security Operations Center" className="block text-[11px] text-zinc-500" />
        </span>
      </div>
      <div aria-hidden className="mt-4 h-px bg-gradient-to-r from-primary/35 via-white/10 to-transparent" />
    </div>
  )
}

function BrandRow() {
  return (
    <div className="flex items-center gap-2">
      <BrandMark size={26} />
      <span className="text-sm font-semibold tracking-tight text-zinc-100">bluetardigrade</span>
    </div>
  )
}

/** Cross-fade between views (state transition, nothing decorative). */
function AnimatedView({ viewKey, children }: { viewKey: string; children: React.ReactNode }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      key={viewKey}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}
