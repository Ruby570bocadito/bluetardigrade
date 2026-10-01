import { expect, test } from 'bun:test'
import { describeTelemetrySources } from './telemetry-source'

test('no received events do not imply a real sensor', () => {
  expect(describeTelemetrySources([])).toEqual({ label: 'sin eventos recibidos', hasDemo: false })
})
test('Sysmon is labeled as a declared source', () => {
  expect(describeTelemetrySources([{ source: 'sysmon' }])).toEqual({ label: 'fuentes declaradas: Sysmon', hasDemo: false })
})
test('ETW is labeled as a declared source', () => {
  expect(describeTelemetrySources([{ source: 'etw' }])).toEqual({ label: 'fuentes declaradas: ETW', hasDemo: false })
})
test('demo telemetry is explicitly identified', () => {
  expect(describeTelemetrySources([{ source: 'simulate' }])).toEqual({ label: 'fuentes declaradas: demo simulada', hasDemo: true })
})
test('a newest Sysmon event cannot hide older demo events in the received window', () => {
  expect(describeTelemetrySources([{ source: 'sysmon' }, { source: 'simulate' }, { source: 'etw' }])).toEqual({ label: 'fuentes declaradas: Sysmon + ETW + demo simulada', hasDemo: true })
})
test('unknown declarations are never promoted to a verified origin or echoed into the header', () => {
  expect(describeTelemetrySources([{ source: 'https://user:secret@example.test?token=test-only' }])).toEqual({ label: 'fuentes declaradas: otra/no declarada', hasDemo: false })
})
test('repeated source labels do not grow with the event count', () => {
  expect(describeTelemetrySources(Array.from({ length: 256 }, () => ({ source: 'sysmon' })))).toEqual(describeTelemetrySources([{ source: 'sysmon' }]))
})
