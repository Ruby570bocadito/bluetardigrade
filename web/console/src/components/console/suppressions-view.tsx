'use client'

// Operator allowlist view (read-only, mirrors GET /api/suppressions via
// the hub). Suppressed rule/host pairs raise no alert, so they are easy
// to forget: this view makes the "holes" in the alert queue visible and
// states plainly that editing happens in suppressions.yaml (hot-reloaded
// by the engine every 15 s) - there is no write API by design.

import { useEffect, useState } from 'react'
import { Prohibit, Timer, Warning } from '@phosphor-icons/react'
import { useEngine } from './engine-provider'
import { EmptyState, StatTile } from './ui-bits'
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
  const { suppressions, rules, status } = useEngine()
  useSlowTick()
  const now = new Date()

  const ruleName = (id: string) => rules.find((r) => r.id === id)?.name
  const withExpiry = suppressions.filter((s) => s.expires).length
  const expired = suppressions.filter((s) => countdown(s.expires, now) === 'expirada').length
  const broad = suppressions.filter((s) => !s.host || !s.rule_id).length

  return (
    <section aria-label="Supresiones del operador" className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile icon={Prohibit} label="Supresiones activas" value={suppressions.length} hint="suppressions.yaml, recarga en caliente" />
        <StatTile icon={Timer} label="Con caducidad" value={withExpiry} hint={expired ? `${expired} ya expiradas: elimínalas del YAML` : 'el resto no caduca nunca'} warn={expired > 0} />
        <StatTile icon={Warning} label="De alcance amplio" value={broad} hint="todas las reglas de un host o un host comodín" warn={broad > 0} />
      </div>

      <p className="max-w-[90ch] text-xs leading-relaxed text-zinc-500">
        Reglas silenciadas a propósito por el operador (ventanas de mantenimiento o excepciones aceptadas): los eventos que
        coinciden <span className="text-zinc-300">no generan alertas</span>, no llegan al webhook ni alimentan el correlador.
        Edite <code className="rounded bg-white/[0.06] px-1 font-mono text-[11px] text-zinc-300">suppressions.yaml</code> y el
        motor lo recarga en caliente; esta vista es de solo lectura.
      </p>

      {status !== 'live' && suppressions.length === 0 ? (
        <div className="panel px-4 py-6">
          <div className="h-24 animate-pulse rounded bg-white/5" />
        </div>
      ) : suppressions.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={Prohibit}
            title="Ninguna supresión activa"
            hint="Todas las detecciones llegan a la cola. Para silenciar una regla (p. ej. durante un cambio autorizado), añada una entrada a suppressions.yaml"
          />
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">Supresiones activas: regla, alcance, motivo y caducidad</caption>
              <thead>
                <tr className="bg-zinc-900">
                  {['Regla', 'Alcance', 'Motivo', 'Caducidad'].map((h) => (
                    <th key={h} scope="col" className="border-b border-zinc-800 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {suppressions.map((s, i) => (
                  <SuppressionRow key={`${s.rule_id}:${s.host ?? '*'}:${i}`} entry={s} ruleName={ruleName(s.rule_id)} now={now} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

function SuppressionRow({ entry, ruleName, now }: { entry: SfSuppression; ruleName?: string; now: Date }) {
  const left = countdown(entry.expires, now)
  return (
    <tr className="align-top transition-colors hover:bg-zinc-900/60">
      <td className="max-w-[320px] px-4 py-3">
        <span className="flex items-center gap-2">
          <Prohibit size={14} weight="fill" aria-hidden className="shrink-0 text-zinc-500" />
          <span className="min-w-0">
            <span className="block truncate text-[13px] text-zinc-100">{ruleName ?? (entry.rule_id ? 'regla no cargada' : 'todas las reglas')}</span>
            {entry.rule_id && <span className="block truncate font-mono text-[11px] text-zinc-500">{entry.rule_id}</span>}
          </span>
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <span
          className={`rounded-md border px-1.5 py-0.5 font-mono text-[11px] ${
            entry.host ? 'border-zinc-700 text-zinc-300' : 'border-amber-300/30 bg-amber-300/10 text-amber-200'
          }`}
        >
          {entry.host ? entry.host : 'todos los hosts'}
        </span>
      </td>
      <td className="min-w-[220px] px-4 py-3 text-xs leading-relaxed text-zinc-400">{entry.reason || <span className="text-zinc-500">sin motivo declarado</span>}</td>
      <td className="whitespace-nowrap px-4 py-3">
        {left ? (
          <span
            title={entry.expires}
            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${
              left === 'expirada' ? 'border-red-400/30 bg-red-400/10 text-red-300' : 'border-zinc-700 text-zinc-300'
            }`}
          >
            <Timer size={12} aria-hidden />
            {left}
          </span>
        ) : (
          <span className="text-[11px] text-zinc-500">sin caducidad</span>
        )}
      </td>
    </tr>
  )
}
