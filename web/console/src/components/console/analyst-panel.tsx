'use client'

// AI triage analyst. Agent-style interaction: steps report what stage the
// analysis is in; the provider's answer arrives over the socket and renders
// as it is generated (native streaming from the hub; providers without
// streaming deliver it in one piece). These steps do not simulate
// correlation. Context comes from an alert selected in the Alerts view
// (or picked here). The transcript travels over the console-service
// socket; if that service is down the view says so and everything else
// stays usable.

import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowsClockwise, CheckCircle, CircleNotch, Sparkle, Stack, Tray, Warning } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAnalystChannel } from './socket-provider'
import { useEngine } from './engine-provider'
import { EmptyState, OfflineNotice, SeverityBadge } from './ui-bits'
import { StarBorder } from '@/components/reactbits/star-border'
import { digestBundle, pickBundleAlert, type BundleDigest, type PendingIncidentAnalysis } from '@/lib/incident-analysis'
import { readForensicBundle } from '@/lib/forensic'
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

// Same context for a multi-alert analysis: every suppression entry that
// mutes any rule involved in the case, so a thin queue is explained.
function incidentSuppressionNote(alerts: readonly SfAlert[], entries: SfSuppression[]): string | undefined {
  const ruleIds = new Set(alerts.map((a) => a.rule_id))
  const matches = entries.filter((s) => ruleIds.has(s.rule_id))
  if (matches.length === 0) return undefined
  const parts = matches.slice(0, 5).map((s) => {
    const scope = !s.host ? 'todos los hosts' : `el host ${s.host}`
    const until = s.expires ? `, hasta ${s.expires}` : ''
    const why = s.reason ? ` — ${s.reason}` : ''
    return `${s.rule_id} (${scope}${until}${why})`
  })
  const extra = matches.length > 5 ? ` y ${matches.length - 5} más` : ''
  return `Supresiones activas para reglas del caso: ${parts.join('; ')}${extra}.`
}

export function AnalystPanel({
  pendingAlert,
  clearPending,
  pendingIncident,
  clearPendingIncident,
}: {
  pendingAlert: SfAlert | null
  clearPending: () => void
  pendingIncident?: PendingIncidentAnalysis | null
  clearPendingIncident?: () => void
}) {
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

  // Multi-alert analysis (incident case or queue selection): the payload
  // was assembled by the shell from real case data; here the frozen
  // bundle of the most severe alert is fetched and attached when the
  // engine answers. Without a bundle the payload travels without one
  // (the hub never pretends there was evidence).
  async function analyzeIncident(pending: PendingIncidentAnalysis, q?: string) {
    const socket = getSocket()
    if (!socket || running || !channelLive) return
    setRunning(true)
    setPickerId(null)
    const p = pending.payload
    const hosts = new Set(p.alerts.map((a) => a.host || '(sin equipo)')).size
    const meta = [
      `${p.alerts.length} ${p.alerts.length === 1 ? 'alerta' : 'alertas'}`,
      p.omitted_alerts ? `+${p.omitted_alerts} no incluidas` : null,
      `${hosts} ${hosts === 1 ? 'equipo' : 'equipos'}`,
      `${p.groups.length} ${p.groups.length === 1 ? 'ventana' : 'ventanas'}`,
    ].filter(Boolean).join(' · ')
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'user',
        incidentTitle: pending.label,
        incidentMeta: meta,
        question: q,
        suppressionNote: incidentSuppressionNote(p.alerts, suppressions),
        incidentPayload: p,
      },
      { id: crypto.randomUUID(), role: 'analyst', steps: [], text: '' },
    ])
    let bundle: BundleDigest | undefined
    const top = pickBundleAlert(p.alerts)
    if (top?.id) {
      const res = await readForensicBundle(top.id)
      if (res.kind === 'bundle') bundle = digestBundle(res.bundle)
    }
    const payload: Record<string, unknown> = { ...p }
    if (bundle) payload.bundle = bundle
    if (q && q.trim()) payload.question = q.trim()
    socket.emit('analyst:ask-incident', payload)
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

  // Hand-off from the incidents view (or the selection bar): same
  // deferred pattern, the bundle fetch happens inside analyzeIncident.
  useEffect(() => {
    if (!pendingIncident) return
    const id = setTimeout(() => {
      void analyzeIncident(pendingIncident, undefined)
      clearPendingIncident?.()
    }, 0)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingIncident])

  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const canRetry = Boolean(lastUser?.alertName || lastUser?.incidentPayload) && !running && channelLive

  return (
    <section aria-label="Analista IA" className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="panel flex min-w-0 flex-col overflow-hidden">
        <div className="panel-head">
          <Tray size={15} aria-hidden className="text-primary" />
          <h2 className="text-sm font-medium text-zinc-100">Elige una alerta</h2>
          <span className="ml-auto text-xs tabular-nums text-zinc-500">{alerts.length}</span>
        </div>
        <div className="max-h-[64vh] flex-1 overflow-y-auto">
          <ul className="divide-y divide-zinc-800/70">
            {alerts.slice(0, 20).map((al) => (
              <li key={`${al.event_id}:${al.rule_id}`}>
                <button
                  type="button"
                  onClick={() => {
                    setPickerId(`${al.event_id}:${al.rule_id}`)
                    void analyze(al, undefined)
                  }}
                  disabled={running || !channelLive}
                  className={`w-full px-4 py-2.5 text-left transition-colors hover:bg-zinc-800/40 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                    pickerId === `${al.event_id}:${al.rule_id}` ? 'bg-primary-tint/[0.08]' : ''
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
      <StarBorder active={running} className="flex min-h-[64vh] min-w-0 flex-col rounded-[0.875rem] bg-[var(--viz-surface)]">
        <div className="panel-head">
          <span className="icon-tile"><Sparkle size={14} weight="fill" aria-hidden /></span>
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-zinc-100">Analista IA</h2>
            <p className="truncate text-[11px] text-zinc-500">Modelo propio configurado en web/console-service · respuesta completa, sin streaming simulado</p>
          </div>
          <span className={`ml-auto flex shrink-0 items-center gap-1.5 text-[11px] ${channelLive ? 'text-emerald-300' : 'text-zinc-500'}`}>
            <span aria-hidden className={`h-2 w-2 rounded-full ${channelLive ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
            {channelLive ? (running ? 'analizando' : 'conectado') : 'sin conexión'}
          </span>
        </div>
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
                    <li key={m.id} className="ml-auto w-fit max-w-[85%] rounded-xl rounded-br-sm border border-primary/20 bg-primary-tint/[0.08] px-3 py-2 text-xs">
                      {m.alertName && (
                        <span>
                          <span className="text-zinc-400">Analizar </span>
                          <span className="font-medium text-zinc-100">{m.alertName}</span>
                        </span>
                      )}
                      {m.incidentTitle && (
                        <span className="flex items-center gap-1.5">
                          <Stack size={12} aria-hidden className="shrink-0 text-primary-link" />
                          <span className="text-zinc-400">Analizar incidente </span>
                          <span className="font-medium text-zinc-100">{m.incidentTitle}</span>
                        </span>
                      )}
                      {m.incidentMeta && <span className="mt-0.5 block font-mono text-[10px] text-zinc-500">{m.incidentMeta}</span>}
                      {m.question && <span className="mt-0.5 block text-zinc-300">{m.question}</span>}
                      {m.suppressionNote && (
                        <p className="mt-1.5 max-w-[70ch] rounded border border-amber-300/30 bg-amber-300/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber-200">
                          {m.suppressionNote}
                        </p>
                      )}
                    </li>
                  ) : (
                    <li key={m.id} className="min-w-0 rounded-xl rounded-bl-sm border border-zinc-800 bg-zinc-900/60 px-4 py-3">
                      {m.steps && m.steps.length > 0 && (
                        <ul className="mb-3 space-y-1.5">
                          {m.steps.map((s) => (
                            <li key={s.label} className="flex items-center gap-2 text-xs">
                              {s.state === 'run' ? (
                                <CircleNotch size={14} className="animate-spin text-primary" aria-hidden />
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
                if (lastUser?.incidentPayload) {
                  void analyzeIncident({ payload: lastUser.incidentPayload, label: lastUser.incidentTitle ?? 'Análisis anterior' }, lastUser?.question)
                  return
                }
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
