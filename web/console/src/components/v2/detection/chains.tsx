'use client'

// Detección · Cadenas: the attack chains the engine correlates, drawn as
// their steps in order (a step that accepts several rules shows the
// alternatives), with the window, the scope and when the chain last
// completed among the alerts in memory.
import { Fragment } from 'react'
import { ArrowRight } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { formatDuration } from '@/lib/fleet'
import type { ChainRow } from '@/lib/v2/detection-model'
import { Empty } from '../home/parts'
import { SevPill } from './parts'

export function Chains({ chains, now, onOpen }: { chains: ChainRow[]; now: number | null; onOpen: (id: string) => void }) {
  const { dict } = useI18n()
  const t = dict.v2.detectionView
  if (chains.length === 0) return <Empty title={t.chainsNone}>{t.filesNote}</Empty>
  return (
    <div className="v2-chains">
      <h2 className="v2-sr-only">{t.chainsTitle}</h2>
      {chains.map(({ seq, steps, lastCompleted, completions }) => (
        <article key={seq.id} className="v2-chain" aria-labelledby={`v2-chain-${seq.id}`}>
          <header>
            <SevPill sev={seq.severity} />
            <h3 id={`v2-chain-${seq.id}`}>{seq.name}</h3>
            <span className="v2-tag">{t.chainWindow(formatDuration(seq.window_seconds))}</span>
            <span className="v2-tag">{seq.scope === 'user' ? t.chainScope.user(seq.min_hosts ?? 2) : t.chainScope.host}</span>
          </header>
          {seq.description && <p className="v2-small v2-dim">{seq.description}</p>}
          <ol className="v2-chain-steps">
            {steps.map((s, i) => (
              <Fragment key={i}>
                {i > 0 && (
                  <li className="v2-chain-arrow" aria-hidden="true">
                    <ArrowRight />
                  </li>
                )}
                <li className="v2-chain-step">
                  <span className="v2-mono v2-chain-n">{i + 1}</span>
                  <span className="v2-chain-opts">
                    {s.ruleId ? (
                      <button type="button" className="v2-link" onClick={() => onOpen(s.ruleId!)}>
                        {s.label}
                      </button>
                    ) : (
                      <span>{s.label}</span>
                    )}
                    {s.alternatives.map((alt, j) => (
                      <span key={j} className="v2-chain-alt">
                        <span className="v2-dim">{t.chainOr}</span>
                        {alt.ruleId ? (
                          <button type="button" className="v2-link" onClick={() => onOpen(alt.ruleId!)}>
                            {alt.label}
                          </button>
                        ) : (
                          <span>{alt.label}</span>
                        )}
                      </span>
                    ))}
                  </span>
                </li>
              </Fragment>
            ))}
          </ol>
          <footer className="v2-small" data-done={completions > 0}>
            {lastCompleted && now !== null
              ? t.chainLast(dict.v2.hostsView.ago(formatDuration(Math.max(0, (now - Date.parse(lastCompleted)) / 1000))), completions)
              : t.chainNever}
          </footer>
        </article>
      ))}
    </div>
  )
}
