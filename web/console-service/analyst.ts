// Alert-triage analyst. Calls the LLM SDK declared in package.json
// (backend only) to explain a raised alert the way a senior SOC analyst
// would: what happened, why it matters (MITRE ATT&CK), risk level and
// recommended first steps.

import ZAI from 'z-ai-web-dev-sdk'
import type { SfAlert, SfEvent, RuleMeta } from './types'

export type AnalystStep = { label: string; state: 'run' | 'done' }

type Emit = {
  step: (s: AnalystStep) => void
  delta: (text: string) => void
}

const MITRE_NOTES: Record<string, string> = {
  'T1059.001':
    'PowerShell ofuscado es el caballo de Troya de la fase de ejecución: permite cargar payloads en memoria, evadir el registro de línea de comandos y moverse lateralmente con WMI o WinRM.',
  T1105:
    'La transferencia de herramientas entrantes marca la transición de acceso inicial a preparación: el atacante ya tiene un punto de apoyo y está trayendo su arsenal (implantes, túneles, exfiltradores).',
  'T1003.001':
    'Un volcado de LSASS expone hashes NTLM y tickets Kerberos de cada sesión del equipo. Con ellos se abre la puerta a pass-the-hash y movimiento lateral a escala de dominio.',
}

export function analystSystemPrompt(): string {
  return [
    'Eres un analista de ciberseguridad senior de un SOC, especialista en triage de alertas de EDR (framework security-framework).',
    'Recibes el evento de telemetría en JSON, la regla de detección que disparó y datos de enriquecimiento.',
    'Responde SIEMPRE en español, tono técnico directo, sin emojis y sin guiones largos (usa coma o punto).',
    'Estructura exacta, con secciones en negrita y listas con guion:',
    '**Qué ha pasado**: 2-3 frases interpretando el evento concreto (proceso, usuario, host).',
    '**Por qué es relevante**: técnica MITRE ATT&CK y su rol en una cadena de ataque real.',
    '**Nivel de riesgo**: una frase justificando la severidad y el impacto potencial.',
    '**Primeros pasos recomendados**: 3-4 acciones concretas de contención e investigación (ordenadas por prioridad).',
    'Máximo 220 palabras en total. No inventes datos que no estén en el evento o en la regla.',
  ].join('\n')
}

export function analystUserPrompt(alert: SfAlert, rule: RuleMeta | undefined, ev: SfEvent | undefined, question?: string): string {
  const parts: string[] = []
  parts.push(`ALERTA: ${alert.rule_name} (severidad ${alert.severity}, MITRE ${rule?.mitre ?? 'n/d'})`)
  parts.push(`EVENTO JSON: ${JSON.stringify(ev ?? { event_id: alert.event_id, summary: alert.summary })}`)
  if (rule) {
    parts.push(`REGLA: ${rule.name}. Tactica: ${rule.tactic}. Condiciones: ${JSON.stringify(rule.conditions)}`)
    parts.push(`CAMPOS QUE DISPARARON LA DETECCION: ${alert.matched_on.join(', ')}`)
  }
  parts.push(`CONTEXTO: host ${alert.host}, usuario ${alert.user ?? 'desconocido'}`)
  if (question && question.trim()) parts.push(`PREGUNTA DEL ANALISTA: ${question.trim()}`)
  return parts.join('\n')
}

/**
 * Runs the triage analysis. Emits agent-style steps and text deltas while
 * working; returns the full analysis text.
 */
export async function runAnalysis(alert: SfAlert, rule: RuleMeta | undefined, ev: SfEvent | undefined, emit: Emit, question?: string): Promise<string> {
  // Step 1: inspect the event (real work: pull the fields the rule matched on)
  emit.step({ label: 'Inspeccionando el evento', state: 'run' })
  const keyFields = alert.matched_on
    .map((f) => {
      if (f === 'process.name') return ev?.process?.name
      if (f === 'process.command_line') return ev?.process?.command_line
      return undefined
    })
    .filter(Boolean)
    .slice(0, 2)
  await sleep(450)
  emit.step({ label: 'Inspeccionando el evento', state: 'done' })

  // Step 2: correlate with ATT&CK (local tactic knowledge for the matched tag)
  emit.step({ label: 'Correlacionando con MITRE ATT&CK', state: 'run' })
  const note = rule ? MITRE_NOTES[rule.mitre] : undefined
  await sleep(500)
  emit.step({ label: 'Correlacionando con MITRE ATT&CK', state: 'done' })

  // Step 3: draft conclusions with the LLM
  emit.step({ label: 'Redactando conclusiones', state: 'run' })
  const zai = await ZAI.create()
  const contextNote = note ? `Nota de contexto interno para tu analisis: ${note}` : ''
  const fieldsNote = keyFields.length ? `Campos clave observados: ${keyFields.join(' | ')}` : ''

  const completion = await zai.chat.completions.create({
    messages: [
      { role: 'assistant', content: analystSystemPrompt() },
      {
        role: 'user',
        content: [analystUserPrompt(alert, rule, ev, question), contextNote, fieldsNote].filter(Boolean).join('\n'),
      },
    ],
    thinking: { type: 'disabled' },
  })

  const text = completion.choices[0]?.message?.content?.trim() ?? ''
  if (!text) throw new Error('respuesta vacia del modelo')

  // Stream the finished text to the client in small deltas (smooth reveal)
  const tokens = text.match(/\S+\s*/g) ?? [text]
  let buf = ''
  for (let i = 0; i < tokens.length; i++) {
    buf += tokens[i]
    if (i % 3 === 2 || i === tokens.length - 1) {
      emit.delta(buf)
      buf = ''
      await sleep(24)
    }
  }
  emit.step({ label: 'Redactando conclusiones', state: 'done' })
  return text
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
