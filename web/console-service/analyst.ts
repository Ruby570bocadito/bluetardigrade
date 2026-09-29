// Alert-triage analyst. Calls an OpenAI-compatible chat completions
// endpoint over plain fetch (no SDK dependency) to explain a raised
// alert the way a senior SOC analyst would: what happened, why it
// matters (MITRE ATT&CK), risk level and recommended first steps.
//
// Configuration lives in the environment of the hub process
// (console-service), so deployments pick any public provider without
// code changes:
//
//   ANALYST_BASE_URL  API root including the version path, e.g.
//                     https://api.openai.com/v1 (OpenAI),
//                     http://127.0.0.1:11434/v1 (Ollama),
//                     http://127.0.0.1:1234/v1 (LM Studio), vLLM, ...
//   ANALYST_API_KEY   bearer token; local servers accept any value
//   ANALYST_MODEL     model name the provider serves, e.g. gpt-4o-mini
//
// Without a full configuration the analyst fails with a clear message
// and the rest of the console keeps working (the panel already reports
// the error); no call is attempted and nothing else degrades.

import type { SfAlert, SfEvent, RuleMeta } from './types'

export type AnalystConfig = {
  baseUrl: string
  apiKey: string
  model: string
}

export type AnalystMessage = { role: 'system' | 'user' | 'assistant'; content: string }

/** Raised before any network call when the env configuration is incomplete. */
export class AnalystNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(
      `Analista IA sin configurar: faltan ${missing.join(', ')} en el entorno del hub. ` +
        'Define ANALYST_BASE_URL, ANALYST_API_KEY y ANALYST_MODEL (API compatible con OpenAI) ' +
        'y reinicia console-service; el resto de la consola sigue funcionando.',
    )
    this.name = 'AnalystNotConfiguredError'
  }
}

/** Reads and validates the analyst configuration from an env-like record. */
export function analystConfigFromEnv(env: Record<string, string | undefined> = process.env): AnalystConfig {
  const baseUrl = env.ANALYST_BASE_URL?.trim() ?? ''
  const apiKey = env.ANALYST_API_KEY?.trim() ?? ''
  const model = env.ANALYST_MODEL?.trim() ?? ''
  const missing: string[] = []
  if (!baseUrl) missing.push('ANALYST_BASE_URL')
  if (!apiKey) missing.push('ANALYST_API_KEY')
  if (!model) missing.push('ANALYST_MODEL')
  if (missing.length) throw new AnalystNotConfiguredError(missing)
  return { baseUrl, apiKey, model }
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
 * Single chat completion against an OpenAI-compatible endpoint. Minimal
 * request body for maximum provider compatibility; bounded by a hard
 * timeout so a stuck provider can never hang the hub. Throws Errors
 * with operator-ready Spanish messages; the hub forwards them to the
 * panel unchanged.
 */
export async function chatCompletion(cfg: AnalystConfig, messages: AnalystMessage[], timeoutMs = 60_000): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ model: cfg.model, messages }),
      signal: abortSignal(timeoutMs),
    })
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err)
    throw new Error(`no se pudo contactar con el proveedor del analista en ${url}: ${cause}`)
  }

  if (!res.ok) {
    const detail = await errorMessage(res)
    switch (res.status) {
      case 401:
      case 403:
        throw new Error(`el proveedor rechazo las credenciales (HTTP ${res.status}): revisa ANALYST_API_KEY${detail ? `. Detalle: ${detail}` : ''}`)
      case 404:
        throw new Error(`endpoint o modelo no encontrado (HTTP 404): revisa ANALYST_BASE_URL (${cfg.baseUrl}) y ANALYST_MODEL (${cfg.model})${detail ? `. Detalle: ${detail}` : ''}`)
      case 429:
        throw new Error(`el proveedor esta limitando las peticiones (HTTP 429): reintenta en unos segundos${detail ? `. Detalle: ${detail}` : ''}`)
      default:
        throw new Error(`el proveedor del analista devolvio HTTP ${res.status}${detail ? `: ${detail}` : ''}`)
    }
  }

  let data: { choices?: Array<{ message?: { content?: string | null } }> }
  try {
    data = (await res.json()) as typeof data
  } catch {
    throw new Error('el proveedor del analista devolvio una respuesta que no es JSON valido')
  }
  const text = data.choices?.[0]?.message?.content?.trim() ?? ''
  if (!text) throw new Error('respuesta vacia del modelo')
  return text
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

  // Step 3: draft conclusions with the configured LLM provider
  emit.step({ label: 'Redactando conclusiones', state: 'run' })
  const cfg = analystConfigFromEnv()
  const contextNote = note ? `Nota de contexto interno para tu analisis: ${note}` : ''
  const fieldsNote = keyFields.length ? `Campos clave observados: ${keyFields.join(' | ')}` : ''

  const text = await chatCompletion(cfg, [
    { role: 'system', content: analystSystemPrompt() },
    {
      role: 'user',
      content: [analystUserPrompt(alert, rule, ev, question), contextNote, fieldsNote].filter(Boolean).join('\n'),
    },
  ])

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

type Emit = {
  step: (s: { label: string; state: 'run' | 'done' }) => void
  delta: (text: string) => void
}

/** Best-effort extraction of the provider's error message from a failed response. */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } | string; message?: string }
    if (typeof body.error === 'string') return body.error
    if (body.error?.message) return body.error.message
    if (body.message) return body.message
  } catch {
    // body was not JSON; fall through
  }
  return ''
}

// AbortSignal.timeout is missing in some runtimes; fall back manually
// (same approach as the engine bridge).
function abortSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms)
  const ctrl = new AbortController()
  setTimeout(() => ctrl.abort(), ms)
  return ctrl.signal
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
