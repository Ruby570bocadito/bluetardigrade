'use client'

// AI triage analyst. Agent-style interaction: steps report what stage the
// analysis is in, the conclusion streams in as it is produced. Context
// comes from an alert selected in the Alerts view (or picked here).
// The transcript travels over the console-service socket; if that
// service is down the view says so and everything else stays usable.

import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowsClockwise, CheckCircle, CircleNotch, Sparkle, Tray, Warning } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAnalystChannel } from './socket-provider'
import { useEngine } from './engine-provider'
import { EmptyState, OfflineNotice, SectionHeader, SeverityBadge } from './ui-bits'
import { StarBorder } from '@/components/reactbits/star-border'
import { formatTime, type AnalystMessage, type SfAlert, type SfSuppression } from '@/lib/console-types'

type AskPayload = { alert: SfAlert; question?: string }

// Operator-suppression context for the alert being analyzed: an entry in
// suppressions.yaml matching this rule means alerts from that host (or
// every host) are being deliberately muted, which is exactly what an
// analyst needs to know when the queue looks thinner than it should.
function suppressionNote(alert: SfAlert, entries: SfSuppression[]): string | undefined {
  const matches = entries.filter((s) => s.rule_id === alert.rule_id)
  if (matches.length === 0) return undefined
  const parts = matches.map((s) => {
    const scope = !s.host
      ? 'todos los hosts'
      : s.host.toLowerCase() === alert.host.toLowerCase()
        ? `este host (${s.host})`
        : `el host ${s.host}`
    const until = s.expires ? `, hasta ${s.expires}` : ''
    const why = s.reason ? ` — ${s.reason}` : ''
    return `${scope}${until}${why}`
  })
  return `Supresiones activas para esta regla: ${parts.join('; ')}.`
}

export function AnalystPanel({ pendingAlert, clearPending }: { pendingAlert: SfAlert | null; clearPending: () => void }) {
  const { alerts, suppressions } = useEngine()
  const { status: channelStatus, getSocket } = useAnalystChannel()
  const reduce = useReducedMotion()
  const [messages, setMessages] = useState<AnalystMessage[]>([])
  const [question, setQuestion] = useState('')
  const [running, setRunning] = useState(false)
  const [pickerId, setPickerId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const channelLive = channelStatus === 'live'

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
    if (!socket || running || !channelLive) return
    setRunning(true)
    setPickerId(null)
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'user',
        alertName: alert.rule_name,
        question: q,
        suppressionNote: suppressionNote(alert, suppressions),
      },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAlert])

  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const canRetry = lastUser?.alertName && !running && channelLive

  return (
    <section aria-label="Analista IA" className="grid gap-4 lg:grid-cols-[290px_minmax(0,1fr)]">
      <div className="min-w-0">
        <SectionHeader title="Cola de alertas" count={alerts.length} />
        <div className="max-h-[56vh] overflow-y-auto rounded-lg border border-zinc-800">
          <ul className="divide-y divide-zinc-800/80">
            {alerts.slice(0, 20).map((al) => (
              <li key={`${al.event_id}:${al.rule_id}`}>
                <button
                  type="button"
                  onClick={() => {
                    setPickerId(`${al.event_id}:${al.rule_id}`)
                    void analyze(al, undefined)
                  }}
                  disabled={running || !channelLive}
                  className={`w-full px-3 py-2.5 text-left transition-colors hover:bg-zinc-800/40 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                    pickerId === `${al.event_id}:${al.rule_id}` ? 'bg-zinc-800/60' : ''
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

      {/* StarBorder (React Bits): el borde de 1px entra en movimiento
          mientras el analista trabaja — es el indicador de "procesando",
          no decoración; al terminar vuelve al borde estático. La rama
          offline del canal (canalLive) conserva su aviso honesto dentro. */}
      <StarBorder active={running} className="flex min-h-[56vh] min-w-0 flex-col rounded-lg border border-zinc-800 bg-zinc-900/40">
        {!channelLive ? (
          <div className="p-4">
            <OfflineNotice
              title="Servicio del analista sin conexión"
              hint="El análisis IA vive en web/console-service (puerto 3003). Arrancalo con bun run dev en ese directorio; el resto de la consola sigue operativa."
            />
          </div>
        ) : (
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <EmptyState
                icon={Sparkle}
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
                      {m.suppressionNote && (
                        <p className="mt-1.5 max-w-[70ch] rounded border border-amber-300/30 bg-amber-300/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber-200">
                          {m.suppressionNote}
                        </p>
                      )}
                    </li>
                  ) : (
                    <li key={m.id} className="min-w-0">
                      {m.steps && m.steps.length > 0 && (
                        <ul className="mb-3 space-y-1.5">
                          {m.steps.map((s) => (
                            <li key={s.label} className="flex items-center gap-2 text-xs">
                              {s.state === 'run' ? (
                                <CircleNotch size={14} className="animate-spin text-emerald-400" aria-hidden />
                              ) : (
                                <CheckCircle size={14} className="text-emerald-500" aria-hidden />
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
                          transition={{ duration: 0.2 }}
                          className="max-w-[75ch] space-y-2 text-sm leading-relaxed text-zinc-300 [&_code]:rounded-sm [&_code]:bg-zinc-800 [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_li]:ml-4 [&_li]:list-disc [&_p]:leading-relaxed [&_strong]:font-semibold [&_strong]:text-zinc-100"
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
                        <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
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
        )}

        <form
          className="flex items-center gap-2 border-t border-zinc-800 px-3 py-2.5"
          onSubmit={(e) => {
            e.preventDefault()
            const al = alerts.find((a) => `${a.event_id}:${a.rule_id}` === pickerId) ?? alerts[0]
            if (!al || running || !channelLive) return
            analyze(al, question)
            setQuestion('')
          }}
        >
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Pregunta opcional para el analista (p. ej. contenido recomendado)"
            className="h-9 flex-1 rounded-md border-zinc-800 bg-zinc-900 text-xs"
            aria-label="Pregunta para el analista"
            disabled={!channelLive}
          />
          <Button type="submit" size="sm" disabled={running || alerts.length === 0 || !channelLive} className="gap-1.5 rounded-md">
            {running ? <CircleNotch size={14} className="animate-spin" aria-hidden /> : <Sparkle size={14} weight="fill" aria-hidden />}
            {running ? 'Analizando' : 'Analizar'}
          </Button>
          {canRetry && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="gap-1.5 rounded-md text-zinc-400 hover:text-zinc-100"
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
      </StarBorder>
    </section>
  )
}
