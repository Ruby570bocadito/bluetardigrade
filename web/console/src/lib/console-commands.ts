import type { ConsoleView } from '@/components/console/dashboard'
import { shortcutHintFor } from './keyboard-nav'
import { DICTS, type Dict } from './i18n'

// The operator command catalogue is built FROM the i18n dictionary
// (IDEA-10): one source of truth per language, stable command ids across
// languages (`view:<id>`, refresh/noc/onboarding/help) so palette state,
// deep links and tests never depend on the active language. The default
// catalogue stays Spanish (the product default the batteries pin);
// localized catalogues are built per render with buildConsoleCommands().

const DESTINATION_IDS: ConsoleView[] = [
  'panel', 'estado', 'flujo', 'alertas', 'incidentes', 'equipos', 'informes',
  'reglas', 'cadenas', 'inteligencia', 'supresiones', 'probador',
  'ruido', 'simulacion',
  'respuesta', 'analista',
]

export type DestinationText = { id: ConsoleView; label: string; group: string; description: string; keywords: string }

/** Navigation destinations in the given language (nav order is fixed). */
export function buildDestinations(dict: Dict): DestinationText[] {
  return DESTINATION_IDS.map((id) => ({ id, ...dict.nav[id] }))
}

/** The Spanish catalogue, unchanged from before i18n (tests, fixtures and
 * the server render all consume it as the default). */
export const CONSOLE_DESTINATIONS: DestinationText[] = buildDestinations(DICTS.es)

type CommandText = { id: string; label: string; group: string; description: string; keywords: string; shortcut?: string }
export type ConsoleCommand = CommandText & (
  | { kind: 'navigate'; view: ConsoleView }
  | { kind: 'refresh' }
  | { kind: 'help' }
  | { kind: 'noc' }
  | { kind: 'onboarding' }
)

/** The full palette catalogue (navigation + standalone commands) in the
 * given language. Ids and kinds are language-independent. */
export function buildConsoleCommands(dict: Dict): ConsoleCommand[] {
  return [
    ...buildDestinations(dict).map((item): ConsoleCommand => ({
      ...item, id: `view:${item.id}`, kind: 'navigate', view: item.id,
      shortcut: shortcutHintFor(item.id) ?? undefined,
    })),
    { id: 'refresh', kind: 'refresh', ...dict.commands.refresh, group: dict.commands.acciones.group },
    { id: 'noc', kind: 'noc', ...dict.commands.noc, group: dict.commands.acciones.group },
    { id: 'onboarding', kind: 'onboarding', ...dict.commands.onboarding, group: dict.commands.acciones.group },
    { id: 'help', kind: 'help', ...dict.commands.help, group: dict.commands.acciones.group, shortcut: '?' },
  ]
}

export const CONSOLE_COMMANDS: ConsoleCommand[] = buildConsoleCommands(DICTS.es)

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/**
 * Search a command catalogue; never sends operator input to the engine.
 * Commands whose name contains every word come first (stable otherwise),
 * so "noc" finds Modo NOC before a description that merely contains it.
 * The catalogue is a parameter (default: the Spanish one) so the palette
 * searches in the operator's active language.
 */
export function findConsoleCommands(query: string, catalogue: ConsoleCommand[] = CONSOLE_COMMANDS): ConsoleCommand[] {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean)
  const matches = catalogue.filter((command) => {
    const text = normalize(`${command.label} ${command.group} ${command.description} ${command.keywords}`)
    return words.every((word) => text.includes(word))
  })
  const inLabel = (command: ConsoleCommand) => words.every((word) => normalize(command.label).includes(word))
  return [...matches.filter(inLabel), ...matches.filter((command) => !inLabel(command))]
}
