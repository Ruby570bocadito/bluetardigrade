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
//   ?view=respuesta&clase=denied        (audit queue lens)
//   ?view=flujo&tipo=FileCreate&fq=mimikatz
//   ?view=reglas&rq=lateral&regla=R-042 (expanded row, stable rule id)
//   ?view=alertas&historial=1&estado=open&sev=critical&q=lsass
//   historial: 1 uses engine history, else live buffer
//   estado: all/open/new/acknowledged/closed, else all
//   view:  one of the shell's nav ids, else 'panel'
//   sev:   one of the queue filter values, else 'all'
//   clase: one of the audit class values, else 'all'
//   tipo:  event type, sanitized (capped) but NOT whitelisted — the
//          inventory is derived from what the engine delivered, so an
//          unknown type stays an honest equality filter (empty feed)
//   q/fq/rq: free text per lens (alerts / feed / rules), trimmed,
//          capped (MAX_QUERY_CHARS), else absent — separate keys so
//          lenses never contaminate each other across navigation
//   regla: expanded rule id (stable catalog ids, unlike the rotating
//          alert ring), else absent
// Unknown params are always preserved verbatim (read-modify-write):
// this lib owns its keys and touches nothing else.

import type { ConsoleView } from '../components/console/dashboard'
import type { Severity } from './console-types'
import { alertStateFromParam, type AlertScope, type AlertStateFilter } from './alert-search'

/** Severity filter values of the alerts queue, including 'all'. */
export type SeverityFilter = 'all' | Severity

/**
 * Class filter of the active-response audit queue, including 'all'.
 * Lives here (not in the view) so the URL lib is the single source of
 * truth and the view cannot drift from what the URL accepts.
 */
export type AuditKindFilter = 'all' | 'executed' | 'denied' | 'followup'

const AUDIT_KINDS: readonly AuditKindFilter[] = ['all', 'executed', 'denied', 'followup']

function isAuditKind(raw: string): raw is AuditKindFilter {
  return (AUDIT_KINDS as readonly string[]).includes(raw)
}

// Exported for the keyboard-nav coverage test: the help sheet must list
// exactly this vocabulary, no more and no less.
export const CONSOLE_VIEWS = [
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

const SEVERITY_FILTERS: readonly SeverityFilter[] = ['all', 'critical', 'high', 'medium', 'low', 'info']

/**
 * Event types are derived from the delivered buffer (no hardcoded
 * inventory anywhere), so the URL value is sanitized, not whitelisted:
 * a typo stays an equality filter and degrades to the honest empty
 * feed, never to a silently different lens.
 */
export const MAX_FEED_TYPE_CHARS = 60

export const MAX_QUERY_CHARS = 120

export type OperatorState = {
  view: ConsoleView
  sev: SeverityFilter
  q: string
}

/** The lens keys a view reads on mount (one query string, many lenses). */
export type LensState = {
  clase: AuditKindFilter
  tipo: string
  fq: string
  rq: string
  regla: string
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

/** Whitelist fallback: anything unknown degrades to the unfiltered audit. */
export function auditKindFromParam(raw: string | null): AuditKindFilter {
  return raw !== null && isAuditKind(raw) ? raw : 'all'
}

/** Sanitized event type: trimmed, capped, '' collapses to 'all'. */
export function feedTypeFromParam(raw: string | null): string {
  if (raw === null) return 'all'
  const trimmed = raw.trim()
  if (trimmed === '') return 'all'
  return trimmed.length > MAX_FEED_TYPE_CHARS ? trimmed.slice(0, MAX_FEED_TYPE_CHARS) : trimmed
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

export function readAlertLens(search: string): { state: AlertStateFilter; scope: AlertScope } {
  const params = new URLSearchParams(search)
  return { state: alertStateFromParam(params.get('estado')), scope: params.get('historial') === '1' ? 'history' : 'live' }
}

/**
 * Parse the per-view lens keys (audit class, feed type+query, rules
 * query+expanded id). Views read what they own; the shared query string
 * keeps the other lenses intact for when the operator navigates back.
 */
export function readLensState(search: string): LensState {
  const params = new URLSearchParams(search)
  return {
    clase: auditKindFromParam(params.get('clase')),
    tipo: feedTypeFromParam(params.get('tipo')),
    fq: queryFromParam(params.get('fq')),
    rq: queryFromParam(params.get('rq')),
    regla: queryFromParam(params.get('regla')),
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

export function writeAlertLens(search: string, sev: SeverityFilter, q: string, state: AlertStateFilter, scope: AlertScope): string {
  return writeKeys(writeFilterToSearch(search, sev, q), {
    estado: state === 'all' ? null : state,
    historial: scope === 'history' ? '1' : null,
  })
}

/** Query string with the audit class lens applied ('all' omitted). */
export function writeAuditKindToSearch(search: string, clase: AuditKindFilter): string {
  return writeKeys(search, { clase: clase === 'all' ? null : clase })
}

/** Query string with the feed lenses applied (defaults omitted). */
export function writeFeedToSearch(search: string, tipo: string, fq: string): string {
  const type = feedTypeFromParam(tipo)
  const query = queryFromParam(fq)
  return writeKeys(search, {
    tipo: type === 'all' ? null : type,
    fq: query === '' ? null : query,
  })
}

/** Query string with the rules lenses applied (defaults omitted). */
export function writeRulesToSearch(search: string, rq: string, regla: string | null): string {
  const query = queryFromParam(rq)
  const id = regla === null ? null : queryFromParam(regla)
  return writeKeys(search, {
    rq: query === '' ? null : query,
    regla: id === '' || id === null ? null : id,
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
