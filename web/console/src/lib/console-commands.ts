import type { ConsoleView } from '@/components/console/dashboard'
import { shortcutHintFor } from './keyboard-nav'

export const CONSOLE_DESTINATIONS: {
  id: ConsoleView; label: string; group: string; description: string; keywords: string
}[] = [
  { id: 'panel', label: 'Panel', group: 'Operación', description: 'Triaje pendiente, actividad y salud del motor', keywords: 'dashboard inicio métricas riesgo' },
  { id: 'flujo', label: 'Flujo en vivo', group: 'Operación', description: 'Buscar telemetría y examinar eventos', keywords: 'eventos sensor procesos live feed' },
  { id: 'alertas', label: 'Alertas', group: 'Operación', description: 'Investigar, reconocer y cerrar detecciones', keywords: 'histórico historial triage triaje cola evidencia' },
  { id: 'reglas', label: 'Reglas', group: 'Detección', description: 'Catálogo de reglas y condiciones cargadas', keywords: 'rules yaml mitre detecciones' },
  { id: 'cadenas', label: 'Cadenas', group: 'Detección', description: 'Secuencias y etapas de correlación', keywords: 'kill chain sequences correlador' },
  { id: 'supresiones', label: 'Supresiones', group: 'Detección', description: 'Excepciones del operador y expiraciones', keywords: 'allowlist ruido falsos positivos' },
  { id: 'respuesta', label: 'Respuesta activa', group: 'Respuesta', description: 'Consultar estado y auditoría de respuesta', keywords: 'respond c3 audit kill proceso' },
  { id: 'analista', label: 'Analista IA', group: 'Asistencia', description: 'Asistencia para explicar e investigar alertas', keywords: 'ai chat modelo inteligencia' },
]

type CommandText = { id: string; label: string; group: string; description: string; keywords: string; shortcut?: string }
export type ConsoleCommand = CommandText & (
  | { kind: 'navigate'; view: ConsoleView }
  | { kind: 'refresh' }
  | { kind: 'help' }
)

export const CONSOLE_COMMANDS: ConsoleCommand[] = [
  ...CONSOLE_DESTINATIONS.map((item): ConsoleCommand => ({
    ...item, id: `view:${item.id}`, kind: 'navigate', view: item.id,
    shortcut: shortcutHintFor(item.id) ?? undefined,
  })),
  { id: 'refresh', kind: 'refresh', label: 'Actualizar datos del motor', group: 'Acciones', description: 'Volver a consultar el estado y los búferes actuales', keywords: 'refresh recargar reconectar sincronizar recuperar' },
  { id: 'help', kind: 'help', label: 'Ayuda de teclado', group: 'Acciones', description: 'Consultar los atajos de la consola', keywords: 'atajos shortcuts ayuda teclas', shortcut: '?' },
]

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** Search the command catalogue; never sends operator input to the engine. */
export function findConsoleCommands(query: string): ConsoleCommand[] {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean)
  return CONSOLE_COMMANDS.filter((command) => {
    const text = normalize(`${command.label} ${command.group} ${command.description} ${command.keywords}`)
    return words.every((word) => text.includes(word))
  })
}
