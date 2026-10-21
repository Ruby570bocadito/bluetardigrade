'use client'

// Kill-chain sequences view (read-only, mirrors GET /api/sequences via
// the hub). The correlator stitches individual rule hits into campaign
// alerts, but until now an operator could not see WHICH chains are
// armed without reading the YAML by hand. This view lists the loaded
// sequences: severity, window, the rule chain and the MITRE tags the
// completion alert will carry. Editing happens in sequences/*.yaml
// (hot-reloaded by the engine every 15 s) - there is no write API, same
// as suppressions.

import { CheckCircle, FlowArrow, Siren, Timer, UsersThree } from '@phosphor-icons/react'
import { useEngine } from './engine-provider'
import { useI18n } from './i18n-provider'
import { EmptyState, SeverityBadge, StatTile } from './ui-bits'
import { AnimatedItem } from '@/components/reactbits/animated-list'
import type { SfSequence } from '@/lib/console-types'
import { isUserScoped, scopeText, stepStatus, unarmedSteps } from '@/lib/sequences'

function formatWindow(seconds: number, window: (rest: string) => string, nd: string): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return nd
  if (seconds % 60 !== 0) return window(`${seconds}s`)
  const min = seconds / 60
  if (min % 60 !== 0) return window(`${min} min`)
  const h = min / 60
  return window(`${h}h`)
}

export function SequencesView() {
  const { dict } = useI18n()
  const { sequences, rules, alerts, status } = useEngine()

  const liveRules = new Set(rules.map((r) => r.name))
  const armed = sequences.filter((s) => unarmedSteps(s, liveRules).length === 0).length
  const hits = new Map<string, number>()
  for (const a of alerts) hits.set(a.rule_name, (hits.get(a.rule_name) ?? 0) + 1)
  const campaigns = (seq: SfSequence) => alerts.filter((a) => a.rule_id === seq.id || a.rule_name === seq.name).length
  const completed = sequences.reduce((sum, seq) => sum + campaigns(seq), 0)

  return (
    <section aria-label={dict.sequences.sectionAria} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile icon={FlowArrow} label={dict.sequences.loadedLabel} value={sequences.length} hint={dict.sequences.loadedHint} />
        <StatTile
          icon={CheckCircle}
          label={dict.sequences.armedLabel}
          value={armed}
          hint={sequences.length === 0 ? dict.sequences.noChains : armed === sequences.length ? dict.sequences.allArmed : dict.sequences.unarmedCount(sequences.length - armed)}
          warn={armed < sequences.length}
        />
        <StatTile icon={Siren} label={dict.sequences.campaignsLabel} value={completed} hint={dict.sequences.campaignsHint(alerts.length)} />
      </div>

      <p className="max-w-[90ch] text-xs leading-relaxed text-zinc-500">
        {dict.sequences.proseA}<span className="text-zinc-300">{dict.sequences.proseBoldA}</span>{dict.sequences.proseB}
        <span className="text-zinc-300">{dict.sequences.proseBoldB}</span>{dict.sequences.proseC}
        <code className="rounded bg-white/[0.06] px-1 font-mono text-[11px] text-zinc-300">sequences/*.yaml</code>
        {dict.sequences.proseD}
      </p>

      {status !== 'live' && sequences.length === 0 ? (
        <div className="h-24 animate-pulse rounded-xl bg-white/5" />
      ) : sequences.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={FlowArrow}
            title={dict.sequences.emptyTitle}
            hint={dict.sequences.emptyHint}
          />
        </div>
      ) : (
        <ul className="grid gap-4">
          {sequences.map((s, i) => (
            <SequenceCard key={s.id} seq={s} index={i} live={liveRules} hits={hits} campaigns={campaigns(s)} />
          ))}
        </ul>
      )}
    </section>
  )
}

/** Arrow between two chain nodes; the dash flows while the link is live. */
function FlowConnector({ flowing }: { flowing: boolean }) {
  return (
    <svg aria-hidden width="26" height="12" viewBox="0 0 26 12" className="hidden shrink-0 sm:block">
      <line x1="1" y1="6" x2="20" y2="6" stroke={flowing ? 'var(--series-1)' : '#3f3f46'} strokeWidth="2" strokeLinecap="round" className={flowing ? 'edge-flow' : undefined} />
      <path d="M19 2 L25 6 L19 10" fill="none" stroke={flowing ? 'var(--series-1)' : '#3f3f46'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SequenceCard({ seq, index, live, hits, campaigns }: { seq: SfSequence; index: number; live: Set<string>; hits: Map<string, number>; campaigns: number }) {
  const { dict } = useI18n()
  const steps = seq.steps.map((_, i) => stepStatus(seq, i, live, hits))
  const missing = unarmedSteps(seq, live).map((i) => seq.steps[i])
  // armed = every step has at least one live rule in the engine: the
  // chain CAN complete and raise its campaign alert.
  const armed = missing.length === 0
  const observed = steps.filter((st) => st.hits > 0).length
  const userScoped = isUserScoped(seq)
  return (
    <li className="min-w-0">
      {/* AnimatedItem (React Bits): entrada escalonada en el montaje; keys estables. */}
      <AnimatedItem index={index} className="panel panel-hover flex h-full flex-col px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`icon-tile ${armed ? '' : 'border-amber-300/30 bg-amber-300/10 text-amber-200'}`}>
            <FlowArrow size={14} weight="fill" aria-hidden />
          </span>
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100" title={seq.name}>{seq.name}</h2>
          <SeverityBadge severity={seq.severity} />
          {userScoped && (
            <span title={dict.sequences.userScopeTitle} className="flex items-center gap-1 rounded-md border border-zinc-700 bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-zinc-300">
              <UsersThree size={12} aria-hidden />
              {scopeText(seq, dict.sequences)}
            </span>
          )}
          <span title={dict.sequences.windowTitle(seq.window_seconds)} className="flex items-center gap-1 rounded-md border border-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400">
            <Timer size={12} aria-hidden />
            {formatWindow(seq.window_seconds, dict.sequences.window, dict.sequences.windowNd)}
          </span>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-zinc-400">{seq.description}</p>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
          <span className={armed ? 'text-emerald-300' : 'text-amber-300'}>{armed ? dict.sequences.armed : dict.sequences.stepsWithoutRule(missing.length)}</span>
          <span>{dict.sequences.stepsObserved(observed, seq.steps.length)}</span>
          <span className={campaigns > 0 ? 'font-medium text-red-300' : ''}>{dict.sequences.campaignsDone(campaigns)}</span>
        </div>

        {/* Grafo de flujo: un nodo por paso y un nodo final de campaña. El
            conector fluye (animado) cuando los dos pasos que une ya se
            observaron en la ventana; azul = la regla del paso disparó,
            ámbar = la regla no está cargada, neutro = cargada sin alertas. */}
        <ol aria-label={dict.sequences.stepsAria(seq.name)} className="mt-3 flex flex-1 flex-col gap-2 sm:flex-row sm:items-stretch">
          {steps.map((st, i) => {
            const step = seq.steps[i]
            const ok = st.loaded.length > 0
            const count = st.hits
            const next = steps[i + 1]
            const flowing = count > 0 && (next === undefined ? campaigns > 0 : next.hits > 0)
            const alternatives = st.rules.length > 1
            return (
              <li key={`${seq.id}:${i}`} className="flex min-w-0 flex-1 items-center gap-1.5">
                <div
                  title={
                    alternatives
                      ? dict.sequences.alternativesAny(st.rules.join(', '), st.loaded.length < st.rules.length ? dict.sequences.loadedOf(st.loaded.length, st.rules.length) : '')
                      : ok ? dict.sequences.ruleLoaded : dict.sequences.ruleNotLoaded
                  }
                  className={`min-w-0 flex-1 rounded-lg border px-2.5 py-2 transition-colors ${
                    !ok ? 'border-amber-300/30 bg-amber-300/[0.06]' : count > 0 ? 'border-primary/40 bg-primary-tint/[0.10]' : 'border-zinc-800 bg-zinc-900/60'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                    <span aria-hidden className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold ${count > 0 ? 'bg-primary-strong text-white' : 'bg-zinc-800 text-zinc-400'}`}>{i + 1}</span>
                    {!ok ? (alternatives ? dict.sequences.noRuleLoaded : dict.sequences.stepNotLoaded) : count > 0 ? dict.sequences.alertsCount(count) : dict.sequences.noAlerts}
                    {alternatives && <span className="rounded bg-white/[0.06] px-1 text-[9px] text-zinc-400">{dict.sequences.alternatives(st.rules.length)}</span>}
                  </span>
                  {alternatives ? (
                    <ul className="mt-1 space-y-0.5">
                      {st.rules.map((r) => (
                        <li key={r} className={`truncate text-[11px] leading-snug ${live.has(r) ? ((hits.get(r) ?? 0) > 0 ? 'text-zinc-100' : 'text-zinc-300') : 'text-zinc-500 line-through'}`} title={live.has(r) ? r : `${r}${dict.sequences.notLoadedSuffix}`}>
                          {r}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className={`mt-1 line-clamp-2 break-words text-xs leading-snug ${ok ? 'text-zinc-200' : 'text-amber-200'}`} title={step}>{step}</span>
                  )}
                </div>
                <FlowConnector flowing={flowing} />
              </li>
            )
          })}
          <li className="flex shrink-0 items-center">
            <div
              className={`flex h-full min-w-[96px] flex-col justify-center rounded-lg border px-3 py-2 ${
                campaigns > 0 ? 'border-red-400/40 bg-red-500/[0.10]' : 'border-dashed border-zinc-700 bg-transparent'
              }`}
            >
              <span className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                <Siren size={12} weight={campaigns > 0 ? 'fill' : 'regular'} aria-hidden className={campaigns > 0 ? 'text-red-300' : ''} />
                {dict.sequences.campaignNode}
              </span>
              <span className={`mt-0.5 text-lg font-semibold leading-none ${campaigns > 0 ? 'text-red-200' : 'text-zinc-500'}`}>{campaigns}</span>
            </div>
          </li>
        </ol>

        {missing.length > 0 && (
          <p className="mt-2 text-[11px] text-amber-300/90">
            {dict.sequences.missingSteps(missing.join(', '))}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {seq.tags.map((t) => (
            <span key={t} className="rounded-md border border-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
              {t.startsWith('attack.') ? t.replace('attack.', '') : t}
            </span>
          ))}
          <span className="ml-auto font-mono text-[10px] text-zinc-500">id: {seq.id}</span>
        </div>
      </AnimatedItem>
    </li>
  )
}
