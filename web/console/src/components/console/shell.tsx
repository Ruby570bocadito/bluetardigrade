'use client'

// Console shell: fixed sidebar on desktop, top bar plus horizontal nav
// on mobile (explicit collapse). The topbar carries the only status dot
// of the chrome: it reflects the real engine connection state.

import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ActivityIcon, Prohibit, ShieldCheck, SquaresFour, Warning, ChatsCircle, FlowArrow } from '@phosphor-icons/react'
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
import { SequencesView } from './sequences-view'
import { AnalystPanel } from './analyst-panel'
import { formatUptime, type EngineStats, type SfAlert } from '@/lib/console-types'
import { useAnalystChannel } from './socket-provider'

const NAV: { id: ConsoleView; label: string; icon: React.ElementType }[] = [
  { id: 'panel', label: 'Panel', icon: SquaresFour },
  { id: 'flujo', label: 'Flujo en vivo', icon: ActivityIcon },
  { id: 'alertas', label: 'Alertas', icon: Warning },
  { id: 'reglas', label: 'Reglas', icon: ShieldCheck },
  { id: 'cadenas', label: 'Cadenas', icon: FlowArrow },
  { id: 'supresiones', label: 'Supresiones', icon: Prohibit },
  { id: 'analista', label: 'Analista IA', icon: ChatsCircle },
]

export function ConsoleShell() {
  const { status, stats, alerts, events, suppressions, sequences, endpoint } = useEngine()
  const { status: analystStatus } = useAnalystChannel()
  const [view, setView] = useState<ConsoleView>('panel')
  const reduce = useReducedMotion()

  // Real telemetry source, derived from the events the engine actually
  // delivered (Event.Source in pkg/model): 'sysmon' = sf-sensor reading
  // Sysmon on this host, 'simulate' = sf-devsensor demo scenario.
  const lastSource = events[0]?.source
  const sourceLabel =
    lastSource === 'sysmon'
      ? 'fuente: sf-sensor (Sysmon real)'
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
      {/* DotGrid (React Bits): fondo de toda la consola, reactivo al puntero
          con la misma contención y congelado bajo prefers-reduced-motion. */}
      <DotGridLayer />
      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[1600px] flex-col lg:flex-row">
        {/* Sidebar (desktop) */}
        <aside className="sticky top-0 hidden h-[100dvh] w-60 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 lg:flex">
          <BrandBlock />
          <nav aria-label="Secciones de la consola" className="mt-4 flex-1 px-2">
            <ul className="space-y-0.5">
              {NAV.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setView(item.id)}
                    aria-current={view === item.id ? 'page' : undefined}
                    className={`relative flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      view === item.id ? 'text-zinc-100' : 'text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200'
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
                        className="pointer-events-none absolute inset-0 rounded-md bg-zinc-800"
                        transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 }}
                      />
                    )}
                    <item.icon
                      size={16}
                      weight={view === item.id ? 'fill' : 'regular'}
                      aria-hidden
                      className={`relative ${view === item.id ? 'text-emerald-500' : ''}`}
                    />
                    <span className="relative">{item.label}</span>
                    {item.id === 'alertas' && alerts.length > 0 && (
                      <span className="relative ml-auto rounded-md border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-zinc-400">
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
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5">
              <p className="flex items-center gap-2 text-xs text-zinc-300">
                <span aria-hidden className={`h-2 w-2 rounded-full ${statusColor}`} />
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
          </div>
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/95 px-4 lg:px-6">
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
            <div className="flex shrink-0 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5">
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
          </header>

          {/* Mobile nav: explicit collapse of the sidebar */}
          <nav
            aria-label="Secciones de la consola"
            className="flex gap-1 overflow-x-auto border-b border-zinc-800 px-3 py-2 lg:hidden"
          >
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                aria-current={view === item.id ? 'page' : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  view === item.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'
                }`}
              >
                <item.icon size={14} aria-hidden className={view === item.id ? 'text-emerald-500' : ''} />
                {item.label}
              </button>
            ))}
          </nav>

          <main className="flex-1 px-4 py-5 lg:px-6">
            <AnimatedView viewKey={view}>
              {view === 'panel' && <Dashboard onAnalyze={openInAnalyst} onNavigate={setView} />}
              {view === 'flujo' && <LiveFeed />}
              {view === 'alertas' && <AlertsView onAnalyze={openInAnalyst} />}
              {view === 'reglas' && <RulesView />}
              {view === 'cadenas' && <SequencesView />}
              {view === 'supresiones' && <SuppressionsView />}
              {view === 'analista' && (
                <AnalystPanel pendingAlert={pendingAlert} clearPending={() => setPendingAlert(null)} />
              )}
            </AnimatedView>
          </main>

          <footer className="border-t border-zinc-800 px-4 py-3 lg:px-6">
            <p className="text-[11px] text-zinc-500">
              security-framework · consola SOC v0.1 · reglas YAML evaluadas en caliente · consulte docs/arquitectura para el
              diseño completo
            </p>
          </footer>
        </div>
      </div>
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
      className={`hidden items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] md:flex ${
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
      className={`hidden items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] md:flex ${
        exhausted ? 'border-red-400/40 bg-red-400/10 text-red-300' : 'border-white/[0.08] text-zinc-400'
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

function BrandBlock() {
  return (
    <div className="px-4 pt-5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-md border border-emerald-400/40 bg-emerald-400/10 font-mono text-xs font-semibold text-emerald-300 shadow-[0_0_14px_rgba(52,211,153,0.18)]">
          sf
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-medium text-zinc-100">security-framework</span>
          {/* DecryptedText (React Bits): la etiqueta se descodifica una vez
              al montar; gesto temático y contenido, cero ruido después. */}
          <DecryptedText text="consola de detección" className="block text-[11px] text-zinc-500" />
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] leading-none text-zinc-500">
          v0.1 · tracer bullet
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
