// v2 · Ajustes: the pure part of the section. The state of every settings
// area as the console and the engine report it (configured, not armed,
// to review, or not known when the read failed), where each one is
// changed (here, when the console starts or with the engine's flags), the engine's outputs with their health, the live
// preview of which machines a host-group pattern takes, and the filters
// of the console audit. Nothing here guesses a state it was not told.

import type { ConsoleAuditEntry, ConsoleMe } from '@/lib/console-user'
import type { EngineStats } from '@/lib/console-types'
import { patternMatches } from '@/lib/v2/hosts-model'

// ---------- URL ----------

export const SETTINGS_TABS = ['mapa', 'cuentas', 'mi-cuenta', 'avisos', 'directorio', 'grupos', 'ingesta', 'integraciones', 'auditoria', 'puesta-en-marcha'] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]
export function settingsTabFromParam(v: string | null): SettingsTab {
  return (SETTINGS_TABS as readonly string[]).includes(v ?? '') ? (v as SettingsTab) : 'mapa'
}
export function v2SettingsLink(tab: SettingsTab): string {
  return tab === 'mapa' ? '/v2/ajustes' : `/v2/ajustes?vista=${tab}`
}

// ---------- the map of areas ----------

/**
 * off: the engine runs without what the area needs; disabled: the console
 * starts without it; restricted: this account has no access to it (403, or
 * an account limited to host groups); unknown: the read failed
 */
export type AreaState = 'loading' | 'ok' | 'off' | 'disabled' | 'restricted' | 'unknown' | 'review' | 'info'
/** console: in this section; startup: in the console's start (its variables); flags: in the engine's flags */
export type AreaWhere = 'console' | 'startup' | 'flags'
export type AreaId = Exclude<SettingsTab, 'mapa'>

/** An engine read: null while asked, 'off' when the engine runs without it, 'restricted' on a 403, 'unknown' when it failed. */
export type Asked<T> = T | 'off' | 'restricted' | 'unknown' | null

function judged<T>(v: Asked<T>, judge: (x: T) => AreaState): AreaState {
  if (v === null) return 'loading'
  if (v === 'off') return 'off'
  if (v === 'restricted') return 'restricted'
  if (v === 'unknown') return 'unknown'
  return judge(v as T)
}

/** What the map knows of each area; null while it is being asked. */
export type AreaInputs = {
  me: Pick<ConsoleMe, 'mode' | 'mfa' | 'pending' | 'scope'>
  stats: Pick<EngineStats, 'ingest_rejected' | 'ingest_identity_violations'> | null
  enroll: { enabled: boolean } | null
  /** GET /api/groups: 'off' when the engine runs without -host-groups */
  groups: Asked<{ writable: boolean; ungrouped: number }>
  /** GET /api/settings/ad (+ /api/ad/status): 'off' = not armed (501); failing = a reload or the last sync failed */
  ad: Asked<{ failing: boolean }>
  /** GET /api/settings/notify: 'off' = no -notify */
  notify: Asked<{ channels: number; failed: number }>
  outputs: OutputRow[]
  /** the console audit file (CONSOLE_AUDIT_FILE): null while asked */
  audit: boolean | null
  firstRunDone: boolean | null
}

export function areaStates(i: AreaInputs): Record<AreaId, { state: AreaState; where: AreaWhere }> {
  // a channel only shows up in the stats once declared; the sinks always do
  const outputsState: AreaState = i.outputs.some((o) => o.health === 'warn') ? 'review' : i.outputs.some((o) => o.health === 'ok' || o.kind === 'channel') ? 'ok' : 'info'
  return {
    cuentas: { state: i.me.pending ? 'loading' : i.me.mode === 'users' ? 'ok' : 'info', where: i.me.mode === 'users' ? 'console' : 'startup' },
    'mi-cuenta': { state: i.me.pending ? 'loading' : i.me.mfa?.required && !i.me.mfa.enrolled ? 'review' : 'ok', where: 'console' },
    avisos: { state: judged(i.notify, (x) => (x.failed > 0 ? 'review' : x.channels > 0 ? 'ok' : 'info')), where: 'console' },
    directorio: { state: judged(i.ad, (x) => (x.failing ? 'review' : 'ok')), where: 'console' },
    grupos: {
      state: judged(i.groups, (x) => (x.ungrouped > 0 ? 'review' : 'ok')),
      where: typeof i.groups === 'object' && i.groups?.writable ? 'console' : 'flags',
    },
    ingesta: {
      state: i.stats === null ? 'loading' : (i.stats.ingest_rejected ?? 0) > 0 || (i.stats.ingest_identity_violations ?? 0) > 0 ? 'review' : i.enroll?.enabled ? 'ok' : 'info',
      where: 'flags',
    },
    integraciones: { state: i.stats === null ? 'loading' : outputsState, where: 'flags' },
    auditoria: { state: i.audit === null ? 'loading' : i.audit ? 'ok' : 'disabled', where: 'startup' },
    // an account limited to host groups sees neither the enrollment tokens nor the other machines
    'puesta-en-marcha': {
      state: i.me.scope?.length ? 'restricted' : i.firstRunDone === null ? 'loading' : i.firstRunDone ? 'ok' : 'review',
      where: 'console',
    },
  }
}

// ---------- the engine's outputs ----------

export type OutputRow = { key: string; label: string; kind: 'sink' | 'channel'; sent: number; failed: number; dropped: number; filtered?: number; health: 'quiet' | 'ok' | 'warn' }

type OutputStats = Partial<
  Pick<EngineStats, 'webhook_sent' | 'webhook_failed' | 'webhook_dropped' | 'elastic_sent' | 'elastic_failed' | 'elastic_dropped' | 'splunk_sent' | 'splunk_failed' | 'splunk_dropped'>
> & { notify_channels?: { name: string; type: string; sent: number; failed: number; dropped: number; filtered: number }[] }

const health = (sent: number, failed: number, dropped: number): OutputRow['health'] => (failed > 0 || dropped > 0 ? 'warn' : sent > 0 ? 'ok' : 'quiet')

/** Webhook, Elastic, Splunk and every notification channel with their counters and health. */
export function outputRows(stats: OutputStats | null): OutputRow[] {
  if (!stats) return []
  const sink = (key: 'webhook' | 'elastic' | 'splunk', label: string): OutputRow => {
    const sent = stats[`${key}_sent`] ?? 0
    const failed = stats[`${key}_failed`] ?? 0
    const dropped = stats[`${key}_dropped`] ?? 0
    return { key, label, kind: 'sink', sent, failed, dropped, health: health(sent, failed, dropped) }
  }
  return [
    sink('webhook', 'Webhook'),
    sink('elastic', 'Elastic'),
    sink('splunk', 'Splunk'),
    ...(stats.notify_channels ?? []).map((c) => ({
      key: `${c.type}:${c.name}`,
      label: c.name,
      kind: 'channel' as const,
      sent: c.sent,
      failed: c.failed,
      dropped: c.dropped,
      filtered: c.filtered,
      health: health(c.sent, c.failed, c.dropped),
    })),
  ]
}

// ---------- host groups ----------

/**
 * Which known machines each group's name patterns take now, and the ones
 * no group takes. AD OUs and ingest identities resolve in the engine, so
 * a draft only previews its name patterns (the saved groups carry the
 * engine's own member list).
 */
export function previewGroups(patterns: readonly (readonly string[])[], hosts: readonly string[]): { perGroup: string[][]; ungrouped: string[] } {
  const sorted = [...new Set(hosts)].sort()
  const perGroup = patterns.map((list) => sorted.filter((h) => list.some((p) => p.trim() && patternMatches(p.trim(), h))))
  const taken = new Set(perGroup.flat())
  return { perGroup, ungrouped: sorted.filter((h) => !taken.has(h)) }
}

// ---------- console audit ----------

export type AuditOutcome = 'all' | ConsoleAuditEntry['outcome']

export function filterConsoleAudit(entries: readonly ConsoleAuditEntry[], user: string, outcome: AuditOutcome): ConsoleAuditEntry[] {
  return entries
    .filter((e) => (user === '' || e.user === user) && (outcome === 'all' || e.outcome === outcome))
    .sort((a, b) => b.at.localeCompare(a.at))
}

export function auditUsers(entries: readonly ConsoleAuditEntry[]): string[] {
  return [...new Set(entries.map((e) => e.user).filter(Boolean))].sort()
}

export function auditCounts(entries: readonly ConsoleAuditEntry[]): Record<AuditOutcome, number> {
  return {
    all: entries.length,
    ok: entries.filter((e) => e.outcome === 'ok').length,
    error: entries.filter((e) => e.outcome === 'error').length,
    denied: entries.filter((e) => e.outcome === 'denied').length,
  }
}
