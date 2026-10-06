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

export type NotifyPermission = NotificationPermission | 'unsupported'

/** The browser's notification permission, or 'unsupported' without the API. */
export function currentPermission(): NotifyPermission {
  return typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
}

/** Two short descending tones through WebAudio (no audio asset). */
export function playNotifyTone(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const at = ctx.currentTime
    for (const [i, freq] of [880, 660].entries()) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, at + i * 0.18)
      gain.gain.exponentialRampToValueAtTime(0.18, at + i * 0.18 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + i * 0.18 + 0.16)
      osc.connect(gain).connect(ctx.destination)
      osc.start(at + i * 0.18)
      osc.stop(at + i * 0.18 + 0.17)
    }
    setTimeout(() => void ctx.close(), 600)
  } catch {
    // audio is a courtesy; a blocked context must never break the console
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
