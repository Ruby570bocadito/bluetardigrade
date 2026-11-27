'use client'

// The console's AI analyst, asked from where the investigation stands
// (boceto 10). The evidence is the alerts of what is being investigated,
// shown before asking; the hub reports its real steps and writes the
// answer as it goes. Without console-service, or for an account limited
// to host groups, it says why and the rest of Investigar keeps working.
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Check, CircleNotch } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { useAnalystChannel } from '@/components/console/socket-provider'
import { acceptsFrame, ANALYST_MARKDOWN_GUARD } from '@/lib/analyst-channel'
import { alertKey } from '@/lib/engine-client'
import { buildIncidentAnalysis, selectAlertsForAnalysis } from '@/lib/incident-analysis'
import type { AnalystStep, SfAlert } from '@/lib/console-types'
import { v2AlertLink } from '@/lib/v2/alerts-model'
import { Empty, SEV_COLOR } from '../home/parts'

type Frame<T> = T & { requestId?: string }

export function AssistedAnalyst({ alerts }: { alerts: readonly SfAlert[] }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.investigateView
  const { status, socket } = useAnalystChannel()
  const [question, setQuestion] = useState('')
  const [steps, setSteps] = useState<AnalystStep[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [asked, setAsked] = useState<string | null>(null)
  const active = useRef<string | null>(null)
  const { picked, omitted } = useMemo(() => selectAlertsForAnalysis(alerts), [alerts])

  useEffect(() => {
    if (!socket) return undefined
    const mine = (frame: Frame<object>) => acceptsFrame(active.current, frame)
    const finish = () => {
      active.current = null
      setRunning(false)
    }
    const onStep = (f: Frame<AnalystStep>) => {
      if (!mine(f)) return
      setSteps((prev) => {
        const i = prev.findIndex((s) => s.label === f.label)
        if (i < 0) return [...prev, { label: f.label, state: f.state }]
        const next = [...prev]
        next[i] = { label: f.label, state: f.state }
        return next
      })
    }
    const onDelta = (f: Frame<{ text: string }>) => mine(f) && setText((prev) => prev + f.text)
    const onDone = (f: Frame<{ text: string }>) => {
      if (!mine(f)) return
      setText((prev) => prev || f.text)
      setSteps((prev) => prev.map((s) => ({ ...s, state: 'done' })))
      finish()
    }
    const onError = (f: Frame<{ message: string }>) => {
      if (!mine(f)) return
      setError(f.message)
      finish()
    }
    const onDrop = () => {
      if (!active.current) return
      setError(t.anLost)
      finish()
    }
    socket.on('analyst:step', onStep)
    socket.on('analyst:delta', onDelta)
    socket.on('analyst:done', onDone)
    socket.on('analyst:error', onError)
    socket.on('disconnect', onDrop)
    return () => {
      socket.off('analyst:step', onStep)
      socket.off('analyst:delta', onDelta)
      socket.off('analyst:done', onDone)
      socket.off('analyst:error', onError)
      socket.off('disconnect', onDrop)
    }
  }, [socket, t])

  const ask = (q: string) => {
    const clean = q.trim()
    if (!socket || status !== 'live' || running || picked.length === 0 || !clean) return
    const requestId = crypto.randomUUID()
    active.current = requestId
    setRunning(true)
    setSteps([])
    setText('')
    setError(null)
    setAsked(clean)
    const payload = buildIncidentAnalysis({ source: 'selection', alerts })
    socket.emit('analyst:ask-incident', { ...payload, requestId, lang, question: clean })
  }

  // why it cannot answer, where the answer would go
  const offline =
    status === 'scoped' ? (
      <Empty title={t.anScoped}>{t.anScopedHint}</Empty>
    ) : status === 'down' ? (
      <Empty title={t.anOffline}>{t.anOfflineHint}</Empty>
    ) : status === 'connecting' ? (
      <Empty title={t.anConnecting} />
    ) : null

  return (
    <div className="v2-analyst">
      <section className="v2-analyst-ask">
        <h3>{t.anContext}</h3>
        <p className="v2-dim v2-small">{t.anContextHint}</p>
        {picked.length === 0 ? (
          <Empty title={t.anNoContext}>{t.anNoContextHint}</Empty>
        ) : (
          <ul className="v2-evidence">
            {picked.map((a) => (
              <li key={alertKey(a)}>
                <a href={v2AlertLink(alertKey(a))} className="v2-evidence-chip" style={{ ['--c' as string]: SEV_COLOR[a.severity] }}>
                  <i aria-hidden="true" />
                  <span>{a.rule_name}</span>
                  <span className="v2-mono v2-dim">{a.host}</span>
                </a>
              </li>
            ))}
            {omitted > 0 && <li className="v2-dim v2-small">{t.anOmitted(omitted)}</li>}
          </ul>
        )}
        <form
          className="v2-analyst-form"
          onSubmit={(e) => {
            e.preventDefault()
            ask(question)
          }}
        >
          <label className="v2-field">
            {t.anQuestion}
            <textarea
              className="v2-input v2-textarea"
              rows={3}
              value={question}
              placeholder={t.anPlaceholder}
              maxLength={1000}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  ask(question)
                }
              }}
            />
          </label>
          <div className="v2-chips">
            {t.anSuggestions.map((s) => (
              <button key={s} type="button" className="v2-chip-btn" onClick={() => setQuestion(s)}>
                {s}
              </button>
            ))}
          </div>
          <button type="submit" className="v2-btn v2-btn-primary" disabled={status !== 'live' || running || picked.length === 0 || !question.trim()}>
            {running ? t.anAsking : t.anAsk}
          </button>
        </form>
      </section>

      <section className="v2-analyst-answer" aria-live="polite">
        {asked && <p className="v2-analyst-q">{asked}</p>}
        {steps.length > 0 && (
          <>
            <h3>{t.anSteps}</h3>
            <ol className="v2-an-steps">
              {steps.map((s) => (
                <li key={s.label} data-state={s.state}>
                  {s.state === 'done' ? <Check aria-hidden="true" /> : <CircleNotch aria-hidden="true" className="v2-spin" />}
                  {s.label}
                </li>
              ))}
            </ol>
          </>
        )}
        {(text || running) && (
          <>
            <h3>{t.anAnswer}</h3>
            <div className="v2-an-text" data-streaming={running}>
              <ReactMarkdown {...ANALYST_MARKDOWN_GUARD}>{text}</ReactMarkdown>
            </div>
          </>
        )}
        {error && <p className="v2-error">{t.anError(error)}</p>}
        {(text || error) && (
          <>
            <h3>{t.anEvidence}</h3>
            <ul className="v2-evidence v2-evidence-compact">
              {picked.map((a) => (
                <li key={alertKey(a)}>
                  <a href={v2AlertLink(alertKey(a))} className="v2-evidence-chip" style={{ ['--c' as string]: SEV_COLOR[a.severity] }}>
                    <i aria-hidden="true" />
                    <span>{a.rule_name}</span>
                  </a>
                </li>
              ))}
            </ul>
            <p className="v2-dim v2-small">{t.anNote}</p>
          </>
        )}
        {!asked && (offline ?? <Empty title={t.anTitle}>{t.anContextHint}</Empty>)}
      </section>
    </div>
  )
}
