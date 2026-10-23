// F3 — client of the engine's notification settings (GET/PUT
// /api/settings/notify, POST /api/notify/test): the channels that carry
// alerts to mail, chat and phones (Slack, Telegram, email, ntfy push).
// Pure helpers keep the wire shapes and the draft bookkeeping here; the
// panel (settings-view.tsx) only renders.
//
// Secrets are write-only: the GET answers url_set / token_set /
// password_set, never the value. A secret field left empty in the draft
// is not sent, and the engine keeps the stored one of the channel with
// the same name and type; clear_secret drops it.
//
// Honest states, as in the Active Directory panel: 501 = the engine runs
// without -notify, 403 = without -api-write (the engine's own sentence
// travels in `error`), 409 = the file was edited by hand on disk.

import { engineCall, type EngineResult } from './engine-writes'

export const NOTIFY_TYPES = ['email', 'telegram', 'slack', 'ntfy'] as const
export type NotifyType = (typeof NOTIFY_TYPES)[number]
export const NOTIFY_SEVERITIES = ['', 'info', 'low', 'medium', 'high', 'critical'] as const
export type NotifySeverity = (typeof NOTIFY_SEVERITIES)[number]
/** The engine's cap (internal/notify MaxChannels). */
export const MAX_NOTIFY_CHANNELS = 8

export type NotifyChannel = {
  type: NotifyType
  name: string
  min_severity: NotifySeverity
  url?: string
  url_set?: boolean
  url_label?: string
  topic?: string
  token?: string
  token_env?: string
  token_set?: boolean
  chat_id?: string
  api_url?: string
  server?: string
  from?: string
  to?: string[]
  username?: string
  username_env?: string
  password?: string
  password_env?: string
  password_set?: boolean
  starttls?: boolean
  hello?: string
  clear_secret?: boolean
}

export type NotifyChannelStats = { name: string; type: string; sent: number; failed: number; dropped: number; filtered: number }

export type NotifySettings = {
  path: string
  exists: boolean
  console_url: string
  channels: NotifyChannel[]
  stats: NotifyChannelStats[]
}

export type NotifyTestResult = { name: string; type: string; ok: boolean; error?: string }

export function fetchNotifySettings(): Promise<EngineResult<NotifySettings>> {
  return engineCall<NotifySettings>('GET', '/api/settings/notify', undefined, {}, 8000)
}

export function updateNotifySettings(consoleURL: string, channels: NotifyChannel[]): Promise<EngineResult<NotifySettings>> {
  return engineCall<NotifySettings>('PUT', '/api/settings/notify', { console_url: consoleURL.trim(), channels: channels.map(channelPayload) }, {}, 12000)
}

/** The engine gives a test round 20 s; the client waits a little longer. */
export const NOTIFY_TEST_BUDGET_MS = 25_000

export function testNotify(name = ''): Promise<EngineResult<{ results: NotifyTestResult[] }>> {
  return engineCall<{ results: NotifyTestResult[] }>('POST', '/api/notify/test', name ? { name } : {}, {}, NOTIFY_TEST_BUDGET_MS)
}

/** A new channel of a type, with the fields its form shows. */
export function emptyChannel(type: NotifyType, taken: string[]): NotifyChannel {
  let name: string = type
  for (let i = 2; taken.includes(name); i++) name = `${type}-${i}`
  const base: NotifyChannel = { type, name, min_severity: 'high' }
  if (type === 'email') return { ...base, server: '', from: '', to: [], starttls: true }
  if (type === 'telegram') return { ...base, chat_id: '' }
  if (type === 'ntfy') return { ...base, url: '', topic: '' }
  return { ...base, url: '' }
}

/** Is the stored secret of this channel kept when its field is empty? */
export function secretStored(ch: NotifyChannel): boolean {
  if (ch.clear_secret) return false
  if (ch.type === 'slack') return !!ch.url_set
  if (ch.type === 'email') return !!ch.password_set
  return !!ch.token_set
}

/** What travels in the PUT: no read-only flags, no empty secrets. */
export function channelPayload(ch: NotifyChannel): NotifyChannel {
  const out: NotifyChannel = { type: ch.type, name: ch.name.trim(), min_severity: ch.min_severity }
  const put = <K extends keyof NotifyChannel>(key: K) => {
    const v = ch[key]
    if (typeof v === 'string' ? v.trim() !== '' : v !== undefined) out[key] = (typeof v === 'string' ? v.trim() : v) as NotifyChannel[K]
  }
  // the secret values travel untrimmed: a password is what it is
  if (ch.token) out.token = ch.token
  if (ch.password) out.password = ch.password
  if (ch.clear_secret) out.clear_secret = true
  if (ch.type === 'slack' || ch.type === 'ntfy') put('url')
  if (ch.type === 'ntfy') put('topic')
  if (ch.type === 'telegram' || ch.type === 'ntfy') put('token_env')
  if (ch.type === 'telegram') (['chat_id', 'api_url'] as const).forEach(put)
  if (ch.type === 'email') {
    ;(['server', 'from', 'username', 'username_env', 'password_env', 'starttls', 'hello'] as const).forEach(put)
    const to = (ch.to ?? []).map((r) => r.trim()).filter(Boolean)
    if (to.length) out.to = to
  }
  return out
}

/** Comma, semicolon or newline separated recipients. */
export function parseRecipients(text: string): string[] {
  return text.split(/[,;\n]/).map((r) => r.trim()).filter(Boolean)
}

export type ChannelProblem = 'name' | 'duplicate' | 'url' | 'topic' | 'chat_id' | 'token' | 'server' | 'from' | 'to' | 'password'

const NAME_OK = /^[^\x00-\x1f\x7f]{1,64}$/u
const HTTP_OK = /^https?:\/\/[^\s/]+/i
const TOPIC_OK = /^[A-Za-z0-9_-]{1,64}$/
const HOST_PORT_OK = /^[^\s:]+:\d{1,5}$|^\[[0-9a-f:]+\]:\d{1,5}$/i

/**
 * The first problem of each channel that the engine would refuse, so the
 * form can point at the field before a round trip. The engine validates
 * again with its own rules either way.
 */
export function channelProblems(channels: NotifyChannel[]): (ChannelProblem | null)[] {
  const names = channels.map((c) => c.name.trim())
  return channels.map((ch, i) => {
    const name = names[i]
    if (!NAME_OK.test(name)) return 'name'
    if (names.indexOf(name) !== i) return 'duplicate'
    const hasSecret = (ch.token ?? '') !== '' || secretStored(ch)
    switch (ch.type) {
      case 'slack':
        if (!secretStored(ch) && !HTTP_OK.test(ch.url ?? '')) return 'url'
        return null
      case 'ntfy':
        if (!HTTP_OK.test(ch.url ?? '')) return 'url'
        if (!TOPIC_OK.test(ch.topic ?? '')) return 'topic'
        return null
      case 'telegram':
        if (!(ch.chat_id ?? '').trim()) return 'chat_id'
        if (!hasSecret && !(ch.token_env ?? '').trim()) return 'token'
        return null
      case 'email': {
        if (!HOST_PORT_OK.test((ch.server ?? '').trim())) return 'server'
        if (!(ch.from ?? '').trim()) return 'from'
        if (!(ch.to ?? []).some((r) => r.trim())) return 'to'
        const user = (ch.username ?? '').trim() || (ch.username_env ?? '').trim()
        const pass = (ch.password ?? '') !== '' || (ch.password_env ?? '').trim() !== '' || secretStored(ch)
        if (!!user !== pass) return 'password'
        return null
      }
    }
  })
}

/** The counters of a saved channel, or null for one not running yet. */
export function statsFor(stats: NotifyChannelStats[], ch: NotifyChannel): NotifyChannelStats | null {
  return stats.find((s) => s.name === ch.name && s.type === ch.type) ?? null
}

/** Draft vs. saved: anything to save? (secret fields typed count) */
export function notifyDirty(saved: NotifySettings | null, consoleURL: string, channels: NotifyChannel[]): boolean {
  if (!saved) return channels.length > 0 || consoleURL.trim() !== ''
  if (saved.console_url !== consoleURL.trim()) return true
  return JSON.stringify(saved.channels.map(channelPayload)) !== JSON.stringify(channels.map(channelPayload))
}
