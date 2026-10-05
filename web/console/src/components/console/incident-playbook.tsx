'use client'

// Response plan for a case (IDEA-3 Plantillas de incidente): applies one
// of the product templates (ransomware, phishing, compromised account)
// and carries the manual checklist, the collected evidence and the
// analyst's reconstructed chronology. The plan lives in this browser's
// localStorage (the panel says so); applying a template leaves a note in
// the engine's case timeline, which is the only engine write here. The
// export buttons of the case carry the plan into the report when present.

import { useEffect, useRef, useState } from 'react'
import { ListChecks, Plus, Trash, X } from '@phosphor-icons/react'
import {
  addChronology,
  addEvidence,
  applyPlaybook,
  EVIDENCE_KIND_LABEL,
  PLAYBOOK_TEMPLATES,
  playbookTemplate,
  progressOf,
  readPlaybooks,
  removeChronology,
  removeEvidence,
  toggleCheck,
  writePlaybooks,
  type EvidenceKind,
  type IncidentPlaybookState,
  type PlaybookTemplateId,
} from '@/lib/incident-playbook'
import { formatDateTime } from '@/lib/console-types'

const inputCls =
  'h-8 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const smallBtn =
  'inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'No se pudo guardar el plan.'
}

function localInputValue(d = new Date()): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

export function IncidentPlaybook({
  incidentId,
  onPlanChange,
  onApplyNote,
}: {
  incidentId: string
  /** tells the case header which plan the exports must carry */
  onPlanChange?: (plan: IncidentPlaybookState | null) => void
  /** non-blocking engine timeline note when a template is applied */
  onApplyNote?: (text: string) => void
}) {
  const [state, setState] = useState<IncidentPlaybookState | null>(null)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const casesRef = useRef<Record<string, IncidentPlaybookState>>({})

  useEffect(() => {
    try {
      const cases = readPlaybooks(window.localStorage)
      casesRef.current = cases
      const found = cases[incidentId] ?? null
      setState(found)
      // the case header needs the restored plan for its export buttons
      onPlanChange?.(found)
    } catch {
      setError('No se pudo leer el plan guardado en este navegador.')
    }
  }, [incidentId, onPlanChange])

  useEffect(() => {
    if (!confirming) return
    const timer = setTimeout(() => setConfirming(false), 3000)
    return () => clearTimeout(timer)
  }, [confirming])

  function persist(next: IncidentPlaybookState | null) {
    const cases = { ...casesRef.current }
    if (next) cases[next.incidentId] = next
    else delete cases[incidentId]
    try {
      writePlaybooks(window.localStorage, cases)
      casesRef.current = cases
      setState(next)
      setError('')
      onPlanChange?.(next)
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  if (!state) {
    return (
      <section aria-label="Plan de respuesta" className="space-y-3">
        <header className="flex items-center gap-2">
          <ListChecks size={14} aria-hidden className="text-primary" />
          <h3 className="text-xs font-medium text-zinc-300">Plan de respuesta</h3>
        </header>
        <p className="text-xs text-zinc-500">
          Aplica una plantilla para llevar la lista de comprobación, las evidencias y la cronología del caso. El plan vive
          en este navegador, no en el motor; al aplicarla queda una nota en la línea de tiempo del incidente.
        </p>
        <div className="grid gap-2 md:grid-cols-3">
          {PLAYBOOK_TEMPLATES.map((t) => (
            <div key={t.id} className="rounded-lg border border-white/[0.06] bg-zinc-950/40 p-3">
              <p className="text-[13px] font-medium text-zinc-100">{t.name}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{t.description}</p>
              <p className="mt-1.5 text-[11px] tabular-nums text-zinc-600">{t.items.length} pasos</p>
              <button
                type="button"
                onClick={() => {
                  try {
                    persist(applyPlaybook(incidentId, t.id, new Date().toISOString()))
                    onApplyNote?.(`Plan de respuesta aplicado: ${t.name} (lista de comprobación en la consola).`)
                  } catch (cause) {
                    setError(messageOf(cause))
                  }
                }}
                className="mt-2 inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary-tint/10 px-2 py-1 text-[11px] font-medium text-primary-soft hover:bg-primary-tint/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus size={11} aria-hidden /> Aplicar
              </button>
            </div>
          ))}
        </div>
        {error && (
          <p role="alert" className="text-xs text-red-300">
            {error}
          </p>
        )}
      </section>
    )
  }

  const template = playbookTemplate(state.templateId)
  if (!template) return null
  const { done, total } = progressOf(state, template)

  return (
    <section aria-label={`Plan de respuesta: ${template.name}`} className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <ListChecks size={14} aria-hidden className="text-primary" />
        <h3 className="text-xs font-medium text-zinc-300">Plan de respuesta: {template.name}</h3>
        <span role="status" className="rounded-md border border-white/[0.06] bg-white/[0.03] px-1.5 py-0.5 text-[11px] tabular-nums text-zinc-400">
          {done}/{total} pasos
        </span>
        <button
          type="button"
          onClick={() => (confirming ? persist(null) : setConfirming(true))}
          className={`${smallBtn} ml-auto ${confirming ? 'border-red-400/40 text-red-300' : ''}`}
        >
          {confirming ? <Trash size={11} aria-hidden /> : <X size={11} aria-hidden />}
          {confirming ? 'Confirmar: se borra de este navegador' : 'Quitar el plan'}
        </button>
      </header>

      <div
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`Progreso del plan: ${done} de ${total} pasos`}
        className="h-1.5 overflow-hidden rounded-full bg-zinc-800"
      >
        <div className="h-full rounded-full bg-emerald-500/70 transition-[width]" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}

      <ol className="divide-y divide-white/[0.05] rounded-lg border border-white/[0.06]">
        {template.items.map((item, i) => {
          const isDone = Boolean(state.checks[item.id]?.done)
          return (
            <li key={item.id}>
              <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-white/[0.03]">
                <input
                  type="checkbox"
                  checked={isDone}
                  onChange={() => {
                    try {
                      persist(toggleCheck(state, template, item.id, new Date().toISOString()))
                    } catch (cause) {
                      setError(messageOf(cause))
                    }
                  }}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-zinc-700 bg-zinc-900 accent-zinc-400"
                />
                <span className={`min-w-0 flex-1 text-xs leading-relaxed ${isDone ? 'text-zinc-500' : 'text-zinc-200'}`}>
                  <span aria-hidden className="mr-1.5 tabular-nums text-zinc-600">
                    {i + 1}.
                  </span>
                  {item.text}
                </span>
                {item.attack && (
                  <code className="shrink-0 rounded border border-white/[0.06] px-1 py-0.5 font-mono text-[10px] text-zinc-500">{item.attack}</code>
                )}
              </label>
            </li>
          )
        })}
      </ol>

      <div className="grid gap-4 lg:grid-cols-2">
        <EvidenceSection state={state} onChange={persist} onError={setError} />
        <ChronologySection state={state} onChange={persist} onError={setError} />
      </div>

      <p className="text-[11px] text-zinc-600">
        El plan vive en este navegador (localStorage): no se envía al motor y no sigue al caso en otro equipo. Los botones
        de informe de la ficha lo incluyen al exportar.
      </p>
    </section>
  )
}

function EvidenceSection({
  state,
  onChange,
  onError,
}: {
  state: IncidentPlaybookState
  onChange: (next: IncidentPlaybookState) => void
  onError: (message: string) => void
}) {
  const template = playbookTemplate(state.templateId)
  const [kind, setKind] = useState<EvidenceKind>('note')
  const [label, setLabel] = useState('')
  const [detail, setDetail] = useState('')

  return (
    <div>
      <h4 className="mb-2 text-xs font-medium text-zinc-300">Evidencias ({state.evidence.length})</h4>
      <form
        className="mb-3 space-y-2 rounded-lg border border-white/[0.06] bg-zinc-950/40 p-2.5"
        onSubmit={(e) => {
          e.preventDefault()
          try {
            onChange(addEvidence(state, { kind, label, detail: detail || undefined, at: new Date().toISOString() }))
            setLabel('')
            setDetail('')
          } catch (cause) {
            onError(cause instanceof Error ? cause.message : 'No se pudo añadir la evidencia.')
          }
        }}
      >
        <div className="flex gap-2">
          <label className="w-36 shrink-0 text-[11px] text-zinc-400">
            <span className="sr-only">Tipo de evidencia</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as EvidenceKind)} className={`mt-0 ${inputCls}`}>
              {(Object.keys(EVIDENCE_KIND_LABEL) as EvidenceKind[]).map((k) => (
                <option key={k} value={k}>
                  {EVIDENCE_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 flex-1 text-[11px] text-zinc-400">
            <span className="sr-only">Evidencia</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} required list={`evidence-hints-${state.incidentId}`} placeholder="qué es y de dónde sale" className={`mt-0 ${inputCls}`} />
            <datalist id={`evidence-hints-${state.incidentId}`}>
              {(template?.evidenceHints ?? []).map((h) => (
                <option key={h} value={h} />
              ))}
            </datalist>
          </label>
        </div>
        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="Detalle opcional: hash completo, cabeceras, contexto…"
          className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button type="submit" disabled={!label.trim()} className="rounded-md bg-primary-strong px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50">
          Añadir evidencia
        </button>
      </form>
      {state.evidence.length === 0 ? (
        <p className="text-[11px] text-zinc-500">Sin evidencias registradas todavía.</p>
      ) : (
        <ul className="divide-y divide-white/[0.05] rounded-lg border border-white/[0.06]">
          {state.evidence.map((e) => (
            <li key={e.id} className="flex items-start gap-2 px-3 py-2">
              <span className="shrink-0 rounded border border-white/[0.06] bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-zinc-400">{EVIDENCE_KIND_LABEL[e.kind]}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-zinc-200">{e.label}</span>
                {e.detail && <span className="mt-0.5 block whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-500">{e.detail}</span>}
                <span className="mt-0.5 block text-[10px] text-zinc-600">{formatDateTime(e.at)}</span>
              </span>
              <button
                type="button"
                aria-label={`Quitar la evidencia ${e.label}`}
                onClick={() => {
                  try {
                    onChange(removeEvidence(state, e.id, new Date().toISOString()))
                  } catch (cause) {
                    onError(cause instanceof Error ? cause.message : 'No se pudo quitar la evidencia.')
                  }
                }}
                className="shrink-0 rounded-md p-1 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X size={12} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ChronologySection({
  state,
  onChange,
  onError,
}: {
  state: IncidentPlaybookState
  onChange: (next: IncidentPlaybookState) => void
  onError: (message: string) => void
}) {
  const [at, setAt] = useState(localInputValue)
  const [text, setText] = useState('')
  const chrono = [...state.chronology].sort((a, b) => a.at.localeCompare(b.at))

  return (
    <div>
      <h4 className="mb-2 text-xs font-medium text-zinc-300">Cronología del analista ({state.chronology.length})</h4>
      <form
        className="mb-3 space-y-2 rounded-lg border border-white/[0.06] bg-zinc-950/40 p-2.5"
        onSubmit={(e) => {
          e.preventDefault()
          try {
            const moment = new Date(at)
            if (Number.isNaN(moment.getTime())) throw new Error('Hito: fecha no válida.')
            onChange(addChronology(state, { at: moment.toISOString(), text }, new Date().toISOString()))
            setText('')
            setAt(localInputValue())
          } catch (cause) {
            onError(cause instanceof Error ? cause.message : 'No se pudo añadir el hito.')
          }
        }}
      >
        <div className="flex gap-2">
          <label className="w-44 shrink-0 text-[11px] text-zinc-400">
            <span className="sr-only">Cuándo</span>
            <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} required className={`mt-0 ${inputCls}`} />
          </label>
          <label className="min-w-0 flex-1 text-[11px] text-zinc-400">
            <span className="sr-only">Qué pasó</span>
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} required placeholder="qué pasó en ese momento" className={`mt-0 ${inputCls}`} />
          </label>
        </div>
        <button type="submit" disabled={!text.trim() || !at} className="rounded-md bg-primary-strong px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50">
          Añadir hito
        </button>
      </form>
      {chrono.length === 0 ? (
        <p className="text-[11px] text-zinc-500">Sin hitos todavía: registra con hora lo que reconstruyas del caso.</p>
      ) : (
        <ol className="relative space-y-2.5 border-l border-zinc-800 pl-4">
          {chrono.map((c) => (
            <li key={c.id} className="group relative">
              <span aria-hidden className="absolute -left-[21px] top-1 h-2 w-2 rounded-full border border-zinc-700 bg-zinc-900" />
              <p className="text-xs leading-relaxed text-zinc-200">{c.text}</p>
              <p className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-600">
                {formatDateTime(c.at)}
                <button
                  type="button"
                  aria-label={`Quitar el hito ${c.text}`}
                  onClick={() => {
                    try {
                      onChange(removeChronology(state, c.id, new Date().toISOString()))
                    } catch (cause) {
                      onError(cause instanceof Error ? cause.message : 'No se pudo quitar el hito.')
                    }
                  }}
                  className="rounded-md p-0.5 text-zinc-600 opacity-0 transition-opacity hover:text-zinc-300 focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
                >
                  <X size={11} aria-hidden /> Quitar
                </button>
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
