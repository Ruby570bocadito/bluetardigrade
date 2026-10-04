import { describe, expect, test } from 'bun:test'
import { enrollmentPlan, formatDuration, identityName, isValidHostName, secondsSince } from './fleet'

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
