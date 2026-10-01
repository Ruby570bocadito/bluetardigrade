'use client'

// Console shell: fixed sidebar on desktop, top bar plus horizontal nav
// on mobile (explicit collapse). The topbar carries the only status dot
// of the chrome: it reflects the real engine connection state.

import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ActivityIcon, Broadcast, Gauge, Lightning, Prohibit, ShieldCheck, SquaresFour, Warning, ChatsCircle, FlowArrow, Keyboard, MagnifyingGlass } from '@phosphor-icons/react'
import { useEngine } from './engine-provider'
import { BlurText } from '@/components/reactbits/blur-text'
import { ShinyText } from '@/components/reactbits/shiny-text'
import { DotGridLayer } from '@/components/reactbits/dot-grid'
import { DecryptedText } from '@/components/reactbits/decrypted-text'
import { Dashboard, type ConsoleView } from './dashboard'
import { LiveFeed } from './live-feed'
import { AlertsView } from './alerts-view'
import { RulesView } from './rules-view'
import { SuppressionsView } from './suppressions-view'
import { RespondView } from './respond-view'
import { SequencesView } from './sequences-view'
import { AnalystPanel } from './analyst-panel'
import { ShortcutsHelp, type ShortcutHelpRow } from './shortcuts-help'
import { CommandPalette } from './command-palette'
import { CONSOLE_DESTINATIONS, type ConsoleCommand } from '@/lib/console-commands'
import { formatUptime, type EngineStats, type SfAlert } from '@/lib/console-types'
import { currentSearch, pushOperatorState, readOperatorState, writeViewToSearch } from '@/lib/url-state'
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

const NAV_ICONS: Record<ConsoleView, React.ElementType> = {
  panel: SquaresFour, flujo: ActivityIcon, alertas: Warning, reglas: ShieldCheck,
  cadenas: FlowArrow, supresiones: Prohibit, respuesta: Lightning, analista: ChatsCircle,
}
const NAV = CONSOLE_DESTINATIONS.map((item) => ({ ...item, icon: NAV_ICONS[item.id] }))

// Help sheet rows: the resolver's map (keys, ordered) zipped with the
// NAV labels/groups — both single sources of truth; flatMap drops a row
// only if NAV ever lacks a view (type-impossible today), so the sheet
// can never advertise an unlabeled binding.
const HELP_ROWS: ShortcutHelpRow[] = shortcutRows().flatMap((row) => {
  const nav = NAV.find((item) => item.id === row.view)
  return nav ? [{ key: row.key, label: nav.label, group: nav.group }] : []
})

export function ConsoleShell() {
  const { status, stats, alerts, events, suppressions, sequences, endpoint, refresh, refreshing } = useEngine()
  const { status: analystStatus } = useAnalystChannel()
  const [view, setViewState] = useState<ConsoleView>('panel')
  const [helpOpen, setHelpOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const helpOpenRef = useRef(false)
  const paletteOpenRef = useRef(false)
  helpOpenRef.current = helpOpen
  paletteOpenRef.current = paletteOpen

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
      if (e.defaultPrevented || e.repeat || e.isComposing) return
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
    else {
      setView(command.view)
      requestAnimationFrame(() => document.getElementById('console-main')?.focus({ preventScroll: true }))
    }
  }

  // Real telemetry source, derived from the events the engine actually
  // delivered (Event.Source in pkg/model): 'sysmon' = sf-sensor reading
  // Sysmon on this host, 'simulate' = sf-devsensor demo scenario.
  const lastSource = events[0]?.source
  const sourceLabel =
    lastSource === 'sysmon'
      ? 'fuente: sf-sensor (Sysmon real)'
      : lastSource === 'etw'
        ? 'fuente: sf-sensor (ETW real)'
      : lastSource === 'simulate'
        ? 'fuente: sf-devsensor (demo)'
        : 'fuente: motor NDJSON'

  const [pendingAlert, setPendingAlert] = useState<SfAlert | null>(null)

  const openInAnalyst = (al: SfAlert) => {
    setPendingAlert(al)
    setView('analista')
  }

  const statusColor = status === 'live' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-400' : 'bg-red-500'
  const statusText = status === 'live' ? 'En vivo' : status === 'connecting' ? 'Conectando' : 'Motor offline'

  return (
    <div className="relative min-h-[100dvh] bg-zinc-950 text-zinc-100">
      <a href="#console-main" className="sr-only z-50 rounded-md bg-emerald-300 px-4 py-2 text-sm text-zinc-950 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Ir al contenido
      </a>
      {/* DotGrid (React Bits): fondo de toda la consola, reactivo al puntero
          con la misma contención y congelado bajo prefers-reduced-motion. */}
      <DotGridLayer />
      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[1600px] flex-col lg:flex-row">
        {/* Sidebar (desktop): glass hairline sobre el fondo ambiental */}
        <aside className="glass sticky top-0 hidden h-[100dvh] w-60 shrink-0 flex-col border-r border-white/[0.06] lg:flex">
          <BrandBlock />
          <nav aria-label="Secciones de la consola" className="mt-4 flex-1 px-2.5">
            <ul className="space-y-0.5">
              {NAV.map((item, idx) => (
                <li key={item.id}>
                  {(idx === 0 || NAV[idx - 1].group !== item.group) && (
                    <p className="px-3 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
                      {item.group}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setView(item.id)}
                    aria-current={view === item.id ? 'page' : undefined}
                    title={hintTitle(item.id)}
                    className={`relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      view === item.id ? 'text-zinc-50' : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
                    }`}
                  >
                    {/* píldora activa animada con layoutId: el resalte viaja
                        entre secciones en lugar de aparecer/desaparecer. El
                        botón lleva `relative` (ancla el inset-0) y la píldora
                        pointer-events-none: durante el vuelo del spring sobre
                        los botones vecinos jamás debe interceptar clicks
                        (defecto real detectado por el E2E de la ronda
                        20h20 cuando el inset-0 se anclaba a la raíz). */}
                    {view === item.id && (
                      <motion.span
                        layoutId="nav-pill"
                        className="pointer-events-none absolute inset-0 rounded-lg border border-emerald-400/20 bg-gradient-to-r from-emerald-500/[0.14] via-emerald-500/[0.06] to-transparent shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
                        transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 }}
                      />
                    )}
                    {view === item.id && (
                      <span aria-hidden className="pointer-events-none absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-gradient-to-b from-emerald-300 to-emerald-500" />
                    )}
                    <item.icon
                      size={16}
                      weight={view === item.id ? 'fill' : 'regular'}
                      aria-hidden
                      className={`relative ${view === item.id ? 'text-emerald-500' : ''}`}
                    />
                    <span className="relative">{item.label}</span>
                    {item.id === 'alertas' && alerts.length > 0 && (
                      <span className="chip relative ml-auto px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-zinc-300">
                        {alerts.length}
                      </span>
                    )}
                    {item.id === 'analista' && analystStatus !== 'live' && (
                      <span aria-hidden className="relative ml-auto h-1.5 w-1.5 rounded-full bg-zinc-600" title="servicio de analista sin conexión" />
                    )}
                    {item.id === 'supresiones' && suppressions.length > 0 && (
                      <span className="relative ml-auto font-mono text-[11px] text-zinc-500">{suppressions.length}</span>
                    )}
                    {item.id === 'cadenas' && sequences.length > 0 && (
                      <span className="relative ml-auto font-mono text-[11px] text-zinc-500">{sequences.length}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="px-4 pb-4">
            <div className="panel px-3 py-2.5">
              <p className="flex items-center gap-2 text-xs text-zinc-200">
                <span className="relative flex h-2 w-2" aria-hidden>
                  {status === 'live' ? (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:hidden" />
                  ) : null}
                  <span aria-hidden className={`relative inline-flex h-2 w-2 rounded-full ${statusColor}`} />
                </span>
                {statusText}
              </p>
              <p className="mt-1 font-mono text-[11px] leading-relaxed text-zinc-500">
                {endpoint}
              </p>
              {stats && status === 'live' && (
                <p className="mt-0.5 font-mono text-[11px] tabular-nums text-zinc-500">
                  activo {formatUptime(stats.uptime_s)}
                </p>
              )}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
              Datos reales del pipeline NDJSON. Sin motor no hay datos: arranca cmd/engine o sf-console.
            </p>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="mt-2 inline-flex items-center gap-1.5 rounded text-[11px] text-zinc-500 transition-colors hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Keyboard size={12} aria-hidden />
              Atajos: <span className="font-mono">{SHORTCUT_PREFIX}·vista</span> · <span className="font-mono">?</span>
            </button>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="glass sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-white/[0.06] px-4 lg:px-6">
            <div className="flex min-w-0 items-baseline gap-3">
              <div className="lg:hidden">
                <BrandRow />
              </div>
              {/* BlurText (React Bits): la entrada palabra a palabra marca el
                  cambio de vista; key={view} reinicia la secuencia. */}
              <h1 className="hidden truncate text-sm font-medium text-zinc-200 lg:block">
                <BlurText key={view} text={titleFor(view)} />
              </h1>
              {stats && status === 'live' && (
                <span className="hidden font-mono text-xs tabular-nums text-zinc-500 xl:inline">
                  motor activo {formatUptime(stats.uptime_s)}
                </span>
              )}
            </div>
            <div className="ml-auto flex min-w-0 items-center gap-2 overflow-x-auto">
              <button
                type="button"
                onClick={() => { setHelpOpen(false); setPaletteOpen(true) }}
                aria-label="Abrir comandos"
                aria-haspopup="dialog"
                aria-keyshortcuts="Control+k Meta+k"
                title="Comandos (Ctrl+K / ⌘K)"
                className="chip shrink-0 gap-2 px-2.5 py-1.5 text-zinc-300 transition-colors hover:border-emerald-400/30 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MagnifyingGlass size={16} aria-hidden />
                <span className="hidden text-xs sm:inline">Comandos</span>
                <kbd aria-hidden className="hidden rounded border border-zinc-700 px-1 font-mono text-[10px] text-zinc-400 md:inline">Ctrl/⌘ K</kbd>
              </button>
              <div className="chip shrink-0 px-2.5 py-1.5">
                <span className="relative flex h-2 w-2" aria-hidden>
                  {status === 'live' ? (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:hidden" />
                  ) : null}
                  <span
                    aria-hidden
                    className={`relative inline-flex h-2 w-2 rounded-full ${
                      status === 'live' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-400' : 'bg-red-500'
                    }`}
                  />
                </span>
                <span className="text-xs text-zinc-300">
                  {/* ShinyText (React Bits): el barrido solo corre con el motor
                      en vivo — comunica flujo activo, no decora. */}
                  {status === 'live' ? (
                    <ShinyText>En vivo</ShinyText>
                  ) : status === 'connecting' ? (
                    'Conectando'
                  ) : (
                    'Motor offline'
                  )}
                </span>
                <span className="hidden font-mono text-[11px] text-zinc-500 sm:inline">{sourceLabel}</span>
              </div>
              <WebhookChip stats={stats} />
              <CorrelatorChip stats={stats} />
              <BeaconChip stats={stats} />
              <ThresholdChip stats={stats} />
            </div>
          </header>

          {/* Mobile nav: explicit collapse of the sidebar */}
          <nav
            aria-label="Secciones de la consola"
            className="flex gap-1 overflow-x-auto border-b border-white/[0.06] px-3 py-2 lg:hidden"
          >
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                aria-current={view === item.id ? 'page' : undefined}
                title={hintTitle(item.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  view === item.id
                    ? 'border-emerald-400/20 bg-emerald-500/[0.12] text-zinc-100'
                    : 'border-transparent text-zinc-400'
                }`}
              >
                <item.icon size={14} aria-hidden className={view === item.id ? 'text-emerald-400' : ''} />
                {item.label}
              </button>
            ))}
          </nav>

          <main id="console-main" tabIndex={-1} className="flex-1 px-4 py-5 outline-none lg:px-6">
            <AnimatedView viewKey={view}>
              {view === 'panel' && <Dashboard onAnalyze={openInAnalyst} onNavigate={setView} />}
              {view === 'flujo' && <LiveFeed />}
              {view === 'alertas' && <AlertsView onAnalyze={openInAnalyst} />}
              {view === 'reglas' && <RulesView />}
              {view === 'cadenas' && <SequencesView />}
              {view === 'supresiones' && <SuppressionsView />}
              {view === 'respuesta' && <RespondView />}
              {view === 'analista' && (
                <AnalystPanel pendingAlert={pendingAlert} clearPending={() => setPendingAlert(null)} />
              )}
            </AnimatedView>
          </main>

          <footer className="border-t border-white/[0.06] px-4 py-3 lg:px-6">
            <p className="text-[11px] text-zinc-500">
              security-framework · consola de operaciones · v0.1.0
            </p>
          </footer>
        </div>
      </div>
      <ShortcutsHelp open={helpOpen} rows={HELP_ROWS} onClose={() => setHelpOpen(false)} />
      <CommandPalette open={paletteOpen} refreshing={refreshing} onClose={() => setPaletteOpen(false)} onExecute={executeCommand} />
    </div>
  )
}

function titleFor(view: ConsoleView): string {
  switch (view) {
    case 'panel':
      return 'Panel de operaciones'
    case 'flujo':
      return 'Flujo en vivo'
    case 'alertas':
      return 'Cola de alertas'
    case 'reglas':
      return 'Reglas de detección'
    case 'cadenas':
      return 'Cadenas de kill chain'
    case 'supresiones':
      return 'Supresiones del operador'
    case 'respuesta':
      return 'Respuesta activa (C3)'
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
      className={`chip hidden px-2.5 py-1.5 font-mono text-[11px] md:flex ${
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

/**
 * Kill-chain correlator chip, fed by /api/stats (correlator_states /
 * correlator_sequences / correlator_cap). Honest by design, like the
 * webhook chip:
 * - hidden while the correlator is off (no sequences/ directory):
 *   showing zeros would suggest a feature the engine is not running;
 * - neutral while there is headroom (states below cap);
 * - red the moment states reach the cap: NEW hosts silently stop being
 *   tracked there, which is detection loss, and the operator must see it.
 */
function CorrelatorChip({ stats }: { stats: EngineStats | null }) {
  // mode is hub-only: direct-engine responses carry no mode, so the chip
  // hides only when the hub explicitly reports the engine offline.
  if (!stats || (stats.mode && stats.mode !== 'engine')) return null
  const { correlator_states: states, correlator_sequences: seqs, correlator_cap: cap } = stats
  if (seqs === 0) return null
  const exhausted = cap > 0 && states >= cap
  return (
    <div
      title={
        exhausted
          ? `Correlador al límite: ${states} cadenas en curso (cap ${cap}). Hosts NUEVOS dejan de ser correlacionados hasta que se liberen estados.`
          : `Correlador: ${states} cadenas en curso, ${seqs} secuencias cargadas (cap ${cap})`
      }
      className={`chip hidden px-2.5 py-1.5 font-mono text-[11px] md:flex ${
        exhausted ? 'border-red-400/40 bg-red-400/10 text-red-300' : 'text-zinc-400'
      }`}
    >
      <span aria-hidden>{exhausted ? '✕' : '⛓'}</span>
      <span>
        correlador {states}
        <span className="text-zinc-600">/{cap}</span>
      </span>
    </div>
  )
}

/**
 * Beaconing detector chip (engine A3), fed by /api/stats (beacons_tracked /
 * beacons_cap / beacons_fired). Honest by design, like the correlator chip:
 * - hidden while the detector is off (no beacons.yaml or -beacons ""):
 *   an all-zero chip would suggest the engine is hunting beacons when the
 *   feature is not even loaded;
 * - neutral while there is headroom (tracked below cap);
 * - red the moment tracked reaches the cap: NEW destinations silently stop
 *   being tracked there (weakest-evicted-first), which is detection loss
 *   on a flooded feed, and the operator must see it.
 */
function BeaconChip({ stats }: { stats: EngineStats | null }) {
  if (!stats || (stats.mode && stats.mode !== 'engine')) return null
  const { beacons_tracked: tracked = 0, beacons_cap: cap = 0, beacons_fired: fired = 0 } = stats
  if (!cap && !tracked) return null
  const exhausted = cap > 0 && tracked >= cap
  return (
    <div
      title={
        exhausted
          ? `Detector de beaconing al límite: ${tracked} destinos seguidos (cap ${cap}). Destinos NUEVOS dejan de rastrearse hasta que se liberen claves.`
          : `Beaconing: ${tracked} destinos seguidos de ${cap}, ${fired} disparos desde el arranque (regularidad CV por perfil, host y destino)`
      }
      className={`chip hidden px-2.5 py-1.5 font-mono text-[11px] md:flex ${
        exhausted ? 'border-red-400/40 bg-red-400/10 text-red-300' : 'text-zinc-400'
      }`}
    >
      <Broadcast size={12} aria-hidden />
      <span>
        beacons {tracked}
        <span className="text-zinc-600">/{cap}</span>
      </span>
    </div>
  )
}

/**
 * Volumetric threshold chip (engine A2), fed by /api/stats (threshold_rules /
 * threshold_keys / threshold_fired). Honest by design:
 * - hidden while the detector is off (missing -thresholds file): the engine
 *   reports an all-zero trio and showing it would imply coverage there is not;
 * - neutral always: the engine exposes no cap for the tracker keys, so this
 *   chip refuses to paint a saturation signal it cannot know about (unlike
 *   the beacon/correlator chips, whose caps come from /api/stats itself).
 * Visible numbers: definitions loaded (the detector is armed) and alerts
 * fired, middle-dot separated like the KPI subtitles; live aggregation keys
 * live in the tooltip.
 */
function ThresholdChip({ stats }: { stats: EngineStats | null }) {
  if (!stats || (stats.mode && stats.mode !== 'engine')) return null
  const { threshold_rules: defs = 0, threshold_keys: keys = 0, threshold_fired: fired = 0 } = stats
  if (!defs) return null
  return (
    <div
      title={`Umbrales volumétricos: ${defs} definiciones cargadas, ${keys} claves de agregación vivas, ${fired} disparos desde el arranque`}
      className="chip hidden px-2.5 py-1.5 font-mono text-[11px] text-zinc-400 md:flex"
    >
      <Gauge size={12} aria-hidden />
      <span>
        umbrales {defs}
        <span className="text-zinc-600"> · {fired}</span>
      </span>
    </div>
  )
}

function BrandBlock() {
  return (
    <div className="px-4 pt-5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-400/30 bg-gradient-to-b from-emerald-400/20 to-emerald-500/[0.06] font-mono text-xs font-semibold text-emerald-300 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.10),0_0_18px_rgba(52,211,153,0.22)]">
          sf
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-medium tracking-tight text-zinc-50">security-framework</span>
          {/* DecryptedText (React Bits): la etiqueta se descodifica una vez
              al montar; gesto temático y contenido, cero ruido después. */}
          <DecryptedText text="consola de detección" className="block text-[11px] text-zinc-500" />
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="chip px-1.5 py-0.5 font-mono text-[10px] leading-none text-zinc-500">
          v0.1.0 · consola SOC
        </span>
      </div>
      <div aria-hidden className="mt-3 h-px bg-gradient-to-r from-emerald-400/30 via-white/10 to-transparent" />
    </div>
  )
}

function BrandRow() {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-md border border-emerald-500/40 bg-emerald-500/10 font-mono text-[11px] font-semibold text-emerald-400">
        sf
      </span>
      <span className="text-sm font-medium text-zinc-100">security-framework</span>
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
