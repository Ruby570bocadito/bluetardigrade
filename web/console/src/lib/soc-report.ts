import type { SfAlert } from './console-types'

export const REPORT_KEY = 'bluetardigrade.soc-reports.v1'
export const REPORT_UPDATED_EVENT = 'bluetardigrade:reports-updated'
export const MAX_REPORTS = 10
export const DECISIONS = { pending: 'Pendiente', false_positive: 'Falso positivo', authorized_activity: 'Actividad autorizada', confirmed_incident: 'Incidente confirmado' } as const
export type Decision = keyof typeof DECISIONS
export type ReportFields = { title: string; analyst: string; decision: Decision; findings: string; actions: string; recommendations: string; references: string }
export type SocReport = { version: 1; alert_id: string; created_at: string; updated_at: string; revision: number; fields: ReportFields; alert: SfAlert }
type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = StorageReader & Pick<Storage, 'setItem'>
const ID = /^[a-f0-9]{16}$/
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Informe incompatible.')
  return value as Record<string, unknown>
}
function fields(value: unknown): ReportFields {
  const input = record(value)
  if (typeof input.decision !== 'string' || !Object.hasOwn(DECISIONS, input.decision)) throw new Error('Clasificación del informe incompatible.')
  const result = { decision: input.decision } as ReportFields
  for (const key of ['title', 'analyst', 'findings', 'actions', 'recommendations', 'references'] as const) {
    const limit = key === 'title' ? 200 : key === 'analyst' ? 120 : 4000
    if (typeof input[key] !== 'string' || input[key].length > limit || CONTROL.test(input[key])) throw new Error(`El campo ${key} supera su límite o contiene caracteres de control.`)
    result[key] = input[key]
  }
  return result
}
function alertSnapshot(value: unknown, id: string): SfAlert {
  const input = record(value)
  if (input.id !== id || !ID.test(id)) throw new Error('La evidencia no corresponde a la alerta seleccionada.')
  const result: Record<string, unknown> = { id }
  for (const key of ['timestamp', 'rule_id', 'rule_name', 'severity', 'host', 'event_id', 'event_type', 'summary']) {
    if (typeof input[key] !== 'string') throw new Error('Evidencia de alerta incompleta.')
    result[key] = input[key]
  }
  if (!['info', 'low', 'medium', 'high', 'critical'].includes(String(input.severity))) throw new Error('Severidad incompatible.')
  for (const key of ['source', 'user', 'message', 'status_note', 'status_by', 'status_at']) {
    if (input[key] !== undefined) { if (typeof input[key] !== 'string') throw new Error('Campo de evidencia incompatible.'); result[key] = input[key] }
  }
  for (const key of ['matched_on', 'tags', 'actions']) {
    const items = input[key] ?? []
    if (!Array.isArray(items) || items.length > 128 || !items.every((item) => typeof item === 'string')) throw new Error('Etiquetas de evidencia incompatibles.')
    result[key] = [...items]
  }
  if (input.notify !== undefined) { if (typeof input.notify !== 'boolean') throw new Error('Notify incompatible.'); result.notify = input.notify }
  if (input.status !== undefined) {
    if (!['new', 'acknowledged', 'closed'].includes(String(input.status))) throw new Error('Estado de evidencia incompatible.')
    result.status = input.status
  }
  for (const key of ['attributes', 'enrichment']) {
    if (input[key] !== undefined) {
      const map = record(input[key]); const entries = Object.entries(map)
      if (entries.length > 128 || !entries.every(([name, item]) => name.length <= 128 && typeof item === 'string')) throw new Error('Observaciones de evidencia incompatibles.')
      result[key] = Object.fromEntries(entries)
    }
  }
  if (input.network !== undefined) {
    const network = record(input.network); const clean: Record<string, unknown> = {}
    for (const key of ['protocol', 'source_ip', 'destination_ip', 'domain']) {
      if (network[key] !== undefined) { if (typeof network[key] !== 'string') throw new Error('Flujo de evidencia incompatible.'); clean[key] = network[key] }
    }
    for (const key of ['source_port', 'destination_port']) {
      if (network[key] !== undefined) { if (!Number.isInteger(network[key]) || (network[key] as number) < 0 || (network[key] as number) > 65535) throw new Error('Puerto de evidencia incompatible.'); clean[key] = network[key] }
    }
    result.network = clean
  }
  if (new TextEncoder().encode(JSON.stringify(result)).length > 64 * 1024) throw new Error('La evidencia supera 64 KiB; usa la exportación forense.')
  return result as SfAlert
}
function iso(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Fecha de informe incompatible.')
  return value
}
function parseReport(value: unknown): SocReport {
  const input = record(value)
  if (input.version !== 1 || typeof input.alert_id !== 'string' || !ID.test(input.alert_id) || !Number.isSafeInteger(input.revision) || (input.revision as number) < 1) throw new Error('Informe incompatible.')
  const created = iso(input.created_at); const updated = iso(input.updated_at)
  if (updated < created) throw new Error('Fechas de informe incompatibles.')
  return { version: 1, alert_id: input.alert_id, created_at: created, updated_at: updated, revision: input.revision as number, fields: fields(input.fields), alert: alertSnapshot(input.alert, input.alert_id) }
}

export function newReport(alert: SfAlert, now = new Date()): SocReport {
  if (!alert.id || !ID.test(alert.id)) throw new Error('El informe requiere un ID de alerta del motor.')
  const at = now.toISOString()
  return { version: 1, alert_id: alert.id, created_at: at, updated_at: at, revision: 0, alert: alertSnapshot(alert, alert.id), fields: { title: `Investigación de alerta ${alert.id}`, analyst: '', decision: 'pending', findings: '', actions: '', recommendations: '', references: '' } }
}
export function readReports(storage: StorageReader): SocReport[] {
  const raw = storage.getItem(REPORT_KEY)
  if (raw === null) return []
  if (raw.length > 2 * 1024 * 1024) throw new Error('El registro de informes supera el límite de lectura.')
  const data = record(JSON.parse(raw))
  if (data.version !== 1 || !Array.isArray(data.items) || data.items.length > MAX_REPORTS) throw new Error('Registro de informes incompatible.')
  const items = data.items.map(parseReport)
  if (new Set(items.map((item) => item.alert_id)).size !== items.length) throw new Error('Registro con informes duplicados.')
  return items
}
export function saveReport(storage: StorageWriter, draft: SocReport, expectedRevision: number, now = new Date()): SocReport {
  const items = readReports(storage); const old = items.find((item) => item.alert_id === draft.alert_id)
  if ((old?.revision ?? 0) !== expectedRevision) throw new Error('El informe cambió en otra pestaña. Carga la versión guardada antes de guardar.')
  if (!old && items.length >= MAX_REPORTS) throw new Error(`Puedes guardar hasta ${MAX_REPORTS} informes. Exporta y elimina uno para añadir otro.`)
  const saved = parseReport({ ...draft, fields: fields(draft.fields), alert: old?.alert ?? draft.alert, created_at: old?.created_at ?? draft.created_at, updated_at: now.toISOString(), revision: expectedRevision + 1 })
  storage.setItem(REPORT_KEY, JSON.stringify({ version: 1, items: [...items.filter((item) => item.alert_id !== saved.alert_id), saved] }))
  return saved
}
export function deleteReport(storage: StorageWriter, id: string, expectedRevision: number): void {
  const items = readReports(storage); const old = items.find((item) => item.alert_id === id)
  if (!old || old.revision !== expectedRevision) throw new Error('La versión guardada cambió. Cárgala antes de eliminar.')
  storage.setItem(REPORT_KEY, JSON.stringify({ version: 1, items: items.filter((item) => item.alert_id !== id) }))
}
function fence(value: string, language: string): string {
  const runs = value.match(/`+/g) ?? []; const marker = '`'.repeat(Math.max(3, ...runs.map((item) => item.length + 1)))
  return `${marker}${language}\n${value}\n${marker}`
}
export function buildReportExport(report: SocReport, format: 'md' | 'json') {
  const checked = { ...report, fields: fields(report.fields), alert: alertSnapshot(report.alert, report.alert_id) }
  let contents: string
  if (format === 'json') contents = JSON.stringify(checked, null, 2) + '\n'
  else {
    const sections: [string, string][] = [['Título', checked.fields.title], ['Analista', checked.fields.analyst], ['Clasificación humana', DECISIONS[checked.fields.decision]], ['Hallazgos', checked.fields.findings], ['Acciones realizadas', checked.fields.actions], ['Recomendaciones', checked.fields.recommendations], ['Referencias', checked.fields.references]]
    const evidence = JSON.stringify(checked.alert, null, 2).replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, (char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'))
    contents = `# Informe SOC\n\nAlerta: ${checked.alert_id}\n\nCreado: ${checked.created_at}\n\n` + sections.map(([title, value]) => `## ${title}\n\n${fence(value || 'Sin completar', 'text')}\n\n`).join('') + `## Evidencia recibida\n\nSnapshot de la alerta; la clasificación pertenece al analista.\n\n${fence(evidence, 'json')}\n\nEl informe no modifica el estado de la alerta ni ejecuta una respuesta.\n`
  }
  return { filename: `soc-${report.alert_id}.${format}`, mime: format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8', contents }
}
