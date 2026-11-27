// v2 · Investigar: the pure part of the section. One query of tokens
// scopes the telemetry for every lens (stream, process tree, host
// timeline, rarity, network); these functions parse and match that
// query, describe an event and build each lens from real events only.
// Nothing here invents a value: a parent that was never seen stays a
// bare PID, a flow with too few connections has no cadence.

import type { SfAlert, SfEvent } from '@/lib/console-types'

// ---------- kinds of event ----------

export type EventKind = 'process' | 'network' | 'dns' | 'file' | 'registry' | 'image' | 'other'
export const EVENT_KINDS: readonly EventKind[] = ['process', 'network', 'dns', 'file', 'registry', 'image', 'other']

/** The family of an engine event type ("process.create" -> process). */
export function kindOf(ev: Pick<SfEvent, 'type'>): EventKind {
  const t = ev.type.toLowerCase()
  if (t.startsWith('process')) return 'process'
  if (t.startsWith('network')) return 'network'
  if (t.startsWith('dns')) return 'dns'
  if (t.startsWith('file')) return 'file'
  if (t.startsWith('registry')) return 'registry'
  if (t.startsWith('image') || t.startsWith('module')) return 'image'
  return 'other'
}

function timeOf(ev: Pick<SfEvent, 'timestamp'>): number {
  const t = Date.parse(ev.timestamp)
  return Number.isFinite(t) ? t : 0
}

// ---------- the query ----------

export const QUERY_FIELDS = ['host', 'type', 'user', 'process', 'pid', 'parent', 'cmd', 'ip', 'dst', 'port', 'domain', 'file', 'key', 'hash'] as const
export type QueryField = (typeof QUERY_FIELDS)[number]
export type QueryToken = { field: QueryField | null; value: string; negate: boolean }

/** The key each field is written with, per console language. */
export const FIELD_KEYS: Record<'es' | 'en', Record<QueryField, string>> = {
  es: { host: 'host', type: 'tipo', user: 'usuario', process: 'proceso', pid: 'pid', parent: 'padre', cmd: 'linea', ip: 'ip', dst: 'destino', port: 'puerto', domain: 'dominio', file: 'fichero', key: 'clave', hash: 'hash' },
  en: { host: 'host', type: 'type', user: 'user', process: 'process', pid: 'pid', parent: 'parent', cmd: 'cmd', ip: 'ip', dst: 'dst', port: 'port', domain: 'domain', file: 'file', key: 'key', hash: 'hash' },
}

// both languages are always understood, whatever the console shows
const ALIASES: Record<string, QueryField> = (() => {
  const out: Record<string, QueryField> = { equipo: 'host', línea: 'cmd', puerto: 'port' }
  for (const lang of ['es', 'en'] as const) for (const f of QUERY_FIELDS) out[FIELD_KEYS[lang][f]] = f
  return out
})()

export const MAX_QUERY = 512

/**
 * Tokens of a query: `campo:valor`, a bare word or a "quoted phrase",
 * each optionally negated with a leading `-`. A prefix that is not a
 * known field (C:\Windows, http://…) is plain text. To search for text
 * that starts with a dash, quote it: "-enc".
 */
export function parseQuery(raw: string): QueryToken[] {
  const s = raw.slice(0, MAX_QUERY)
  const tokens: QueryToken[] = []
  let i = 0
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++
    if (i >= s.length) break
    let negate = false
    if (s[i] === '-' && i + 1 < s.length && !/\s/.test(s[i + 1])) {
      negate = true
      i++
    }
    let field: QueryField | null = null
    const m = /^([A-Za-zÁÉÍÓÚáéíóúÑñ]+):(?=\S)/.exec(s.slice(i))
    if (m && ALIASES[m[1].toLowerCase()]) {
      field = ALIASES[m[1].toLowerCase()]
      i += m[0].length
    }
    let value: string
    if (s[i] === '"') {
      const end = s.indexOf('"', i + 1)
      value = end === -1 ? s.slice(i + 1) : s.slice(i + 1, end)
      i = end === -1 ? s.length : end + 1
    } else {
      let j = i
      while (j < s.length && !/\s/.test(s[j])) j++
      value = s.slice(i, j)
      i = j
    }
    value = value.trim()
    if (value) tokens.push({ field, value, negate })
  }
  return tokens
}

/** One token as it is written in the query. */
export function formatToken(t: QueryToken, lang: 'es' | 'en' = 'es'): string {
  const value = t.value.replaceAll('"', '')
  const quote = /\s/.test(value) || (!t.field && value.startsWith('-')) || (!t.field && /^[A-Za-zÁÉÍÓÚáéíóúÑñ]+:/.test(value) && !!ALIASES[value.split(':')[0].toLowerCase()])
  return `${t.negate ? '-' : ''}${t.field ? FIELD_KEYS[lang][t.field] + ':' : ''}${quote ? `"${value}"` : value}`
}

export function formatQuery(tokens: readonly QueryToken[], lang: 'es' | 'en' = 'es'): string {
  return tokens.map((t) => formatToken(t, lang)).join(' ')
}

export function sameToken(a: QueryToken, b: QueryToken): boolean {
  return a.field === b.field && a.negate === b.negate && a.value.toLowerCase() === b.value.toLowerCase()
}

/** Adds a token unless the query already has it (a pivot never doubles up). */
export function addToken(tokens: readonly QueryToken[], t: QueryToken): QueryToken[] {
  return tokens.some((x) => sameToken(x, t)) ? [...tokens] : [...tokens, t]
}

// ---------- matching ----------

/** host|pid -> process name, for `padre:` and the parent of each row. */
export function parentIndex(events: readonly SfEvent[]): Map<string, string> {
  const out = new Map<string, string>()
  // oldest first so the newest name of a reused PID wins
  for (const ev of [...events].sort((a, b) => timeOf(a) - timeOf(b))) {
    if (ev.process?.pid !== undefined && ev.process.name) out.set(`${ev.host.toLowerCase()}|${ev.process.pid}`, ev.process.name)
  }
  return out
}

export function parentName(ev: SfEvent, parents: ReadonlyMap<string, string>): string | undefined {
  const ppid = ev.process?.ppid
  return ppid === undefined ? undefined : parents.get(`${ev.host.toLowerCase()}|${ppid}`)
}

function hashesOf(ev: SfEvent): string[] {
  return [...Object.values(ev.process?.hashes ?? {}), ...Object.values(ev.file?.hashes ?? {})].filter(Boolean)
}

function domainOf(ev: SfEvent): string | undefined {
  return ev.network?.domain || ev.attributes?.query || ev.attributes?.domain || undefined
}

/** What the event is about, in one line (the stream's main column). */
export function eventTarget(ev: SfEvent): string {
  const n = ev.network
  if (n?.destination_ip || n?.domain) {
    const where = n.destination_ip ? `${n.destination_ip}${n.destination_port ? ':' + n.destination_port : ''}` : ''
    return [n.domain, where].filter(Boolean).join(' · ')
  }
  if (domainOf(ev)) return domainOf(ev) as string
  if (ev.file?.path) return ev.file.path
  if (ev.registry?.key) return ev.registry.value_name ? `${ev.registry.key}\\${ev.registry.value_name}` : ev.registry.key
  if (ev.target) return ev.target.image || ev.target.name || `pid ${ev.target.pid}`
  if (ev.process) return ev.process.command_line || ev.process.image || ev.process.name
  return ''
}

/** The text a bare word is looked for in (the engine's own haystack). */
function haystack(ev: SfEvent): string[] {
  return [
    ev.id, ev.type, ev.source, ev.host, ev.user ?? '',
    ev.process?.name ?? '', ev.process?.command_line ?? '', ev.process?.image ?? '',
    ev.file?.path ?? '',
    ev.network?.destination_ip ?? '', ev.network?.source_ip ?? '', ev.network?.domain ?? '',
    ev.registry?.key ?? '', ev.registry?.value_name ?? '', ev.target?.name ?? '',
    ...Object.values(ev.attributes ?? {}),
  ]
}

const KIND_WORDS: Record<string, EventKind> = {
  proceso: 'process', process: 'process', red: 'network', network: 'network', dns: 'dns',
  fichero: 'file', file: 'file', registro: 'registry', registry: 'registry',
  modulo: 'image', módulo: 'image', image: 'image', module: 'image', otro: 'other', other: 'other',
}

/** The kind a `tipo:` value names (proceso, red, …), if it names one. */
export function kindWord(value: string): EventKind | null {
  return KIND_WORDS[value.toLowerCase()] ?? null
}

function contains(values: readonly (string | undefined)[], needle: string): boolean {
  const n = needle.toLowerCase()
  return values.some((v) => !!v && v.toLowerCase().includes(n))
}

function sameNumber(value: number | undefined, needle: string): boolean {
  return value !== undefined && /^\d+$/.test(needle) && value === Number(needle)
}

function positiveMatch(ev: SfEvent, t: QueryToken, parents: ReadonlyMap<string, string>): boolean {
  const v = t.value
  switch (t.field) {
    case 'host':
      return ev.host.toLowerCase() === v.toLowerCase()
    case 'type': {
      const kind = KIND_WORDS[v.toLowerCase()]
      if (kind) return kindOf(ev) === kind
      return v.includes('.') ? ev.type.toLowerCase() === v.toLowerCase() : contains([ev.type], v)
    }
    case 'user':
      return contains([ev.user], v)
    case 'process':
      return contains([ev.process?.name, ev.process?.image], v)
    case 'pid':
      return sameNumber(ev.process?.pid, v)
    case 'parent':
      return /^\d+$/.test(v) ? sameNumber(ev.process?.ppid, v) : contains([parentName(ev, parents)], v)
    case 'cmd':
      return contains([ev.process?.command_line], v)
    case 'ip':
      return contains([ev.network?.source_ip, ev.network?.destination_ip], v)
    case 'dst': {
      const n = ev.network
      return contains([n?.destination_ip, n?.destination_ip && n.destination_port ? `${n.destination_ip}:${n.destination_port}` : undefined, domainOf(ev)], v)
    }
    case 'port':
      return sameNumber(ev.network?.destination_port, v)
    case 'domain':
      return contains([domainOf(ev)], v)
    case 'file':
      return contains([ev.file?.path], v)
    case 'key':
      return contains([ev.registry?.key, ev.registry?.value_name], v)
    case 'hash':
      return contains(hashesOf(ev), v)
    default:
      return contains(haystack(ev), v)
  }
}

export function matchEvent(ev: SfEvent, tokens: readonly QueryToken[], parents: ReadonlyMap<string, string>): boolean {
  return tokens.every((t) => positiveMatch(ev, t, parents) !== t.negate)
}

export function filterEvents(events: readonly SfEvent[], tokens: readonly QueryToken[]): SfEvent[] {
  if (tokens.length === 0) return [...events]
  const parents = parentIndex(events)
  return events.filter((ev) => matchEvent(ev, tokens, parents))
}

// ---------- the engine's history ----------

export type HistoryRange = '1h' | '24h' | '7d' | 'all'
export const HISTORY_RANGES: readonly HistoryRange[] = ['1h', '24h', '7d', 'all']
export const HISTORY_LIMIT = 1000
const RANGE_MS: Record<Exclude<HistoryRange, 'all'>, number> = { '1h': 3_600_000, '24h': 86_400_000, '7d': 7 * 86_400_000 }

export function historyRangeFromParam(v: string | null): HistoryRange {
  return (HISTORY_RANGES as readonly string[]).includes(v ?? '') ? (v as HistoryRange) : '24h'
}

// fields the engine's text search covers: only those may travel as `q`
const PUSHABLE: ReadonlySet<QueryField | null> = new Set<QueryField | null>([null, 'user', 'process', 'cmd', 'file', 'key'])

/**
 * The engine request for a query: host and exact type go as filters, the
 * longest positive text as `q`, and the range as `since`. The engine only
 * narrows; every token is applied again on what comes back, so the
 * history answers exactly the same question as the live stream.
 */
export function historyPath(tokens: readonly QueryToken[], range: HistoryRange, now: number, limit = HISTORY_LIMIT): string {
  const p = new URLSearchParams()
  const pos = tokens.filter((t) => !t.negate)
  const host = pos.find((t) => t.field === 'host')
  if (host) p.set('host', host.value)
  const type = pos.find((t) => t.field === 'type' && t.value.includes('.') && !KIND_WORDS[t.value.toLowerCase()])
  if (type) p.set('type', type.value)
  const text = pos.filter((t) => PUSHABLE.has(t.field)).sort((a, b) => b.value.length - a.value.length)[0]
  if (text) p.set('q', text.value)
  if (range !== 'all') p.set('since', new Date(now - RANGE_MS[range]).toISOString())
  p.set('limit', String(limit))
  return `/api/events?${p.toString()}`
}

// ---------- autocomplete ----------

/** The values a field takes in one event (for suggestions and pivots). */
export function valuesOf(ev: SfEvent, field: QueryField, parents: ReadonlyMap<string, string>): string[] {
  const n = ev.network
  const out: (string | undefined)[] = (() => {
    switch (field) {
      case 'host': return [ev.host]
      case 'type': return [ev.type]
      case 'user': return [ev.user]
      case 'process': return [ev.process?.name]
      case 'pid': return [ev.process?.pid !== undefined ? String(ev.process.pid) : undefined]
      case 'parent': return [parentName(ev, parents)]
      case 'cmd': return [ev.process?.command_line]
      case 'ip': return [n?.source_ip, n?.destination_ip]
      case 'dst': return [n?.destination_ip && n.destination_port ? `${n.destination_ip}:${n.destination_port}` : n?.destination_ip]
      case 'port': return [n?.destination_port !== undefined ? String(n.destination_port) : undefined]
      case 'domain': return [domainOf(ev)]
      case 'file': return [ev.file?.path]
      case 'key': return [ev.registry?.key]
      case 'hash': return hashesOf(ev)
    }
  })()
  return out.filter((v): v is string => !!v)
}

export type Suggestion = { field: QueryField; value: string; count: number }

const SUGGEST_FIELDS: readonly QueryField[] = ['host', 'process', 'user', 'type', 'dst', 'domain', 'parent']

/**
 * What to offer while a token is being typed: with `campo:` the values of
 * that field seen in the events (most frequent first), without it the
 * fields whose key starts that way and the common values that contain it.
 */
export function suggest(events: readonly SfEvent[], partial: string, lang: 'es' | 'en', max = 8): { fields: QueryField[]; values: Suggestion[] } {
  const text = partial.replace(/^-/, '')
  const m = /^([A-Za-zÁÉÍÓÚáéíóúÑñ]+):(.*)$/.exec(text)
  const field = m ? ALIASES[m[1].toLowerCase()] : undefined
  const needle = (field ? m![2] : text).replace(/^"/, '').toLowerCase()
  const parents = parentIndex(events)
  const counts = new Map<string, Suggestion>()
  for (const ev of events) {
    for (const f of field ? [field] : SUGGEST_FIELDS) {
      for (const value of valuesOf(ev, f, parents)) {
        if (needle && !value.toLowerCase().includes(needle)) continue
        const key = `${f}|${value.toLowerCase()}`
        const s = counts.get(key)
        if (s) s.count++
        else counts.set(key, { field: f, value, count: 1 })
      }
    }
  }
  const values = [...counts.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).slice(0, max)
  const fields = field || !text ? (field ? [] : [...QUERY_FIELDS]) : QUERY_FIELDS.filter((f) => FIELD_KEYS[lang][f].startsWith(text.toLowerCase()))
  return { fields: fields.slice(0, max), values }
}

// ---------- the event, field by field ----------

export type DetailKey =
  | 'time' | 'host' | 'type' | 'user' | 'process' | 'pid' | 'parent' | 'ppid' | 'cmd' | 'image'
  | 'hash' | 'src' | 'dst' | 'domain' | 'file' | 'key' | 'value' | 'target' | 'source' | 'id'

export type DetailRow = { key: DetailKey; value: string; pivot?: QueryToken; mono?: boolean }

/** The rows of the detail panel; a value that can scope a search pivots. */
export function detailRows(ev: SfEvent, parents: ReadonlyMap<string, string>): DetailRow[] {
  const rows: DetailRow[] = []
  const add = (key: DetailKey, value: string | number | undefined, pivot?: [QueryField, string], mono = true) => {
    if (value === undefined || value === '') return
    rows.push({ key, value: String(value), mono, pivot: pivot ? { field: pivot[0], value: pivot[1], negate: false } : undefined })
  }
  add('time', ev.timestamp)
  add('host', ev.host, ['host', ev.host])
  add('type', ev.type, ['type', ev.type])
  add('user', ev.user, ev.user ? ['user', ev.user] : undefined)
  const p = ev.process
  if (p) {
    add('process', p.name, ['process', p.name])
    add('pid', p.pid, ['pid', String(p.pid)])
    const parent = parentName(ev, parents)
    if (parent) add('parent', `${parent} (${p.ppid})`, ['process', parent])
    else add('ppid', p.ppid, p.ppid !== undefined ? ['pid', String(p.ppid)] : undefined)
    add('cmd', p.command_line, p.command_line ? ['cmd', p.command_line.slice(0, 120)] : undefined)
    add('image', p.image)
  }
  for (const h of hashesOf(ev)) add('hash', h, ['hash', h])
  const n = ev.network
  if (n) {
    add('src', n.source_ip ? `${n.source_ip}${n.source_port ? ':' + n.source_port : ''}` : undefined, n.source_ip ? ['ip', n.source_ip] : undefined)
    add('dst', n.destination_ip ? `${n.destination_ip}${n.destination_port ? ':' + n.destination_port : ''}` : undefined, n.destination_ip ? ['ip', n.destination_ip] : undefined)
  }
  const domain = domainOf(ev)
  add('domain', domain, domain ? ['domain', domain] : undefined)
  add('file', ev.file?.path, ev.file?.path ? ['file', ev.file.path] : undefined)
  add('key', ev.registry?.key, ev.registry?.key ? ['key', ev.registry.key] : undefined)
  add('value', ev.registry?.value_name ? `${ev.registry.value_name}${ev.registry.value ? ' = ' + ev.registry.value : ''}` : undefined)
  add('target', ev.target ? ev.target.image || ev.target.name || `pid ${ev.target.pid}` : undefined)
  add('source', ev.source, undefined, false)
  add('id', ev.id)
  return rows
}

// ---------- histogram ----------

export function timeSpan(events: readonly SfEvent[]): { from: number; to: number } | null {
  let from = Infinity
  let to = -Infinity
  for (const ev of events) {
    const t = timeOf(ev)
    if (!t) continue
    if (t < from) from = t
    if (t > to) to = t
  }
  return Number.isFinite(from) ? { from, to: Math.max(to, from + 1) } : null
}

/** Events per bucket between `from` and `to` (both edges included). */
export function histogram(events: readonly SfEvent[], from: number, to: number, buckets: number): number[] {
  const out = new Array<number>(Math.max(1, buckets)).fill(0)
  const span = Math.max(1, to - from)
  for (const ev of events) {
    const t = timeOf(ev)
    if (t < from || t > to) continue
    out[Math.min(out.length - 1, Math.floor(((t - from) / span) * out.length))]++
  }
  return out
}

// ---------- process tree ----------

export type ProcNode = {
  key: string
  host: string
  pid: number
  ppid?: number
  name: string
  cmd?: string
  user?: string
  start?: string
  /** a process.create event was seen; false: known only by its PID or later activity */
  seen: boolean
  eventId?: string
  children: ProcNode[]
  alerts: SfAlert[]
  /** it or one of its descendants raised an alert: the path is drawn in amber */
  hot: boolean
  activity: { network: number; file: number; registry: number; other: number }
}

/**
 * The process forest of one host from its events: every process.create
 * is a node hung from the latest earlier create of its parent PID; a
 * parent that was never seen is a bare PID. Alerts hang from the process
 * of the event they fired on.
 */
export function processForest(events: readonly SfEvent[], alerts: readonly SfAlert[], host: string): ProcNode[] {
  const own = events.filter((e) => e.host.toLowerCase() === host.toLowerCase() && e.process).sort((a, b) => timeOf(a) - timeOf(b))
  const nodes: ProcNode[] = []
  const byPid = new Map<number, ProcNode[]>() // creates of each PID, oldest first
  const make = (pid: number, seen: boolean, ev?: SfEvent): ProcNode => {
    const node: ProcNode = {
      key: `${pid}@${ev?.timestamp ?? 'unseen'}`, host, pid, ppid: ev?.process?.ppid, name: ev?.process?.name ?? `pid ${pid}`,
      cmd: ev?.process?.command_line, user: ev?.user, start: seen ? ev?.timestamp : undefined, seen, eventId: seen ? ev?.id : undefined,
      children: [], alerts: [], hot: false, activity: { network: 0, file: 0, registry: 0, other: 0 },
    }
    nodes.push(node)
    const list = byPid.get(pid) ?? []
    list.push(node)
    byPid.set(pid, list)
    return node
  }
  // the node a PID meant at a given time: its latest create up to then
  const at = (pid: number, t: number): ProcNode | undefined => {
    const list = byPid.get(pid)
    if (!list) return undefined
    let pick: ProcNode | undefined
    for (const n of list) if (!n.start || Date.parse(n.start) <= t) pick = n
    return pick ?? list[0]
  }
  for (const ev of own) if (ev.type === 'process.create' && ev.process) make(ev.process.pid, true, ev)
  // processes only known from their activity
  for (const ev of own) if (ev.process && !byPid.has(ev.process.pid)) make(ev.process.pid, false, ev)
  const eventsById = new Map(own.map((e) => [e.id, e]))
  for (const ev of own) {
    if (ev.type === 'process.create' || !ev.process) continue
    const node = at(ev.process.pid, timeOf(ev))
    if (!node) continue
    const k = kindOf(ev)
    if (k === 'network' || k === 'dns') node.activity.network++
    else if (k === 'file') node.activity.file++
    else if (k === 'registry') node.activity.registry++
    else node.activity.other++
  }
  // parents: the latest create of the parent PID before the child started
  const roots: ProcNode[] = []
  const unseenParents = new Map<number, ProcNode>()
  for (const node of nodes) {
    if (node.ppid === undefined) {
      roots.push(node)
      continue
    }
    const t = node.start ? Date.parse(node.start) : Infinity
    let parent = (byPid.get(node.ppid) ?? []).filter((p) => p !== node && (!p.start || Date.parse(p.start) <= t)).pop()
    if (!parent) {
      parent = unseenParents.get(node.ppid)
      if (!parent) {
        parent = {
          key: `${node.ppid}@parent`, host, pid: node.ppid, name: `pid ${node.ppid}`, seen: false,
          children: [], alerts: [], hot: false, activity: { network: 0, file: 0, registry: 0, other: 0 },
        }
        unseenParents.set(node.ppid, parent)
        roots.push(parent)
      }
    }
    parent.children.push(node)
  }
  for (const a of alerts) {
    if (a.host.toLowerCase() !== host.toLowerCase()) continue
    const ev = eventsById.get(a.event_id)
    if (!ev?.process) continue
    at(ev.process.pid, timeOf(ev))?.alerts.push(a)
  }
  const mark = (n: ProcNode): boolean => {
    let hot = n.alerts.length > 0
    for (const c of n.children) hot = mark(c) || hot
    n.hot = hot
    return hot
  }
  const byStart = (a: ProcNode, b: ProcNode) => (a.start ?? '').localeCompare(b.start ?? '') || a.pid - b.pid
  const sortDeep = (list: ProcNode[]) => {
    list.sort(byStart)
    for (const n of list) sortDeep(n.children)
  }
  roots.forEach(mark)
  sortDeep(roots)
  return roots.filter((r) => r.children.length > 0 || r.seen || r.alerts.length > 0)
}

/** Every node of a forest, depth first, with its depth. */
export function flattenForest(roots: readonly ProcNode[], open: (n: ProcNode) => boolean): { node: ProcNode; depth: number }[] {
  const out: { node: ProcNode; depth: number }[] = []
  const walk = (n: ProcNode, depth: number) => {
    out.push({ node: n, depth })
    if (open(n)) for (const c of n.children) walk(c, depth + 1)
  }
  for (const r of roots) walk(r, 0)
  return out
}

export function countNodes(roots: readonly ProcNode[]): number {
  let n = 0
  const walk = (x: ProcNode) => {
    n++
    x.children.forEach(walk)
  }
  roots.forEach(walk)
  return n
}

// ---------- hosts ----------

export function hostCounts(events: readonly SfEvent[]): { host: string; count: number }[] {
  const m = new Map<string, number>()
  for (const ev of events) m.set(ev.host, (m.get(ev.host) ?? 0) + 1)
  return [...m.entries()].map(([host, count]) => ({ host, count })).sort((a, b) => b.count - a.count || a.host.localeCompare(b.host))
}

// ---------- rarity (stack counting) ----------

export type RarityField = 'process' | 'cmd' | 'pair' | 'dst' | 'user'
export const RARITY_FIELDS: readonly RarityField[] = ['process', 'cmd', 'pair', 'dst', 'user']

export type RarityRow = { value: string; hosts: string[]; count: number; first: string; last: string; sampleId: string; token: QueryToken }

function rarityValue(ev: SfEvent, field: RarityField, parents: ReadonlyMap<string, string>): [string, QueryToken] | null {
  switch (field) {
    case 'process':
      return ev.process?.name ? [ev.process.name, { field: 'process', value: ev.process.name, negate: false }] : null
    case 'cmd': {
      const c = ev.process?.command_line?.replace(/\s+/g, ' ').trim()
      return c ? [c, { field: 'cmd', value: c.slice(0, 120), negate: false }] : null
    }
    case 'pair': {
      if (ev.type !== 'process.create' || !ev.process?.name) return null
      const parent = parentName(ev, parents)
      if (!parent) return null
      return [`${parent} › ${ev.process.name}`, { field: 'process', value: ev.process.name, negate: false }]
    }
    case 'dst': {
      const n = ev.network
      const where = domainOf(ev) || (n?.destination_ip ? `${n.destination_ip}${n.destination_port ? ':' + n.destination_port : ''}` : '')
      if (!where) return null
      return [where, domainOf(ev) ? { field: 'domain', value: domainOf(ev) as string, negate: false } : { field: 'ip', value: n!.destination_ip as string, negate: false }]
    }
    case 'user':
      return ev.user ? [ev.user, { field: 'user', value: ev.user, negate: false }] : null
  }
}

/** Values of a field across hosts, the rarest first (seen on the fewest hosts, then the fewest times). */
export function rarity(events: readonly SfEvent[], field: RarityField): { rows: RarityRow[]; totalHosts: number } {
  const parents = parentIndex(events)
  const rows = new Map<string, RarityRow & { hostSet: Set<string> }>()
  const totalHosts = new Set(events.map((e) => e.host.toLowerCase())).size
  for (const ev of events) {
    const got = rarityValue(ev, field, parents)
    if (!got) continue
    const [value, token] = got
    const key = value.toLowerCase()
    const row = rows.get(key)
    if (!row) {
      rows.set(key, { value, hosts: [], hostSet: new Set([ev.host]), count: 1, first: ev.timestamp, last: ev.timestamp, sampleId: ev.id, token })
      continue
    }
    row.hostSet.add(ev.host)
    row.count++
    if (ev.timestamp < row.first) row.first = ev.timestamp
    if (ev.timestamp > row.last) {
      row.last = ev.timestamp
      row.sampleId = ev.id
    }
  }
  const out = [...rows.values()].map(({ hostSet, ...r }) => ({ ...r, hosts: [...hostSet].sort() }))
  out.sort((a, b) => a.hosts.length - b.hosts.length || a.count - b.count || b.first.localeCompare(a.first) || a.value.localeCompare(b.value))
  return { rows: out, totalHosts }
}

// ---------- network flows and beacons ----------

/** The engine's own cadence rule for a beacon (beacons.yaml: CV <= 0.12). */
export const BEACON_MAX_CV = 0.12
export const BEACON_MIN_CONNECTIONS = 5

export type Flow = {
  key: string
  host: string
  process: string
  dst: string
  times: number[]
  count: number
  first: number
  last: number
  /** mean gap between connections, ms (from 2 connections on) */
  meanMs?: number
  /** coefficient of variation of the gaps (from 3 connections on) */
  cv?: number
  /** the connections of the latest session (after the last long pause): cadence is measured here */
  session: number[]
  regular: boolean
  /** a beacon alert of the engine on the same host and destination */
  alert?: SfAlert
  token: QueryToken
}

/**
 * The connections after the last long pause: a pause is a gap twenty times
 * the usual one and at least five minutes, so two separate runs of the
 * same implant are not averaged into one meaningless cadence.
 */
export function latestSession(times: readonly number[]): number[] {
  if (times.length < 3) return [...times]
  const gaps = times.slice(1).map((t, i) => t - times[i])
  const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
  const pause = Math.max(20 * median, 300_000)
  let start = 0
  gaps.forEach((g, i) => {
    if (g > pause) start = i + 1
  })
  return times.slice(start)
}

/** Outbound connections grouped by host, process and destination, the regular ones first. */
export function networkFlows(events: readonly SfEvent[], alerts: readonly SfAlert[]): Flow[] {
  const groups = new Map<string, Flow>()
  const byId = new Map(events.map((e) => [e.id, e]))
  for (const ev of events) {
    const n = ev.network
    if (!n || !(n.destination_ip || n.domain) || kindOf(ev) !== 'network') continue
    const dst = n.destination_ip ? `${n.destination_ip}${n.destination_port ? ':' + n.destination_port : ''}` : (n.domain as string)
    const proc = ev.process?.name ?? ''
    const key = `${ev.host.toLowerCase()}|${proc.toLowerCase()}|${dst.toLowerCase()}`
    const t = timeOf(ev)
    const flow = groups.get(key)
    if (flow) flow.times.push(t)
    else
      groups.set(key, {
        key, host: ev.host, process: proc, dst, times: [t], count: 0, first: t, last: t, session: [], regular: false,
        token: n.destination_ip ? { field: 'ip', value: n.destination_ip, negate: false } : { field: 'domain', value: n.domain as string, negate: false },
      })
  }
  const out = [...groups.values()].map((f) => {
    const times = [...f.times].sort((a, b) => a - b)
    const session = latestSession(times)
    const gaps = session.slice(1).map((t, i) => t - session[i])
    const mean = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : undefined
    let cv: number | undefined
    if (gaps.length >= 2 && mean && mean > 0) {
      const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length
      cv = Math.sqrt(variance) / mean
    }
    const ip = f.dst.split(':')[0]
    // the beacon alert names its destination itself or through the event it fired on
    const alert = alerts.find((a) => {
      if (!a.rule_id.startsWith('bcn-') || a.host.toLowerCase() !== f.host.toLowerCase()) return false
      const dst = a.network?.destination_ip ?? byId.get(a.event_id)?.network?.destination_ip
      return dst === ip
    })
    return {
      ...f, times, session, count: times.length, first: times[0], last: times[times.length - 1], meanMs: mean, cv,
      regular: session.length >= BEACON_MIN_CONNECTIONS && cv !== undefined && cv <= BEACON_MAX_CV, alert,
    }
  })
  return out.sort((a, b) => Number(!!b.alert) - Number(!!a.alert) || Number(b.regular) - Number(a.regular) || b.count - a.count || a.dst.localeCompare(b.dst))
}

// ---------- saved queries ----------

export const SAVED_QUERIES_KEY = 'bluetardigrade.v2.saved-queries.v1'
export const MAX_SAVED_QUERIES = 20
export type SavedQuery = { id: string; name: string; q: string }

type Reader = Pick<Storage, 'getItem'>
type Writer = Pick<Storage, 'setItem'>

function readJson(storage: Reader, key: string): unknown {
  try {
    const raw = storage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeJson(storage: Writer, key: string, value: unknown): boolean {
  try {
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null)

export function readSavedQueries(storage: Reader): SavedQuery[] {
  const raw = readJson(storage, SAVED_QUERIES_KEY)
  if (!Array.isArray(raw)) return []
  const out: SavedQuery[] = []
  for (const item of raw.slice(0, MAX_SAVED_QUERIES)) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const id = str(r.id, 64)
    const name = str(r.name, 80)
    const q = str(r.q, MAX_QUERY)
    if (id && name && q !== null) out.push({ id, name, q })
  }
  return out
}

export function writeSavedQueries(storage: Writer, items: readonly SavedQuery[]): boolean {
  return writeJson(storage, SAVED_QUERIES_KEY, items.slice(0, MAX_SAVED_QUERIES))
}

/** Saves a query under a name; the same name replaces, the newest goes first. */
export function upsertSavedQuery(items: readonly SavedQuery[], name: string, q: string, id: string): SavedQuery[] {
  const clean = name.trim().slice(0, 80)
  const rest = items.filter((x) => x.name.toLowerCase() !== clean.toLowerCase())
  return [{ id, name: clean, q: q.slice(0, MAX_QUERY) }, ...rest].slice(0, MAX_SAVED_QUERIES)
}

// ---------- hunt notebooks ----------

export const NOTEBOOKS_KEY = 'bluetardigrade.v2.hunts.v1'
export const MAX_NOTEBOOKS = 30
export const MAX_CELLS = 20

export type HuntCell = { id: string; kind: 'search' | 'sql'; text: string }
export type HuntFinding = { id: string; text: string; at: string }
export type HuntNotebook = {
  id: string
  title: string
  technique: string
  cells: HuntCell[]
  findings: HuntFinding[]
  created: string
  updated: string
}

export function newNotebook(id: string, title: string, technique: string, now: string): HuntNotebook {
  return { id, title: title.trim().slice(0, 140), technique: technique.trim().slice(0, 16), cells: [], findings: [], created: now, updated: now }
}

export function readNotebooks(storage: Reader): HuntNotebook[] {
  const raw = readJson(storage, NOTEBOOKS_KEY)
  if (!Array.isArray(raw)) return []
  const out: HuntNotebook[] = []
  for (const item of raw.slice(0, MAX_NOTEBOOKS)) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const id = str(r.id, 64)
    const title = str(r.title, 140)
    const technique = str(r.technique, 16) ?? ''
    const created = str(r.created, 40)
    const updated = str(r.updated, 40)
    if (!id || title === null || !created || !updated) continue
    const cells: HuntCell[] = (Array.isArray(r.cells) ? r.cells : [])
      .slice(0, MAX_CELLS)
      .map((c: unknown) => {
        const x = (c ?? {}) as Record<string, unknown>
        const cid = str(x.id, 64)
        const text = str(x.text, 8192)
        const kind = x.kind === 'sql' ? 'sql' : x.kind === 'search' ? 'search' : null
        return cid && text !== null && kind ? { id: cid, kind, text } : null
      })
      .filter((c): c is HuntCell => c !== null)
    const findings: HuntFinding[] = (Array.isArray(r.findings) ? r.findings : [])
      .slice(0, 50)
      .map((f: unknown) => {
        const x = (f ?? {}) as Record<string, unknown>
        const fid = str(x.id, 64)
        const text = str(x.text, 2000)
        const at = str(x.at, 40)
        return fid && text && at ? { id: fid, text, at } : null
      })
      .filter((f): f is HuntFinding => f !== null)
    out.push({ id, title, technique, cells, findings, created, updated })
  }
  return out
}

export function writeNotebooks(storage: Writer, items: readonly HuntNotebook[]): boolean {
  return writeJson(storage, NOTEBOOKS_KEY, items.slice(0, MAX_NOTEBOOKS))
}

// ---------- modes and URL ----------

export const MODES = ['flujo', 'arbol', 'cronologia', 'rarezas', 'red', 'sql', 'cuaderno', 'analista'] as const
export type InvestigateMode = (typeof MODES)[number]

export function modeFromParam(v: string | null): InvestigateMode {
  return (MODES as readonly string[]).includes(v ?? '') ? (v as InvestigateMode) : 'flujo'
}

export type Source = 'vivo' | 'historico'
export function sourceFromParam(v: string | null): Source {
  return v === 'historico' ? 'historico' : 'vivo'
}

/** The v2 Investigar page scoped by a query (pivots from other sections). */
export function v2InvestigateLink(q: string, mode: InvestigateMode = 'flujo'): string {
  const p = new URLSearchParams()
  if (mode !== 'flujo') p.set('modo', mode)
  if (q) p.set('q', q)
  const s = p.toString()
  return `/v2/investigar${s ? '?' + s : ''}`
}
