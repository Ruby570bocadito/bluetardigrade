'use client'

// Console shell: sidebar navigation on desktop, horizontal nav on mobile,
// topbar with the live engine status (the only place a status dot is
// semantically allowed: it reflects the real socket state).

import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ActivityIcon, ShieldCheck, SquaresFour, Warning, ChatsCircle } from '@phosphor-icons/react'
import { useConsole } from './socket-provider'
import { Dashboard } from './dashboard'
import { LiveFeed } from './live-feed'
import { AlertsView } from './alerts-view'
import { RulesView } from './rules-view'
import { AnalystPanel } from './analyst-panel'
import { formatUptime, type SfAlert } from '@/lib/console-types'

type ViewId = 'panel' | 'flujo' | 'alertas' | 'reglas' | 'analista'

const NAV: { id: ViewId; label: string; icon: React.ElementType }[] = [
  { id: 'panel', label: 'Panel', icon: SquaresFour },
  { id: 'flujo', label: 'Flujo en vivo', icon: ActivityIcon },
  { id: 'alertas', label: 'Alertas', icon: Warning },
  { id: 'reglas', label: 'Reglas', icon: ShieldCheck },
  { id: 'analista', label: 'Analista IA', icon: ChatsCircle },
]

export function ConsoleShell() {
  const { status, stats, alerts, startedAt } = useConsole()
  const [view, setView] = useState<ViewId>('panel')
  const [pendingAlert, setPendingAlert] = useState<SfAlert | null>(null)

  const openInAnalyst = (al: SfAlert) => {
    setPendingAlert(al)
    setView('analista')
  }

  return (
    <div className="min-h-[100dvh] bg-[#0b0d10] text-zinc-100">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[1400px] flex-col lg:flex-row">
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
                      view === item.id ? 'bg-white/[0.06] text-zinc-100' : 'text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200'
                    }`}
                  >
                    <item.icon size={16} weight={view === item.id ? 'fill' : 'regular'} aria-hidden />
                    {item.label}
                    {item.id === 'alertas' && alerts.length > 0 && (
                      <span className="ml-auto font-mono text-[11px] text-zinc-500">{alerts.length}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <p className="px-4 py-4 text-[11px] leading-relaxed text-zinc-600">
            Consola del tracer bullet. Telemetría simulada con el mismo contrato NDJSON que el sensor Rust.
          </p>
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center justify-between gap-3 border-b border-white/[0.08] px-4 lg:px-6">
            <div className="lg:hidden">
              <BrandRow />
            </div>
            <div className="hidden items-baseline gap-2 lg:flex">
              <h1 className="text-sm font-medium text-zinc-200">{titleFor(view)}</h1>
              {startedAt && stats && (
                <span className="font-mono text-xs text-zinc-600">sensor activo {formatUptime(stats.uptime_s)}</span>
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
                {status === 'live' ? 'En vivo' : status === 'connecting' ? 'Conectando' : 'Reconectando'}
              </span>
              <span className="hidden font-mono text-[11px] text-zinc-600 sm:inline">ETW · simulación</span>
            </div>
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
    case 'analista':
      return 'Analista IA'
  }
}

function BrandBlock() {
  return (
    <div className="flex items-center gap-2.5 px-4 pt-5">
      <span className="flex h-7 w-7 items-center justify-center rounded-md border border-emerald-400/40 bg-emerald-400/10 font-mono text-xs font-semibold text-emerald-300">
        sf
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-medium text-zinc-100">security-framework</span>
        <span className="block text-[11px] text-zinc-500">consola de detección</span>
      </span>
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
