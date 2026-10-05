import type { ConsoleView } from '@/components/console/dashboard'
import { shortcutHintFor } from './keyboard-nav'

export const CONSOLE_DESTINATIONS: {
  id: ConsoleView; label: string; group: string; description: string; keywords: string
}[] = [
  { id: 'panel', label: 'Panel', group: 'Operación', description: 'Triaje pendiente, actividad y salud del motor', keywords: 'dashboard inicio métricas riesgo' },
  { id: 'estado', label: 'Estado', group: 'Operación', description: 'Motor, ingesta, colas, almacén y entrega externa en un vistazo', keywords: 'salud health plataforma estado motor ingesta cola almacen version sink siem' },
  { id: 'flujo', label: 'Flujo en vivo', group: 'Operación', description: 'Buscar telemetría y examinar eventos', keywords: 'eventos sensor procesos live feed' },
  { id: 'alertas', label: 'Alertas', group: 'Operación', description: 'Investigar, reconocer y cerrar detecciones', keywords: 'histórico historial triage triaje cola evidencia' },
  { id: 'incidentes', label: 'Incidentes', group: 'Operación', description: 'Casos que agrupan alertas, con estado, responsable y línea de tiempo', keywords: 'casos case incident investigacion' },
  { id: 'equipos', label: 'Equipos', group: 'Operación', description: 'Ficha de cada equipo: riesgo, alertas, procesos y conexiones', keywords: 'hosts host maquinas endpoints ficha' },
  { id: 'informes', label: 'Informes', group: 'Operación', description: 'Catálogo de informes del motor con descarga CSV/JSON y vista imprimible', keywords: 'reports informe resumen ejecutivo cobertura flota actividad csv json imprimir pdf' },
  { id: 'reglas', label: 'Reglas', group: 'Detección', description: 'Catálogo de reglas y condiciones cargadas', keywords: 'rules yaml mitre detecciones' },
  { id: 'cadenas', label: 'Cadenas', group: 'Detección', description: 'Secuencias y etapas de correlación', keywords: 'kill chain sequences correlador' },
  { id: 'inteligencia', label: 'Inteligencia', group: 'Detección', description: 'Listas de indicadores locales y línea base de procesos por equipo', keywords: 'intel ioc indicadores listas hash dominio ip baseline nuevo proceso amenazas' },
  { id: 'supresiones', label: 'Supresiones', group: 'Detección', description: 'Excepciones del operador y expiraciones', keywords: 'allowlist ruido falsos positivos' },
  { id: 'probador', label: 'Probador', group: 'Detección', description: 'Comprobar qué detecta un evento, sin generar alertas', keywords: 'test tester probar evento simular' },
  { id: 'ruido', label: 'Ruido', group: 'Detección', description: 'Procesos, dominios y detectores que más generan eventos o alertas', keywords: 'noise ruido procesos dns dominios top suprimir software conocido volumen' },
  { id: 'simulacion', label: 'Validación', group: 'Detección', description: 'Batería de validación de detecciones: escenarios, ejecución, historial y tendencia', keywords: 'simulacion scenarios validacion bateria laboratorio ataque matriz pass rate tendencia' },
  { id: 'respuesta', label: 'Respuesta activa', group: 'Respuesta', description: 'Consultar estado y auditoría de respuesta', keywords: 'respond c3 audit kill proceso' },
  { id: 'analista', label: 'Analista IA', group: 'Asistencia', description: 'Asistencia para explicar e investigar alertas', keywords: 'ai chat modelo inteligencia' },
]

type CommandText = { id: string; label: string; group: string; description: string; keywords: string; shortcut?: string }
export type ConsoleCommand = CommandText & (
  | { kind: 'navigate'; view: ConsoleView }
  | { kind: 'refresh' }
  | { kind: 'help' }
  | { kind: 'noc' }
)

export const CONSOLE_COMMANDS: ConsoleCommand[] = [
  ...CONSOLE_DESTINATIONS.map((item): ConsoleCommand => ({
    ...item, id: `view:${item.id}`, kind: 'navigate', view: item.id,
    shortcut: shortcutHintFor(item.id) ?? undefined,
  })),
  { id: 'refresh', kind: 'refresh', label: 'Actualizar datos del motor', group: 'Acciones', description: 'Volver a consultar el estado y los búferes actuales', keywords: 'refresh recargar reconectar sincronizar recuperar' },
  { id: 'noc', kind: 'noc', label: 'Modo NOC', group: 'Acciones', description: 'Pantalla completa rotativa para un monitor de sala', keywords: 'pantalla completa sala monitor wall pared' },
  { id: 'help', kind: 'help', label: 'Ayuda de teclado', group: 'Acciones', description: 'Consultar los atajos de la consola', keywords: 'atajos shortcuts ayuda teclas', shortcut: '?' },
]

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/**
 * Search the command catalogue; never sends operator input to the engine.
 * Commands whose name contains every word come first (stable otherwise),
 * so "noc" finds Modo NOC before a description that merely contains it.
 */
export function findConsoleCommands(query: string): ConsoleCommand[] {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean)
  const matches = CONSOLE_COMMANDS.filter((command) => {
    const text = normalize(`${command.label} ${command.group} ${command.description} ${command.keywords}`)
    return words.every((word) => text.includes(word))
  })
  const inLabel = (command: ConsoleCommand) => words.every((word) => normalize(command.label).includes(word))
  return [...matches.filter(inLabel), ...matches.filter((command) => !inLabel(command))]
}
