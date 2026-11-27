'use client'

// Respuesta · Contención por equipo: the machines of the cases, one card
// each, in the column of its least advanced case (a host still open in
// one case is not contained), with the response attempts made on it and
// the next unchecked step of its plan. States change in the war room or
// in Incidentes, where the whole case moves.
import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import type { SfRespondRecord } from '@/lib/console-types'
import type { Incident } from '@/lib/engine-writes'
import { PLAYBOOK_TEMPLATES, readPlaybooks, type IncidentPlaybookState } from '@/lib/incident-playbook'
import { v2HostLink } from '@/lib/v2/hosts-model'
import { v2IncidentLink } from '@/lib/v2/incidents-model'
import { BOARD_STATES, containmentBoard } from '@/lib/v2/respond-model'
import { Empty, SEV_COLOR } from '../home/parts'
import { StateChip } from '../incidents/parts'

/** The plans kept in this browser (read once; the plan views write them). */
export function useStoredPlans(version = 0): Record<string, IncidentPlaybookState> {
  const [plans, setPlans] = useState<Record<string, IncidentPlaybookState>>({})
  useEffect(() => {
    try {
      setPlans(readPlaybooks(window.localStorage))
    } catch {
      setPlans({})
    }
  }, [version])
  return plans
}

export function Containment({
  incidents,
  available,
  records,
  now,
  onWarRoom,
}: {
  incidents: Incident[]
  available: boolean
  records: SfRespondRecord[]
  now: number | null
  onWarRoom: (id: string) => void
}) {
  const { dict } = useI18n()
  const t = dict.v2.respondView
  const items = dict.playbook.templates as Record<string, { items: Record<string, string> }>
  const plans = useStoredPlans()
  const board = useMemo(() => containmentBoard(incidents, records, plans, PLAYBOOK_TEMPLATES, now ?? Date.now()), [incidents, records, plans, now])
  const total = BOARD_STATES.reduce((n, s) => n + board[s].length, 0)

  if (!available) return <Empty title={t.incidentsOff} />
  return (
    <div className="v2-board-wrap">
      <div>
        <h2>{t.boardTitle}</h2>
        <p className="v2-small v2-dim">{t.boardHint}</p>
      </div>
      {total === 0 ? (
        <Empty title={t.boardNone} />
      ) : (
        <div className="v2-cboard">
          {BOARD_STATES.map((s) => (
            <section key={s} className="v2-cboard-col" data-state={s} aria-label={dict.incidents.statusLabels[s]}>
              <header>
                <StateChip status={s} />
                <span className="v2-mono v2-dim">{board[s].length}</span>
                {s === 'closed' && <span className="v2-small v2-dim">{t.boardClosedNote}</span>}
              </header>
              <ul>
                {board[s].map((card) => {
                  const lead = card.incidents[0]
                  const step = card.nextStep
                  return (
                    <li key={card.host} className="v2-ccard">
                      <a className="v2-ccard-host v2-mono" href={v2HostLink(card.host)}>
                        {card.host}
                      </a>
                      <ul className="v2-ccard-cases">
                        {card.incidents.map((inc) => (
                          <li key={inc.id}>
                            <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[inc.severity] }}>
                              {dict.v2.sev[inc.severity]}
                            </span>
                            <a className="v2-link" href={v2IncidentLink(inc.id)}>
                              {inc.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                      <p className="v2-small" data-none={card.executed + card.denied === 0}>
                        {card.executed + card.denied === 0 ? t.boardNoActions : t.boardActions(card.executed, card.denied)}
                      </p>
                      <div className="v2-ccard-next">
                        <span className="v2-eyebrow">{t.boardNext}</span>
                        <p className="v2-small">{step ? (items[step.templateId]?.items[step.itemId] ?? step.text) : <span className="v2-dim">{t.boardNoPlan}</span>}</p>
                      </div>
                      {lead.status !== 'closed' && (
                        <button type="button" className="v2-link v2-small" onClick={() => onWarRoom(lead.id)}>
                          {t.boardWarRoom}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
