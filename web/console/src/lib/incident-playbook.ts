// Incident response playbooks (IDEA-3): manual checklists, collected
// evidence and the analyst's reconstructed chronology for a case, from
// three product templates (ransomware, phishing, compromised account).
//
// The templates are product content: constants in this file, never
// fetched, never invented per case. The state a console user produces
// lives in this browser's localStorage (same pattern as the saved
// searches) and the UI says so; applying a template also leaves a note
// in the engine's case timeline, which is the only engine write here.
// Nothing reads or writes fabricated engine data: the export carries
// exactly what the analyst registered.

export const PLAYBOOK_STORAGE_KEY = 'bluetardigrade.incident-playbooks.v1'
export const PLAYBOOK_VERSION = 1
const MAX_STORAGE_CHARS = 256 * 1024
/** Console states kept in the browser; the least recently updated is evicted. */
export const MAX_PLAYBOOK_CASES = 40
export const MAX_EVIDENCE = 40
export const MAX_CHRONOLOGY = 80
export const MAX_LABEL = 200
export const MAX_DETAIL = 1000
const MAX_CASE_ID = 64
const MAX_ITEM_ID = 64

type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'setItem'>

export type PlaybookTemplateId = 'ransomware' | 'phishing' | 'compromised-account'

export type PlaybookItem = { id: string; text: string; attack?: string }
export type PlaybookTemplate = {
  id: PlaybookTemplateId
  name: string
  description: string
  items: PlaybookItem[]
  evidenceHints: string[]
}

export type EvidenceKind = 'file' | 'hash' | 'url' | 'ip' | 'account' | 'note'

export type PlaybookEvidence = { id: string; kind: EvidenceKind; label: string; detail?: string; at: string }
export type PlaybookChrono = { id: string; at: string; text: string }
export type PlaybookCheck = { done: boolean; at: string }

export type IncidentPlaybookState = {
  incidentId: string
  templateId: PlaybookTemplateId
  appliedAt: string
  updatedAt: string
  /** item id -> check; absent means pending. */
  checks: Record<string, PlaybookCheck>
  evidence: PlaybookEvidence[]
  chronology: PlaybookChrono[]
}

export const EVIDENCE_KIND_LABEL: Record<EvidenceKind, string> = {
  file: 'Fichero o muestra',
  hash: 'Hash',
  url: 'URL o dominio',
  ip: 'IP o destino',
  account: 'Cuenta o identidad',
  note: 'Nota',
}

// Bidi controls would let stored text read differently than it is
// stored; they are rejected here and escaped in the exports.
const BIDI = /[\u202a-\u202e\u2066-\u2069]/
const NO_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const SINGLE_LINE = /[\r\n]/

function checkText(value: string, max: number, what: string, multiline = false): string {
  if (typeof value !== 'string') throw new Error(`${what}: texto requerido.`)
  const text = value.normalize('NFKC')
  if (!text.trim()) throw new Error(`${what}: no puede quedar vacío.`)
  if (text.length > max) throw new Error(`${what}: usa como máximo ${max} caracteres.`)
  if (BIDI.test(text) || NO_CONTROL.test(text)) throw new Error(`${what}: contiene caracteres no permitidos.`)
  if (!multiline && SINGLE_LINE.test(text)) throw new Error(`${what}: no puede tener saltos de línea.`)
  return text
}

function checkTime(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value || Number.isNaN(Date.parse(value))) {
    throw new Error(`${what}: fecha no válida.`)
  }
  return value
}

function checkId(value: unknown, max: number, what: string): string {
  if (typeof value !== 'string' || !value || value.length > max || NO_CONTROL.test(value) || BIDI.test(value)) {
    throw new Error(`${what}: identificador no válido.`)
  }
  return value
}

export function entryId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const PLAYBOOK_TEMPLATES: PlaybookTemplate[] = [
  {
    id: 'ransomware',
    name: 'Ransomware',
    description: 'Cifrado en curso o consumado: contener rápido, preservar evidencia y decidir el restauro con datos.',
    evidenceHints: ['Nota de rescate', 'Muestra cifrada', 'Hash del binario', 'Destino de exfiltración', 'Cuenta usada'],
    items: [
      { id: 'alcance', text: 'Delimita el alcance: equipos con cifrado, notas de rescate o escritura masiva de ficheros renombrados.', attack: 'T1486' },
      { id: 'aislar', text: 'Aísla de la red los equipos afectados y corta los recursos compartidos mientras el cifrado siga activo.', attack: 'T1486' },
      { id: 'evidencia', text: 'Preserva evidencia antes de apagar nada: captura memoria y el bundle forense de la alerta más grave del caso.' },
      { id: 'familia', text: 'Identifica la familia (nota, extensión, muestra) sin ejecutar nada del entorno del atacante.' },
      { id: 'acceso-inicial', text: 'Remonta el acceso inicial: phishing, credenciales robadas o servicio expuesto; anota la primera alerta.', attack: 'T1078' },
      { id: 'preparacion', text: 'Busca preparación previa: borrado de copias sombra, copias de seguridad eliminadas o servicios detenidos.', attack: 'T1490' },
      { id: 'lateral', text: 'Rastrea el movimiento lateral: RDP, SMB y herramientas de administración remota con cuentas implicadas.', attack: 'T1021' },
      { id: 'exfil', text: 'Comprueba exfiltración previa (picos de subida, nube) antes de decidir restaurar sin pagar.', attack: 'T1567' },
      { id: 'persistencia', text: 'Revisa persistencia en equipos aún no cifrados: tareas, servicios, Run keys y cuentas nuevas.', attack: 'T1136' },
      { id: 'restauro', text: 'Restaura solo con copias verificadas como limpias y rota las credenciales de las cuentas implicadas.' },
      { id: 'cierre', text: 'Registra los hitos en la cronología y notifica según el procedimiento (dirección, seguros, legal).' },
    ],
  },
  {
    id: 'phishing',
    name: 'Phishing',
    description: 'Correo malicioso recibido, abierto o con clic: del buzón al equipo y del clic a la credencial.',
    evidenceHints: ['Mensaje original (.eml)', 'URL maliciosa', 'Hash del adjunto', 'Dominio del remitente', 'Buzón afectado'],
    items: [
      { id: 'mensaje', text: 'Consigue el mensaje original con cabeceras completas (.eml) sin reenviarlo entre buzones.' },
      { id: 'indicadores', text: 'Extrae indicadores: remitente, dominios, URLs y adjuntos; contrasta su reputación.' },
      { id: 'destinatarios', text: 'Busca a quién más llegó y quién lo abrió o hizo clic en la pasarela de correo.' },
      { id: 'adjunto', text: 'Si hay adjunto, calcula su hash y busca ese hash y su comportamiento en el histórico de alertas.', attack: 'T1204' },
      { id: 'clics', text: 'Identifica los equipos de quienes clicaron y revisa sus alertas y eventos web/DNS.', attack: 'T1204' },
      { id: 'credenciales', text: 'Si se introdujeron credenciales: revoca sesiones, restablece contraseñas y revisa el segundo factor.', attack: 'T1078' },
      { id: 'ejecucion', text: 'En los equipos implicados, revisa procesos hijo, persistencia y tareas creadas tras el clic.' },
      { id: 'bloqueo', text: 'Bloquea remitente, dominio y URL en la pasarela; si una regla interna dio volumen, crea la supresión desde Ruido.' },
      { id: 'purga', text: 'Retira el mensaje de los buzones restantes si la pasarela permite la purga.' },
      { id: 'cierre', text: 'Cierra la cronología: quién clicó, qué se contuvo y el estado final de cada buzón.' },
    ],
  },
  {
    id: 'compromised-account',
    name: 'Cuenta comprometida',
    description: 'Una identidad se usa fuera de su base: contener la cuenta, medir el alcance y buscar persistencia.',
    evidenceHints: ['IP de acceso', 'Dispositivo nuevo', 'Regla de buzón', 'Grupo modificado', 'Cuenta creada'],
    items: [
      { id: 'contencion', text: 'Contén la cuenta: restablece la contraseña y revoca sesiones y tokens sin borrar la cuenta aún.' },
      { id: 'origenes', text: 'Identifica los orígenes de acceso: IPs, dispositivos y horas, comparados con la base habitual del usuario.', attack: 'T1078' },
      { id: 'alcance', text: 'Determina qué era accesible con la cuenta: privilegios, grupos, buzones y recursos.' },
      { id: 'buzon', text: 'Revisa el buzón: reglas de reenvío, delegaciones y mensajes borrados.', attack: 'T1114' },
      { id: 'privilegios', text: 'Busca cambios de privilegio hechos con la cuenta: grupos, políticas y servicios nuevos.', attack: 'T1098' },
      { id: 'lateral', text: 'Busca movimiento lateral con la cuenta: inicios en otros equipos y uso de SMB, WMI o PsExec.', attack: 'T1021' },
      { id: 'persistencia', text: 'Revisa persistencia creada con la cuenta: cuentas nuevas, tareas programadas y claves Run.', attack: 'T1136' },
      { id: 'secretos', text: 'Si la cuenta es de servicio o administrativa, rota los secretos que alcanzaba y revisa dónde inició sesión.' },
      { id: 'vigilancia', text: 'Vigila la cuenta tras la contención: guarda la búsqueda de sus indicadores en Alertas.' },
      { id: 'cierre', text: 'Documenta en la cronología cada acceso y acción con hora, y el estado final de la cuenta.' },
    ],
  },
]

export function playbookTemplate(id: string): PlaybookTemplate | undefined {
  return PLAYBOOK_TEMPLATES.find((t) => t.id === id)
}

// ---------------------------------------------------------------------------
// Pure state operations (throw on invalid input; the component surfaces it)
// ---------------------------------------------------------------------------

export function applyPlaybook(incidentId: string, templateId: PlaybookTemplateId, now: string): IncidentPlaybookState {
  const id = checkId(incidentId, MAX_CASE_ID, 'Incidente')
  const template = playbookTemplate(templateId)
  if (!template) throw new Error('Plantilla desconocida.')
  checkTime(now, 'Aplicación')
  return { incidentId: id, templateId: template.id, appliedAt: now, updatedAt: now, checks: {}, evidence: [], chronology: [] }
}

function withUpdate(state: IncidentPlaybookState, now: string): IncidentPlaybookState {
  return { ...state, updatedAt: now }
}

export function toggleCheck(state: IncidentPlaybookState, template: PlaybookTemplate, itemId: string, now: string): IncidentPlaybookState {
  if (state.templateId !== template.id) throw new Error('La plantilla no coincide con el plan del caso.')
  if (!template.items.some((i) => i.id === itemId)) throw new Error('Paso de la plantilla desconocido.')
  const current = state.checks[itemId]
  const checks = { ...state.checks }
  if (current?.done) delete checks[itemId]
  else checks[itemId] = { done: true, at: checkTime(now, 'Casilla') }
  return withUpdate({ ...state, checks }, now)
}

export function addEvidence(state: IncidentPlaybookState, input: { kind: string; label: string; detail?: string; at: string }): IncidentPlaybookState {
  const kind = (Object.keys(EVIDENCE_KIND_LABEL) as EvidenceKind[]).find((k) => k === input.kind)
  if (!kind) throw new Error('Tipo de evidencia desconocido.')
  if (state.evidence.length >= MAX_EVIDENCE) throw new Error(`Máximo ${MAX_EVIDENCE} evidencias por caso.`)
  const label = checkText(input.label, MAX_LABEL, 'Evidencia')
  const detail = input.detail && input.detail.trim() ? checkText(input.detail, MAX_DETAIL, 'Detalle', true) : undefined
  const entry: PlaybookEvidence = { id: entryId(), kind, label, ...(detail ? { detail } : {}), at: checkTime(input.at, 'Evidencia') }
  return withUpdate({ ...state, evidence: [...state.evidence, entry] }, input.at)
}

export function removeEvidence(state: IncidentPlaybookState, evidenceId: string, now: string): IncidentPlaybookState {
  const evidence = state.evidence.filter((e) => e.id !== evidenceId)
  if (evidence.length === state.evidence.length) throw new Error('Evidencia no encontrada.')
  return withUpdate({ ...state, evidence }, now)
}

export function addChronology(state: IncidentPlaybookState, input: { at: string; text: string }, now: string): IncidentPlaybookState {
  if (state.chronology.length >= MAX_CHRONOLOGY) throw new Error(`Máximo ${MAX_CHRONOLOGY} hitos por caso.`)
  const entry: PlaybookChrono = { id: entryId(), at: checkTime(input.at, 'Hito'), text: checkText(input.text, MAX_DETAIL, 'Hito') }
  return withUpdate({ ...state, chronology: [...state.chronology, entry] }, checkTime(now, 'Actualización'))
}

export function removeChronology(state: IncidentPlaybookState, chronoId: string, now: string): IncidentPlaybookState {
  const chronology = state.chronology.filter((c) => c.id !== chronoId)
  if (chronology.length === state.chronology.length) throw new Error('Hito no encontrado.')
  return withUpdate({ ...state, chronology }, now)
}

export function progressOf(state: IncidentPlaybookState, template: PlaybookTemplate): { done: number; total: number } {
  return { done: template.items.filter((i) => state.checks[i.id]?.done).length, total: template.items.length }
}

// ---------------------------------------------------------------------------
// Storage: validated on read, capped and evicted on write
// ---------------------------------------------------------------------------

function record(raw: unknown, what: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${what}: registro incompatible.`)
  return raw as Record<string, unknown>
}

// Reconstructs only the owned fields; anything malformed or unknown in
// one stored case drops that case, never the whole record.
export function parsePlaybookState(raw: unknown): IncidentPlaybookState {
  const entry = record(raw, 'Plan')
  const incidentId = checkId(entry.incidentId, MAX_CASE_ID, 'Plan')
  const templateId = checkId(entry.templateId, 40, 'Plan')
  // the lookup validates the id belongs to the product templates
  const template = playbookTemplate(templateId)
  if (!template) throw new Error('Plan: plantilla desconocida.')
  const appliedAt = checkTime(entry.appliedAt, 'Plan')
  const updatedAt = checkTime(entry.updatedAt, 'Plan')
  const rawChecks = record(entry.checks ?? {}, 'Plan')
  const checks: Record<string, PlaybookCheck> = {}
  for (const [key, value] of Object.entries(rawChecks)) {
    try {
      const id = checkId(key, MAX_ITEM_ID, 'Plan')
      const check = record(value, 'Plan')
      if (check.done === true) checks[id] = { done: true, at: checkTime(check.at, 'Plan') }
    } catch {
      // one incompatible check row reads as pending, the case stays
    }
  }
  const rawEvidence = Array.isArray(entry.evidence) ? entry.evidence.slice(0, MAX_EVIDENCE) : []
  const evidence: PlaybookEvidence[] = []
  for (const raw of rawEvidence) {
    try {
      const ev = record(raw, 'Evidencia')
      const kind = (Object.keys(EVIDENCE_KIND_LABEL) as EvidenceKind[]).find((k) => k === ev.kind)
      if (!kind) throw new Error('tipo')
      evidence.push({
        id: checkId(ev.id, 32, 'Evidencia'),
        kind,
        label: checkText(ev.label as string, MAX_LABEL, 'Evidencia'),
        ...(typeof ev.detail === 'string' && ev.detail.trim() ? { detail: checkText(ev.detail, MAX_DETAIL, 'Evidencia', true) } : {}),
        at: checkTime(ev.at, 'Evidencia'),
      })
    } catch {
      // one incompatible evidence row is dropped, the case stays
    }
  }
  const rawChrono = Array.isArray(entry.chronology) ? entry.chronology.slice(0, MAX_CHRONOLOGY) : []
  const chronology: PlaybookChrono[] = []
  for (const raw of rawChrono) {
    try {
      const ch = record(raw, 'Hito')
      chronology.push({ id: checkId(ch.id, 32, 'Hito'), at: checkTime(ch.at, 'Hito'), text: checkText(ch.text as string, MAX_DETAIL, 'Hito') })
    } catch {
      // one incompatible row is dropped, the case stays
    }
  }
  return { incidentId, templateId: template.id, appliedAt, updatedAt, checks, evidence, chronology }
}

export function readPlaybooks(storage: StorageReader): Record<string, IncidentPlaybookState> {
  const raw = storage.getItem(PLAYBOOK_STORAGE_KEY)
  if (raw === null || raw === '') return {}
  if (raw.length > MAX_STORAGE_CHARS) throw new Error('El registro de planes supera el límite de lectura.')
  const data = record(JSON.parse(raw), 'Planes')
  if (data.version !== PLAYBOOK_VERSION) throw new Error('Registro de planes incompatible.')
  const casesRaw = record(data.cases ?? {}, 'Planes')
  const cases: Record<string, IncidentPlaybookState> = {}
  for (const [incidentId, value] of Object.entries(casesRaw)) {
    try {
      const state = parsePlaybookState(value)
      if (state.incidentId !== incidentId) throw new Error('clave')
      cases[incidentId] = state
    } catch {
      // an incompatible case is skipped, the rest survive
    }
  }
  return cases
}

export function writePlaybooks(storage: StorageWriter, cases: Record<string, IncidentPlaybookState>): void {
  const all = Object.values(cases).map((c) => parsePlaybookState(c))
  if (all.length > MAX_PLAYBOOK_CASES) {
    all.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    for (const stale of all.slice(0, all.length - MAX_PLAYBOOK_CASES)) delete cases[stale.incidentId]
  }
  const clean: Record<string, IncidentPlaybookState> = {}
  for (const id of Object.keys(cases)) {
    const state = parsePlaybookState(cases[id])
    clean[state.incidentId] = state
  }
  const payload = JSON.stringify({ version: PLAYBOOK_VERSION, cases: clean })
  if (payload.length > MAX_STORAGE_CHARS) throw new Error('El registro de planes no cabe en este navegador.')
  storage.setItem(PLAYBOOK_STORAGE_KEY, payload)
}

/** Insert or replace one case state (used by the component before every write). */
export function upsertPlaybook(cases: Record<string, IncidentPlaybookState>, state: IncidentPlaybookState): Record<string, IncidentPlaybookState> {
  return { ...cases, [state.incidentId]: parsePlaybookState(state) }
}
