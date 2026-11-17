'use client'

// The response plan of the case (lib/incident-playbook: the product's
// templates, the analyst's checks in this browser): pick a template, then
// tick its steps; each tick draws itself and the ring fills to the new
// count. Applying a plan leaves a note in the case timeline, as in the
// classic console, where the evidence and the chronology stay for now.
import { useEffect, useState } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import { addIncidentNote, type Incident } from '@/lib/engine-writes'
import {
  PLAYBOOK_TEMPLATES, applyPlaybook, playbookTemplate, progressOf, readPlaybooks, toggleCheck, writePlaybooks,
  type IncidentPlaybookState, type PlaybookTemplateId,
} from '@/lib/incident-playbook'
import { useCaseWrite } from './parts'

export function usePlan(incidentId: string) {
  const [plan, setPlan] = useState<IncidentPlaybookState | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    try {
      setPlan(readPlaybooks(window.localStorage)[incidentId] ?? null)
    } catch {
      setPlan(null)
    }
  }, [incidentId])
  function save(next: IncidentPlaybookState | null) {
    try {
      const cases = readPlaybooks(window.localStorage)
      if (next) cases[incidentId] = next
      else delete cases[incidentId]
      writePlaybooks(window.localStorage, cases)
      setPlan(next)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'localStorage')
    }
  }
  return { plan, save, error }
}

function Ring({ done, total, label }: { done: number; total: number; label: string }) {
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <svg className="v2-ring" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label={label}>
      <circle cx="32" cy="32" r={r} className="v2-ring-track" />
      <circle cx="32" cy="32" r={r} className="v2-ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - (total ? done / total : 0))} transform="rotate(-90 32 32)" />
      <text x="32" y="36" textAnchor="middle">
        {done}/{total}
      </text>
    </svg>
  )
}

export type PlanState = ReturnType<typeof usePlan>

/**
 * The plan of a case. A caller that edits the same plan elsewhere (the
 * evidence and the chronology in Respuesta) passes its own state, so both
 * write one object and neither overwrites the other's changes.
 */
export function CasePlan({ incident, state }: { incident: Incident; state?: PlanState }) {
  const { dict } = useI18n()
  const t = dict.v2.incidentsView
  const p = dict.playbook
  const own = usePlan(incident.id)
  const { plan, save, error } = state ?? own
  const { run } = useCaseWrite()
  const [confirming, setConfirming] = useState(false)

  if (!plan) {
    const apply = (id: PlaybookTemplateId, name: string) => {
      save(applyPlaybook(incident.id, id, new Date().toISOString()))
      // the case timeline records it; a refused note (read-only role) does not undo the plan
      void run((by) => addIncidentNote(incident.id, p.appliedNote(name), by))
    }
    return (
      <div className="v2-plan">
        <p className="v2-small">{t.planChoose}</p>
        <div className="v2-plan-templates">
          {PLAYBOOK_TEMPLATES.map((tpl) => (
            <article key={tpl.id} className="v2-plan-template">
              <strong>{tpl.name}</strong>
              <p className="v2-dim v2-small">{tpl.description}</p>
              <span className="v2-dim v2-small">{p.stepsCount(tpl.items.length)}</span>
              <button type="button" className="v2-btn" onClick={() => apply(tpl.id, tpl.name)}>
                {p.apply}
              </button>
            </article>
          ))}
        </div>
        <p className="v2-dim v2-small">{p.browserNote}</p>
      </div>
    )
  }

  const template = playbookTemplate(plan.templateId)
  if (!template) return null
  const { done, total } = progressOf(plan, template)
  return (
    <div className="v2-plan">
      <div className="v2-plan-head">
        <Ring done={done} total={total} label={p.progressAria(done, total)} />
        <div>
          <strong>{p.headingName(template.name)}</strong>
          <p className="v2-dim v2-small">{p.stepsDone(done, total)}</p>
        </div>
        <button
          type="button"
          className="v2-link v2-plan-remove"
          onClick={() => {
            if (confirming) save(null)
            else setConfirming(true)
          }}
          onBlur={() => setConfirming(false)}
        >
          {confirming ? p.removeConfirm : p.removePlan}
        </button>
      </div>
      <ol className="v2-checklist">
        {template.items.map((item) => {
          const checked = !!plan.checks[item.id]?.done
          return (
            <li key={item.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={checked}
                className="v2-check-item"
                onClick={() => save(toggleCheck(plan, template, item.id, new Date().toISOString()))}
              >
                <svg viewBox="0 0 20 20" className="v2-checkbox" aria-hidden="true">
                  <rect x="1" y="1" width="18" height="18" rx="4" />
                  <path d="M5 10.5l3.2 3.2L15 6.8" />
                </svg>
                <span>{item.text}</span>
                {item.attack && <span className="v2-tag v2-mono">{item.attack}</span>}
              </button>
            </li>
          )
        })}
      </ol>
      {error && (
        <p className="v2-error" role="alert">
          {error}
        </p>
      )}
      <p className="v2-dim v2-small">
        {p.browserNote}{' '}
        {/* inside Respuesta the evidence and the chronology are right below */}
        {!state && (
          <a className="v2-link" href={`/v2/respuesta?vista=planes&caso=${encodeURIComponent(incident.id)}`}>
            {t.planClassic}
          </a>
        )}
      </p>
    </div>
  )
}
