import { expect, test } from 'bun:test'
import { mapAlert } from './engine-client'
import { eventDetail } from './console-types'
import { describeTelemetrySources } from './telemetry-source'

test('direct engine alerts preserve imported source, flow and info severity', () => {
  const mapped = mapAlert({ source: 'suricata', severity: 'info', attributes: { ids_verdict: 'drop', bad: {} }, network: { source_ip: '10.0.0.1', destination_port: 443, source_port: -1 }, enrichment: { owner: 'SOC' }, matched_on: [3, 'attributes.ids_verdict'], tags: [] })
  expect(mapped.source).toBe('suricata'); expect(mapped.severity).toBe('info'); expect(mapped.attributes).toEqual({ ids_verdict: 'drop' }); expect(mapped.network).toEqual({ source_ip: '10.0.0.1', destination_port: 443 }); expect(mapped.enrichment).toEqual({ owner: 'SOC' }); expect(mapped.matched_on).toEqual(['attributes.ids_verdict'])
})
test('SOC sources in a mixed window cannot hide demo telemetry or use inherited labels', () => {
  const label = describeTelemetrySources([{ source: 'suricata' }, { source: 'eml' }, { source: 'simulate' }, { source: 'constructor' }])
  expect(label.hasDemo).toBe(true); expect(label.label).toContain('Suricata'); expect(label.label).toContain('EML'); expect(label.label).toContain('otra/no declarada')
})
test('IDS and osquery summaries describe observations instead of fabricated executions', () => {
  expect(eventDetail({ id: 'x', timestamp: '', host: 'LAB', type: 'network.alert', source: 'suricata', attributes: { ids_signature: 'Observed', ids_action: 'allowed', ids_verdict: 'drop' } })).toContain('firma allowed · veredicto drop')
  expect(eventDetail({ id: 'x', timestamp: '', host: 'LAB', type: 'host.query', source: 'osquery', process: { pid: 1, name: 'sshd' }, attributes: { query_name: 'q', query_action: 'added' } })).toContain('osquery q · added')
})
