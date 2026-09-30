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
import { useEngine } from './engine-provider'
import { EmptyState, SectionHeader, SeverityBadge } from './ui-bits'
import { AnimatedItem } from '@/components/reactbits/animated-list'
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
  const { sequences, rules, status } = useEngine()

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
          {sequences.map((s, i) => (
            <SequenceCard key={s.id} seq={s} index={i} rules={rules.map((r) => r.name)} />
          ))}
        </ul>
      )}
    </section>
  )
}

function SequenceCard({ seq, index, rules }: { seq: SfSequence; index: number; rules: string[] }) {
  const live = new Set(rules)
  const missing = seq.steps.filter((step) => !live.has(step))
  // armed = every step has a live rule in the engine: the chain CAN
  // complete and raise its campaign alert. The connector color carries
  // exactly that fact (emerald flow vs. neutral line) — state, not decor.
  const armed = missing.length === 0
  return (
    <li>
      {/* AnimatedItem (React Bits): entrada escalonada en el montaje, misma
          pauta que la telemetría del Panel; keys estables, sin re-animar. */}
      <AnimatedItem
        index={index}
        className="panel panel-hover px-4 py-3"
      >
      <div className="flex flex-wrap items-center gap-2">
        {/* el icono comunica si la cadena puede completar: esmeralda armada,
            ámbar con pasos huérfanos */}
        <FlowArrow
          size={14}
          weight="fill"
          aria-hidden
          className={`shrink-0 ${armed ? 'text-emerald-300/80' : 'text-amber-300/80'}`}
        />
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

      {/* Cadena visual: nodo numerado + conector por paso. El conector es
          la parte semántica — línea esmeralda cuando la cadena puede
          completar, neutra cuando hay un paso sin regla. */}
      <ol className="mt-3 flex flex-wrap items-center gap-y-2">
        {seq.steps.map((step, i) => {
          const ok = live.has(step)
          const last = i === seq.steps.length - 1
          return (
            <li key={`${seq.id}:${i}`} className="flex items-center">
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] leading-none ${
                    ok ? 'border-white/15 bg-white/[0.04] text-zinc-400' : 'border-amber-300/40 bg-amber-300/10 text-amber-200'
                  }`}
                >
                  {i + 1}
                </span>
                <span
                  title={ok ? 'regla cargada en el motor' : 'regla NO cargada: la cadena no puede completar con este paso'}
                  className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${
                    ok ? 'border-white/10 text-zinc-300' : 'border-amber-300/30 bg-amber-300/10 text-amber-200'
                  }`}
                >
                  {step}
                </span>
              </span>
              {!last && (
                <span
                  aria-hidden
                  title={armed ? 'paso siguiente observable en el mismo host y ventana' : undefined}
                  className={`mx-1.5 h-px w-5 ${
                    armed ? 'bg-gradient-to-r from-emerald-400/50 to-emerald-400/20' : 'bg-white/10'
                  }`}
                />
              )}
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
      </AnimatedItem>
    </li>
  )
}
