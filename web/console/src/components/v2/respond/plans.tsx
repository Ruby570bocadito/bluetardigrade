'use client'

// Respuesta · Planes: every case with the progress of its response plan,
// and one plan in full — the template's steps (shared with Incidentes),
// the evidence collected and the analyst's chronology. The plan lives in
// this browser; one object per case, written by every view that edits it.
import { useState, type FormEvent } from 'react'
import { Trash } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import type { Incident } from '@/lib/engine-writes'
import { addChronology, addEvidence, playbookTemplate, progressOf, removeChronology, removeEvidence, type EvidenceKind } from '@/lib/incident-playbook'
import { Empty, SEV_COLOR } from '../home/parts'
import { CasePlan, usePlan } from '../incidents/case-plan'
import { StateChip } from '../incidents/parts'
import { useStoredPlans } from './containment'

const KINDS: EvidenceKind[] = ['file', 'hash', 'url', 'ip', 'account', 'note']
const localNow = () => {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

export function Plans({ incidents, available, caseId, onCase }: { incidents: Incident[]; available: boolean; caseId: string | null; onCase: (id: string) => void }) {
  const { dict } = useI18n()
  const t = dict.v2.respondView
  const [version, setVersion] = useState(0)
  const plans = useStoredPlans(version)
  const sorted = [...incidents].sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || b.updated_at.localeCompare(a.updated_at))
  const selected = incidents.find((i) => i.id === caseId) ?? null

  if (!available) return <Empty title={t.incidentsOff} />
  if (incidents.length === 0) return <Empty title={t.plansNone} />
  return (
    <div className="v2-plans">
      <section className="v2-plans-list" aria-labelledby="v2-plans-title">
        <h2 id="v2-plans-title">{t.plansTitle}</h2>
        <p className="v2-small v2-dim">{t.plansHint}</p>
        <ul>
          {sorted.map((inc) => {
            const plan = plans[inc.id]
            const tpl = plan && playbookTemplate(plan.templateId)
            const prog = plan && tpl ? progressOf(plan, tpl) : null
            return (
              <li key={inc.id}>
                <button type="button" className="v2-plans-row" aria-pressed={selected?.id === inc.id} onClick={() => onCase(inc.id)}>
                  <span className="v2-plans-title">
                    <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[inc.severity] }}>
                      {dict.v2.sev[inc.severity]}
                    </span>
                    <strong>{inc.title}</strong>
                  </span>
                  <span className="v2-plans-meta">
                    <StateChip status={inc.status} />
                    {prog && tpl ? (
                      <span className="v2-plans-prog">
                        <i aria-hidden="true">
                          <b style={{ ['--w' as string]: `${(prog.done / Math.max(1, prog.total)) * 100}%` }} />
                        </i>
                        <span className="v2-small">
                          {tpl.name} · {t.planProgress(prog.done, prog.total)}
                        </span>
                      </span>
                    ) : (
                      <span className="v2-small v2-dim">{t.planNone}</span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>
      <section className="v2-plans-detail" aria-live="polite">
        {selected ? <PlanEditor key={selected.id} incident={selected} onSaved={() => setVersion((v) => v + 1)} /> : <p className="v2-small v2-dim">{t.planPick}</p>}
      </section>
    </div>
  )
}

function PlanEditor({ incident, onSaved }: { incident: Incident; onSaved: () => void }) {
  const { dict } = useI18n()
  const p = dict.playbook
  const state = usePlan(incident.id)
  const { plan } = state
  const [kind, setKind] = useState<EvidenceKind>('hash')
  const [label, setLabel] = useState('')
  const [detail, setDetail] = useState('')
  const [at, setAt] = useState(localNow)
  const [what, setWhat] = useState('')
  const [problem, setProblem] = useState('')

  const save: typeof state.save = (next) => {
    state.save(next)
    onSaved()
  }
  const tracked = { ...state, save }

  function attempt(fn: () => void) {
    try {
      fn()
      setProblem('')
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="v2-plan-editor">
      <h2>{incident.title}</h2>
      <CasePlan incident={incident} state={tracked} />
      {plan && (
        <>
          <section aria-labelledby="v2-ev-title" className="v2-plan-part">
            <h3 id="v2-ev-title">{p.evidenceHeading(plan.evidence.length)}</h3>
            {plan.evidence.length === 0 ? (
              <p className="v2-small v2-dim">{p.evidenceEmpty}</p>
            ) : (
              <ul className="v2-plan-items">
                {plan.evidence.map((e) => (
                  <li key={e.id}>
                    <span className="v2-tag">{p.evidenceKinds[e.kind]}</span>
                    <span className="v2-plan-item-text">
                      <strong>{e.label}</strong>
                      {e.detail && <span className="v2-small v2-dim v2-mono">{e.detail}</span>}
                    </span>
                    <button
                      type="button"
                      className="v2-icon-btn"
                      aria-label={p.removeEvidenceAria(e.label)}
                      onClick={() => attempt(() => save(removeEvidence(plan, e.id, new Date().toISOString())))}
                    >
                      <Trash aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="v2-plan-form"
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                attempt(() => {
                  save(addEvidence(plan, { kind, label, detail, at: new Date().toISOString() }))
                  setLabel('')
                  setDetail('')
                })
              }}
            >
              <label className="v2-select">
                <span className="v2-sr-only">{p.evidenceKindAria}</span>
                <select value={kind} onChange={(e) => setKind(e.target.value as EvidenceKind)}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {p.evidenceKinds[k]}
                    </option>
                  ))}
                </select>
              </label>
              <input className="v2-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={p.evidencePlaceholder} aria-label={p.evidenceLabelAria} required maxLength={200} />
              <input className="v2-input v2-mono" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder={p.evidenceDetailPlaceholder} aria-label={p.evidenceDetailPlaceholder} maxLength={1000} />
              <button type="submit" className="v2-btn" disabled={!label.trim()}>
                {p.addEvidence}
              </button>
            </form>
          </section>

          <section aria-labelledby="v2-chrono-title" className="v2-plan-part">
            <h3 id="v2-chrono-title">{p.chronoHeading(plan.chronology.length)}</h3>
            {plan.chronology.length === 0 ? (
              <p className="v2-small v2-dim">{p.chronoEmpty}</p>
            ) : (
              <ol className="v2-plan-items">
                {[...plan.chronology]
                  .sort((a, b) => a.at.localeCompare(b.at))
                  .map((c) => (
                    <li key={c.id}>
                      <time className="v2-mono v2-small" dateTime={c.at}>
                        {new Date(c.at).toLocaleString()}
                      </time>
                      <span className="v2-plan-item-text">{c.text}</span>
                      <button
                        type="button"
                        className="v2-icon-btn"
                        aria-label={p.removeMilestoneAria(c.text)}
                        onClick={() => attempt(() => save(removeChronology(plan, c.id, new Date().toISOString())))}
                      >
                        <Trash aria-hidden="true" />
                      </button>
                    </li>
                  ))}
              </ol>
            )}
            <form
              className="v2-plan-form"
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                attempt(() => {
                  save(addChronology(plan, { at: new Date(at).toISOString(), text: what }, new Date().toISOString()))
                  setWhat('')
                })
              }}
            >
              <input className="v2-input v2-mono" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-label={p.whenAria} required />
              <input className="v2-input" value={what} onChange={(e) => setWhat(e.target.value)} placeholder={p.whatPlaceholder} aria-label={p.whatAria} required maxLength={1000} />
              <button type="submit" className="v2-btn" disabled={!what.trim()}>
                {p.addMilestone}
              </button>
            </form>
          </section>
          {problem && (
            <p className="v2-error" role="alert">
              {problem}
            </p>
          )}
        </>
      )}
    </div>
  )
}
