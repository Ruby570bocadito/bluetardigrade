import { describe, expect, test } from 'bun:test'
import { outdatedCount, outdatedSensor, enrollmentPlan, formatDuration, identityName, isValidHostName, secondsSince, runModeText, yaraSkew, type FleetHost } from './fleet'

describe('fleet formatting', () => {
  test('durations read naturally at every scale', () => {
    expect(formatDuration(59)).toBe('59 s')
    expect(formatDuration(120)).toBe('2 min')
    expect(formatDuration(3600)).toBe('1 h')
    expect(formatDuration(5400)).toBe('1 h 30 min')
    expect(formatDuration(90061)).toBe('1 d 1 h')
    expect(formatDuration(-1)).toBe('—')
  })

  test('seconds since an instant, tolerant of bad input', () => {
    const now = Date.parse('2026-10-04T12:00:00Z')
    expect(secondsSince('2026-10-04T11:59:00Z', now)).toBe(60)
    expect(secondsSince('2026-10-04T12:00:05Z', now)).toBe(0)
    expect(secondsSince('nope', now)).toBeNull()
    expect(secondsSince(undefined, now)).toBeNull()
  })
})

describe('enrollment', () => {
  test('host names follow the Windows NetBIOS shape', () => {
    expect(isValidHostName('PC-CONTA-01')).toBe(true)
    expect(isValidHostName('a'.repeat(16))).toBe(false)
    expect(isValidHostName('-PC')).toBe(false)
    expect(isValidHostName('pc;calc')).toBe(false)
  })

  test('identity names are lowercase and command-safe', () => {
    expect(identityName('PC-CONTA-01')).toBe('pc-conta-01')
    expect(identityName('Srv_Files 2')).toBe('srv-files-2')
    expect(identityName('***')).toBe('equipo')
  })

  test('the plan binds the identity to the host and never embeds a token', () => {
    const plan = enrollmentPlan('PC-CONTA-01', '192.168.1.10', true)
    expect(plan[0].cmd).toBe('sf-engine ingest-identity --name pc-conta-01 --host PC-CONTA-01')
    const run = plan.at(-1)!
    expect(run.where).toBe('remote-admin')
    expect(run.cmd).toContain('--addr 192.168.1.10:7777')
    expect(run.cmd).toContain('--token "<token de pc-conta-01>"')
    expect(run.cmd).toContain('--tls-ca')
    expect(plan.some((step) => step.where === 'server-admin' && step.cmd?.includes('LocalPort 7777'))).toBe(true)
    expect(enrollmentPlan('PC-01', '10.0.0.5', false).at(-1)!.cmd).not.toContain('--tls-ca')
  })
})

test('run mode reads as the operator would say it', () => {
  expect(runModeText('service')).toContain('Servicio de Windows')
  expect(runModeText('console')).toContain('sf-etw -Install')
  expect(runModeText(undefined)).toBe('—')
})

describe('outdated sensor detection (C-5)', () => {
  const sensor = (version?: string) => ({ interval_s: 60, uptime_s: 10, spooled: 0, dropped: 0, last_heartbeat: '2026-10-21T19:00:00Z', ...(version ? { version } : {}) })
  const host = (version?: string): FleetHost => ({ host: 'PC-01', status: 'online', first_seen: '2026-10-20T19:00:00Z', last_seen: '2026-10-21T19:00:00Z', events: 1, events_last_5m: 0, sources: [], peers: [], ...(version !== undefined ? { sensor: sensor(version) } : {}) })

  test('a match is never flagged', () => {
    expect(outdatedSensor('v1.0.0', sensor('v1.0.0'))).toBe(false)
  })

  test('a different declared version is flagged, without ordering claims', () => {
    expect(outdatedSensor('v1.0.0', sensor('0.3.0'))).toBe(true)
    // the console cannot know which build is newer: any mismatch flags
    expect(outdatedSensor('0.3.0', sensor('v1.0.0'))).toBe(true)
  })

  test('a sensor without a declared version is never called outdated', () => {
    expect(outdatedSensor('v1.0.0', sensor(undefined))).toBe(false)
    expect(outdatedSensor('v1.0.0', undefined)).toBe(false)
  })

  test('an engine without a published version silences the comparison', () => {
    expect(outdatedSensor(undefined, sensor('0.3.0'))).toBe(false)
    expect(outdatedSensor('', sensor('0.3.0'))).toBe(false)
  })

  test('the inventory count follows the same rule', () => {
    const hosts = [host('v1.0.0'), host('0.3.0'), host('0.3.0'), host(undefined), host('v1.0.0')]
    expect(outdatedCount(hosts, 'v1.0.0')).toBe(2)
    expect(outdatedCount(hosts, undefined)).toBe(0)
    expect(outdatedCount([], 'v1.0.0')).toBe(0)
  })
})

// The pack comparison (M-3): each state names exactly what each side
// said — the engine's /api/yara against the heartbeat's yara_rules_sha.
describe('yaraSkew', () => {
  const engine = { enabled: true, sha16: 'abc123def4567890' }

  test('an engine without a published pack gives nothing to compare', () => {
    expect(yaraSkew({ yara_rules: 3, yara_rules_sha: 'x' }, { enabled: false })).toEqual({ kind: 'unavailable' })
    expect(yaraSkew({ yara_rules: 3, yara_rules_sha: 'x' }, { enabled: true, sha16: '' })).toEqual({ kind: 'unavailable' })
    expect(yaraSkew({ yara_rules: 3, yara_rules_sha: 'x' }, null)).toEqual({ kind: 'unavailable' })
    expect(yaraSkew({ yara_rules: 3, yara_rules_sha: 'x' }, undefined)).toEqual({ kind: 'unavailable' })
  })

  test('a sensor without pack fields says so instead of guessing', () => {
    expect(yaraSkew(undefined, engine)).toEqual({ kind: 'no-report' })
    expect(yaraSkew({ yara_rules: 3 }, engine)).toEqual({ kind: 'no-report' })
    expect(yaraSkew({ yara_rules: 3, yara_rules_sha: '' }, engine)).toEqual({ kind: 'no-report' })
  })

  test('equal shas match, different shas are stale', () => {
    expect(yaraSkew({ yara_rules: 12, yara_rules_sha: 'abc123def4567890' }, engine)).toEqual({ kind: 'match', rules: 12 })
    expect(yaraSkew({ yara_rules: 9, yara_rules_sha: 'dead00beef123456' }, engine)).toEqual({ kind: 'stale', rules: 9 })
    // a heartbeat with the sha but no count still compares; the count is cosmetic
    expect(yaraSkew({ yara_rules_sha: 'abc123def4567890' }, engine)).toEqual({ kind: 'match', rules: 0 })
  })
})
