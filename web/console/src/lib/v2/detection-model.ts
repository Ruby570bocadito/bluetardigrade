// v2 · Detección: the pure part of the section. The rules the engine
// loaded, seen with what the console holds about them — their alerts in
// memory, the chains they belong to, the suppressions that silence them —
// plus the suppressions' state, the chains' steps and the draft of a rule
// written from a hunting query. Rules and chains live as YAML files on
// the engine host: nothing here edits them, the draft is text to copy.

import type { RuleMeta, Severity, SfAlert, SfSequence, SfSuppression } from '@/lib/console-types'
import { tacticSlug, type TacticSlug } from '@/lib/soc-metrics'
import type { QueryToken } from '@/lib/v2/investigate-model'

const lower = (s: string) => s.toLowerCase()
const SEV_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }

export type RuleRow = {
  rule: RuleMeta
  tactic: TacticSlug | null
  alerts24h: number
  lastFired?: string
  /** alerts per day over the last 7 days (oldest first), from the alerts in memory */
  week: number[]
  chains: string[]
  suppressions: SfSuppression[]
}

function dayBuckets(times: number[], now: number, days: number): number[] {
  const out = new Array<number>(days).fill(0)
  const day = 86_400_000
  const start = now - days * day
  for (const t of times) {
    if (t < start || t > now) continue
    out[Math.min(days - 1, Math.floor((t - start) / day))]++
  }
  return out
}

/** Every loaded rule with its alerts in memory, the chains that use it and the suppressions on it. */
export function ruleRows(rules: readonly RuleMeta[], alerts: readonly SfAlert[], sequences: readonly SfSequence[], suppressions: readonly SfSuppression[], now: number): RuleRow[] {
  const byRule = new Map<string, number[]>()
  for (const a of alerts) {
    const t = Date.parse(a.timestamp)
    if (!Number.isFinite(t)) continue
    const list = byRule.get(a.rule_id) ?? []
    list.push(t)
    byRule.set(a.rule_id, list)
  }
  return rules.map((rule) => {
    const times = byRule.get(rule.id) ?? []
    const last = times.length ? Math.max(...times) : null
    return {
      rule,
      tactic: tacticSlug(rule.tactic) ?? tacticFromTags(rule.tags),
      alerts24h: times.filter((t) => now - t <= 86_400_000).length,
      lastFired: last !== null ? new Date(last).toISOString() : undefined,
      week: dayBuckets(times, now, 7),
      chains: sequences.filter((s) => chainUses(s, rule)).map((s) => s.name),
      suppressions: suppressions.filter((s) => s.rule_id === rule.id),
    }
  })
}

function tacticFromTags(tags: readonly string[]): TacticSlug | null {
  for (const t of tags) {
    const slug = tacticSlug(t.replace(/^attack\./, ''))
    if (slug) return slug
  }
  return null
}

/** A chain uses a rule when one of its steps (or step alternatives) names it by id or by name. */
export function chainUses(seq: SfSequence, rule: Pick<RuleMeta, 'id' | 'name'>): boolean {
  const names = [...seq.steps, ...(seq.step_rules ?? []).flat()].map(lower)
  return names.includes(lower(rule.id)) || names.includes(lower(rule.name))
}

export type RuleFilter = { q: string; sev: Severity | 'all'; tactic: TacticSlug | 'all' | 'none' }

/** Narrows the pack by anything an analyst remembers: name, id, technique, tactic, event type, condition fields and values. */
export function filterRuleRows(rows: readonly RuleRow[], f: RuleFilter): RuleRow[] {
  const q = f.q.trim().toLowerCase()
  return rows.filter((r) => {
    if (f.sev !== 'all' && r.rule.severity !== f.sev) return false
    if (f.tactic === 'none' ? r.tactic !== null : f.tactic !== 'all' && r.tactic !== f.tactic) return false
    if (!q) return true
    // condition values arrive as the YAML wrote them: a port is a number, not text
    const hay: unknown[] = [
      r.rule.name, r.rule.id, r.rule.mitre, r.rule.tactic, r.rule.event_type, r.rule.description, ...r.rule.tags,
      ...r.rule.conditions.flatMap((c) => [c.field, ...(Array.isArray(c.value) ? c.value : [c.value])]),
    ]
    return hay.some((v) => v !== null && v !== undefined && v !== '' && String(v).toLowerCase().includes(q))
  })
}

/** Busiest first (alerts in the last 24 h), then severity, then name. */
export function byActivity(a: RuleRow, b: RuleRow): number {
  return b.alerts24h - a.alerts24h || SEV_RANK[b.rule.severity] - SEV_RANK[a.rule.severity] || a.rule.name.localeCompare(b.rule.name)
}

/** The hosts where a rule fires most among the alerts in memory. */
export function ruleTopHosts(alerts: readonly SfAlert[], ruleId: string, max = 5): { host: string; count: number }[] {
  const m = new Map<string, number>()
  for (const a of alerts) if (a.rule_id === ruleId && a.host) m.set(a.host, (m.get(a.host) ?? 0) + 1)
  return [...m.entries()].map(([host, count]) => ({ host, count })).sort((a, b) => b.count - a.count || a.host.localeCompare(b.host)).slice(0, max)
}

// ---------- chains ----------

export type ChainStep = { label: string; ruleId?: string; ruleIds: string[]; alternatives: { label: string; ruleId?: string }[] }
export type ChainRow = { seq: SfSequence; steps: ChainStep[]; lastCompleted?: string; completions: number }

/**
 * A chain with its steps named by the rules they stand for (alternatives
 * when a step accepts several) and when it last completed: the engine
 * raises the completion alert under the chain's own id.
 */
export function chainRows(sequences: readonly SfSequence[], rules: readonly RuleMeta[], alerts: readonly SfAlert[]): ChainRow[] {
  const byKey = new Map<string, RuleMeta>()
  for (const r of rules) {
    byKey.set(lower(r.id), r)
    byKey.set(lower(r.name), r)
  }
  return sequences.map((seq) => {
    const groups = seq.step_rules?.length ? seq.step_rules : seq.steps.map((s) => [s])
    const steps = groups.map((alts, i) => {
      const resolved = alts.map((a) => byKey.get(lower(a)))
      return {
        label: resolved[0]?.name ?? seq.steps[i] ?? alts[0] ?? '',
        ruleId: resolved[0]?.id,
        ruleIds: resolved.filter((r): r is RuleMeta => !!r).map((r) => r.id),
        alternatives: resolved.slice(1).map((r, j) => ({ label: r?.name ?? alts[j + 1], ruleId: r?.id })),
      }
    })
    const done = alerts.filter((a) => a.rule_id === seq.id).map((a) => a.timestamp).sort()
    return { seq, steps, lastCompleted: done[done.length - 1], completions: done.length }
  })
}

// ---------- suppressions ----------

export type SuppressionState = { s: SfSuppression; expired: boolean; permanent: boolean; remainingMs: number | null; ruleName: string }

/** Every suppression with whether it still silences and how long it has left (permanent ones have no end). */
export function suppressionStates(list: readonly SfSuppression[], rules: readonly RuleMeta[], now: number): SuppressionState[] {
  const names = new Map(rules.map((r) => [r.id, r.name]))
  return list
    .map((s) => {
      const end = s.expires ? Date.parse(s.expires) : NaN
      const permanent = !s.expires || !Number.isFinite(end)
      const remainingMs = permanent ? null : end - now
      return { s, permanent, remainingMs, expired: !permanent && (remainingMs as number) <= 0, ruleName: names.get(s.rule_id) ?? s.rule_id }
    })
    .sort((a, b) => Number(a.expired) - Number(b.expired) || (a.remainingMs ?? Infinity) - (b.remainingMs ?? Infinity) || a.ruleName.localeCompare(b.ruleName))
}

// ---------- rule tester ----------

/** The lines of a pretty-printed event that hold the fields a rule matched on (to light them up). */
export function matchedLines(json: string, fields: readonly string[]): Set<number> {
  const leaves = new Set(fields.map((f) => f.split('.').pop() ?? f))
  const out = new Set<number>()
  json.split('\n').forEach((line, i) => {
    const m = /^\s*"([^"]+)":/.exec(line)
    if (m && leaves.has(m[1])) out.add(i)
  })
  return out
}

const INVERTIBLE = new Set(['eq', 'ieq', 'contains', 'icontains', 'startswith', 'istartswith', 'endswith', 'iendswith', 'in', 'iin', 'contains_any', 'icontains_any'])

/**
 * A starting event for the tester written from a rule's own conditions:
 * what can be turned around (equalities, substrings, lists, bounds)
 * becomes a field value; negations and regexes are left out. It is an
 * editable draft for the analyst, never shown as something that happened.
 */
export function skeletonEvent(rule: Pick<RuleMeta, 'event_type' | 'conditions'>): Record<string, unknown> {
  const ev: Record<string, unknown> = { type: rule.event_type || 'process.create' }
  for (const c of rule.conditions) {
    const raw = Array.isArray(c.value) ? c.value[0] : c.value
    if (raw === undefined || raw === null) continue
    const text = String(raw)
    let value: string | number
    if (c.operator === 'gt' || c.operator === 'lt') {
      const n = Number(text)
      if (!Number.isFinite(n)) continue
      value = c.operator === 'gt' ? n + 1 : n - 1
    } else if (INVERTIBLE.has(c.operator)) {
      value = /(^|\.)(port|destination_port|source_port|pid|ppid)$/.test(c.field) && /^\d+$/.test(text) ? Number(text) : text
    } else continue
    const parts = c.field.split('.')
    let cur = ev
    for (const p of parts.slice(0, -1)) {
      if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {}
      cur = cur[p] as Record<string, unknown>
    }
    const leaf = parts[parts.length - 1]
    const prev = cur[leaf]
    // two conditions on one field (starts with … and ends with …) are joined
    if (typeof prev === 'string' && typeof value === 'string') {
      if (c.operator.endsWith('startswith')) value = value + prev
      else if (c.operator.endsWith('endswith')) value = prev + value
      else if (c.operator.includes('contains')) value = `${prev} ${value}`
    }
    cur[leaf] = value
  }
  return ev
}

// ---------- from a search to a rule ----------

/** A rule id from its name: lowercase ASCII words joined by dashes. */
export function ruleIdFrom(name: string): string {
  const id = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '')
  return id || 'regla-nueva'
}

export type DraftCondition = { field: string; operator: string; value: string | number }
export type DraftRule = { conditions: DraftCondition[]; eventType: string; skipped: QueryToken[] }

const KIND_TYPE: Record<string, string> = {
  proceso: 'process.create', process: 'process.create', red: 'network.connect', network: 'network.connect', dns: 'dns.query',
  fichero: 'file.create', file: 'file.create', registro: 'registry.set', registry: 'registry.set', modulo: 'image.load', módulo: 'image.load', image: 'image.load', module: 'image.load',
}

/**
 * The conditions a hunting query becomes in the engine's rule schema.
 * Only what the engine can express travels: a negated "contains" has no
 * operator, a PID means nothing across machines, a hash has no field —
 * those tokens are returned as skipped, never bent into something else.
 */
export function draftFromTokens(tokens: readonly QueryToken[], fallbackType: string): DraftRule {
  const conditions: DraftCondition[] = []
  const skipped: QueryToken[] = []
  let eventType = ''
  const eq = (field: string, t: QueryToken) => conditions.push({ field, operator: t.negate ? 'ineq' : 'ieq', value: t.value })
  const has = (field: string, t: QueryToken) => (t.negate ? skipped.push(t) : conditions.push({ field, operator: 'icontains', value: t.value }))
  for (const t of tokens) {
    switch (t.field) {
      case 'type':
        if (t.negate) skipped.push(t)
        else eventType = t.value.includes('.') ? t.value : (KIND_TYPE[lower(t.value)] ?? t.value)
        break
      case 'process': eq('process.name', t); break
      case 'user': eq('user', t); break
      case 'host': eq('host', t); break
      case 'parent':
        if (/^\d+$/.test(t.value)) skipped.push(t)
        else eq('enrichment.parent_name', t)
        break
      case 'cmd': has('process.command_line', t); break
      case 'file': has('file.path', t); break
      case 'key': has('registry.key', t); break
      case 'domain': has('network.domain', t); break
      case 'port':
        if (/^\d+$/.test(t.value)) conditions.push({ field: 'network.destination_port', operator: t.negate ? 'neq' : 'eq', value: Number(t.value) })
        else skipped.push(t)
        break
      case 'ip':
        conditions.push({ field: 'network.destination_ip', operator: t.negate ? 'neq' : 'eq', value: t.value })
        break
      case 'dst': {
        const m = /^(.+):(\d+)$/.exec(t.value)
        if (t.negate) skipped.push(t)
        else if (m) {
          conditions.push({ field: 'network.destination_ip', operator: 'eq', value: m[1] })
          conditions.push({ field: 'network.destination_port', operator: 'eq', value: Number(m[2]) })
        } else conditions.push({ field: 'network.destination_ip', operator: 'eq', value: t.value })
        break
      }
      case null: has('process.command_line', t); break
      default: skipped.push(t) // pid, hash
    }
  }
  return { conditions, eventType: eventType || fallbackType, skipped }
}

const yamlString = (s: string) => JSON.stringify(s)

/** The draft as the engine's rule files write it (one list item, ready to paste into rules/*.yaml). */
export function draftYaml(d: DraftRule, meta: { id: string; name: string; description: string; severity: Severity; techniques: string[]; tactic: TacticSlug | null }): string {
  const tags = [...meta.techniques.map((t) => `attack.${lower(t)}`), ...(meta.tactic ? [`attack.${meta.tactic}`] : [])]
  const lines = [
    `- name: ${yamlString(meta.name)}`,
    `  id: ${yamlString(meta.id)}`,
    '  description: >',
    ...(meta.description.trim() || meta.name).split('\n').map((l) => `    ${l.trim()}`),
    `  severity: ${meta.severity}`,
    `  event_type: ${d.eventType}`,
    '  conditions:',
    ...(d.conditions.length
      ? d.conditions.flatMap((c) => [`    - field: ${c.field}`, `      operator: ${c.operator}`, `      value: ${typeof c.value === 'number' ? c.value : yamlString(c.value)}`])
      : ['    []']),
    '  actions:',
    '    - type: alert',
    `  tags: [${tags.map(yamlString).join(', ')}]`,
    '  enabled: true',
  ]
  return lines.join('\n') + '\n'
}

/** ATT&CK techniques typed by hand: T1053.005, t1059 … */
export function parseTechniques(text: string): string[] {
  return [...new Set((text.match(/t\d{4}(?:\.\d{3})?/gi) ?? []).map((t) => t.toUpperCase()))]
}

// ---------- URL ----------

export const DETECTION_TABS = ['reglas', 'cobertura', 'cadenas', 'probador', 'ruido', 'supresiones', 'validacion', 'indicadores', 'borrador'] as const
export type DetectionTab = (typeof DETECTION_TABS)[number]
export function detectionTabFromParam(v: string | null): DetectionTab {
  return (DETECTION_TABS as readonly string[]).includes(v ?? '') ? (v as DetectionTab) : 'reglas'
}

export function v2RuleLink(id: string): string {
  return `/v2/deteccion?regla=${encodeURIComponent(id)}`
}

export function v2DraftLink(q: string): string {
  return `/v2/deteccion?vista=borrador&q=${encodeURIComponent(q)}`
}
