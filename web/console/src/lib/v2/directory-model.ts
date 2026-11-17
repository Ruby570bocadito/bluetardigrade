// v2 · Directorio: the pure part of the Active Directory section. The
// tabs in the URL, the findings in severity order, a DN's container and
// the affected objects grouped by it, the score trend placed in a box and
// the stacked bar of findings by severity. Every number is the engine's
// (lib/directory); nothing here computes a posture.
import { AD_SEVERITY_ORDER, type ADFinding, type ADPosturePoint } from '@/lib/directory'

export const DIRECTORY_TABS = ['postura', 'hallazgos', 'objetos', 'cobertura'] as const
export type DirectoryTab = (typeof DIRECTORY_TABS)[number]

export function directoryTabFromParam(raw: string | null): DirectoryTab {
  return (DIRECTORY_TABS as readonly string[]).includes(raw ?? '') ? (raw as DirectoryTab) : 'postura'
}

/** The container of a DN: what follows its first RDN ("" for a root). Escaped commas (\,) stay in the value. */
export function parentOf(dn: string): string {
  for (let i = 0; i < dn.length; i++) {
    if (dn[i] === '\\') i++
    else if (dn[i] === ',') return dn.slice(i + 1).trim()
  }
  return ''
}

/** The first RDN's value, unescaped: «CN=SRV-DC01,OU=…» → «SRV-DC01». */
export function leafName(dn: string): string {
  const parent = parentOf(dn)
  const rdn = parent ? dn.slice(0, dn.length - parent.length - 1) : dn
  const eq = rdn.indexOf('=')
  return (eq >= 0 ? rdn.slice(eq + 1) : rdn).replace(/\\(.)/g, '$1').trim()
}

const rank = (sev: string) => {
  const i = (AD_SEVERITY_ORDER as readonly string[]).indexOf(sev)
  return i < 0 ? AD_SEVERITY_ORDER.length : i
}

/** Critical first, then by how many objects each finding counts. */
export function bySeverity(findings: readonly ADFinding[]): ADFinding[] {
  return [...findings].sort((a, b) => rank(a.severity) - rank(b.severity) || b.count - a.count || a.title.localeCompare(b.title))
}

/** Objects grouped by their container, the largest group first. */
export function groupByParent<T extends { dn: string }>(objects: readonly T[]): { parent: string; objects: T[] }[] {
  const groups = new Map<string, T[]>()
  for (const o of objects) {
    const parent = parentOf(o.dn)
    groups.set(parent, [...(groups.get(parent) ?? []), o])
  }
  return [...groups.entries()]
    .map(([parent, list]) => ({ parent, objects: list }))
    .sort((a, b) => b.objects.length - a.objects.length || a.parent.localeCompare(b.parent))
}

/** The stacked bar of findings by severity: one segment per severity with findings, as a share of 100. */
export function severityShares(summary: Record<string, number>): { sev: string; count: number; share: number }[] {
  const entries = AD_SEVERITY_ORDER.map((sev) => ({ sev, count: summary[sev] ?? 0 })).filter((e) => e.count > 0)
  const total = entries.reduce((n, e) => n + e.count, 0)
  return entries.map((e) => ({ ...e, share: total ? (e.count / total) * 100 : 0 }))
}

export type TrendDot = { x: number; y: number; score: number; at: number }

/** The score trend placed in a w×h box (score 0–100, top is 100), oldest first; `at` in seconds. */
export function trendDots(points: readonly ADPosturePoint[], w: number, h: number, pad = 8): TrendDot[] {
  if (points.length === 0) return []
  const sorted = [...points].sort((a, b) => a.at - b.at)
  const t0 = sorted[0].at
  const span = sorted[sorted.length - 1].at - t0
  return sorted.map((p) => ({
    x: span === 0 ? w / 2 : pad + ((p.at - t0) / span) * (w - 2 * pad),
    y: pad + (1 - Math.min(100, Math.max(0, p.score)) / 100) * (h - 2 * pad),
    score: p.score,
    at: p.at,
  }))
}

/** The change of the score over the trend, rounded; null with fewer than two points. */
export function trendDelta(points: readonly ADPosturePoint[]): number | null {
  if (points.length < 2) return null
  const sorted = [...points].sort((a, b) => a.at - b.at)
  return Math.round(sorted[sorted.length - 1].score - sorted[0].score)
}

export function v2DirectoryLink(tab: DirectoryTab = 'postura'): string {
  return tab === 'postura' ? '/v2/directorio' : `/v2/directorio?vista=${tab}`
}
