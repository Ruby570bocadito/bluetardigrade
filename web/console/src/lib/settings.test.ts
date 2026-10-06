import { describe, expect, test } from 'bun:test'
import {
  AD_PROBE_BUDGET_MS,
  adDirtyFields,
  draftFromSettings,
  draftPayload,
  emptyDraft,
  type ADSettings,
} from './settings'

const SETTINGS: ADSettings = {
  server: 'dc01.lab.local',
  port: 636,
  start_tls: false,
  base_dn: 'DC=lab,DC=local',
  ca_file: '/etc/bluetardigrade/ad-ca.pem',
  ca_file_present: true,
  bind_dn: 'CN=bt-reader,OU=svc,DC=lab,DC=local',
  password_file: '/var/lib/bluetardigrade/ad.secret',
  password_stored: true,
  interval_seconds: 900,
  include_ous: ['OU=people,DC=lab,DC=local'],
  exclude_ous: [],
  max_objects: 20000,
  page_size: 500,
  inactive_days: 45,
  krbtgt_max_age_days: 180,
  work_start: '08:00',
  work_end: '18:00',
  work_days: [1, 2, 3, 4, 5],
  reload_pending: false,
}

describe('draftFromSettings', () => {
  test('the draft mirrors the effective settings', () => {
    const d = draftFromSettings(SETTINGS)
    expect(d.server).toBe('dc01.lab.local')
    expect(d.port).toBe('636')
    expect(d.include_ous).toBe('OU=people,DC=lab,DC=local')
    expect(d.exclude_ous).toBe('')
    expect(d.work_start).toBe('08:00')
    expect(d.work_days).toEqual([false, true, true, true, true, true, false])
    // credential-free by construction: no draft field carries the secret
    expect(Object.keys(d)).not.toContain('password')
  })

  test('the candidate draft of an unarmed engine starts empty with no invented defaults', () => {
    const d = emptyDraft()
    expect(d.server).toBe('')
    expect(d.port).toBe('')
    expect(d.interval_seconds).toBe('')
    expect(d.work_days).toEqual([false, false, false, false, false, false, false])
    expect(adDirtyFields(null, d)).toEqual([])
  })
})

describe('adDirtyFields', () => {
  test('a pristine draft of the effective settings is clean', () => {
    expect(adDirtyFields(SETTINGS, draftFromSettings(SETTINGS))).toEqual([])
  })

  test('changed fields are named exactly (and untouched ones are not)', () => {
    const d = { ...draftFromSettings(SETTINGS), server: 'dc02.lab.local', interval_seconds: '600', inactive_days: '30' }
    expect(adDirtyFields(SETTINGS, d).sort()).toEqual(['inactive_days', 'interval_seconds', 'server'])
  })

  test('ou textareas compare as line lists (blank lines do not make noise)', () => {
    const d = { ...draftFromSettings(SETTINGS), exclude_ous: 'OU=stale,DC=lab,DC=local\n\n  \n' }
    expect(adDirtyFields(SETTINGS, d)).toEqual(['exclude_ous'])
  })

  test('clearing every ou of a populated list is a dirty change', () => {
    const d = { ...draftFromSettings(SETTINGS), include_ous: '' }
    expect(adDirtyFields(SETTINGS, d)).toEqual(['include_ous'])
  })

  test('a filled field on the candidate form travels (unarmed engine)', () => {
    const d = { ...emptyDraft(), server: 'dc01.lab.local', port: '636' }
    expect(adDirtyFields(null, d).sort()).toEqual(['port', 'server'])
  })
})

describe('draftPayload', () => {
  test('only the dirty fields travel, and the password only when typed', () => {
    const d = { ...draftFromSettings(SETTINGS), server: 'dc02.lab.local', interval_seconds: '600' }
    const { update, invalid } = draftPayload(SETTINGS, d, '   ')
    expect(invalid).toEqual([])
    expect(update).toEqual({ server: 'dc02.lab.local', interval_seconds: 600 })
    // VERBATIM (SEG-A r10 LOW): the engine stores and probes the password
    // exactly as typed — leading/trailing spaces are legal bind passwords,
    // so the client must not mutate what it sends. The trimmed copy only
    // decides whether the field travels.
    const withPassword = draftPayload(SETTINGS, d, ' s3cret ')
    expect(withPassword.update.password).toBe(' s3cret ')
    expect(draftPayload(SETTINGS, d, ' ').update.password).toBeUndefined()
  })

  test('a dirty numeric field that does not parse blocks the request and names itself', () => {
    const d = { ...draftFromSettings(SETTINGS), page_size: 'abc', port: ' ' }
    const { update, invalid } = draftPayload(SETTINGS, d)
    expect(update).toEqual({})
    expect(invalid.sort()).toEqual(['page_size', 'port'])
  })

  test('the password never rides along with an untouched form', () => {
    const { update } = draftPayload(SETTINGS, draftFromSettings(SETTINGS))
    expect(Object.keys(update)).toEqual([])
  })

  test('cleared work hours send empty strings (a present field replaces)', () => {
    const d = { ...draftFromSettings(SETTINGS), work_start: '', work_end: '' }
    const { update, invalid } = draftPayload(SETTINGS, d)
    expect(invalid).toEqual([])
    expect(update.work_start).toBe('')
    expect(update.work_end).toBe('')
  })

  test('weekend-only checks translate to the right day indices', () => {
    const d = { ...draftFromSettings(SETTINGS), work_days: [true, false, false, false, false, false, true] }
    const { update } = draftPayload(SETTINGS, d)
    expect(update.work_days).toEqual([0, 6])
  })

  test('the probe budget exceeds the engine\'s 45s so the engine budget is reachable (SEG-A r10 LOW)', () => {
    expect(AD_PROBE_BUDGET_MS).toBe(50_000)
    expect(AD_PROBE_BUDGET_MS).toBeGreaterThan(45_000)
  })
})
