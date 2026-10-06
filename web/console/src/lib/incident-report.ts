// Incident report export: one incident as a Markdown file (for a
// ticket or a wiki) or a self-contained printable HTML page (for a PDF
// via the browser's print dialog), with the case alerts, the timeline,
// the ATT&CK techniques and the entity graph drawn as static SVG.
//
// Built only from what the console holds: the incident as the engine
// stores it and the case alerts still in the live window. Alerts that
// left the window are counted, not invented. Nothing here writes to the
// engine.
//
// Language (ronda 12 decision): the exported report follows the console
// language — the report is console-authored copy wrapped around engine
// data, and the operator's language is browser preference, never engine
// data (ronda 6 rule). `lang` rides in the input (default 'es', the
// product default and the no-JS outcome). Everything the engine stores
// (titles, summaries, notes, rule names, owners, timeline text) travels
// verbatim in both languages. Shared vocabulary (severities, incident
// statuses, evidence kinds) comes from the console dictionaries so the
// artifact can never drift from the views.

import type { Severity, SfAlert } from './console-types'
import { layoutGraph, type EntityGraph, type NodeKind } from './entity-graph'
import { INCIDENT_STATUS_LABEL, type Incident } from './engine-writes'
import { EVIDENCE_KIND_LABEL, playbookTemplate, progressOf, type IncidentPlaybookState } from './incident-playbook'
import { DICTS, type Lang } from './i18n'

// Entity-kind names exist only in the artifact (the graph component is
// another lane's file); ES entries are byte-identical to the pre-i18n
// export. ES copy for everything else keeps the byte-identical rule.
const REPORT_TEXT: Record<Lang, {
  filenamePrefix: string
  mdTitle: string
  field: string
  value: string
  id: string
  severity: string
  status: string
  owner: string
  unassigned: string
  opened: string
  lastUpdate: string
  closed: string
  hosts: string
  summary: string
  noSummary: string
  techniques: string
  caseAlerts: string
  colTime: string
  colSeverity: string
  colRule: string
  colHost: string
  colUser: string
  colSummary: string
  missing: (n: number) => string
  noAlerts: string
  timeline: string
  noEntries: string
  plan: string
  planProgress: (done: number, total: number, at: string) => string
  colStep: string
  colStatus: string
  done: string
  pending: string
  evidenceHeading: string
  colType: string
  colEvidence: string
  colDetail: string
  colCollected: string
  noEvidence: string
  chrono: string
  noMilestones: string
  planNote: string
  entities: string
  footer: (at: string) => string
  htmlSubtitle: string
  htmlTitleWord: string
  printButton: string
  graphHeading: string
  graphAria: (n: number) => string
  htmlFooter: string
  kindOf: Record<NodeKind, string>
}> = {
  es: {
    filenamePrefix: 'incidente',
    mdTitle: 'Informe de incidente',
    field: 'Campo',
    value: 'Valor',
    id: 'Identificador',
    severity: 'Severidad',
    status: 'Estado',
    owner: 'Responsable',
    unassigned: 'sin asignar',
    opened: 'Abierto',
    lastUpdate: 'Última actualización',
    closed: 'Cerrado',
    hosts: 'Equipos',
    summary: 'Resumen',
    noSummary: 'Sin resumen.',
    techniques: 'Técnicas ATT&CK',
    caseAlerts: 'Alertas del caso',
    colTime: 'Hora',
    colSeverity: 'Severidad',
    colRule: 'Regla',
    colHost: 'Equipo',
    colUser: 'Usuario',
    colSummary: 'Resumen',
    missing: (n) => n === 1
      ? '1 alerta ya no estaba en la ventana en vivo de la consola al generar el informe; consúltalas en el histórico del motor.'
      : `${n} alertas ya no estaban en la ventana en vivo de la consola al generar el informe; consúltalas en el histórico del motor.`,
    noAlerts: 'Sin alertas asociadas.',
    timeline: 'Línea de tiempo',
    noEntries: 'Sin entradas.',
    plan: 'Plan de respuesta',
    planProgress: (done, total, at) => `${done} de ${total} pasos completados · plan aplicado ${at}.`,
    colStep: 'Paso',
    colStatus: 'Estado',
    done: 'Hecho',
    pending: 'Pendiente',
    evidenceHeading: 'Evidencias',
    colType: 'Tipo',
    colEvidence: 'Evidencia',
    colDetail: 'Detalle',
    colCollected: 'Recogida',
    noEvidence: 'Sin evidencias registradas.',
    chrono: 'Cronología del analista',
    noMilestones: 'Sin hitos registrados.',
    planNote: 'El plan de respuesta vive en la consola del analista (este navegador), no en el motor.',
    entities: 'Entidades relacionadas',
    footer: (at) => `Generado por la consola de bluetardigrade el ${at}. El informe no cambia el incidente ni ejecuta ninguna respuesta.`,
    htmlSubtitle: 'Informe de incidente · generado el',
    htmlTitleWord: 'Incidente',
    printButton: 'Imprimir / guardar PDF',
    graphHeading: 'Grafo del incidente',
    graphAria: (n) => `Grafo del incidente: ${n} entidades`,
    htmlFooter: 'Generado por la consola de bluetardigrade. El informe no cambia el incidente ni ejecuta ninguna respuesta.',
    kindOf: { host: 'Equipo', user: 'Usuario', rule: 'Regla', process: 'Proceso', destination: 'Destino' },
  },
  en: {
    filenamePrefix: 'incident',
    mdTitle: 'Incident report',
    field: 'Field',
    value: 'Value',
    id: 'Identifier',
    severity: 'Severity',
    status: 'Status',
    owner: 'Owner',
    unassigned: 'unassigned',
    opened: 'Opened',
    lastUpdate: 'Last update',
    closed: 'Closed',
    hosts: 'Hosts',
    summary: 'Summary',
    noSummary: 'No summary.',
    techniques: 'ATT&CK techniques',
    caseAlerts: 'Case alerts',
    colTime: 'Time',
    colSeverity: 'Severity',
    colRule: 'Rule',
    colHost: 'Host',
    colUser: 'User',
    colSummary: 'Summary',
    missing: (n) => n === 1
      ? '1 alert was no longer in the console\'s live window when the report was generated; check it in the engine\'s history.'
      : `${n} alerts were no longer in the console's live window when the report was generated; check them in the engine's history.`,
    noAlerts: 'No associated alerts.',
    timeline: 'Timeline',
    noEntries: 'No entries.',
    plan: 'Response plan',
    planProgress: (done, total, at) => `${done} of ${total} steps completed · plan applied ${at}.`,
    colStep: 'Step',
    colStatus: 'Status',
    done: 'Done',
    pending: 'Pending',
    evidenceHeading: 'Evidence',
    colType: 'Type',
    colEvidence: 'Evidence',
    colDetail: 'Detail',
    colCollected: 'Collected',
    noEvidence: 'No evidence recorded.',
    chrono: 'Analyst chronology',
    noMilestones: 'No milestones recorded.',
    planNote: 'The response plan lives in the analyst\'s console (this browser), not in the engine.',
    entities: 'Related entities',
    footer: (at) => `Generated by the bluetardigrade console on ${at}. The report does not change the incident and does not run a response.`,
    htmlSubtitle: 'Incident report · generated on',
    htmlTitleWord: 'Incident',
    printButton: 'Print / save PDF',
    graphHeading: 'Incident graph',
    graphAria: (n) => `Incident graph: ${n} entities`,
    htmlFooter: 'Generated by the bluetardigrade console. The report does not change the incident and does not run a response.',
    kindOf: { host: 'Host', user: 'User', rule: 'Rule', process: 'Process', destination: 'Destination' },
  },
}

/** ES kept as the pre-i18n literal; EN twin follows the console language. */
function severityText(severity: Severity, lang: Lang): string {
  return DICTS[lang].alerts.sevLabels[severity] ?? severity
}

function statusText(status: Incident['status'], lang: Lang): string {
  const labels = DICTS[lang].incidents.statusLabels
  return (labels as Record<string, string>)[status] ?? INCIDENT_STATUS_LABEL[status] ?? status
}

function evidenceText(kind: keyof typeof EVIDENCE_KIND_LABEL, lang: Lang): string {
  const labels = DICTS[lang].playbook.evidenceKinds
  return (labels as Record<string, string>)[kind] ?? EVIDENCE_KIND_LABEL[kind]
}

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
  /** artifact language; the console language the operator chose (default es) */
  lang?: Lang
}

// The playbook section carries exactly what the analyst registered: the
// checklist against the product template, the collected evidence and
// the reconstructed chronology. A playbook without a resolvable
// template cannot come from the UI, so it renders nothing. Template
// names and step texts are analyst-facing product data and travel
// verbatim (ronda 6 rule: stored text is never translated).
function playbookMarkdown(playbook: IncidentPlaybookState, lang: Lang): string[] {
  const t = REPORT_TEXT[lang]
  const template = playbookTemplate(playbook.templateId)
  if (!template) return []
  const { done, total } = progressOf(playbook, template)
  const lines: string[] = []
  lines.push(`## ${t.plan}: ${mdText(template.name)}`, '')
  lines.push(`_${t.planProgress(done, total, utc(playbook.appliedAt))}_`, '')
  lines.push(`| # | ${t.colStep} | ATT&CK | ${t.colStatus} |`, '| --- | --- | --- | --- |')
  template.items.forEach((item, i) => {
    lines.push(`| ${i + 1} | ${mdCell(item.text)} | ${item.attack ?? '—'} | ${playbook.checks[item.id]?.done ? t.done : t.pending} |`)
  })
  lines.push('')
  lines.push(`### ${t.evidenceHeading}`, '')
  if (playbook.evidence.length) {
    lines.push(`| ${t.colType} | ${t.colEvidence} | ${t.colDetail} | ${t.colCollected} |`, '| --- | --- | --- | --- |')
    for (const e of playbook.evidence) {
      lines.push(`| ${mdCell(evidenceText(e.kind, lang))} | ${mdCell(e.label)} | ${e.detail ? mdCell(e.detail) : '—'} | ${utc(e.at)} |`)
    }
    lines.push('')
  } else {
    lines.push(`_${t.noEvidence}_`, '')
  }
  lines.push(`### ${t.chrono}`, '')
  const chrono = [...playbook.chronology].sort((a, b) => a.at.localeCompare(b.at))
  if (chrono.length) {
    for (const c of chrono) lines.push(`- **${utc(c.at)}**: ${mdText(c.text)}`)
    lines.push('')
  } else {
    lines.push(`_${t.noMilestones}_`, '')
  }
  lines.push(`_${t.planNote}_`, '')
  return lines
}

function caseAlerts(input: IncidentReportInput): SfAlert[] {
  const ids = new Set(input.incident.alert_ids)
  return input.alerts
    .filter((a) => a.id && ids.has(a.id))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

export function reportFilename(incident: Incident, ext: 'md' | 'html', lang: Lang = 'es'): string {
  return `${REPORT_TEXT[lang].filenamePrefix}-${incident.id}.${ext}`
}

export function buildIncidentMarkdown(input: IncidentReportInput): string {
  const lang = input.lang ?? 'es'
  const t = REPORT_TEXT[lang]
  const { incident } = input
  const now = input.now ?? new Date()
  const alerts = caseAlerts(input)
  const missing = incident.alert_ids.length - alerts.length
  const lines: string[] = []
  lines.push(`# ${t.mdTitle}: ${mdText(incident.title)}`, '')
  lines.push(`| ${t.field} | ${t.value} |`, '| --- | --- |')
  lines.push(`| ${t.id} | ${mdCell(incident.id)} |`)
  lines.push(`| ${t.severity} | ${severityText(incident.severity, lang) ?? incident.severity} |`)
  lines.push(`| ${t.status} | ${statusText(incident.status, lang) ?? incident.status} |`)
  lines.push(`| ${t.owner} | ${mdCell(incident.owner || t.unassigned)} |`)
  lines.push(`| ${t.opened} | ${utc(incident.created_at)} |`)
  lines.push(`| ${t.lastUpdate} | ${utc(incident.updated_at)} |`)
  if (incident.closed_at) lines.push(`| ${t.closed} | ${utc(incident.closed_at)} |`)
  lines.push(`| ${t.hosts} | ${incident.hosts.length ? incident.hosts.map(mdCell).join(', ') : '—'} |`)
  lines.push('')
  lines.push(`## ${t.summary}`, '', incident.summary ? mdText(incident.summary) : `_${t.noSummary}_`, '')
  const tech = techniques(alerts)
  if (tech.length) {
    lines.push(`## ${t.techniques}`, '', tech.map((tech_) => `- ${tech_}`).join('\n'), '')
  }
  lines.push(`## ${t.caseAlerts} (${incident.alert_ids.length})`, '')
  if (alerts.length) {
    lines.push(`| ${t.colTime} | ${t.colSeverity} | ${t.colRule} | ${t.colHost} | ${t.colUser} | ${t.colSummary} |`, '| --- | --- | --- | --- | --- | --- |')
    for (const a of alerts) {
      lines.push(`| ${utc(a.timestamp)} | ${severityText(a.severity, lang) ?? a.severity} | ${mdCell(a.rule_name)} | ${mdCell(a.host)} | ${mdCell(a.user ?? '—')} | ${mdCell(a.summary)} |`)
    }
    lines.push('')
  }
  if (missing > 0) {
    lines.push(`_${t.missing(missing)}_`, '')
  }
  if (!alerts.length && missing === 0) lines.push(`_${t.noAlerts}_`, '')
  lines.push(`## ${t.timeline}`, '')
  for (const e of incident.timeline) {
    lines.push(`- **${utc(e.at)}**${e.by ? ` · ${mdText(e.by)}` : ''}: ${mdText(e.text)}`)
  }
  if (!incident.timeline.length) lines.push(`_${t.noEntries}_`)
  lines.push('')
  if (input.playbook) lines.push(...playbookMarkdown(input.playbook, lang))
  if (input.graph && input.graph.nodes.length > 1) {
    lines.push(`## ${t.entities}`, '')
    const byKind = new Map<NodeKind, string[]>()
    for (const n of input.graph.nodes) byKind.set(n.kind, [...(byKind.get(n.kind) ?? []), n.label])
    for (const [kind, labels] of byKind) lines.push(`- ${t.kindOf[kind]}: ${labels.map(mdText).join(', ')}`)
    lines.push('')
  }
  lines.push('---', '', t.footer(utc(now.toISOString())), '')
  return lines.join('\n')
}

function esc(text: string): string {
  return visible(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

const NODE_COLOR: Record<NodeKind, string> = { host: '#3f3f46', user: '#0f766e', rule: '#b45309', process: '#4338ca', destination: '#be123c' }

// graphSvg draws the entity graph as a static, print-friendly SVG with
// the same deterministic layout the console uses.
export function graphSvg(graph: EntityGraph, width = 720, maxHeight = 380, lang: Lang = 'es'): string {
  if (graph.nodes.length < 2) return ''
  const t = REPORT_TEXT[lang]
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
    parts.push(`<g><title>${esc(t.kindOf[n.kind] + ': ' + n.label)}</title><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${NODE_COLOR[n.kind]}" stroke="#ffffff" stroke-width="2"/><text x="${p.x.toFixed(1)}" y="${(p.y + r + 11).toFixed(1)}" text-anchor="middle" font-size="10" fill="#27272a">${esc(label)}</text></g>`)
  }
  const kinds = [...new Set(graph.nodes.map((n) => n.kind))]
  const legend = kinds
    .map((k, i) => `<g transform="translate(${12 + i * 96},${height - 14})"><circle r="5" cx="5" cy="-4" fill="${NODE_COLOR[k]}"/><text x="14" y="0" font-size="10" fill="#52525b">${t.kindOf[k]}</text></g>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${t.graphAria(graph.nodes.length)}">${parts.join('')}${legend}</svg>`
}

function playbookHtml(playbook: IncidentPlaybookState, lang: Lang): string {
  const t = REPORT_TEXT[lang]
  const template = playbookTemplate(playbook.templateId)
  if (!template) return ''
  const { done, total } = progressOf(playbook, template)
  const steps = template.items
    .map((item, i) => {
      const isDone = Boolean(playbook.checks[item.id]?.done)
      return `<tr><td class="num">${i + 1}</td><td>${esc(item.text)}</td><td>${item.attack ? `<code>${item.attack}</code>` : '<span class="muted">—</span>'}</td><td>${isDone ? `<span class="ok">${t.done}</span>` : `<span class="muted">${t.pending}</span>`}</td></tr>`
    })
    .join('')
  const evidence = playbook.evidence.length
    ? `<table><thead><tr><th>${t.colType}</th><th>${t.colEvidence}</th><th>${t.colDetail}</th><th>${t.colCollected}</th></tr></thead><tbody>${playbook.evidence
        .map((e) => `<tr><td>${esc(evidenceText(e.kind, lang))}</td><td>${esc(e.label)}</td><td>${e.detail ? esc(e.detail).replace(/\r?\n/g, '<br>') : '<span class="muted">—</span>'}</td><td class="nowrap">${utc(e.at)}</td></tr>`)
        .join('')}</tbody></table>`
    : `<p class="muted">${t.noEvidence}</p>`
  const chrono = [...playbook.chronology].sort((a, b) => a.at.localeCompare(b.at))
  const chronology = chrono.length
    ? `<ol class="timeline">${chrono.map((c) => `<li><span class="when">${utc(c.at)}</span><span>${esc(c.text)}</span></li>`).join('')}</ol>`
    : `<p class="muted">${t.noMilestones}</p>`
  return `<h2>${t.plan}: ${esc(template.name)}</h2>
<p class="muted">${t.planProgress(done, total, utc(playbook.appliedAt))}</p>
<table class="checklist"><thead><tr><th class="num">#</th><th>${t.colStep}</th><th>ATT&amp;CK</th><th>${t.colStatus}</th></tr></thead><tbody>${steps}</tbody></table>
<h3>${t.evidenceHeading}</h3>
${evidence}
<h3>${t.chrono}</h3>
${chronology}
<p class="muted plan-note">${t.planNote}</p>`
}

export function buildIncidentHtml(input: IncidentReportInput): string {
  const lang = input.lang ?? 'es'
  const t = REPORT_TEXT[lang]
  const { incident } = input
  const now = input.now ?? new Date()
  const alerts = caseAlerts(input)
  const missing = incident.alert_ids.length - alerts.length
  const tech = techniques(alerts)
  const svg = input.graph ? graphSvg(input.graph, 720, 380, lang) : ''
  const row = (k: string, v: string) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`
  const meta = [
    row(t.id, `<code>${esc(incident.id)}</code>`),
    row(t.severity, `<span class="sev sev-${incident.severity}">${severityText(incident.severity, lang) ?? esc(incident.severity)}</span>`),
    row(t.status, esc(statusText(incident.status, lang) ?? incident.status)),
    row(t.owner, esc(incident.owner || t.unassigned)),
    row(t.opened, utc(incident.created_at)),
    row(t.lastUpdate, utc(incident.updated_at)),
    incident.closed_at ? row(t.closed, utc(incident.closed_at)) : '',
    row(t.hosts, incident.hosts.length ? incident.hosts.map((h) => `<code>${esc(h)}</code>`).join(', ') : '—'),
  ].join('')
  const alertRows = alerts
    .map((a) => `<tr><td class="nowrap">${utc(a.timestamp)}</td><td><span class="sev sev-${a.severity}">${severityText(a.severity, lang) ?? esc(a.severity)}</span></td><td>${esc(a.rule_name)}</td><td><code>${esc(a.host)}</code></td><td>${esc(a.user ?? '—')}</td><td>${esc(a.summary)}</td></tr>`)
    .join('')
  const timeline = incident.timeline
    .map((e) => `<li><span class="when">${utc(e.at)}${e.by ? ` · ${esc(e.by)}` : ''}</span><span class="${e.kind === 'note' ? 'note' : ''}">${esc(e.text)}</span></li>`)
    .join('')
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t.htmlTitleWord} ${esc(incident.id)}: ${esc(incident.title)}</title>
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
<button class="print" type="button" onclick="window.print()">${t.printButton}</button>
<h1>${esc(incident.title)}</h1>
<p class="sub">${t.htmlSubtitle} ${utc(now.toISOString())}</p>
<table class="meta"><tbody>${meta}</tbody></table>
<h2>${t.summary}</h2>
${incident.summary ? `<p class="summary">${esc(incident.summary)}</p>` : `<p class="muted">${t.noSummary}</p>`}
${tech.length ? `<h2>${t.techniques.replace('&', '&amp;')}</h2><ul class="tech">${tech.map((tech_) => `<li>${tech_}</li>`).join('')}</ul>` : ''}
<h2>${t.caseAlerts} (${incident.alert_ids.length})</h2>
${alerts.length ? `<table class="cases"><thead><tr><th>${t.colTime}</th><th>${t.colSeverity}</th><th>${t.colRule}</th><th>${t.colHost}</th><th>${t.colUser}</th><th>${t.colSummary}</th></tr></thead><tbody>${alertRows}</tbody></table>` : ''}
${missing > 0 ? `<p class="muted">${t.missing(missing)}</p>` : ''}
${!alerts.length && missing === 0 ? `<p class="muted">${t.noAlerts}</p>` : ''}
${svg ? `<h2>${t.graphHeading}</h2><div class="graph">${svg}</div>` : ''}
<h2>${t.timeline}</h2>
${timeline ? `<ol class="timeline">${timeline}</ol>` : `<p class="muted">${t.noEntries}</p>`}
${input.playbook ? playbookHtml(input.playbook, lang) : ''}
<footer>${t.htmlFooter}</footer>
</main>
</body>
</html>
`
}
