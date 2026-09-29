'use client'

// AI triage analyst. Agent-style interaction: steps report what stage the
// analysis is in, the conclusion streams in as it is produced. Context comes
// from an alert selected in the Alerts view (or picked here).

import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowsClockwise, CheckCircle, CircleNotch, Sparkle, Warning } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useConsole } from './socket-provider'
import { EmptyState, SectionHeader, SeverityBadge } from './ui-bits'
import { formatTime, type AnalystMessage, type SfAlert } from '@/lib/console-types'

type AskPayload = { alert: SfAlert; question?: string }

export function AnalystPanel({ pendingAlert, clearPending }: { pendingAlert: SfAlert | null; clearPending: () => void }) {
  const { alerts, getSocket } = useConsole()
  const reduce = useReducedMotion()
  const [messages, setMessages] = useState<AnalystMessage[]>([])
  const [question, setQuestion] = useState('')
  const [running, setRunning] = useState(false)
  const [pickerId, setPickerId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Live updates while the analyst works.
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return
    const onStep = ({ label, state }: { label: string; state: 'run' | 'done' }) => {
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (!last || last.role !== 'analyst') return prev
        const steps = [...(last.steps ?? [])]
        const idx = steps.findIndex((s) => s.label === label)
        if (idx >= 0) steps[idx] = { label, state }
        else steps.push({ label, state })
        next[next.length - 1] = { ...last, steps }
        return next
      })
    }
    const onDelta = ({ text }: { text: string }) => {
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (!last || last.role !== 'analyst') return prev
        next[next.length - 1] = { ...last, text: (last.text ?? '') + text }
        return next
      })
    }
    const onDone = ({ text }: { text: string }) => {
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (!last || last.role !== 'analyst') return prev
        next[next.length - 1] = { ...last, text: last.text || text }
        return next
      })
      setRunning(false)
    }
    const onError = ({ message }: { message: string }) => {
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (!last || last.role !== 'analyst') return prev
        next[next.length - 1] = { ...last, error: message }
        return next
      })
      setRunning(false)
    }
    socket.on('analyst:step', onStep)
    socket.on('analyst:delta', onDelta)
    socket.on('analyst:done', onDone)
    socket.on('analyst:error', onError)
    return () => {
      socket.off('analyst:step', onStep)
      socket.off('analyst:delta', onDelta)
      socket.off('analyst:done', onDone)
      socket.off('analyst:error', onError)
    }
  }, [getSocket])

  // Keep the transcript pinned to the newest line.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  function analyze(alert: SfAlert, q?: string) {
    const socket = getSocket()
    if (!socket || running) return
    setRunning(true)
    setPickerId(null)
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', alertName: alert.rule_name, question: q },
      { id: crypto.randomUUID(), role: 'analyst', steps: [], text: '' },
    ])
    const payload: AskPayload = { alert }
    if (q && q.trim()) payload.question = q.trim()
    socket.emit('analyst:ask', payload)
  }

  // Hand-off from the alerts view: open a fresh analysis immediately.
  // The zero-delay timeout defers the state updates out of the effect body.
  useEffect(() => {
    if (!pendingAlert) return
    const id = setTimeout(() => {
      analyze(pendingAlert, undefined)
      clearPending()
    }, 0)
    return () => clearTimeout(id)
     
  }, [pendingAlert])

  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const canRetry = lastUser?.alertName && !running

  return (
    <section aria-label="Analista IA" className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <div className="min-w-0">
        <SectionHeader title="Cola de alertas" count={alerts.length} />
        <div className="max-h-[52vh] overflow-y-auto rounded-md border border-white/[0.08]">
          <ul className="divide-y divide-white/[0.06]">
            {alerts.slice(0, 20).map((al) => (
              <li key={al.id}>
                <button
                  type="button"
                  onClick={() => {
                    setPickerId(al.id)
                    void analyze(al, undefined)
                  }}
                  disabled={running}
                  className={`w-full px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04] disabled:opacity-50 ${
                    pickerId === al.id ? 'bg-white/[0.05]' : ''
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <SeverityBadge severity={al.severity} />
                    <span className="truncate text-xs text-zinc-200">{al.rule_name}</span>
                  </span>
                  <span className="mt-1 block font-mono text-[11px] text-zinc-500">
                    {formatTime(al.timestamp)} {al.host}
                  </span>
                </button>
              </li>
            ))}
            {alerts.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-zinc-500">Sin alertas en cola</li>
            )}
          </ul>
        </div>
      </div>

      <div className="flex min-h-[52vh] min-w-0 flex-col rounded-md border border-white/[0.08]">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <EmptyState
              title="El analista espera una alerta"
              hint="Elige una detección de la cola y el modelo la explicará: qué ha pasado, por qué importa, riesgo y primeros pasos"
            />
          ) : (
            <ul className="space-y-5">
              {messages.map((m) =>
                m.role === 'user' ? (
                  <li key={m.id} className="text-xs">
                    <span className="text-zinc-500">Analizando </span>
                    <span className="text-zinc-200">{m.alertName}</span>
                    {m.question && <span className="block text-zinc-400">Pregunta: {m.question}</span>}
                  </li>
                ) : (
                  <li key={m.id} className="min-w-0">
                    {m.steps && m.steps.length > 0 && (
                      <ul className="mb-3 space-y-1.5">
                        {m.steps.map((s) => (
                          <li key={s.label} className="flex items-center gap-2 text-xs">
                            {s.state === 'run' ? (
                              <CircleNotch size={14} className="animate-spin text-emerald-300" aria-hidden />
                            ) : (
                              <CheckCircle size={14} className="text-emerald-400" aria-hidden />
                            )}
                            <span className={s.state === 'run' ? 'text-zinc-300' : 'text-zinc-500'}>{s.label}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {m.text && (
                      <motion.div
                        initial={reduce ? false : { opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25 }}
                        className="max-w-[75ch] space-y-2 text-sm leading-relaxed text-zinc-300 [&_code]:rounded [&_code]:bg-white/[0.06] [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_li]:ml-4 [&_li]:list-disc [&_p]:leading-relaxed [&_strong]:font-semibold [&_strong]:text-zinc-100"
                      >
                        <ReactMarkdown
                          components={{
                            p: (p) => <p {...(p as object)} />,
                            ul: (p) => <ul {...(p as object)} />,
                            li: (p) => <li {...(p as object)} />,
                            strong: (p) => <strong {...(p as object)} />,
                            code: (p) => <code {...(p as object)} />,
                          }}
                        >
                          {m.text}
                        </ReactMarkdown>
                      </motion.div>
                    )}
                    {m.error && (
                      <div className="mt-2 flex items-start gap-2 rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">
                        <Warning size={14} className="mt-0.5 shrink-0" aria-hidden />
                        <span>
                          El analista no pudo completar la respuesta: {m.error}. Comprueba la conexion y vuelve a intentarlo.
                        </span>
                      </div>
                    )}
                  </li>
                ),
              )}
            </ul>
          )}
        </div>

        <form
          className="flex items-center gap-2 border-t border-white/[0.08] px-3 py-2.5"
          onSubmit={(e) => {
            e.preventDefault()
            const al = alerts.find((a) => a.id === pickerId) ?? alerts[0]
            if (!al || running) return
            analyze(al, question)
            setQuestion('')
          }}
        >
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Pregunta opcional para el analista (p. ej. contenido recomendado)"
            className="h-9 flex-1 border-white/10 bg-white/[0.03] text-xs"
            aria-label="Pregunta para el analista"
          />
          <Button type="submit" size="sm" disabled={running || alerts.length === 0} className="gap-1.5 active:scale-[0.98]">
            {running ? <CircleNotch size={14} className="animate-spin" aria-hidden /> : <Sparkle size={14} weight="fill" aria-hidden />}
            {running ? 'Analizando' : 'Analizar'}
          </Button>
          {canRetry && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="gap-1.5 text-zinc-400 active:scale-[0.98]"
              aria-label="Repetir el último análisis"
              onClick={() => {
                const al = alerts.find((a) => a.rule_name === lastUser?.alertName) ?? alerts[0]
                if (al) analyze(al, lastUser?.question)
              }}
            >
              <ArrowsClockwise size={14} aria-hidden />
              <span className="hidden sm:inline">Repetir</span>
            </Button>
          )}
        </form>
      </div>
    </section>
  )
}
