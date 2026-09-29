'use client'

// Operator allowlist view (read-only, mirrors GET /api/suppressions via
// the hub). Suppressed rule/host pairs raise no alert, so they are easy
// to forget: this view makes the "holes" in the alert queue visible and
// states plainly that editing happens in suppressions.yaml (hot-reloaded
// by the engine every 15 s) - there is no write API by design.

import { useEffect, useState } from 'react'
import { Prohibit, Timer } from '@phosphor-icons/react'
import { useConsole } from './socket-provider'
import { EmptyState, SectionHeader } from './ui-bits'
import type { SfSuppression } from '@/lib/console-types'

/** Re-renders every 30 s so the expiry countdowns stay truthful. */
function useSlowTick() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])
}

function countdown(iso: string | undefined, now: Date): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const ms = t - now.getTime()
  if (ms <= 0) return 'expirada'
  const min = Math.floor(ms / 60_000)
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  if (d > 0) return `expira en ${d}d ${h}h`
  if (h > 0) return `expira en ${h}h ${m}m`
  return `expira en ${m}m`
}

export function SuppressionsView() {
  const { suppressions, rules, status } = useConsole()
  useSlowTick()
  const now = new Date()

  const ruleName = (id: string) => rules.find((r) => r.id === id)?.name

  return (
    <section aria-label="Supresiones del operador">
      <SectionHeader title="Supresiones" count={suppressions.length} />

      <p className="max-w-[80ch] pb-4 text-xs leading-relaxed text-zinc-500">
        Reglas silenciadas a propósito por el operador (ventanas de mantenimiento o excepciones aceptadas):
        los eventos que coinciden <span className="text-zinc-400">no generan alertas</span>, no llegan al webhook ni
        alimentan el correlador. Edite <code className="rounded bg-white/[0.06] px-1 font-mono text-[11px] text-zinc-300">suppressions.yaml</code>{' '}
        y el motor lo recarga en caliente; esta vista es de solo lectura.
      </p>

      {status !== 'live' && suppressions.length === 0 ? (
        <div className="h-24 animate-pulse rounded bg-white/5" />
      ) : suppressions.length === 0 ? (
        <EmptyState
          icon={Prohibit}
          title="Ninguna supresión activa"
          hint="Todas las detecciones llegan a la cola. Para silenciar una regla (p. ej. durante un cambio autorizado), añada una entrada a suppressions.yaml"
        />
      ) : (
        <ul className="divide-y divide-white/[0.06] border-y border-white/[0.08]">
          {suppressions.map((s, i) => (
            <SuppressionRow key={`${s.rule_id}:${s.host ?? '*'}:${i}`} entry={s} ruleName={ruleName(s.rule_id)} now={now} />
          ))}
        </ul>
      )}
    </section>
  )
}

function SuppressionRow({
  entry,
  ruleName,
  now,
}: {
  entry: SfSuppression
  ruleName?: string
  now: Date
}) {
  const left = countdown(entry.expires, now)
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Prohibit size={14} weight="fill" aria-hidden className="shrink-0 text-zinc-500" />
        <span className="font-mono text-sm text-zinc-100">{entry.rule_id || 'todas las reglas'}</span>
        {ruleName && <span className="text-xs text-zinc-500">{ruleName}</span>}
        <span
          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
            entry.host ? 'border-white/10 text-zinc-400' : 'border-amber-300/30 bg-amber-300/10 text-amber-200'
          }`}
        >
          {entry.host ? `host: ${entry.host}` : 'todos los hosts'}
        </span>
        {left && (
          <span
            title={entry.expires}
            className={`flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
              left === 'expirada'
                ? 'border-red-400/30 bg-red-400/10 text-red-300'
                : 'border-white/10 text-zinc-400'
            }`}
          >
            <Timer size={11} aria-hidden />
            {left}
          </span>
        )}
      </div>
      {entry.reason && (
        <p className="mt-1 pl-6 text-xs leading-relaxed text-zinc-400">{entry.reason}</p>
      )}
    </li>
  )
}
