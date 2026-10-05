import { describe, expect, test } from 'bun:test'
import { enrolledFor, isValidPattern, isValidServer, serviceEnrollmentCommand, tokenEnrollmentPlan, type EnrollState } from './enroll'

const SECRET = 'btenroll_' + 'a'.repeat(64)

describe('token enrollment plan', () => {
  test('the sensor gets the token, a credential file and TLS', () => {
    const plan = tokenEnrollmentPlan(SECRET, '192.168.1.10', true)
    const run = plan.at(-1)!
    expect(run.where).toBe('remote-admin')
    expect(run.cmd).toContain('--addr 192.168.1.10:7777')
    expect(run.cmd).toContain(`--enroll-token ${SECRET}`)
    expect(run.cmd).toContain('--token-file "C:\\ProgramData\\bluetardigrade\\sensor\\ingest.token"')
    expect(run.cmd).toContain('--tls-ca')
  })

  test('the data folder is restricted to SYSTEM and Administrators by SID', () => {
    const folder = tokenEnrollmentPlan(SECRET, 'srv', true)[1].cmd!
    expect(folder).toContain('/inheritance:r')
    expect(folder).toContain('*S-1-5-18:(OI)(CI)F')
    expect(folder).toContain('*S-1-5-32-544:(OI)(CI)F')
  })

  test('without TLS no certificate is referenced', () => {
    const plan = tokenEnrollmentPlan(SECRET, 'srv', false)
    expect(plan.some((s) => s.cmd?.includes('ingest-cert.pem'))).toBe(false)
  })

  test('the service variant uses sf-etw', () => {
    expect(serviceEnrollmentCommand(SECRET, 'srv', false)).toBe(`sf-etw -Install -Addr srv:7777 -EnrollToken ${SECRET}`)
    expect(serviceEnrollmentCommand(SECRET, 'srv', true)).toContain('-TlsCa')
  })
})

describe('validation', () => {
  test('patterns', () => {
    expect(isValidPattern('')).toBe(true)
    expect(isValidPattern('PC-CONTA-*')).toBe(true)
    expect(isValidPattern('pc conta')).toBe(false)
    expect(isValidPattern('pc;calc')).toBe(false)
  })

  test('server addresses', () => {
    expect(isValidServer('192.168.1.10')).toBe(true)
    expect(isValidServer('soc.empresa.local')).toBe(true)
    expect(isValidServer('srv:7777')).toBe(false)
    expect(isValidServer('')).toBe(false)
  })
})

describe('enrolled host lookup', () => {
  const state: EnrollState = {
    enabled: true, pending: 0, active: 1, usable_tokens: 0, writes: true, tokens: [],
    hosts: [
      { name: 'enr-pc-1-aaaaaa', host: 'PC-1', state: 'revoked', token_id: 't', enrolled_at: '' },
      { name: 'enr-pc-1-bbbbbb', host: 'PC-1', state: 'active', token_id: 't', enrolled_at: '' },
    ],
  }
  test('by identity first, then the active record of the host', () => {
    expect(enrolledFor(state, 'pc-1', 'enr-pc-1-aaaaaa')?.state).toBe('revoked')
    expect(enrolledFor(state, 'pc-1')?.name).toBe('enr-pc-1-bbbbbb')
    expect(enrolledFor(state, 'pc-2')).toBeUndefined()
    expect(enrolledFor(null, 'pc-1')).toBeUndefined()
  })
})
