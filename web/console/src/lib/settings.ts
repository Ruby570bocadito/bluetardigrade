// SET-1 / AD-6 — client of the engine's Active Directory settings family
// (GET/PUT /api/settings/ad, POST /api/ad/test). Pure helpers keep the
// wire shapes and the draft bookkeeping in one place; the view only
// renders. The password is write-only: it crosses in an update request
// and never comes back (the GET carries `password_stored`, the presence
// of the credential envelope, and nothing more).
//
// Honest-states contract (ronda 3, vigente): a 501 means the connector is
// not armed (-ad off) — the probe still works under -api-write, but PUT
// answers 501 too, so the view lets the operator test a candidate and
// declares that saving needs the armed engine. A 403 means the engine
// runs without -api-write and the whole family is closed; the engine's
// own sentence travels in `error`.

import { engineCall, type EngineResult } from './engine-writes'

export type ADSettings = {
  server: string
  port: number
  start_tls: boolean
  base_dn: string
  ca_file: string
  ca_file_present: boolean
  bind_dn: string
  password_file: string
  password_stored: boolean
  interval_seconds: number
  include_ous: string[]
  exclude_ous: string[]
  max_objects: number
  page_size: number
  inactive_days: number
  krbtgt_max_age_days: number
  work_start: string
  work_end: string
  work_days: number[]
  reload_pending: boolean
  last_reload_at?: string
  last_reload_error?: string
}

/** Every field optional: a present field REPLACES the current value. */
export type ADSettingsUpdate = Partial<Omit<ADSettings, 'ca_file_present' | 'password_stored' | 'reload_pending' | 'last_reload_at' | 'last_reload_error'>> & {
  password?: string
}

export type ADTestKind = { kind: 'user' | 'group' | 'computer' | 'ou'; count: number; cap: number; truncated: boolean; sample_dns: string[] }

export type ADTestResult = {
  ok: boolean
  tls_version: string
  cipher_suite: string
  bind_dn: string
  base_dn: string
  kinds: ADTestKind[]
  duration_ms: number
  error?: string
}

export function fetchADSettings(): Promise<EngineResult<ADSettings>> {
  return engineCall<ADSettings>('GET', '/api/settings/ad', undefined, {}, 8000)
}

export function updateADSettings(update: ADSettingsUpdate): Promise<EngineResult<ADSettings>> {
  return engineCall<ADSettings>('PUT', '/api/settings/ad', update, {}, 12000)
}

export function testADConnection(candidate: ADSettingsUpdate): Promise<EngineResult<ADTestResult>> {
  return engineCall<ADTestResult>('POST', '/api/ad/test', candidate, {}, 30000)
}

// ---------------------------------------------------------------------------
// Draft bookkeeping: the form works on a draft (strings so empty means
// "absent"), the dirty walk decides which fields travel, and the payload
// builder produces the update plus the list of dirty numeric fields the
// browser could not parse (the request is not sent while one exists).

export type ADSettingsDraft = {
  server: string
  port: string
  start_tls: boolean
  base_dn: string
  ca_file: string
  bind_dn: string
  password_file: string
  interval_seconds: string
  include_ous: string
  exclude_ous: string
  max_objects: string
  page_size: string
  inactive_days: string
  krbtgt_max_age_days: string
  work_start: string
  work_end: string
  /** checked state for weekdays 0=Sunday..6=Saturday */
  work_days: boolean[]
}

export const WORK_DAYS = [0, 1, 2, 3, 4, 5, 6] as const

/** The candidate form of an unarmed engine: everything empty (the request
 * only carries what the operator fills), no invented defaults. */
export function emptyDraft(): ADSettingsDraft {
  return {
    server: '', port: '', start_tls: false, base_dn: '', ca_file: '', bind_dn: '', password_file: '',
    interval_seconds: '', include_ous: '', exclude_ous: '', max_objects: '', page_size: '',
    inactive_days: '', krbtgt_max_age_days: '', work_start: '', work_end: '', work_days: [false, false, false, false, false, false, false],
  }
}

/** Textarea with one OU per line -> trimmed, non-empty lines. */
function linesToOus(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
}

function ousToLines(ous: string[] | undefined): string {
  return (ous ?? []).join('\n')
}

function daysToChecks(days: number[] | undefined): boolean[] {
  const set = new Set(days ?? [])
  return WORK_DAYS.map((d) => set.has(d))
}

/** The draft the form edits for the current effective settings. */
export function draftFromSettings(s: ADSettings | null): ADSettingsDraft {
  if (!s) return emptyDraft()
  return {
    server: s.server,
    port: String(s.port),
    start_tls: s.start_tls,
    base_dn: s.base_dn,
    ca_file: s.ca_file,
    bind_dn: s.bind_dn,
    password_file: s.password_file,
    interval_seconds: String(s.interval_seconds),
    include_ous: ousToLines(s.include_ous),
    exclude_ous: ousToLines(s.exclude_ous),
    max_objects: String(s.max_objects),
    page_size: String(s.page_size),
    inactive_days: String(s.inactive_days),
    krbtgt_max_age_days: String(s.krbtgt_max_age_days),
    work_start: s.work_start ?? '',
    work_end: s.work_end ?? '',
    work_days: daysToChecks(s.work_days),
  }
}

function checksToDays(checks: boolean[]): number[] {
  return WORK_DAYS.filter((d) => checks[d])
}

/** The numeric draft fields that differ but do not parse (blocks the request). */
const NUMERIC_FIELDS: readonly (keyof ADSettingsDraft)[] = [
  'port', 'interval_seconds', 'max_objects', 'page_size', 'inactive_days', 'krbtgt_max_age_days',
]

/** Which editable fields differ from the effective settings (or from empty,
 * on the candidate form of an unarmed engine). */
export function adDirtyFields(s: ADSettings | null, d: ADSettingsDraft): string[] {
  const dirty: string[] = []
  const eq = (a: string | boolean, b: string | boolean) => a === b
  if (!s) {
    // candidate: every filled field travels
    if (d.server.trim()) dirty.push('server')
    if (d.port.trim()) dirty.push('port')
    if (d.start_tls) dirty.push('start_tls')
    if (d.base_dn.trim()) dirty.push('base_dn')
    if (d.ca_file.trim()) dirty.push('ca_file')
    if (d.bind_dn.trim()) dirty.push('bind_dn')
    if (d.password_file.trim()) dirty.push('password_file')
    if (d.interval_seconds.trim()) dirty.push('interval_seconds')
    if (linesToOus(d.include_ous).length) dirty.push('include_ous')
    if (linesToOus(d.exclude_ous).length) dirty.push('exclude_ous')
    if (d.max_objects.trim()) dirty.push('max_objects')
    if (d.page_size.trim()) dirty.push('page_size')
    if (d.inactive_days.trim()) dirty.push('inactive_days')
    if (d.krbtgt_max_age_days.trim()) dirty.push('krbtgt_max_age_days')
    if (d.work_start.trim()) dirty.push('work_start')
    if (d.work_end.trim()) dirty.push('work_end')
    if (checksToDays(d.work_days).length) dirty.push('work_days')
    return dirty
  }
  if (!eq(d.server, s.server)) dirty.push('server')
  if (!eq(d.port, String(s.port))) dirty.push('port')
  if (!eq(d.start_tls, s.start_tls)) dirty.push('start_tls')
  if (!eq(d.base_dn, s.base_dn)) dirty.push('base_dn')
  if (!eq(d.ca_file, s.ca_file)) dirty.push('ca_file')
  if (!eq(d.bind_dn, s.bind_dn)) dirty.push('bind_dn')
  if (!eq(d.password_file, s.password_file)) dirty.push('password_file')
  if (!eq(d.interval_seconds, String(s.interval_seconds))) dirty.push('interval_seconds')
  if (JSON.stringify(linesToOus(d.include_ous)) !== JSON.stringify(s.include_ous ?? [])) dirty.push('include_ous')
  if (JSON.stringify(linesToOus(d.exclude_ous)) !== JSON.stringify(s.exclude_ous ?? [])) dirty.push('exclude_ous')
  if (!eq(d.max_objects, String(s.max_objects))) dirty.push('max_objects')
  if (!eq(d.page_size, String(s.page_size))) dirty.push('page_size')
  if (!eq(d.inactive_days, String(s.inactive_days))) dirty.push('inactive_days')
  if (!eq(d.krbtgt_max_age_days, String(s.krbtgt_max_age_days))) dirty.push('krbtgt_max_age_days')
  if (!eq(d.work_start, s.work_start ?? '')) dirty.push('work_start')
  if (!eq(d.work_end, s.work_end ?? '')) dirty.push('work_end')
  if (JSON.stringify(checksToDays(d.work_days)) !== JSON.stringify(s.work_days ?? [])) dirty.push('work_days')
  return dirty
}

function num(draft: string): number | undefined {
  const trimmed = draft.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

export type DraftPayload = { update: ADSettingsUpdate; invalid: string[] }

/** The update payload: only the dirty fields travel (a present field
 * replaces the current value, so untouched fields must stay absent), the
 * password only when the operator typed one. `invalid` names the dirty
 * numeric fields that do not parse; the caller must not send anything
 * while it is non-empty. */
export function draftPayload(s: ADSettings | null, d: ADSettingsDraft, password?: string): DraftPayload {
  const dirty = new Set(adDirtyFields(s, d))
  const invalid = NUMERIC_FIELDS.filter((f) => dirty.has(f) && num(d[f] as string) === undefined)
  if (invalid.length > 0) return { update: {}, invalid: [...invalid] }
  const update: ADSettingsUpdate = {}
  if (dirty.has('server')) update.server = d.server.trim()
  if (dirty.has('port')) update.port = num(d.port)
  if (dirty.has('start_tls')) update.start_tls = d.start_tls
  if (dirty.has('base_dn')) update.base_dn = d.base_dn.trim()
  if (dirty.has('ca_file')) update.ca_file = d.ca_file.trim()
  if (dirty.has('bind_dn')) update.bind_dn = d.bind_dn.trim()
  if (dirty.has('password_file')) update.password_file = d.password_file.trim()
  if (dirty.has('interval_seconds')) update.interval_seconds = num(d.interval_seconds)
  if (dirty.has('include_ous')) update.include_ous = linesToOus(d.include_ous)
  if (dirty.has('exclude_ous')) update.exclude_ous = linesToOus(d.exclude_ous)
  if (dirty.has('max_objects')) update.max_objects = num(d.max_objects)
  if (dirty.has('page_size')) update.page_size = num(d.page_size)
  if (dirty.has('inactive_days')) update.inactive_days = num(d.inactive_days)
  if (dirty.has('krbtgt_max_age_days')) update.krbtgt_max_age_days = num(d.krbtgt_max_age_days)
  if (dirty.has('work_start')) update.work_start = d.work_start.trim()
  if (dirty.has('work_end')) update.work_end = d.work_end.trim()
  if (dirty.has('work_days')) update.work_days = checksToDays(d.work_days)
  const trimmedPassword = password?.trim()
  if (trimmedPassword) update.password = trimmedPassword
  return { update, invalid: [] }
}
