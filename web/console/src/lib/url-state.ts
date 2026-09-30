// Operator state in the URL: the console's view and the alert queue's
// triage filters live in the address bar so that a refresh keeps the
// investigation context, the browser's back/forward navigate between
// views, and a filtered queue can be shared as a plain link.
//
// Everything here is a pure string function over a query string, so it
// runs under bun test without a DOM; the browser adapters (read /
// replace / push) are thin window wrappers that no-op on the server
// (the console pre-renders — window is undefined during SSR).
//
// Contract (single source of truth for the param names):
//   ?view=alertas&sev=critical&q=lsass
//   view: one of the shell's nav ids, else 'panel'
//   sev:  one of the queue filter values, else 'all'
//   q:    free text, trimmed, capped (MAX_QUERY_CHARS), else absent
// Unknown params are always preserved verbatim (read-modify-write):
// this lib owns its three keys and touches nothing else.

import type { ConsoleView } from '../components/console/dashboard'
import type { Severity } from './console-types'

/** Severity filter values of the alerts queue, including 'all'. */
export type SeverityFilter = 'all' | Severity

const CONSOLE_VIEWS = [
  'panel',
  'flujo',
  'alertas',
  'reglas',
  'cadenas',
  'supresiones',
  'respuesta',
  'analista',
] as const

// Compile-time proof that the vocabulary here and the shell's
// ConsoleView union never drift apart (both directions, exhaustive).
type ViewsMatch = ConsoleView extends (typeof CONSOLE_VIEWS)[number]
  ? (typeof CONSOLE_VIEWS)[number] extends ConsoleView
    ? true
    : never
  : never
const viewsAreExhaustive: ViewsMatch = true
void viewsAreExhaustive

const SEVERITY_FILTERS: readonly SeverityFilter[] = ['all', 'critical', 'high', 'medium', 'low']

export const MAX_QUERY_CHARS = 120

export type OperatorState = {
  view: ConsoleView
  sev: SeverityFilter
  q: string
}

function isView(raw: string): raw is ConsoleView {
  return (CONSOLE_VIEWS as readonly string[]).includes(raw)
}

function isSeverityFilter(raw: string): raw is SeverityFilter {
  return (SEVERITY_FILTERS as readonly string[]).includes(raw)
}

/** Whitelist fallback: anything unknown degrades to the default view. */
export function viewFromParam(raw: string | null): ConsoleView {
  return raw !== null && isView(raw) ? raw : 'panel'
}

/** Whitelist fallback: anything unknown degrades to the unfiltered queue. */
export function sevFromParam(raw: string | null): SeverityFilter {
  return raw !== null && isSeverityFilter(raw) ? raw : 'all'
}

/** Trimmed and capped free text: a URL is not a paste bin. */
export function queryFromParam(raw: string | null): string {
  if (raw === null) return ''
  const trimmed = raw.trim()
  return trimmed.length > MAX_QUERY_CHARS ? trimmed.slice(0, MAX_QUERY_CHARS) : trimmed
}

/** Parse the operator keys out of a query string ('' or '?a=b' form). */
export function readOperatorState(search: string): OperatorState {
  const params = new URLSearchParams(search)
  return {
    view: viewFromParam(params.get('view')),
    sev: sevFromParam(params.get('sev')),
    q: queryFromParam(params.get('q')),
  }
}

// Internal: clone the current params, apply the writer's own keys and
// render back to a query string that omits defaults ('?view=panel',
// '?sev=all' and an empty q are noise, never state).
function writeKeys(
  search: string,
  keys: Record<string, string | null>,
): string {
  const params = new URLSearchParams(search)
  for (const [name, value] of Object.entries(keys)) {
    if (value === null || value === '') params.delete(name)
    else params.set(name, value)
  }
  const qs = params.toString()
  return qs === '' ? '' : `?${qs}`
}

/** Query string with the view key applied (unknown params preserved). */
export function writeViewToSearch(search: string, view: ConsoleView): string {
  // 'panel' is the default: absent key keeps deep links canonical.
  return writeKeys(search, { view: view === 'panel' ? null : view })
}

/** Query string with the triage filter keys applied (defaults omitted). */
export function writeFilterToSearch(search: string, sev: SeverityFilter, q: string): string {
  const query = queryFromParam(q)
  return writeKeys(search, {
    sev: sev === 'all' ? null : sev,
    q: query === '' ? null : query,
  })
}

// ---------------------------------------------------------------------------
// Browser adapters (no-ops on the server).

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

function applyUrl(search: string, mode: 'replace' | 'push'): void {
  if (!isBrowser()) return
  const url = `${window.location.pathname}${search}${window.location.hash}`
  if (mode === 'replace') window.history.replaceState(window.history.state, '', url)
  else window.history.pushState(window.history.state, '', url)
}

/** Current location.search ('' outside the browser). */
export function currentSearch(): string {
  return isBrowser() ? window.location.search : ''
}

/**
 * Re-derive the URL from the current location and write it back.
 * Readers get the freshest search on every call, so concurrent writers
 * (shell writes `view`, queue writes `sev`/`q`) never clobber each
 * other's keys — each mutation re-reads before writing.
 */
export function replaceOperatorState(mutate: (search: string) => string): void {
  if (!isBrowser()) return
  applyUrl(mutate(window.location.search), 'replace')
}

/** Like replaceOperatorState, but leaves a history entry (view changes). */
export function pushOperatorState(mutate: (search: string) => string): void {
  if (!isBrowser()) return
  applyUrl(mutate(window.location.search), 'push')
}
