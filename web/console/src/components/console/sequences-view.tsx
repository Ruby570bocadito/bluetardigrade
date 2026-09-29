'use client'

// Kill-chain sequences view (read-only, mirrors GET /api/sequences via
// the hub). The correlator stitches individual rule hits into campaign
// alerts, but until now an operator could not see WHICH chains are
// armed without reading the YAML by hand. This view lists the loaded
// sequences: severity, window, the rule chain and the MITRE tags the
// completion alert will carry. Editing happens in sequences/*.yaml
// (hot-reloaded by the engine every 15 s) - there is no write API, same
// as suppressions.

import { FlowArrow, Timer } from '@phosphor-icons/react'
import { useConsole } from './socket-provider'
import { EmptyState, SectionHeader, SeverityBadge } from './ui-bits'
import type { SfSequence } from '@/lib/console-types'

function formatWindow(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'ventana n/d'
  if (seconds % 60 !== 0) return `ventana ${seconds}s`
  const min = seconds / 60
  if (min % 60 !== 0) return `ventana ${min} min`
  const h = min / 60
  return `ventana ${h}h`
}

export function SequencesView() {
  const { sequences, rules, status } = useConsole()

  const liveRules = new Set(rules.map((r) => r.name))
  const armed = sequences.filter((s) => s.steps.every((step) => liveRules.has(step))).length

  return (
    <section aria-label="Cadenas de kill chain">
      <SectionHeader title="Cadenas" count={sequences.length} />

      <p className="max-w-[80ch] pb-4 text-xs leading-relaxed text-zinc-500">
        Secuencias de kill chain cargadas por el correlador: cuando todos los pasos de una cadena se
        observan en el <span className="text-zinc-400">mismo host dentro de la ventana</span>, el motor
        levanta una sola alerta de campaña (el orden de los pasos no importa). Edite{' '}
        <code className="rounded bg-white/[0.06] px-1 font-mono text-[11px] text-zinc-300">sequences/*.yaml</code>{' '}
        y el motor lo recarga en caliente; esta vista es de solo lectura.
        {sequences.length > 0 && (
          <>
            {' '}
            {armed === sequences.length ? (
              <span className="text-emerald-300/90">Todas las cadenas están armadas: cada paso tiene su regla cargada.</span>
            ) : (
              <span className="text-amber-300/90">
                {sequences.length - armed} de {sequences.length} cadenas tienen pasos sin regla cargada y no
                pueden completarse hasta que la regla exista.
              </span>
            )}
          </>
        )}
      </p>

      {status !== 'live' && sequences.length === 0 ? (
        <div className="h-24 animate-pulse rounded bg-white/5" />
      ) : sequences.length === 0 ? (
        <EmptyState
          icon={FlowArrow}
          title="Sin secuencias cargadas"
          hint="El correlador está apagado: el motor no encontró un directorio sequences/ con YAML válido. Crea sequences/kill-chains.yaml y se cargará en el próximo hot-reload."
        />
      ) : (
        <ul className="space-y-3">
          {sequences.map((s) => (
            <SequenceCard key={s.id} seq={s} rules={rules.map((r) => r.name)} />
          ))}
        </ul>
      )}
    </section>
  )
}

function SequenceCard({ seq, rules }: { seq: SfSequence; rules: string[] }) {
  const live = new Set(rules)
  const missing = seq.steps.filter((step) => !live.has(step))
  return (
    <li className="rounded-md border border-white/[0.08] bg-white/[0.02] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <FlowArrow size={14} weight="fill" aria-hidden className="shrink-0 text-zinc-500" />
        <span className="text-sm font-medium text-zinc-100">{seq.name}</span>
        <SeverityBadge severity={seq.severity} />
        <span
          title={`ventana: ${seq.window_seconds}s`}
          className="flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
        >
          <Timer size={11} aria-hidden />
          {formatWindow(seq.window_seconds)}
        </span>
        {seq.tags.map((t) => (
          <span key={t} className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
            {t.startsWith('attack.') ? t.replace('attack.', '') : t}
          </span>
        ))}
      </div>

      <p className="mt-2 max-w-[100ch] text-xs leading-relaxed text-zinc-400">{seq.description}</p>

      <ol className="mt-3 flex flex-wrap items-center gap-1.5">
        {seq.steps.map((step, i) => {
          const ok = live.has(step)
          return (
            <li key={`${seq.id}:${i}`} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden className="font-mono text-xs text-zinc-600">→</span>}
              <span
                title={ok ? 'regla cargada en el motor' : 'regla NO cargada: la cadena no puede completar con este paso'}
                className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${
                  ok ? 'border-white/10 text-zinc-300' : 'border-amber-300/30 bg-amber-300/10 text-amber-200'
                }`}
              >
                {step}
              </span>
            </li>
          )
        })}
      </ol>

      {missing.length > 0 && (
        <p className="mt-2 text-[11px] text-amber-300/80">
          Pasos sin regla cargada: {missing.join(', ')}. El completion nunca se disparará hasta que esas reglas
          existan en rules/.
        </p>
      )}

      <p className="mt-2 font-mono text-[10px] text-zinc-600">id: {seq.id}</p>
    </li>
  )
}
