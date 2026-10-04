import { describe, expect, test } from 'bun:test'
import { buildAlertGraph, buildEntityGraph, buildProcessTree, layoutGraph } from './entity-graph'
import type { SfAlert, SfEvent } from './console-types'

const alert = (over: Partial<SfAlert>): SfAlert => ({
  id: 'a', timestamp: '2026-10-03T10:00:00Z', rule_id: 'r1', rule_name: 'Descarga con certutil', severity: 'high',
  host: 'LAB-WKS-01', event_id: 'e1', event_type: 'process.create', summary: '', matched_on: [], ...over,
})
const event = (over: Partial<SfEvent>): SfEvent => ({
  id: 'e1', timestamp: '2026-10-03T10:00:00Z', type: 'process.create', source: 'sysmon', host: 'LAB-WKS-01',
  process: { pid: 10, name: 'certutil.exe' }, ...over,
})

describe('entity graph', () => {
  test('links host, rule, user, the triggering process and network destinations', () => {
    const g = buildEntityGraph(
      [alert({ user: 'CORP\\ana' }), alert({ id: 'b', severity: 'critical', rule_name: 'Volcado de LSASS', event_id: 'gone' })],
      [event({}), event({ id: 'n1', type: 'network.connect', process: { pid: 11, name: 'powershell.exe' }, network: { destination_ip: '185.220.101.47', destination_port: 443 } })],
    )
    const ids = g.nodes.map((n) => n.id).sort()
    expect(ids).toEqual([
      'destination:185.220.101.47:443', 'host:lab-wks-01', 'process:certutil.exe', 'process:powershell.exe',
      'rule:descarga con certutil', 'rule:volcado de lsass', 'user:corp\\ana',
    ])
    const hot = g.edges.find((e) => e.source === 'host:lab-wks-01' && e.target === 'rule:volcado de lsass')
    expect(hot?.hot).toBe(true)
    expect(g.edges.some((e) => e.source === 'process:certutil.exe' && e.target === 'rule:descarga con certutil')).toBe(true)
    // the second alert's event left the buffer: no process is invented for it
    expect(g.edges.filter((e) => e.target === 'rule:volcado de lsass')).toHaveLength(1)
  })

  test('keeps the heaviest nodes of each kind and counts the rest', () => {
    const alerts = Array.from({ length: 5 }, (_, i) => alert({ id: String(i), rule_name: 'regla ' + i, event_id: 'x' }))
    alerts.push(alert({ id: 'dup', rule_name: 'regla 4', event_id: 'x' }))
    const g = buildEntityGraph(alerts, [], { hosts: 8, rules: 2, processes: 8, users: 8, destinations: 8 })
    expect(g.nodes.filter((n) => n.kind === 'rule').map((n) => n.label).sort()).toEqual(['regla 0', 'regla 4'])
    expect(g.folded).toBe(3)
  })

  test('a focused graph is laid out radially around the focus', () => {
    const g = buildAlertGraph(alert({ user: 'u', enrichment: { parent_name: 'winword.exe' } }), [event({})])
    const pos = layoutGraph(g, 400, 250)
    expect(pos.get('rule:descarga con certutil')).toEqual({ x: 200, y: 125 })
    const dist = (id: string) => Math.hypot(pos.get(id)!.x - 200, pos.get(id)!.y - 125)
    // second-ring nodes (reached through the host or the process) sit outside the first ring
    expect(dist('user:u')).toBeGreaterThan(dist('host:lab-wks-01'))
    expect(dist('process:winword.exe')).toBeGreaterThan(dist('process:certutil.exe'))
  })

  test('the alert graph centres on the rule and adds the parent process', () => {
    const g = buildAlertGraph(alert({ enrichment: { parent_name: 'winword.exe' }, network: { destination_ip: '10.0.0.5' } }), [event({})])
    expect(g.nodes.find((n) => n.focus)?.id).toBe('rule:descarga con certutil')
    expect(g.edges.some((e) => e.source === 'process:certutil.exe' && e.target === 'process:winword.exe')).toBe(true)
    expect(g.nodes.some((n) => n.id === 'destination:10.0.0.5')).toBe(true)
  })
})

describe('layout', () => {
  test('is deterministic and stays inside the box', () => {
    const g = buildEntityGraph([alert({ user: 'u' }), alert({ id: 'b', rule_name: 'otra', host: 'LAB-2' })], [event({})])
    const a = layoutGraph(g, 600, 300)
    const b = layoutGraph(g, 600, 300)
    expect([...a.entries()]).toEqual([...b.entries()])
    for (const p of a.values()) {
      expect(p.x).toBeGreaterThanOrEqual(57)
      expect(p.x).toBeLessThanOrEqual(543)
      expect(p.y).toBeGreaterThanOrEqual(34)
      expect(p.y).toBeLessThanOrEqual(266)
    }
  })
})

describe('process tree', () => {
  const pc = (_id: string, pid: number, ppid: number | undefined, name: string, t: string, parent?: string) => ({
    timestamp: t, type: 'process.create', process: { pid, ppid, name }, enrichment: parent ? { parent_name: parent } : undefined,
  })

  test('nests children by ppid and roots unknown parents by name', () => {
    const roots = buildProcessTree([
      pc('1', 100, 4, 'cmd.exe', '2026-10-03T10:00:01Z', 'winword.exe'),
      pc('2', 101, 100, 'powershell.exe', '2026-10-03T10:00:02Z'),
      pc('3', 102, 101, 'certutil.exe', '2026-10-03T10:00:03Z'),
      { timestamp: '2026-10-03T10:00:04Z', type: 'network.connect' },
    ], 'certutil.exe')
    expect(roots).toHaveLength(1)
    expect(roots[0]).toMatchObject({ name: 'winword.exe', external: true })
    const cmd = roots[0].children[0]
    expect(cmd.name).toBe('cmd.exe')
    expect(cmd.children[0].children[0]).toMatchObject({ name: 'certutil.exe', focus: true })
  })

  test('a forged ppid cycle never loops', () => {
    const roots = buildProcessTree([
      pc('1', 200, 201, 'a.exe', '2026-10-03T10:00:01Z'),
      pc('2', 201, 200, 'b.exe', '2026-10-03T10:00:02Z'),
      pc('3', 300, 300, 'self.exe', '2026-10-03T10:00:03Z'),
    ])
    const names = (list: typeof roots): string[] => list.flatMap((n) => [n.name, ...names(n.children)])
    expect(names(roots).sort()).toEqual(['a.exe', 'b.exe', 'self.exe'])
  })
})
