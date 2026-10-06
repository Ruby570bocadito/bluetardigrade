import { expect, test } from 'bun:test'
import { buildReportExport, deleteReport, MAX_REPORTS, newReport, readReports, REPORT_KEY, saveReport } from './soc-report'
import type { SfAlert } from './console-types'

function storage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}
const alert: SfAlert = { id: '0123456789abcdef', timestamp: '2026-10-02T10:00:00Z', rule_id: 'soc-ids-priority-high', rule_name: 'IDS', severity: 'high', host: 'LAB', event_id: 'source-event', event_type: 'network.alert', source: 'suricata', attributes: { ids_signature: '```\n# source heading\n```', ids_action: 'allowed', ids_verdict: 'drop', original: 'raw\u202e' }, network: { source_ip: '10.0.0.1', destination_ip: '8.8.8.8', destination_port: 443 }, summary: 'Observed signal', matched_on: [], status: 'new' }
const now = () => new Date('2026-10-02T10:00:00.000Z')

test('report draft defaults to pending and freezes a separate alert snapshot', () => {
  const input = structuredClone(alert); const report = newReport(input, now())
  input.attributes!.ids_verdict = 'pass'; input.status = 'closed'
  expect(report.fields.decision).toBe('pending'); expect(report.fields.actions).toBe(''); expect(report.alert.status).toBe('new'); expect(report.alert.attributes!.ids_verdict).toBe('drop')
})
test('saved reports round-trip source evidence and human classification separately', () => {
  const store = storage(); const draft = newReport(alert, now()); draft.fields.findings = 'Reviewed'; draft.fields.decision = 'false_positive'
  const saved = saveReport(store, draft, 0, now()); const read = readReports(store)[0]
  expect(read).toEqual(saved); expect(saved.revision).toBe(1); expect(read.alert.status).toBe('new')
  const exported = JSON.parse(buildReportExport(read, 'json').contents)
  expect(exported.alert.attributes.original).toBe('raw\u202e'); expect(exported.fields.findings).toBe('Reviewed')
})
test('updates preserve original evidence and detect stale revisions from other tabs', () => {
  const store = storage(); const saved = saveReport(store, newReport(alert, now()), 0, now())
  const edited = { ...saved, alert: { ...saved.alert, status: 'closed' as const } }; edited.fields = { ...saved.fields, findings: 'Human text' }
  const newer = saveReport(store, edited, 1, new Date('2026-10-02T10:01:00.000Z'))
  expect(newer.alert.status).toBe('new'); expect(newer.revision).toBe(2)
  expect(() => saveReport(store, saved, 1, now())).toThrow(/otra pestaña/)
  expect(() => deleteReport(store, saved.alert_id, 1)).toThrow(/cambió/)
})
test('capacity does not silently evict old incident reports', () => {
  const store = storage()
  for (let i = 0; i < MAX_REPORTS; i++) saveReport(store, newReport({ ...alert, id: i.toString(16).padStart(16, '0') }, now()), 0, now())
  expect(() => saveReport(store, newReport(alert, now()), 0, now())).toThrow(/hasta 10/)
  expect(readReports(store)).toHaveLength(MAX_REPORTS)
})
test('corrupt, duplicated and incompatible report stores are not overwritten', () => {
  for (const value of ['{broken', 'null', JSON.stringify({ version: 2, items: [] }), 'x'.repeat(2 * 1024 * 1024 + 1)]) {
    const store = storage(); store.setItem(REPORT_KEY, value)
    expect(() => saveReport(store, newReport(alert, now()), 0, now())).toThrow(); expect(store.getItem(REPORT_KEY)).toBe(value)
  }
})
test('storage quota errors propagate without pretending the draft was saved', () => {
  const store = { getItem: () => null, setItem: () => { throw new Error('quota') } }
  expect(() => saveReport(store, newReport(alert, now()), 0, now())).toThrow('quota')
})
test('human fields reject controls, overlong input and prototype decision names', () => {
  const store = storage()
  for (const invalid of [{ findings: '\u202e' }, { title: 'x'.repeat(201) }, { findings: 'x'.repeat(4001) }, { decision: 'constructor' }]) {
    const draft = newReport(alert, now()); Object.assign(draft.fields, invalid)
    expect(() => saveReport(store, draft, 0, now())).toThrow()
  }
})
test('Markdown fences cannot be closed by received evidence or human notes', () => {
  const draft = newReport(alert, now()); draft.fields.findings = '```\n# Human heading\n```'
  const file = buildReportExport(draft, 'md')
  expect(file.contents).toContain('````text\n```\n# Human heading\n```\n````')
  expect(file.contents).toContain('\\u202e'); expect(file.contents).toContain('Evidencia recibida')
})
test('report evidence identity cannot be replaced with another alert', () => {
  const store = storage(); const draft = newReport(alert, now()); draft.alert = { ...draft.alert, id: 'fedcba9876543210' }
  expect(() => saveReport(store, draft, 0, now())).toThrow(/corresponde/)
  expect(() => newReport({ ...alert, id: 'legacy-id' }, now())).toThrow(/ID/)
})
test('orphan report snapshots remain available and can free capacity offline', () => {
  const store = storage(); const saved = saveReport(store, newReport(alert, now()), 0, now())
  expect(buildReportExport(readReports(store)[0], 'json').contents).toContain('suricata')
  deleteReport(store, saved.alert_id, saved.revision); expect(readReports(store)).toEqual([])
})
test('saved reports reject changed draft identity even when old evidence exists', () => {
  const store = storage(); const saved = saveReport(store, newReport(alert, now()), 0, now())
  saved.alert = { ...saved.alert, id: 'fedcba9876543210' }
  expect(() => saveReport(store, saved, 1, now())).toThrow(/corresponde/)
  expect(readReports(store)[0].revision).toBe(1)
})
test('exports validate metadata and omit unknown envelope properties', () => {
  const draft = newReport(alert, now()); const file = buildReportExport(Object.assign(draft, { injected: 'unknown field' }), 'json')
  expect(JSON.parse(file.contents).injected).toBeUndefined()
  expect(JSON.parse(file.contents).revision).toBe(0)
  expect(() => buildReportExport({ ...draft, created_at: 'invalid date' }, 'md')).toThrow()
})

test('the SOC export follows the console language; ES stays byte-identical (ronda 12)', () => {
  const draft = newReport(alert, now())
  const es = buildReportExport({ ...draft, fields: { ...draft.fields, decision: 'false_positive' } }, 'md')
  expect(es.contents).toStartWith('# Informe SOC')
  expect(es.contents).toContain('## Clasificación humana')
  expect(es.contents).toContain('Falso positivo')
  expect(es.contents).toContain('## Evidencia recibida')
  const en = buildReportExport({ ...draft, fields: { ...draft.fields, decision: 'false_positive' } }, 'md', 'en')
  expect(en.contents).toStartWith('# SOC report')
  expect(en.contents).toContain('## Human classification')
  expect(en.contents).toContain('False positive')
  expect(en.contents).toContain('## Evidence received')
  expect(en.contents).toContain('The report does not change the alert state')
  // the default title follows the language; stored data afterwards
  expect(newReport(alert, now(), 'en').fields.title).toBe(`Alert investigation ${alert.id}`)
  expect(newReport(alert, now()).fields.title).toBe(`Investigación de alerta ${alert.id}`)
})
