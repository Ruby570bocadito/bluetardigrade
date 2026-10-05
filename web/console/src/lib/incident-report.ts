// Incident report export: one incident as a Markdown file (for a
// ticket or a wiki) or a self-contained printable HTML page (for a PDF
// via the browser's print dialog), with the case alerts, the timeline,
// the ATT&CK techniques and the entity graph drawn as static SVG.
//
// Built only from what the console holds: the incident as the engine
// stores it and the case alerts still in the live window. Alerts that
// left the window are counted, not invented. Nothing here writes to the
// engine.

import type { Severity, SfAlert } from './console-types'
import { layoutGraph, type EntityGraph, type NodeKind } from './entity-graph'
import { INCIDENT_STATUS_LABEL, type Incident } from './engine-writes'
import { EVIDENCE_KIND_LABEL, playbookTemplate, progressOf, type IncidentPlaybookState } from './incident-playbook'

const SEVERITY_TEXT: Record<Severity, string> = { critical: 'Crítica', high: 'Alta', medium: 'Media', low: 'Baja', info: 'Info' }
const KIND_TEXT: Record<NodeKind, string> = { host: 'Equipo', user: 'Usuario', rule: 'Regla', process: 'Proceso', destination: 'Destino' }

// Bidi controls can make text read differently than it is stored
// (Trojan Source); they are shown escaped in every export.
function visible(text: string): string {
  return text.replace(/[؜‎‏‪-‮⁦-⁩]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
}

// Markdown escaping runs first, so the "\u202e" that visible() writes
// is not escaped again (a backslash before a letter is literal text).
function mdCell(text: string): string {
  return visible(text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').replace(/[`*_[\]<>]/g, (c) => '\\' + c))
}

function mdText(text: string): string {
  return visible(text.replace(/[\\`*_[\]<>#]/g, (c) => '\\' + c))
}

function utc(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

// techniques collects ATT&CK technique tags (attack.t1059.001 -> T1059.001).
export function techniques(alerts: readonly SfAlert[]): string[] {
  const out = new Set<string>()
  for (const a of alerts) {
    for (const tag of a.tags ?? []) {
      const m = /^attack\.(t\d{4}(?:\.\d{3})?)$/i.exec(tag.trim())
      if (m) out.add(m[1].toUpperCase())
    }
  }
  return [...out].sort()
}

export type IncidentReportInput = {
  incident: Incident
  /** case alerts still in the console's window */
  alerts: readonly SfAlert[]
  graph?: EntityGraph
  /** analyst's response playbook (IDEA-3), when the case carries one */
  playbook?: IncidentPlaybookState
  now?: Date
}

// The playbook section carries exactly what the analyst registered: the
// checklist against the product template, the collected evidence and
// the reconstructed chronology. A playbook without a resolvable
// template cannot come from the UI, so it renders nothing.
function playbookMarkdown(playbook: IncidentPlaybookState): string[] {
  const template = playbookTemplate(playbook.templateId)
  if (!template) return []
  const { done, total } = progressOf(playbook, template)
  const lines: string[] = []
  lines.push(`## Plan de respuesta: ${mdText(template.name)}`, '')
  lines.push(`_${done} de ${total} pasos completados · plan aplicado ${utc(playbook.appliedAt)}._`, '')
  lines.push('| # | Paso | ATT&CK | Estado |', '| --- | --- | --- | --- |')
  template.items.forEach((item, i) => {
    lines.push(`| ${i + 1} | ${mdCell(item.text)} | ${item.attack ?? '—'} | ${playbook.checks[item.id]?.done ? 'Hecho' : 'Pendiente'} |`)
  })
  lines.push('')
  lines.push('### Evidencias', '')
  if (playbook.evidence.length) {
    lines.push('| Tipo | Evidencia | Detalle | Recogida |', '| --- | --- | --- | --- |')
    for (const e of playbook.evidence) {
      lines.push(`| ${mdCell(EVIDENCE_KIND_LABEL[e.kind])} | ${mdCell(e.label)} | ${e.detail ? mdCell(e.detail) : '—'} | ${utc(e.at)} |`)
    }
    lines.push('')
  } else {
    lines.push('_Sin evidencias registradas._', '')
  }
  lines.push('### Cronología del analista', '')
  const chrono = [...playbook.chronology].sort((a, b) => a.at.localeCompare(b.at))
  if (chrono.length) {
    for (const c of chrono) lines.push(`- **${utc(c.at)}**: ${mdText(c.text)}`)
    lines.push('')
  } else {
    lines.push('_Sin hitos registrados._', '')
  }
  lines.push('_El plan de respuesta vive en la consola del analista (este navegador), no en el motor._', '')
  return lines
}

function caseAlerts(input: IncidentReportInput): SfAlert[] {
  const ids = new Set(input.incident.alert_ids)
  return input.alerts
    .filter((a) => a.id && ids.has(a.id))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

export function reportFilename(incident: Incident, ext: 'md' | 'html'): string {
  return `incidente-${incident.id}.${ext}`
}

export function buildIncidentMarkdown(input: IncidentReportInput): string {
  const { incident } = input
  const now = input.now ?? new Date()
  const alerts = caseAlerts(input)
  const missing = incident.alert_ids.length - alerts.length
  const lines: string[] = []
  lines.push(`# Informe de incidente: ${mdText(incident.title)}`, '')
  lines.push('| Campo | Valor |', '| --- | --- |')
  lines.push(`| Identificador | ${mdCell(incident.id)} |`)
  lines.push(`| Severidad | ${SEVERITY_TEXT[incident.severity] ?? incident.severity} |`)
  lines.push(`| Estado | ${INCIDENT_STATUS_LABEL[incident.status] ?? incident.status} |`)
  lines.push(`| Responsable | ${mdCell(incident.owner || 'sin asignar')} |`)
  lines.push(`| Abierto | ${utc(incident.created_at)} |`)
  lines.push(`| Última actualización | ${utc(incident.updated_at)} |`)
  if (incident.closed_at) lines.push(`| Cerrado | ${utc(incident.closed_at)} |`)
  lines.push(`| Equipos | ${incident.hosts.length ? incident.hosts.map(mdCell).join(', ') : '—'} |`)
  lines.push('')
  lines.push('## Resumen', '', incident.summary ? mdText(incident.summary) : '_Sin resumen._', '')
  const tech = techniques(alerts)
  if (tech.length) {
    lines.push('## Técnicas ATT&CK', '', tech.map((t) => `- ${t}`).join('\n'), '')
  }
  lines.push(`## Alertas del caso (${incident.alert_ids.length})`, '')
  if (alerts.length) {
    lines.push('| Hora | Severidad | Regla | Equipo | Usuario | Resumen |', '| --- | --- | --- | --- | --- | --- |')
    for (const a of alerts) {
      lines.push(`| ${utc(a.timestamp)} | ${SEVERITY_TEXT[a.severity] ?? a.severity} | ${mdCell(a.rule_name)} | ${mdCell(a.host)} | ${mdCell(a.user ?? '—')} | ${mdCell(a.summary)} |`)
    }
    lines.push('')
  }
  if (missing > 0) {
    lines.push(`_${missing} ${missing === 1 ? 'alerta ya no estaba' : 'alertas ya no estaban'} en la ventana en vivo de la consola al generar el informe; consúltalas en el histórico del motor._`, '')
  }
  if (!alerts.length && missing === 0) lines.push('_Sin alertas asociadas._', '')
  lines.push('## Línea de tiempo', '')
  for (const e of incident.timeline) {
    lines.push(`- **${utc(e.at)}**${e.by ? ` · ${mdText(e.by)}` : ''}: ${mdText(e.text)}`)
  }
  if (!incident.timeline.length) lines.push('_Sin entradas._')
  lines.push('')
  if (input.playbook) lines.push(...playbookMarkdown(input.playbook))
  if (input.graph && input.graph.nodes.length > 1) {
    lines.push('## Entidades relacionadas', '')
    const byKind = new Map<NodeKind, string[]>()
    for (const n of input.graph.nodes) byKind.set(n.kind, [...(byKind.get(n.kind) ?? []), n.label])
    for (const [kind, labels] of byKind) lines.push(`- ${KIND_TEXT[kind]}: ${labels.map(mdText).join(', ')}`)
    lines.push('')
  }
  lines.push('---', '', `Generado por la consola de bluetardigrade el ${utc(now.toISOString())}. El informe no cambia el incidente ni ejecuta ninguna respuesta.`, '')
  return lines.join('\n')
}

function esc(text: string): string {
  return visible(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

const NODE_COLOR: Record<NodeKind, string> = { host: '#3f3f46', user: '#0f766e', rule: '#b45309', process: '#4338ca', destination: '#be123c' }

// graphSvg draws the entity graph as a static, print-friendly SVG with
// the same deterministic layout the console uses.
export function graphSvg(graph: EntityGraph, width = 720, maxHeight = 380): string {
  if (graph.nodes.length < 2) return ''
  // a handful of nodes lays out in a band: no empty half page in print
  const height = graph.nodes.length <= 6 ? 240 : maxHeight
  const pos = layoutGraph(graph, width, height)
  const maxW = Math.max(1, ...graph.nodes.map((n) => n.weight))
  const parts: string[] = []
  for (const e of graph.edges) {
    const a = pos.get(e.source)
    const b = pos.get(e.target)
    if (!a || !b) continue
    parts.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${e.hot ? '#be123c' : '#a1a1aa'}" stroke-width="${e.hot ? 2 : 1.25}" stroke-opacity="0.8"/>`)
  }
  for (const n of graph.nodes) {
    const p = pos.get(n.id)
    if (!p) continue
    const r = 6 + 8 * Math.sqrt(n.weight / maxW)
    const label = n.label.length > 28 ? n.label.slice(0, 27) + '…' : n.label
    parts.push(`<g><title>${esc(KIND_TEXT[n.kind] + ': ' + n.label)}</title><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${NODE_COLOR[n.kind]}" stroke="#ffffff" stroke-width="2"/><text x="${p.x.toFixed(1)}" y="${(p.y + r + 11).toFixed(1)}" text-anchor="middle" font-size="10" fill="#27272a">${esc(label)}</text></g>`)
  }
  const kinds = [...new Set(graph.nodes.map((n) => n.kind))]
  const legend = kinds
    .map((k, i) => `<g transform="translate(${12 + i * 96},${height - 14})"><circle r="5" cx="5" cy="-4" fill="${NODE_COLOR[k]}"/><text x="14" y="0" font-size="10" fill="#52525b">${KIND_TEXT[k]}</text></g>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Grafo del incidente: ${graph.nodes.length} entidades">${parts.join('')}${legend}</svg>`
}

function playbookHtml(playbook: IncidentPlaybookState): string {
  const template = playbookTemplate(playbook.templateId)
  if (!template) return ''
  const { done, total } = progressOf(playbook, template)
  const steps = template.items
    .map((item, i) => {
      const isDone = Boolean(playbook.checks[item.id]?.done)
      return `<tr><td class="num">${i + 1}</td><td>${esc(item.text)}</td><td>${item.attack ? `<code>${item.attack}</code>` : '<span class="muted">—</span>'}</td><td>${isDone ? '<span class="ok">Hecho</span>' : '<span class="muted">Pendiente</span>'}</td></tr>`
    })
    .join('')
  const evidence = playbook.evidence.length
    ? `<table><thead><tr><th>Tipo</th><th>Evidencia</th><th>Detalle</th><th>Recogida</th></tr></thead><tbody>${playbook.evidence
        .map((e) => `<tr><td>${esc(EVIDENCE_KIND_LABEL[e.kind])}</td><td>${esc(e.label)}</td><td>${e.detail ? esc(e.detail).replace(/\r?\n/g, '<br>') : '<span class="muted">—</span>'}</td><td class="nowrap">${utc(e.at)}</td></tr>`)
        .join('')}</tbody></table>`
    : '<p class="muted">Sin evidencias registradas.</p>'
  const chrono = [...playbook.chronology].sort((a, b) => a.at.localeCompare(b.at))
  const chronology = chrono.length
    ? `<ol class="timeline">${chrono.map((c) => `<li><span class="when">${utc(c.at)}</span><span>${esc(c.text)}</span></li>`).join('')}</ol>`
    : '<p class="muted">Sin hitos registrados.</p>'
  return `<h2>Plan de respuesta: ${esc(template.name)}</h2>
<p class="muted">${done} de ${total} pasos completados · plan aplicado el ${utc(playbook.appliedAt)}</p>
<table class="checklist"><thead><tr><th class="num">#</th><th>Paso</th><th>ATT&amp;CK</th><th>Estado</th></tr></thead><tbody>${steps}</tbody></table>
<h3>Evidencias</h3>
${evidence}
<h3>Cronología del analista</h3>
${chronology}
<p class="muted plan-note">El plan de respuesta vive en la consola del analista (este navegador), no en el motor.</p>`
}

export function buildIncidentHtml(input: IncidentReportInput): string {
  const { incident } = input
  const now = input.now ?? new Date()
  const alerts = caseAlerts(input)
  const missing = incident.alert_ids.length - alerts.length
  const tech = techniques(alerts)
  const svg = input.graph ? graphSvg(input.graph) : ''
  const row = (k: string, v: string) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`
  const meta = [
    row('Identificador', `<code>${esc(incident.id)}</code>`),
    row('Severidad', `<span class="sev sev-${incident.severity}">${SEVERITY_TEXT[incident.severity] ?? esc(incident.severity)}</span>`),
    row('Estado', esc(INCIDENT_STATUS_LABEL[incident.status] ?? incident.status)),
    row('Responsable', esc(incident.owner || 'sin asignar')),
    row('Abierto', utc(incident.created_at)),
    row('Última actualización', utc(incident.updated_at)),
    incident.closed_at ? row('Cerrado', utc(incident.closed_at)) : '',
    row('Equipos', incident.hosts.length ? incident.hosts.map((h) => `<code>${esc(h)}</code>`).join(', ') : '—'),
  ].join('')
  const alertRows = alerts
    .map((a) => `<tr><td class="nowrap">${utc(a.timestamp)}</td><td><span class="sev sev-${a.severity}">${SEVERITY_TEXT[a.severity] ?? esc(a.severity)}</span></td><td>${esc(a.rule_name)}</td><td><code>${esc(a.host)}</code></td><td>${esc(a.user ?? '—')}</td><td>${esc(a.summary)}</td></tr>`)
    .join('')
  const timeline = incident.timeline
    .map((e) => `<li><span class="when">${utc(e.at)}${e.by ? ` · ${esc(e.by)}` : ''}</span><span class="${e.kind === 'note' ? 'note' : ''}">${esc(e.text)}</span></li>`)
    .join('')
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Incidente ${esc(incident.id)}: ${esc(incident.title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #ffffff; color: #18181b; font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 900px; margin: 0 auto; padding: 32px 16px 48px; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-size: 15px; margin: 28px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e4e4e7; }
  .sub { color: #71717a; margin: 0 0 20px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; vertical-align: top; padding: 6px 8px; border-bottom: 1px solid #f4f4f5; }
  thead th { color: #52525b; font-weight: 600; border-bottom: 1px solid #e4e4e7; }
  table.meta th { width: 180px; color: #52525b; font-weight: 500; }
  code { font: 12px ui-monospace, "Cascadia Mono", Consolas, monospace; background: #f4f4f5; padding: 1px 4px; border-radius: 4px; }
  .nowrap { white-space: nowrap; }
  .sev { display: inline-block; padding: 0 6px; border-radius: 4px; font-size: 11px; font-weight: 600; border: 1px solid; }
  .sev-critical { color: #9f1239; border-color: #fda4af; background: #fff1f2; }
  .sev-high { color: #9a3412; border-color: #fdba74; background: #fff7ed; }
  .sev-medium { color: #854d0e; border-color: #fde047; background: #fefce8; }
  .sev-low { color: #3f3f46; border-color: #d4d4d8; background: #fafafa; }
  .sev-info { color: #52525b; border-color: #e4e4e7; background: #ffffff; }
  .summary { white-space: pre-wrap; }
  ul.tech { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; padding: 0; margin: 0; }
  ul.tech li { border: 1px solid #e4e4e7; border-radius: 4px; padding: 1px 6px; font: 12px ui-monospace, Consolas, monospace; }
  ol.timeline { list-style: none; padding: 0; margin: 0; border-left: 2px solid #e4e4e7; }
  ol.timeline li { padding: 0 0 10px 12px; }
  ol.timeline .when { display: block; color: #71717a; font-size: 11px; }
  ol.timeline .note { white-space: pre-wrap; }
  .graph { border: 1px solid #e4e4e7; border-radius: 8px; padding: 8px; }
  .muted { color: #71717a; }
  table.checklist td.num, table.checklist th.num { width: 2em; color: #71717a; }
  .ok { color: #166534; font-weight: 600; }
  h3 { font-size: 13px; margin: 18px 0 6px; }
  .plan-note { font-size: 11px; }
  footer { margin-top: 36px; color: #a1a1aa; font-size: 11px; }
  .print { position: fixed; top: 16px; right: 16px; font: inherit; padding: 6px 12px; border: 1px solid #d4d4d8; border-radius: 6px; background: #fafafa; cursor: pointer; }
  @media (max-width: 640px) { table.cases { display: block; overflow-x: auto; } .print { position: static; margin-bottom: 12px; } }
  @media print { .print { display: none; } main { padding: 0; } h2 { break-after: avoid; } tr, li, .graph { break-inside: avoid; } }
</style>
</head>
<body>
<main>
<button class="print" type="button" onclick="window.print()">Imprimir / guardar PDF</button>
<h1>${esc(incident.title)}</h1>
<p class="sub">Informe de incidente · generado el ${utc(now.toISOString())}</p>
<table class="meta"><tbody>${meta}</tbody></table>
<h2>Resumen</h2>
${incident.summary ? `<p class="summary">${esc(incident.summary)}</p>` : '<p class="muted">Sin resumen.</p>'}
${tech.length ? `<h2>Técnicas ATT&amp;CK</h2><ul class="tech">${tech.map((t) => `<li>${t}</li>`).join('')}</ul>` : ''}
<h2>Alertas del caso (${incident.alert_ids.length})</h2>
${alerts.length ? `<table class="cases"><thead><tr><th>Hora</th><th>Severidad</th><th>Regla</th><th>Equipo</th><th>Usuario</th><th>Resumen</th></tr></thead><tbody>${alertRows}</tbody></table>` : ''}
${missing > 0 ? `<p class="muted">${missing} ${missing === 1 ? 'alerta ya no estaba' : 'alertas ya no estaban'} en la ventana en vivo de la consola al generar el informe; consúltalas en el histórico del motor.</p>` : ''}
${!alerts.length && missing === 0 ? '<p class="muted">Sin alertas asociadas.</p>' : ''}
${svg ? `<h2>Grafo del incidente</h2><div class="graph">${svg}</div>` : ''}
<h2>Línea de tiempo</h2>
${timeline ? `<ol class="timeline">${timeline}</ol>` : '<p class="muted">Sin entradas.</p>'}
${input.playbook ? playbookHtml(input.playbook) : ''}
<footer>Generado por la consola de bluetardigrade. El informe no cambia el incidente ni ejecuta ninguna respuesta.</footer>
</main>
</body>
</html>
`
}
