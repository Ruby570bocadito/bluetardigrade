'use client'

// Respuesta · Actuar: the alerts an operator can answer with a terminate
// request — their event is still in memory and names the process, so the
// PID comes from the telemetry, never from a guess.
import { CaretRight } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { alertKey } from '@/lib/engine-client'
import type { ActionableAlert } from '@/lib/v2/respond-model'
import { Empty, SEV_COLOR } from '../home/parts'
import { DecisionPill, When } from './parts'

export function ActList({ items, now, onOpen }: { items: ActionableAlert[]; now: number | null; onOpen: (key: string) => void }) {
  const { dict } = useI18n()
  const t = dict.v2.respondView
  return (
    <div className="v2-act">
      <div>
        <h2>{t.actTitle}</h2>
        <p className="v2-small v2-dim">{t.actHint}</p>
      </div>
      {items.length === 0 ? (
        <Empty title={t.actNone}>{t.actHint}</Empty>
      ) : (
        <ul className="v2-act-list">
          {items.map((it) => {
            const last = it.actions[0]
            return (
              <li key={alertKey(it.alert)}>
                <button type="button" className="v2-act-row" onClick={() => onOpen(alertKey(it.alert))}>
                  <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[it.alert.severity] }}>
                    {dict.v2.sev[it.alert.severity]}
                  </span>
                  <span className="v2-act-main">
                    <strong>{it.alert.rule_name}</strong>
                    <span className="v2-small v2-dim">
                      {it.alert.host} · <When iso={it.alert.timestamp} now={now} />
                    </span>
                  </span>
                  <span className="v2-mono v2-act-proc">
                    {it.process} <span className="v2-dim">· PID {it.pid}</span>
                  </span>
                  <span className="v2-act-done">
                    {last ? (
                      <>
                        <DecisionPill decision={last.decision} />
                        <span className="v2-small v2-dim">{t.attempts(it.actions.length)}</span>
                      </>
                    ) : (
                      <span className="v2-small v2-dim">{t.noAttempts}</span>
                    )}
                  </span>
                  <span className="v2-act-go">
                    {t.actOpen}
                    <CaretRight aria-hidden="true" />
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
