// Area hues: every view and every card of the console belongs to one
// area, and the area gives it its colour: the nav icon, the icon of each
// card about it and that card's header wash. The colours themselves are
// CSS tokens (--area-*, globals.css, restated for the light theme and
// for the dark sidebar island); this module only decides who is what.
//
// Identity, not data and not status: health keeps --status-*, alerts
// keep the severity scale. Cool hues for the areas that inform, one warm
// hue (coral) for the area that asks the operator to act.

import type { ConsoleView } from '@/components/console/dashboard'

export type Area = 'core' | 'telemetry' | 'alerts' | 'fleet' | 'detection' | 'connect'

/** Every area, in nav order of their first view. */
export const AREAS: readonly Area[] = ['core', 'telemetry', 'alerts', 'fleet', 'detection', 'connect']

const VIEW_AREA: Record<ConsoleView, Area> = {
  panel: 'core',
  estado: 'core',
  informes: 'core',
  consulta: 'core',
  ajustes: 'core',
  flujo: 'telemetry',
  alertas: 'alerts',
  incidentes: 'alerts',
  respuesta: 'alerts',
  equipos: 'fleet',
  directorio: 'fleet',
  reglas: 'detection',
  cadenas: 'detection',
  inteligencia: 'detection',
  supresiones: 'detection',
  probador: 'detection',
  ruido: 'detection',
  simulacion: 'detection',
  analista: 'connect',
}

export function areaOf(view: ConsoleView): Area {
  return VIEW_AREA[view]
}

/** The area's colour as a token reference (follows the active theme). */
export function areaColor(area: Area): string {
  return `var(--area-${area})`
}

/** The selected nav item in its area's hue: a flat tint and an edge. */
export function areaSelection(area: Area): { borderColor: string; backgroundColor: string } {
  const hue = areaColor(area)
  return {
    borderColor: `color-mix(in srgb, ${hue} 38%, transparent)`,
    backgroundColor: `color-mix(in srgb, ${hue} 15%, transparent)`,
  }
}
