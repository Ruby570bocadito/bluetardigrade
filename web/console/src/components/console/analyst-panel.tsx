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
import { useI18n } from './i18n-provider'
import { EmptyState, OfflineNotice, SeverityBadge } from './ui-bits'
import { StarBorder } from '@/components/reactbits/star-border'
import {
  ANALYST_MARKDOWN_GUARD, acceptsFrame, alertKey, analystTarget, withDelta, withDone, withError, withStep,
} from '@/lib/analyst-channel'
import { digestBundle, pickBundleAlert, type BundleDigest, type PendingIncidentAnalysis } from '@/lib/incident-analysis'
import { readForensicBundle } from '@/lib/forensic'
import type { Dict } from '@/lib/i18n'
import { formatTime, type AnalystMessage, type SfAlert, type SfSuppression } from '@/lib/console-types'

// requestId tags every frame of the answer; lang is the language the
// hub answers and labels its steps in.
type AskPayload = { alert: SfAlert; question?: string; requestId: string; lang: string }

type SuppressWords = Dict['analyst']['suppress']

// Operator-suppression context for the alert being analyzed: an entry in
// suppressions.yaml matching this rule means alerts from that host (or
// every host) are being deliberately muted, which is exactly what an
// analyst needs to know when the queue looks thinner than it should.
// The words travel in the dictionary (analyst.suppress); the suppression
// reason is engine data and never translates.
function suppressionNote(alert: SfAlert, entries: SfSuppression[], w: SuppressWords): string | undefined {
  const matches = entries.filter((s) => s.rule_id === alert.rule_id)
  if (matches.length === 0) return undefined
  const parts = matches.map((s) => {
    const scope = !s.host
      ? w.allHosts
      : s.host.toLowerCase() === alert.host.toLowerCase()
        ? w.thisHost(s.host)
        : w.thatHost(s.host)
    const until = s.expires ? w.until(s.expires) : ''
    const why = s.reason ? ` — ${s.reason}` : ''
    return `${scope}${until}${why}`
  })
  return w.note(parts.join('; '))
}

// Same context for a multi-alert analysis: every suppression entry that
// mutes any rule involved in the case, so a thin queue is explained.
function incidentSuppressionNote(alerts: readonly SfAlert[], entries: SfSuppression[], w: SuppressWords): string | undefined {
  const ruleIds = new Set(alerts.map((a) => a.rule_id))
  const matches = entries.filter((s) => ruleIds.has(s.rule_id))
  if (matches.length === 0) return undefined
  const parts = matches.slice(0, 5).map((s) => {
    const scope = !s.host ? w.allHosts : w.thatHost(s.host)
    const until = s.expires ? w.until(s.expires) : ''
    const why = s.reason ? ` — ${s.reason}` : ''
    return `${s.rule_id} (${scope}${until}${why})`
  })
  const extra = matches.length > 5 ? w.andMore(matches.length - 5) : ''
  return w.incidentNote(parts.join('; ') + extra)
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
  const { dict, lang } = useI18n()
  const { status: channelStatus, socket } = useAnalystChannel()
  const reduce = useReducedMotion()
  const [messages, setMessages] = useState<AnalystMessage[]>([])
  const [question, setQuestion] = useState('')
  const [running, setRunning] = useState(false)
  const [pickerId, setPickerId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const channelLive = channelStatus === 'live'
  // The request whose frames the panel is waiting for; null when idle.
  const activeRequest = useRef<string | null>(null)
  // read by the disconnect handler, which outlives a language change
  const disconnectedText = useRef(dict.analyst.disconnected)
  useEffect(() => {
    disconnectedText.current = dict.analyst.disconnected
  }, [dict])

  // Live updates while the analyst works. The socket is created after
  // the provider's credential fetch, so on a direct load of this view it
  // arrives after the first render: the effect depends on it and
  // subscribes when it does. Frames of any request but the active one
  // are ignored (lib/analyst-channel).
  useEffect(() => {
    if (!socket) return
    type Frame<T> = T & { requestId?: string }
    const active = (frame: Frame<unknown>): string | null =>
      acceptsFrame(activeRequest.current, frame as { requestId?: unknown }) ? activeRequest.current : null
    const finish = () => {
      activeRequest.current = null
      setRunning(false)
    }
    const onStep = (frame: Frame<{ label: string; state: 'run' | 'done' }>) => {
      const id = active(frame)
      if (id) setMessages((prev) => withStep(prev, id, frame))
    }
    const onDelta = (frame: Frame<{ text: string }>) => {
      const id = active(frame)
      if (id) setMessages((prev) => withDelta(prev, id, frame.text))
    }
    const onDone = (frame: Frame<{ text: string }>) => {
      const id = active(frame)
      if (!id) return
      setMessages((prev) => withDone(prev, id, frame.text))
      finish()
    }
    const onError = (frame: Frame<{ message: string }>) => {
      const id = active(frame)
      if (!id) return
      setMessages((prev) => withError(prev, id, frame.message))
      finish()
    }
    // The hub cancels the analyses of a socket that drops: no further
    // frame will arrive for the one in flight, so it ends here instead
    // of leaving the panel "analysing" for good.
    const onDisconnect = () => {
      const id = activeRequest.current
      if (!id) return
      setMessages((prev) => withError(prev, id, disconnectedText.current))
      finish()
    }
    socket.on('analyst:step', onStep)
    socket.on('analyst:delta', onDelta)
    socket.on('analyst:done', onDone)
    socket.on('analyst:error', onError)
    socket.on('disconnect', onDisconnect)
    return () => {
      socket.off('analyst:step', onStep)
      socket.off('analyst:delta', onDelta)
      socket.off('analyst:done', onDone)
      socket.off('analyst:error', onError)
      socket.off('disconnect', onDisconnect)
    }
  }, [socket])

  // Keep the transcript pinned to the newest line.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  function analyze(alert: SfAlert, q?: string) {
    if (!socket || running || !channelLive) return
    const requestId = crypto.randomUUID()
    activeRequest.current = requestId
    setRunning(true)
    // the queue highlights the alert the conversation is about, whether
    // it was picked here or handed over from the alerts view
    setPickerId(alertKey(alert))
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'user',
        alertName: alert.rule_name,
        alert,
        question: q,
        suppressionNote: suppressionNote(alert, suppressions, dict.analyst.suppress),
      },
      { id: crypto.randomUUID(), role: 'analyst', requestId, steps: [], text: '' },
    ])
    const payload: AskPayload = { alert, requestId, lang }
    if (q && q.trim()) payload.question = q.trim()
    socket.emit('analyst:ask', payload)
  }

  // Multi-alert analysis (incident case or queue selection): the payload
  // was assembled by the shell from real case data; here the frozen
  // bundle of the most severe alert is fetched and attached when the
  // engine answers. Without a bundle the payload travels without one
  // (the hub never pretends there was evidence).
  async function analyzeIncident(pending: PendingIncidentAnalysis, q?: string) {
    if (!socket || running || !channelLive) return
    const requestId = crypto.randomUUID()
    activeRequest.current = requestId
    setRunning(true)
    setPickerId(null)
    const p = pending.payload
    const hosts = new Set(p.alerts.map((a) => a.host || dict.analyst.noHost)).size
    const meta = [
      dict.analyst.metaAlerts(p.alerts.length),
      p.omitted_alerts ? dict.analyst.metaOmitted(p.omitted_alerts) : null,
      dict.analyst.metaHosts(hosts),
      dict.analyst.metaWindows(p.groups.length),
    ].filter(Boolean).join(' · ')
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'user',
        incidentTitle: pending.label,
        incidentMeta: meta,
        question: q,
        suppressionNote: incidentSuppressionNote(p.alerts, suppressions, dict.analyst.suppress),
        incidentPayload: p,
      },
      { id: crypto.randomUUID(), role: 'analyst', requestId, steps: [], text: '' },
    ])
    let bundle: BundleDigest | undefined
    const top = pickBundleAlert(p.alerts)
    if (top?.id) {
      const res = await readForensicBundle(top.id)
      if (res.kind === 'bundle') bundle = digestBundle(res.bundle)
    }
    // the socket dropped while the bundle was being read: the request
    // was already closed with an error, sending it now would orphan it
    if (activeRequest.current !== requestId) return
    const payload: Record<string, unknown> = { ...p, requestId, lang }
    if (bundle) payload.bundle = bundle
    if (q && q.trim()) payload.question = q.trim()
    socket.emit('analyst:ask-incident', payload)
  }

  // Hand-off from the alerts view: open a fresh analysis immediately.
  // The zero-delay timeout defers the state updates out of the effect body.
  // It waits for the channel: a hand-off that lands before the socket is
  // up would otherwise be consumed without sending anything.
  useEffect(() => {
    if (!pendingAlert || !socket || !channelLive) return
    const id = setTimeout(() => {
      analyze(pendingAlert, undefined)
      clearPending()
    }, 0)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAlert, socket, channelLive])

  // Hand-off from the incidents view (or the selection bar): same
  // deferred pattern, the bundle fetch happens inside analyzeIncident.
  useEffect(() => {
    if (!pendingIncident || !socket || !channelLive) return
    const id = setTimeout(() => {
      void analyzeIncident(pendingIncident, undefined)
      clearPendingIncident?.()
    }, 0)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingIncident, socket, channelLive])

  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const canRetry = Boolean(lastUser?.alert || lastUser?.incidentPayload) && !running && channelLive

  // A follow-up question and «Repetir» go to what the conversation is
  // about (lib/analyst-channel, analystTarget), with the given question.
  function askAgain(q?: string) {
    const target = analystTarget(messages, alerts)
    if (!target || running || !channelLive) return
    if (target.kind === 'alert') {
      analyze(target.alert, q)
      return
    }
    const m = target.message
    if (m.incidentPayload) void analyzeIncident({ payload: m.incidentPayload, label: m.incidentTitle ?? dict.analyst.previousAnalysis }, q)
  }

  return (
    <section aria-label={dict.analyst.sectionAria} className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="panel flex min-w-0 flex-col overflow-hidden">
        <div className="panel-head">
          <Tray size={15} aria-hidden className="text-primary" />
          <h2 className="text-sm font-medium text-zinc-100">{dict.analyst.queueTitle}</h2>
          <span className="ml-auto text-xs tabular-nums text-zinc-500">{alerts.length}</span>
        </div>
        <div className="max-h-[64vh] flex-1 overflow-y-auto" tabIndex={0} aria-label={dict.analyst.queueAria}>
          <ul className="divide-y divide-zinc-800/70">
            {alerts.slice(0, 20).map((al) => (
              <li key={`${al.event_id}:${al.rule_id}`}>
                <button
                  type="button"
                  onClick={() => analyze(al, undefined)}
                  disabled={running || !channelLive}
                  aria-current={pickerId === alertKey(al) ? 'true' : undefined}
                  className={`w-full px-4 py-2.5 text-left transition-colors hover:bg-zinc-800/40 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                    pickerId === alertKey(al) ? 'bg-primary-tint/[0.08]' : ''
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <SeverityBadge severity={al.severity} />
                    <span className="truncate text-xs text-zinc-200">{al.rule_name}</span>
                  </span>
                  <span className="mt-1 block font-mono text-[11px] text-zinc-500">
                    {formatTime(al.timestamp, lang)} {al.host}
                  </span>
                </button>
              </li>
            ))}
            {alerts.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-zinc-500">{dict.analyst.queueEmpty}</li>
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
            <h2 className="text-sm font-medium text-zinc-100">{dict.analyst.title}</h2>
            <p className="truncate text-[11px] text-zinc-500">{dict.analyst.subtitle}</p>
          </div>
          <span className={`ml-auto flex shrink-0 items-center gap-1.5 text-[11px] ${channelLive ? 'text-emerald-300' : 'text-zinc-500'}`}>
            <span aria-hidden className={`h-2 w-2 rounded-full ${channelLive ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
            {channelLive ? (running ? dict.analyst.statusAnalyzing : dict.analyst.statusConnected) : channelStatus === 'scoped' ? dict.analyst.statusUnavailable : dict.analyst.statusOffline}
          </span>
        </div>
        {channelStatus === 'scoped' ? (
          <div className="p-4">
            <OfflineNotice
              title={dict.analyst.scopedTitle}
              hint={dict.analyst.scopedHint}
            />
          </div>
        ) : !channelLive ? (
          <div className="p-4">
            <OfflineNotice
              title={dict.analyst.offlineTitle}
              hint={dict.analyst.offlineHint}
            />
          </div>
        ) : (
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <EmptyState
                icon={Sparkle}
                title={dict.analyst.waitingTitle}
                hint={dict.analyst.waitingHint}
              />
            ) : (
              <ul className="space-y-5">
                {messages.map((m) =>
                  m.role === 'user' ? (
                    <li key={m.id} className="ml-auto w-fit max-w-[85%] rounded-xl rounded-br-sm border border-primary/20 bg-primary-tint/[0.08] px-3 py-2 text-xs">
                      {m.alertName && (
                        <span>
                          <span className="text-zinc-400">{dict.analyst.analyzePrefix}</span>
                          <span className="font-medium text-zinc-100">{m.alertName}</span>
                        </span>
                      )}
                      {m.incidentTitle && (
                        <span className="flex items-center gap-1.5">
                          <Stack size={12} aria-hidden className="shrink-0 text-primary-link" />
                          <span className="text-zinc-400">{dict.analyst.analyzeIncidentPrefix}</span>
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
                            {...ANALYST_MARKDOWN_GUARD}
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
                            {dict.analyst.errorLine(m.error)}
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
            if (running || !channelLive || !analystTarget(messages, alerts)) return
            askAgain(question)
            setQuestion('')
          }}
        >
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={dict.analyst.questionPlaceholder}
            className="h-9 flex-1 rounded-md border-zinc-800 bg-zinc-900 text-xs"
            aria-label={dict.analyst.questionAria}
            disabled={!channelLive}
          />
          <Button type="submit" size="sm" disabled={running || !analystTarget(messages, alerts) || !channelLive} className="gap-1.5 rounded-md">
            {running ? <CircleNotch size={14} className="animate-spin" aria-hidden /> : <Sparkle size={14} weight="fill" aria-hidden />}
            {running ? dict.analyst.analyzing : dict.analyst.analyze}
          </Button>
          {canRetry && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="gap-1.5 rounded-md text-zinc-400 hover:text-zinc-100"
              aria-label={dict.analyst.retryAria}
              onClick={() => askAgain(lastUser?.question)}
            >
              <ArrowsClockwise size={14} aria-hidden />
              <span className="hidden sm:inline">{dict.analyst.retry}</span>
            </Button>
          )}
        </form>
      </StarBorder>
    </section>
  )
}
