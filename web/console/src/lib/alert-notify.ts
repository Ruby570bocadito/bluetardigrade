// Browser notifications for new critical alerts: the per-browser
// preference and the pure decision of which arrivals deserve a toast.
// Nothing here leaves the browser; the Notification itself is raised by
// the console component when the operator granted permission.

import type { SfAlert } from './console-types'

export const NOTIFY_KEY = 'bluetardigrade.notify.v1'

export type NotifyPrefs = { enabled: boolean; sound: boolean }
export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = { enabled: false, sound: false }

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export function readNotifyPrefs(storage: StorageLike | undefined): NotifyPrefs {
  try {
    const raw = storage?.getItem(NOTIFY_KEY)
    if (!raw) return DEFAULT_NOTIFY_PREFS
    const value = JSON.parse(raw) as Partial<NotifyPrefs>
    return { enabled: value.enabled === true, sound: value.sound === true }
  } catch {
    return DEFAULT_NOTIFY_PREFS
  }
}

/** Persist the preference; returns false when the browser refuses storage. */
export function writeNotifyPrefs(storage: StorageLike | undefined, prefs: NotifyPrefs): boolean {
  try {
    storage?.setItem(NOTIFY_KEY, JSON.stringify({ enabled: prefs.enabled, sound: prefs.sound }))
    return Boolean(storage)
  } catch {
    return false
  }
}

/**
 * Critical, still-open alerts among `alerts` whose key is not in `seen`.
 * The first call (seen === null) only primes the set: opening the console
 * never replays the backlog as a burst of notifications.
 */
export function newCriticalAlerts(alerts: readonly SfAlert[], seen: Set<string> | null, keyOf: (a: SfAlert) => string): { fresh: SfAlert[]; seen: Set<string> } {
  const next = new Set<string>()
  for (const a of alerts) next.add(keyOf(a))
  if (seen === null) return { fresh: [], seen: next }
  const fresh = alerts.filter((a) => a.severity === 'critical' && a.status !== 'closed' && !seen.has(keyOf(a)))
  return { fresh, seen: next }
}

/** The language-dependent wording of the toast, supplied by the caller
 * (the dictionaries own it — IDEA-10). The lib only concatenates engine
 * data (hosts, users, summaries, rule names) around these phrases. */
export type NotifyPhrases = {
  one: (rule: string) => string
  many: (n: number) => string
  /** Suffix for the hosts beyond the first three, e.g. “y 2 equipos más”. */
  moreHosts: (n: number) => string
}

/** Title and body of the toast; several arrivals collapse into one. */
export function notificationText(fresh: readonly SfAlert[], phrases: NotifyPhrases): { title: string; body: string } {
  if (fresh.length === 1) {
    const a = fresh[0]
    return { title: phrases.one(a.rule_name), body: `${a.host}${a.user ? ' · ' + a.user : ''}\n${a.summary}`.slice(0, 240) }
  }
  const hosts = [...new Set(fresh.map((a) => a.host))]
  const extra = hosts.length - 3
  return {
    title: phrases.many(fresh.length),
    body: hosts.slice(0, 3).join(', ') + (extra > 0 ? ` ${phrases.moreHosts(extra)}` : ''),
  }
}
