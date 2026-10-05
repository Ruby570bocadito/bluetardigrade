import { expect, test } from 'bun:test'
import type { SfAlert } from './console-types'
import { buildEntityGraph } from './entity-graph'
import type { Incident } from './engine-writes'
import { buildIncidentHtml, buildIncidentMarkdown, graphSvg, reportFilename, techniques } from './incident-report'
import { PLAYBOOK_TEMPLATES, addChronology, addEvidence, applyPlaybook, toggleCheck, type IncidentPlaybookState } from './incident-playbook'

const ransomware = PLAYBOOK_TEMPLATES.find((t) => t.id === 'ransomware')!

const alert = (id: string, over: Partial<SfAlert> = {}): SfAlert => ({
  id,
  timestamp: '2026-10-04T10:00:00Z',
  rule_id: 'r1',
  rule_name: 'Volcado de LSASS',
  severity: 'critical',
  host: 'PC-CONTA',
  user: 'CORP\\ana',
  event_id: 'e-' + id,
  event_type: 'process.create',
  summary: 'rundll32 comsvcs.dll MiniDump',
  matched_on: ['process.command_line'],
  tags: ['attack.credential-access', 'attack.t1003.001'],
  ...over,
})

const incident: Incident = {
  id: '0123456789abcdef',
  title: 'Robo de credenciales en contabilidad',
  summary: 'Volcado de LSASS y movimiento a SRV-FILES.',
  severity: 'critical',
  status: 'investigating',
  owner: 'ana',
  hosts: ['PC-CONTA', 'SRV-FILES'],
  alert_ids: ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'cccccccccccccccc'],
  timeline: [
    { at: '2026-10-04T10:05:00Z', by: 'ana', kind: 'created', text: 'Incidente creado' },
    { at: '2026-10-04T10:20:00Z', by: 'ana', kind: 'note', text: 'Aislado el equipo <PC-CONTA> | revisar' },
  ],
  created_at: '2026-10-04T10:05:00Z',
  updated_at: '2026-10-04T10:20:00Z',
}

const alerts = [
  alert('bbbbbbbbbbbbbbbb', { timestamp: '2026-10-04T10:03:00Z', host: 'SRV-FILES', rule_name: 'PsExec remoto', tags: ['attack.t1021.002', 'attack.lateral-movement'] }),
  alert('aaaaaaaaaaaaaaaa'),
  alert('dddddddddddddddd', { rule_name: 'Otra alerta fuera del caso' }),
]

test('techniques are collected from attack.tNNNN tags', () => {
  expect(techniques(alerts.slice(0, 2))).toEqual(['T1003.001', 'T1021.002'])
  expect(techniques([alert('x', { tags: ['attack.execution', 'intel'] })])).toEqual([])
})

test('the Markdown report lists the case, escapes table cells and counts missing alerts', () => {
  const md = buildIncidentMarkdown({ incident, alerts, now: new Date('2026-10-04T12:00:00Z') })
  expect(md).toStartWith('# Informe de incidente: Robo de credenciales en contabilidad')
  expect(md).toContain('| Estado | Investigando |')
  expect(md).toContain('- T1003.001')
  // chronological, only case alerts
  expect(md.indexOf('| Volcado de LSASS |')).toBeLessThan(md.indexOf('| PsExec remoto |'))
  expect(md).not.toContain('Otra alerta fuera del caso')
  expect(md).toContain('CORP\\\\ana')
  expect(md).toContain('1 alerta ya no estaba en la ventana en vivo')
  expect(md).toContain('Aislado el equipo \\<PC-CONTA\\> | revisar')
  expect(md).toContain('2026-10-04 12:00:00 UTC')
  expect(reportFilename(incident, 'md')).toBe('incidente-0123456789abcdef.md')
})

test('the HTML report escapes everything and embeds the graph', () => {
  const graph = buildEntityGraph(alerts.slice(0, 2), [])
  const html = buildIncidentHtml({ incident: { ...incident, title: 'x <script>alert(1)</script>' }, alerts, graph })
  expect(html).toStartWith('<!doctype html>')
  expect(html).not.toContain('<script>')
  expect(html).toContain('x &lt;script&gt;alert(1)&lt;/script&gt;')
  expect(html).toContain('Aislado el equipo &lt;PC-CONTA&gt; | revisar')
  expect(html).toContain('<svg')
  expect(html).toContain('Grafo del incidente')
  expect(html).toContain('<li>T1021.002</li>')
  expect(html).toContain('@media print')
})

test('bidi controls are shown escaped', () => {
  const md = buildIncidentMarkdown({ incident: { ...incident, title: 'abc‮def' }, alerts: [] })
  expect(md).toContain('abc\\u202edef')
  expect(buildIncidentHtml({ incident: { ...incident, summary: 'a⁦b' }, alerts: [] })).toContain('a\\u2066b')
})

test('a graph with a single node draws nothing', () => {
  expect(graphSvg({ nodes: [{ id: 'h', kind: 'host', label: 'PC', weight: 1 }], edges: [], folded: 0 })).toBe('')
})

test('the playbook renders in Markdown only when provided', () => {
  const without = buildIncidentMarkdown({ incident, alerts, now: new Date('2026-10-04T12:00:00Z') })
  expect(without).not.toContain('Plan de respuesta')
  let state = applyPlaybook(incident.id, 'ransomware', '2026-10-04T11:00:00Z')
  state = toggleCheck(state, ransomware, 'aislar', '2026-10-04T11:10:00Z')
  state = addEvidence(state, { kind: 'hash', label: 'SHA-256 | cifrador', detail: 'abc', at: '2026-10-04T11:15:00Z' })
  state = addChronology(state, { at: '2026-10-04T10:58:00Z', text: 'Primer cifrado observado' }, '2026-10-04T11:20:00Z')
  const md = buildIncidentMarkdown({ incident, alerts, graph: buildEntityGraph(alerts.slice(0, 2), []), playbook: state, now: new Date('2026-10-04T12:00:00Z') })
  expect(md).toContain('## Plan de respuesta: Ransomware')
  expect(md).toContain('1 de 11 pasos completados')
  expect(md).toContain('| 2 | A\u00edsla de la red')
  expect(md).toContain('| SHA-256 \\| cifrador | abc |')
  expect(md).toContain('- **2026-10-04 10:58:00 UTC**: Primer cifrado observado')
  // the plan section sits after the engine timeline and before the graph
  expect(md.indexOf('## Plan de respuesta')).toBeGreaterThan(md.indexOf('## Línea de tiempo'))
  expect(md.indexOf('## Plan de respuesta')).toBeLessThan(md.indexOf('## Entidades relacionadas'))
})

test('the playbook renders in the printable HTML with progress and honest provenance', () => {
  let state = applyPlaybook(incident.id, 'phishing', '2026-10-04T11:00:00Z')
  state = toggleCheck(state, PLAYBOOK_TEMPLATES.find((t) => t.id === 'phishing')!, 'mensaje', '2026-10-04T11:10:00Z')
  const html = buildIncidentHtml({ incident, alerts, playbook: state })
  expect(html).toContain('Plan de respuesta: Phishing')
  expect(html).toContain('1 de 10 pasos completados')
  expect(html).toContain('<span class="ok">Hecho</span>')
  expect(html).toContain('<span class="muted">Pendiente</span>')
  expect(html).toContain('El plan de respuesta vive en la consola del analista')
  // without a playbook the section never appears
  expect(buildIncidentHtml({ incident, alerts })).not.toContain('Plan de respuesta')
})
