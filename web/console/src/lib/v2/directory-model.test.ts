import { describe, expect, test } from 'bun:test'
import type { ADFinding } from '@/lib/directory'
import { bySeverity, directoryTabFromParam, groupByParent, leafName, parentOf, severityShares, trendDelta, trendDots, v2DirectoryLink } from './directory-model'

const finding = (id: string, severity: string, count: number): ADFinding => ({
  id,
  title: id,
  severity,
  description: '',
  remediation: '',
  count,
  objects: [],
  objects_truncated: false,
})

describe('directory model', () => {
  test('tabs and links', () => {
    expect(directoryTabFromParam('objetos')).toBe('objetos')
    expect(directoryTabFromParam('x')).toBe('postura')
    expect(directoryTabFromParam(null)).toBe('postura')
    expect(v2DirectoryLink()).toBe('/v2/directorio')
    expect(v2DirectoryLink('cobertura')).toBe('/v2/directorio?vista=cobertura')
  })

  test('a DN gives its container and its own name, escaped commas included', () => {
    expect(parentOf('CN=SRV-DC01,OU=Servidores,DC=corp,DC=local')).toBe('OU=Servidores,DC=corp,DC=local')
    expect(parentOf('CN=García\\, Ana,OU=Usuarios,DC=corp')).toBe('OU=Usuarios,DC=corp')
    expect(parentOf('DC=corp')).toBe('')
    expect(leafName('CN=García\\, Ana,OU=Usuarios,DC=corp')).toBe('García, Ana')
    expect(leafName('DC=corp')).toBe('corp')
  })

  test('findings: critical first, then by count', () => {
    const sorted = bySeverity([finding('a', 'low', 9), finding('b', 'critical', 1), finding('c', 'high', 2), finding('d', 'high', 6), finding('e', 'weird', 50)])
    expect(sorted.map((f) => f.id)).toEqual(['b', 'd', 'c', 'a', 'e'])
  })

  test('objects grouped by container, largest first', () => {
    const groups = groupByParent([{ dn: 'CN=A,OU=X,DC=c' }, { dn: 'CN=B,OU=Y,DC=c' }, { dn: 'CN=C,OU=Y,DC=c' }])
    expect(groups.map((g) => [g.parent, g.objects.length])).toEqual([
      ['OU=Y,DC=c', 2],
      ['OU=X,DC=c', 1],
    ])
  })

  test('severity shares skip empty severities', () => {
    const shares = severityShares({ critical: 2, high: 0, medium: 6 })
    expect(shares.map((s) => s.sev)).toEqual(['critical', 'medium'])
    expect(shares[0].share).toBe(25)
    expect(severityShares({})).toEqual([])
  })

  test('trend dots fit the box and the delta reads oldest to newest', () => {
    const dots = trendDots(
      [
        { at: 200, score: 75 },
        { at: 100, score: 50 },
      ],
      100,
      40,
      0,
    )
    expect(dots[0]).toEqual({ x: 0, y: 20, score: 50, at: 100 })
    expect(dots[1]).toEqual({ x: 100, y: 10, score: 75, at: 200 })
    expect(trendDots([{ at: 5, score: 100 }], 100, 50, 0)[0].x).toBe(50)
    expect(trendDelta([{ at: 200, score: 80 }, { at: 100, score: 60 }])).toBe(20)
    expect(trendDelta([{ at: 1, score: 3 }])).toBeNull()
  })
})
