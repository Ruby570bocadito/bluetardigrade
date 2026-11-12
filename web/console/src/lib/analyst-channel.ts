// Decisions of the analyst channel that need no React and no socket:
// how the socket reconnects, which frames belong to the analysis the
// panel is waiting for, how a frame changes the transcript, and which
// alert a follow-up question or a retry is about. The panel
// (components/console/analyst-panel.tsx) and the provider
// (socket-provider.tsx) only wire these to state.

import type { ManagerOptions, SocketOptions } from 'socket.io-client'
import type { AnalystMessage, AnalystStep, SfAlert } from './console-types'

// The hub is optional and often starts after the console (or restarts on
// its own): the client keeps trying for as long as the tab is open, with
// a capped delay, instead of giving up after a fixed number of attempts
// and leaving the analyst offline until a reload.
export function analystSocketOptions(token: string): Partial<ManagerOptions & SocketOptions> {
  return {
    // keep in sync with the socket.io server path (console-service)
    path: '/',
    transports: ['websocket', 'polling'],
    forceNew: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1500,
    reconnectionDelayMax: 15_000,
    timeout: 8000,
    auth: token ? { token } : {},
  }
}

// The key the panel highlights and remembers an alert by. The engine id
// when there is one; alerts of older engines fall back to event + rule.
export function alertKey(alert: Pick<SfAlert, 'id' | 'event_id' | 'rule_id'>): string {
  return alert.id || `${alert.event_id}:${alert.rule_id}`
}

// A frame belongs to the analysis in flight when it carries its id. A
// hub that predates request ids sends untagged frames: they can only be
// the answer to the one request the panel allows at a time. Frames of
// any other request (an analysis that was cut off, another tab's on a
// shared socket) are dropped.
export function acceptsFrame(active: string | null, frame: { requestId?: unknown } | null | undefined): boolean {
  if (!active) return false
  const id = frame?.requestId
  return id === undefined || id === active
}

function patchAnswer(messages: AnalystMessage[], requestId: string, patch: (answer: AnalystMessage) => AnalystMessage): AnalystMessage[] {
  const at = messages.findIndex((m) => m.role === 'analyst' && m.requestId === requestId)
  if (at < 0) return messages
  const next = [...messages]
  next[at] = patch(messages[at])
  return next
}

export function withStep(messages: AnalystMessage[], requestId: string, step: AnalystStep): AnalystMessage[] {
  return patchAnswer(messages, requestId, (answer) => {
    const steps = [...(answer.steps ?? [])]
    const idx = steps.findIndex((s) => s.label === step.label)
    if (idx >= 0) steps[idx] = { label: step.label, state: step.state }
    else steps.push({ label: step.label, state: step.state })
    return { ...answer, steps }
  })
}

export function withDelta(messages: AnalystMessage[], requestId: string, text: string): AnalystMessage[] {
  return patchAnswer(messages, requestId, (answer) => ({ ...answer, text: (answer.text ?? '') + text }))
}

// The streamed text wins: `done` repeats the whole answer and only fills
// in when no delta arrived.
export function withDone(messages: AnalystMessage[], requestId: string, text: string): AnalystMessage[] {
  return patchAnswer(messages, requestId, (answer) => ({ ...answer, text: answer.text || text }))
}

export function withError(messages: AnalystMessage[], requestId: string, error: string): AnalystMessage[] {
  return patchAnswer(messages, requestId, (answer) => ({ ...answer, error }))
}

export type AnalystTarget =
  | { kind: 'incident'; message: AnalystMessage }
  | { kind: 'alert'; alert: SfAlert }
  | null

// What a follow-up question or «Repetir» is about: the subject of the
// last request in the transcript, exactly as it was analysed. The alert
// travels on the user message, so neither depends on the alert still
// being in the live queue nor on which one happens to be newest. Only an
// empty transcript falls back to the newest alert.
export function analystTarget(messages: readonly AnalystMessage[], alerts: readonly SfAlert[]): AnalystTarget {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    if (m.incidentPayload) return { kind: 'incident', message: m }
    if (m.alert) return { kind: 'alert', alert: m.alert }
    break
  }
  return alerts[0] ? { kind: 'alert', alert: alerts[0] } : null
}

// The answer is model output over attacker-influenced telemetry: a
// command line that steers the model could make it print a link or an
// image pointing anywhere. Neither is rendered; their text stays.
export const ANALYST_MARKDOWN_GUARD = {
  disallowedElements: ['a', 'img'],
  unwrapDisallowed: true,
} as const
