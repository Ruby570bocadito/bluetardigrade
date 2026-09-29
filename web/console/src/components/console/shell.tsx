'use client'

// Console shell: sidebar navigation on desktop, horizontal nav on mobile,
// topbar with the live engine status (the only place a status dot is
// semantically allowed: it reflects the real socket state).

import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ActivityIcon, Prohibit, ShieldCheck, SquaresFour, Warning, ChatsCircle, FlowArrow } from '@phosphor-icons/react'
import { useConsole } from './socket-provider'
import { BlurText } from '@/components/reactbits/blur-text'
import { ShinyText } from '@/components/reactbits/shiny-text'
import { DotGridLayer } from '@/components/reactbits/dot-grid'
import { DecryptedText } from '@/components/reactbits/decrypted-text'
import { Dashboard } from './dashboard'
import { LiveFeed } from './live-feed'
import { AlertsView } from './alerts-view'
import { RulesView } from './rules-view'
import { SuppressionsView } from './suppressions-view'
import { SequencesView } from './sequences-view'
import { AnalystPanel } from './analyst-panel'
import { formatUptime, type SfAlert, type SimStats } from '@/lib/console-types'

type ViewId = 'panel' | 'flujo' | 'alertas' | 'reglas' | 'cadenas' | 'supresiones' | 'analista'

const NAV: { id: ViewId; label: string; icon: React.ElementType }[] = [
  { id: 'panel', label: 'Panel', icon: SquaresFour },
  { id: 'flujo', label: 'Flujo en vivo', icon: ActivityIcon },
  { id: 'alertas', label: 'Alertas', icon: Warning },
  { id: 'reglas', label: 'Reglas', icon: ShieldCheck },
  { id: 'cadenas', label: 'Cadenas', icon: FlowArrow },
  { id: 'supresiones', label: 'Supresiones', icon: Prohibit },
  { id: 'analista', label: 'Analista IA', icon: ChatsCircle },
]

export function ConsoleShell() {
  const { status, stats, alerts, events, suppressions, sequences, startedAt } = useConsole()
  const [view, setView] = useState<ViewId>('panel')
  const reduce = useReducedMotion()

  // Real telemetry source, derived from the events the engine actually
  // delivered (Event.Source in pkg/model): 'sysmon' = sf-sensor reading
  // Sysmon on this host, 'simulate' = sf-devsensor demo scenario.
  const lastSource = events[0]?.source
  const sourceLabel =
    stats?.mode !== 'engine'
      ? 'sin motor'
      : lastSource === 'sysmon'
        ? 'fuente: sf-sensor (Sysmon real)'
        : lastSource === 'simulate'
          ? 'fuente: sf-devsensor (demo)'
          : 'fuente: motor NDJSON'
  const [pendingAlert, setPendingAlert] = useState<SfAlert | null>(null)

  const openInAnalyst = (al: SfAlert) => {
    setPendingAlert(al)
    setView('analista')
  }

  return (
    <div className="relative min-h-[100dvh] bg-[#0b0d10] text-zinc-100">
      {/* DotGrid (React Bits): fondo de toda la consola. La rejilla estaba
          antes en CSS estático del sidebar; ahora reacciona al puntero con
          la misma contención (alpha base 0.05) y se congela sin movimiento
          bajo prefers-reduced-motion. */}
      <DotGridLayer />
      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[1400px] flex-col lg:flex-row">
        {/* Sidebar (desktop) */}
        <aside className="hidden w-56 shrink-0 flex-col border-r border-white/[0.08] lg:flex">
          <BrandBlock />
          <nav aria-label="Secciones de la consola" className="mt-2 flex-1 px-2">
            <ul className="space-y-0.5">
              {NAV.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setView(item.id)}
                    aria-current={view === item.id ? 'page' : undefined}
                    className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors active:scale-[0.99] ${
                      view === item.id ? 'text-zinc-100' : 'text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200'
                    }`}
                  >
                    {/* píldora activa animada con layoutId: el resalte viaja
                        entre secciones en lugar de aparecer/desaparecer; el
                        contenido lleva `relative` para pintar por encima */}
                    {view === item.id && (
                      <motion.span
                        layoutId="nav-pill"
                        className="absolute inset-0 rounded-md bg-white/[0.06]"
                        transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 }}
                      />
                    )}
                    <item.icon size={16} weight={view === item.id ? 'fill' : 'regular'} aria-hidden className="relative" />
                    <span className="relative">{item.label}</span>
                    {item.id === 'alertas' && alerts.length > 0 && (
                      <span className="relative ml-auto font-mono text-[11px] text-zinc-500">{alerts.length}</span>
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
          <p className="px-4 py-4 text-[11px] leading-relaxed text-zinc-600">
            {stats?.mode === 'engine'
              ? 'Conectada al motor Go real: eventos y alertas del pipeline NDJSON en directo.'
              : 'Sin conexión con el motor Go: no se muestra ningún dato. Arranca sf-engine o sf-console.'}
          </p>
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="ambient-glow relative flex h-14 items-center justify-between gap-3 border-b border-white/[0.08] px-4 lg:px-6">
            <div className="lg:hidden">
              <BrandRow />
            </div>
            <div className="hidden items-baseline gap-2 lg:flex">
              {/* BlurText (React Bits): la entrada palabra a palabra marca el
                  cambio de vista; key={view} reinicia la secuencia. */}
              <h1 className="text-sm font-medium text-zinc-200">
                <BlurText key={view} text={titleFor(view)} />
              </h1>
              {startedAt && stats && (
                <span className="font-mono text-xs text-zinc-600">motor activo {formatUptime(stats.uptime_s)}</span>
              )}
            </div>
            <div className="flex items-center gap-2 rounded-md border border-white/[0.08] px-2.5 py-1.5">
              <span className="relative flex h-2 w-2" aria-hidden>
                {status === 'live' ? (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:hidden" />
                ) : null}
                <span
                  className={`relative inline-flex h-2 w-2 rounded-full ${
                    status === 'live' ? 'bg-emerald-400' : status === 'connecting' ? 'bg-amber-300' : 'bg-red-400'
                  }`}
                />
              </span>
              <span className="text-xs text-zinc-400">
                {/* ShinyText (React Bits): el barrido solo corre con el socket
                    en vivo — comunica flujo activo, no decora. */}
                {status === 'live' ? (
                  <ShinyText>En vivo</ShinyText>
                ) : status === 'connecting' ? (
                  'Conectando'
                ) : (
                  'Reconectando'
                )}
              </span>
              <span className="hidden font-mono text-[11px] text-zinc-600 sm:inline">
                {sourceLabel}
              </span>
            </div>
            <WebhookChip stats={stats} />
            <CorrelatorChip stats={stats} />
          </header>

          {/* Mobile nav */}
          <nav aria-label="Secciones de la consola" className="flex gap-1 overflow-x-auto border-b border-white/[0.08] px-3 py-2 lg:hidden">
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                aria-current={view === item.id ? 'page' : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs ${
                  view === item.id ? 'bg-white/[0.06] text-zinc-100' : 'text-zinc-400'
                }`}
              >
                <item.icon size={14} aria-hidden />
                {item.label}
              </button>
            ))}
          </nav>

          <main className="flex-1 px-4 py-6 lg:px-6">
            <AnimatedView viewKey={view}>
              {view === 'panel' && <Dashboard onAnalyze={openInAnalyst} />}
              {view === 'flujo' && <LiveFeed />}
              {view === 'alertas' && <AlertsView onAnalyze={openInAnalyst} />}
              {view === 'reglas' && <RulesView />}
              {view === 'cadenas' && <SequencesView />}
              {view === 'supresiones' && <SuppressionsView />}
              {view === 'analista' && <AnalystPanel pendingAlert={pendingAlert} clearPending={() => setPendingAlert(null)} />}
            </AnimatedView>
          </main>

          <footer className="border-t border-white/[0.08] px-4 py-3 lg:px-6">
            <p className="text-[11px] text-zinc-600">
              security-framework · tracer bullet v0.1 · reglas YAML evaluadas en caliente · consulte docs/arquitectura para el
              diseño completo
            </p>
          </footer>
        </div>
      </div>
    </div>
  )
}

function titleFor(view: ViewId): string {
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
function WebhookChip({ stats }: { stats: SimStats | null }) {
  if (!stats || stats.mode !== 'engine') return null
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
function CorrelatorChip({ stats }: { stats: SimStats | null }) {
  if (!stats || stats.mode !== 'engine') return null
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
      <span className="flex h-6 w-6 items-center justify-center rounded-md border border-emerald-400/40 bg-emerald-400/10 font-mono text-[11px] font-semibold text-emerald-300">
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
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  )
}
