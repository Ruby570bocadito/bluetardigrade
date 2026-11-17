'use client'

// Small shared pieces of v2 Incidentes: the state chip, the writes to the
// engine (signed like the classic console: the session account with
// accounts, 'consola' otherwise) and the step-by-step state of a case.
import { useState } from 'react'
import { Check } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { useConsoleUser } from '@/components/console/user-session'
import { useIncidents } from '@/components/console/incidents-provider'
import type { Incident, IncidentEntry, IncidentStatus } from '@/lib/engine-writes'
import { STATUS_FLOW, entryText } from '@/lib/v2/incidents-model'

/** Timeline lines in the operator's words (lib/v2/incidents-model entryText). */
export function useEntryText(): (e: Pick<IncidentEntry, 'kind' | 'text'>) => string {
  const { dict } = useI18n()
  const status = dict.incidents.statusLabels as Record<string, string>
  const sev = dict.alerts.sevLabels as Record<string, string>
  return (e) => entryText(e, dict.v2.incidentsView.entry, (c) => status[c] ?? c, (c) => sev[c] ?? c)
}

export function StateChip({ status }: { status: IncidentStatus }) {
  const { dict } = useI18n()
  return (
    <span className="v2-istate" data-state={status}>
      {dict.incidents.statusLabels[status]}
    </span>
  )
}

type Result = { ok: true; data: Incident } | { ok: false; status: number; error: string }

/** One write at a time: the engine's answer replaces the case in the shared list. */
export function useCaseWrite() {
  const me = useConsoleUser()
  const { upsert } = useIncidents()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const by = me.mode === 'users' ? me.name : 'consola'
  const can = !me.pending && me.can_triage
  async function run(write: (by: string) => Promise<Result>): Promise<Incident | null> {
    if (busy) return null
    setBusy(true)
    setError('')
    const res = await write(by)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return null
    }
    upsert(res.data)
    return res.data
  }
  return { busy, error, run, can, me }
}

/** Abierto > Investigando > Contenido > Cerrado: the line fills up to the current step. */
export function Stepper({ status, disabled, onPick }: { status: IncidentStatus; disabled: boolean; onPick: (status: IncidentStatus) => void }) {
  const { dict } = useI18n()
  const t = dict.v2.incidentsView
  const at = STATUS_FLOW.indexOf(status)
  return (
    <div className="v2-stepper">
      <span className="v2-stepper-line" aria-hidden="true">
        <span style={{ width: `${(at / (STATUS_FLOW.length - 1)) * 100}%` }} />
      </span>
      <ol aria-label={t.stepperAria}>
        {STATUS_FLOW.map((s, i) => {
          const label = dict.incidents.statusLabels[s]
          return (
            <li key={s} data-step={i < at ? 'done' : i === at ? 'current' : 'todo'}>
              <button
                type="button"
                disabled={disabled || i === at}
                aria-current={i === at ? 'step' : undefined}
                aria-label={i === at ? label : t.stepTo(label)}
                onClick={() => onPick(s)}
              >
                <span className="v2-step-dot" aria-hidden="true">
                  {i < at ? <Check weight="bold" /> : i + 1}
                </span>
                <span className="v2-step-label">{label}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
