import { describe, expect, test } from 'bun:test'
import type { ConsoleAuditEntry } from '@/lib/console-user'
import { areaStates, auditCounts, auditUsers, filterConsoleAudit, outputRows, previewGroups, settingsTabFromParam, v2SettingsLink, type AreaInputs } from './settings-model'

describe('the engine outputs', () => {
  test('sinks and channels with their health: failures or drops to review, deliveries ok, nothing quiet', () => {
    const rows = outputRows({
      webhook_sent: 8412,
      webhook_failed: 0,
      webhook_dropped: 0,
      elastic_sent: 0,
      splunk_sent: 10,
      splunk_failed: 2,
      notify_channels: [{ name: 'Guardia por correo', type: 'email', sent: 3, failed: 0, dropped: 0, filtered: 9 }],
    })
    expect(rows.map((r) => [r.key, r.health])).toEqual([
      ['webhook', 'ok'],
      ['elastic', 'quiet'],
      ['splunk', 'warn'],
      ['email:Guardia por correo', 'ok'],
    ])
    expect(rows[3]).toMatchObject({ kind: 'channel', filtered: 9 })
    expect(outputRows(null)).toEqual([])
  })
})

describe('host groups', () => {
  test('each pattern list takes its machines; the rest are ungrouped', () => {
    const { perGroup, ungrouped } = previewGroups([['SRV-*'], ['ws-0??', 'LAB-WKS-01']], ['WS-014', 'SRV-DC01', 'LAB-WKS-01', 'DESKTOP-1', 'WS-014'])
    expect(perGroup).toEqual([['SRV-DC01'], ['LAB-WKS-01', 'WS-014']])
    expect(ungrouped).toEqual(['DESKTOP-1'])
  })
})

describe('console audit', () => {
  const e = (at: string, user: string, outcome: ConsoleAuditEntry['outcome']): ConsoleAuditEntry => ({ at, user, role: 'admin', mode: 'users', method: 'POST', path: '/api/x', status: 200, outcome })
  const ENTRIES = [e('2026-11-17T10:00:00Z', 'ana', 'ok'), e('2026-11-17T11:00:00Z', 'luis', 'denied'), e('2026-11-17T09:00:00Z', 'ana', 'error'), e('2026-11-17T08:00:00Z', '', 'denied')]
  test('filters by account and outcome, newest first; accounts and counts', () => {
    expect(filterConsoleAudit(ENTRIES, '', 'all').map((x) => x.at.slice(11, 13))).toEqual(['11', '10', '09', '08'])
    expect(filterConsoleAudit(ENTRIES, 'ana', 'all').length).toBe(2)
    expect(filterConsoleAudit(ENTRIES, '', 'denied').map((x) => x.user)).toEqual(['luis', ''])
    expect(auditUsers(ENTRIES)).toEqual(['ana', 'luis'])
    expect(auditCounts(ENTRIES)).toEqual({ all: 4, ok: 1, error: 1, denied: 2 })
  })
})

describe('the map of areas', () => {
  const base: AreaInputs = {
    me: { mode: 'token', pending: false },
    stats: { ingest_rejected: 0, ingest_identity_violations: 0 },
    enroll: { enabled: true },
    groups: { writable: true, ungrouped: 0 },
    ad: 'off',
    notify: { channels: 2, failed: 0 },
    outputs: [],
    audit: false,
    firstRunDone: true,
  }
  test('each area says its state and where it is changed', () => {
    const s = areaStates(base)
    expect(s.cuentas).toEqual({ state: 'info', where: 'startup' })
    expect(s.directorio.state).toBe('off')
    expect(s.avisos.state).toBe('ok')
    expect(s.grupos).toEqual({ state: 'ok', where: 'console' })
    expect(s.ingesta).toEqual({ state: 'ok', where: 'flags' })
    expect(s.integraciones.state).toBe('info')
    expect(s.auditoria).toEqual({ state: 'disabled', where: 'startup' })
  })
  test('a failed read is unknown, never «not armed»', () => {
    const s = areaStates({ ...base, groups: 'unknown', ad: 'unknown', notify: 'off' })
    expect(s.grupos).toEqual({ state: 'unknown', where: 'flags' })
    expect(s.directorio.state).toBe('unknown')
    expect(s.avisos.state).toBe('off')
  })
  test('no access is its own state', () => {
    const s = areaStates({ ...base, me: { ...base.me, scope: ['servidores'] }, ad: 'restricted', notify: 'restricted' })
    expect(s.directorio.state).toBe('restricted')
    expect(s.avisos.state).toBe('restricted')
    expect(s['puesta-en-marcha'].state).toBe('restricted')
  })
  test('problems turn into review; unknowns stay loading', () => {
    const s = areaStates({
      ...base,
      me: { mode: 'users', pending: false, mfa: { enrolled: false, required: true, recovery_left: 0 } },
      stats: { ingest_rejected: 3, ingest_identity_violations: 0 },
      groups: { writable: false, ungrouped: 2 },
      notify: { channels: 1, failed: 4 },
      ad: null,
      firstRunDone: false,
    })
    expect(s['mi-cuenta'].state).toBe('review')
    expect(s.ingesta.state).toBe('review')
    expect(s.grupos).toEqual({ state: 'review', where: 'flags' })
    expect(s.avisos.state).toBe('review')
    expect(s.directorio.state).toBe('loading')
    expect(areaStates({ ...base, ad: { failing: true } }).directorio.state).toBe('review')
    expect(areaStates({ ...base, ad: { failing: false } }).directorio.state).toBe('ok')
    const quietChannel = { key: 'ntfy:m', label: 'm', kind: 'channel' as const, sent: 0, failed: 0, dropped: 0, filtered: 0, health: 'quiet' as const }
    expect(areaStates({ ...base, outputs: [quietChannel] }).integraciones.state).toBe('ok')
    expect(s['puesta-en-marcha'].state).toBe('review')
  })
  test('tabs and links', () => {
    expect(settingsTabFromParam('avisos')).toBe('avisos')
    expect(settingsTabFromParam('x')).toBe('mapa')
    expect(v2SettingsLink('mapa')).toBe('/v2/ajustes')
    expect(v2SettingsLink('grupos')).toBe('/v2/ajustes?vista=grupos')
  })
})
