// v2 · command palette and keyboard: the sections of the console (one
// list the rail and the palette share), the two-key chords that open them
// (g then a letter), the search over sections, machines, alerts and
// actions, and when a key belongs to a field instead of the console.

export const V2_SECTIONS = [
  { id: 'inicio', href: '/v2', chord: 'i' },
  { id: 'alertas', href: '/v2/alertas', chord: 'a' },
  { id: 'incidentes', href: '/v2/incidentes', chord: 'n' },
  { id: 'investigar', href: '/v2/investigar', chord: 'b' },
  { id: 'equipos', href: '/v2/equipos', chord: 'e' },
  { id: 'directorio', href: '/v2/directorio', chord: 'd' },
  { id: 'deteccion', href: '/v2/deteccion', chord: 't' },
  { id: 'respuesta', href: '/v2/respuesta', chord: 'r' },
  { id: 'informes', href: '/v2/informes', chord: 'o' },
  { id: 'plataforma', href: '/v2/plataforma', chord: 'p' },
  { id: 'ajustes', href: '/v2/ajustes', chord: 's' },
] as const

export type V2SectionId = (typeof V2_SECTIONS)[number]['id']

/** The section a chord's second key opens, if any. */
export function chordTarget(key: string): (typeof V2_SECTIONS)[number] | undefined {
  const k = key.toLowerCase()
  return V2_SECTIONS.find((s) => s.chord === k)
}

/** A key typed into a field belongs to the field, not to the console. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== 'string') return false
  const node = el as HTMLElement
  const tag = node.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable === true
}

export type PaletteGroup = 'sections' | 'hosts' | 'alerts' | 'actions'
export const PALETTE_GROUPS: readonly PaletteGroup[] = ['sections', 'hosts', 'alerts', 'actions']

export type PaletteItem = {
  id: string
  group: PaletteGroup
  label: string
  detail?: string
  /** extra words it is found by (never shown) */
  keywords?: string
  href?: string
  /** an action the shell runs instead of a link */
  action?: 'refresh' | 'language' | 'shortcuts'
  /** a severity, for alerts */
  tone?: string
}

/** Lower case and without accents, so «deteccion» finds «Detección». */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * The items that hold every word of the query, best first (the label
 * starts with the query, then a word of the label does, then anything),
 * at most `perGroup` per group, in the palette's group order. An empty
 * query shows the sections and the actions.
 */
export function searchPalette(items: readonly PaletteItem[], query: string, perGroup = 5): PaletteItem[] {
  const q = fold(query.trim())
  const words = q.split(/\s+/).filter(Boolean)
  const scored: { item: PaletteItem; score: number; order: number }[] = []
  items.forEach((item, order) => {
    if (words.length === 0) {
      if (item.group === 'sections' || item.group === 'actions') scored.push({ item, score: 0, order })
      return
    }
    const label = fold(item.label)
    const hay = `${label} ${fold(item.detail ?? '')} ${fold(item.keywords ?? '')}`
    if (!words.every((w) => hay.includes(w))) return
    const score = label.startsWith(q) ? 0 : label.split(/[\s·\-_./]+/).some((part) => part.startsWith(words[0])) ? 1 : 2
    scored.push({ item, score, order })
  })
  const out: PaletteItem[] = []
  for (const group of PALETTE_GROUPS) {
    const inGroup = scored
      .filter((s) => s.item.group === group)
      .sort((a, b) => a.score - b.score || a.order - b.order)
      .slice(0, words.length === 0 ? Infinity : perGroup)
    out.push(...inGroup.map((s) => s.item))
  }
  return out
}
