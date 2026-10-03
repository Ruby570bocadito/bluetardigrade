// Entity graphs for investigation: who (user), where (host), what ran
// (process), what fired (rule) and where it talked to (destination).
// Built only from what the console received (alert ring, event buffer,
// forensic bundle); a missing link stays missing, nothing is inferred.

import type { Severity, SfAlert, SfEvent } from './console-types'
import type { ForensicEvent } from './forensic'

export type NodeKind = 'host' | 'user' | 'rule' | 'process' | 'destination'

export type GraphNode = {
  id: string
  kind: NodeKind
  label: string
  /** alerts or events behind the node; drives the node size */
  weight: number
  severity?: Severity
  /** true for the node an alert graph is centred on */
  focus?: boolean
}

export type GraphEdge = { source: string; target: string; weight: number; hot?: boolean }
export type EntityGraph = { nodes: GraphNode[]; edges: GraphEdge[]; folded: number }

const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }

function maxSeverity(a: Severity | undefined, b: Severity): Severity {
  return a && SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b
}

class Builder {
  nodes = new Map<string, GraphNode>()
  edges = new Map<string, GraphEdge>()

  node(kind: NodeKind, label: string, weight = 1, severity?: Severity): string {
    const id = `${kind}:${label.toLowerCase()}`
    const prev = this.nodes.get(id)
    if (prev) {
      prev.weight += weight
      if (severity) prev.severity = maxSeverity(prev.severity, severity)
    } else {
      this.nodes.set(id, { id, kind, label, weight, severity })
    }
    return id
  }

  edge(a: string, b: string, weight = 1, hot = false) {
    if (a === b) return
    const [source, target] = a < b ? [a, b] : [b, a]
    const key = `${source}|${target}`
    const prev = this.edges.get(key)
    if (prev) {
      prev.weight += weight
      prev.hot = prev.hot || hot
    } else {
      this.edges.set(key, { source, target, weight, hot })
    }
  }
}

function destinationOf(net: SfEvent['network'] | undefined): string | null {
  if (!net) return null
  const host = net.domain || net.destination_ip
  if (!host) return null
  return net.destination_port ? `${host}:${net.destination_port}` : host
}

export type EntityGraphLimits = { hosts: number; rules: number; processes: number; users: number; destinations: number }

const DEFAULT_LIMITS: EntityGraphLimits = { hosts: 8, rules: 10, processes: 8, users: 6, destinations: 8 }

/**
 * Investigation graph of the received window: host-rule edges from
 * alerts, rule-process edges when the triggering event is still in the
 * buffer, host-user edges and host-destination edges from network
 * events. Each kind is capped to its heaviest nodes; the rest is
 * counted in `folded` so the reader knows the graph is a summary.
 */
export function buildEntityGraph(alerts: readonly SfAlert[], events: readonly SfEvent[], limits: EntityGraphLimits = DEFAULT_LIMITS): EntityGraph {
  const b = new Builder()
  const byId = new Map(events.map((e) => [e.id, e]))
  for (const alert of alerts) {
    const host = b.node('host', alert.host || 'host desconocido')
    const rule = b.node('rule', alert.rule_name, 1, alert.severity)
    b.edge(host, rule, 1, alert.severity === 'critical' && alert.status !== 'closed')
    if (alert.user) b.edge(b.node('user', alert.user), host)
    const ev = byId.get(alert.event_id)
    if (ev?.process?.name) b.edge(rule, b.node('process', ev.process.name))
    const dest = destinationOf(alert.network)
    if (dest) b.edge(host, b.node('destination', dest), 1, true)
  }
  for (const ev of events) {
    if (ev.type !== 'network.connect') continue
    const dest = destinationOf(ev.network)
    if (!dest) continue
    const host = b.node('host', ev.host || 'host desconocido', 0)
    b.edge(host, b.node('destination', dest))
    if (ev.process?.name) b.edge(b.node('process', ev.process.name, 0), b.node('destination', dest, 0))
  }
  return prune(b, limits)
}

function prune(b: Builder, limits: EntityGraphLimits): EntityGraph {
  const keep = new Set<string>()
  let folded = 0
  const cap: Record<NodeKind, number> = {
    host: limits.hosts, rule: limits.rules, process: limits.processes, user: limits.users, destination: limits.destinations,
  }
  for (const kind of Object.keys(cap) as NodeKind[]) {
    const ofKind = [...b.nodes.values()]
      .filter((n) => n.kind === kind)
      .sort((x, y) => y.weight - x.weight || x.label.localeCompare(y.label))
    ofKind.slice(0, cap[kind]).forEach((n) => keep.add(n.id))
    folded += Math.max(0, ofKind.length - cap[kind])
  }
  const edges = [...b.edges.values()].filter((e) => keep.has(e.source) && keep.has(e.target))
  const linked = new Set(edges.flatMap((e) => [e.source, e.target]))
  const nodes = [...b.nodes.values()].filter((n) => keep.has(n.id) && (linked.has(n.id) || n.kind === 'host'))
  return { nodes, edges, folded }
}

/** Neighbourhood of one alert: rule at the centre, then host, user, process, parent and destination. */
export function buildAlertGraph(alert: SfAlert, events: readonly SfEvent[]): EntityGraph {
  const b = new Builder()
  const rule = b.node('rule', alert.rule_name, 1, alert.severity)
  b.nodes.get(rule)!.focus = true
  const host = b.node('host', alert.host || 'host desconocido')
  b.edge(rule, host, 1, true)
  if (alert.user) b.edge(b.node('user', alert.user), host)
  const ev = events.find((e) => e.id === alert.event_id)
  const parentName = alert.enrichment?.parent_name ?? ev?.enrichment?.parent_name
  if (ev?.process?.name) {
    const proc = b.node('process', ev.process.name)
    b.edge(rule, proc, 1, true)
    b.edge(proc, host)
    if (parentName && parentName.toLowerCase() !== ev.process.name.toLowerCase()) b.edge(b.node('process', parentName), proc)
  } else if (parentName) {
    b.edge(b.node('process', parentName), host)
  }
  const dest = destinationOf(alert.network ?? ev?.network)
  if (dest) b.edge(host, b.node('destination', dest), 1, true)
  return { nodes: [...b.nodes.values()], edges: [...b.edges.values()], folded: 0 }
}

export type Point = { x: number; y: number }

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

/**
 * Deterministic force layout (same graph, same picture): seeded by the
 * node ids, repulsion between all pairs, springs along edges, gravity to
 * the centre, then clamped inside the box with a margin.
 */
export function layoutGraph(graph: EntityGraph, width: number, height: number, iterations = 260): Map<string, Point> {
  const pos = new Map<string, Point>()
  const n = graph.nodes.length
  const cx = width / 2
  const cy = height / 2
  const margin = 34
  if (n === 0 || width <= 0 || height <= 0) return pos
  const focus = graph.nodes.find((node) => node.focus)
  if (focus) return layoutRadial(graph, focus.id, width, height)
  graph.nodes.forEach((node, i) => {
    if (node.focus) {
      pos.set(node.id, { x: cx, y: cy })
      return
    }
    const angle = (i / n) * Math.PI * 2 + hash(node.id) * 0.8
    const r = Math.min(width, height) * (0.22 + hash(node.id + '#') * 0.2)
    pos.set(node.id, { x: cx + Math.cos(angle) * r * (width / height > 1.4 ? 1.6 : 1), y: cy + Math.sin(angle) * r })
  })
  const area = (width - margin * 2) * (height - margin * 2)
  const k = Math.sqrt(area / n) * 0.75
  for (let it = 0; it < iterations; it++) {
    const temp = (1 - it / iterations) * Math.min(width, height) * 0.08 + 0.5
    const disp = new Map<string, Point>(graph.nodes.map((node) => [node.id, { x: 0, y: 0 }]))
    for (let i = 0; i < n; i++) {
      const a = graph.nodes[i]
      const pa = pos.get(a.id)!
      for (let j = i + 1; j < n; j++) {
        const bnode = graph.nodes[j]
        const pb = pos.get(bnode.id)!
        let dx = pa.x - pb.x
        let dy = pa.y - pb.y
        let d = Math.hypot(dx, dy)
        if (d < 0.01) {
          dx = hash(a.id + bnode.id) - 0.5
          dy = hash(bnode.id + a.id) - 0.5
          d = Math.hypot(dx, dy) || 0.01
        }
        const f = (k * k) / d
        const da = disp.get(a.id)!
        const db = disp.get(bnode.id)!
        da.x += (dx / d) * f
        da.y += (dy / d) * f
        db.x -= (dx / d) * f
        db.y -= (dy / d) * f
      }
    }
    for (const e of graph.edges) {
      const pa = pos.get(e.source)
      const pb = pos.get(e.target)
      if (!pa || !pb) continue
      const dx = pa.x - pb.x
      const dy = pa.y - pb.y
      const d = Math.hypot(dx, dy) || 0.01
      const f = (d * d) / k
      const da = disp.get(e.source)!
      const db = disp.get(e.target)!
      da.x -= (dx / d) * f
      da.y -= (dy / d) * f
      db.x += (dx / d) * f
      db.y += (dy / d) * f
    }
    for (const node of graph.nodes) {
      const p = pos.get(node.id)!
      if (node.focus) continue
      const d = disp.get(node.id)!
      // gravity keeps disconnected parts on screen (stronger vertically:
      // the boxes are wide)
      d.x += (cx - p.x) * 0.12
      d.y += (cy - p.y) * 0.25
      const len = Math.hypot(d.x, d.y) || 1
      p.x += (d.x / len) * Math.min(len, temp)
      p.y += (d.y / len) * Math.min(len, temp)
      p.x = Math.min(width - margin * 1.7, Math.max(margin * 1.7, p.x))
      p.y = Math.min(height - margin, Math.max(margin, p.y))
    }
  }
  return pos
}

/**
 * Radial layout around a focus node: its neighbours on an inner ellipse,
 * evenly spread, and every further ring outside, each node near the
 * angle of the node that reached it. Used for the small alert graphs.
 */
function layoutRadial(graph: EntityGraph, focusId: string, width: number, height: number): Map<string, Point> {
  const pos = new Map<string, Point>()
  const cx = width / 2
  const cy = height / 2
  const adjacency = new Map<string, string[]>()
  for (const e of graph.edges) {
    adjacency.set(e.source, [...(adjacency.get(e.source) ?? []), e.target])
    adjacency.set(e.target, [...(adjacency.get(e.target) ?? []), e.source])
  }
  const level = new Map<string, number>([[focusId, 0]])
  const parent = new Map<string, string>()
  const queue = [focusId]
  while (queue.length) {
    const at = queue.shift()!
    for (const next of adjacency.get(at) ?? []) {
      if (level.has(next)) continue
      level.set(next, level.get(at)! + 1)
      parent.set(next, at)
      queue.push(next)
    }
  }
  // unreachable nodes go on the outer ring
  const maxLevel = Math.max(1, ...level.values()) + (graph.nodes.some((node) => !level.has(node.id)) ? 1 : 0)
  for (const node of graph.nodes) if (!level.has(node.id)) level.set(node.id, maxLevel)
  const rx = Math.max(20, width / 2 - 56)
  const ry = Math.max(20, height / 2 - 34)
  const angle = new Map<string, number>([[focusId, 0]])
  pos.set(focusId, { x: cx, y: cy })
  for (let ring = 1; ring <= maxLevel; ring++) {
    const members = graph.nodes.filter((node) => level.get(node.id) === ring)
    members.forEach((node, i) => {
      const from = parent.get(node.id)
      const siblings = from ? members.filter((m) => parent.get(m.id) === from) : members
      const k = siblings.indexOf(node)
      // ring 1 starts just above the left side, so two neighbours sit on
      // a diagonal and their labels never share a row with the focus; outer rings fan out from their parent's angle,
      // a lone child stepping down so labels do not collide
      const a = ring === 1 || !from
        ? Math.PI * 0.78 + (i / members.length) * Math.PI * 2
        : angle.get(from)! + (siblings.length === 1 ? 0.5 : (k - (siblings.length - 1) / 2) * 0.6)
      angle.set(node.id, a)
      const r = maxLevel === 1 ? 1 : 0.64 + (0.36 * (ring - 1)) / (maxLevel - 1)
      pos.set(node.id, { x: cx + Math.cos(a) * rx * r, y: cy + Math.sin(a) * ry * r })
    })
  }
  return pos
}

export type ProcessNode = {
  pid: number
  name: string
  commandLine?: string
  timestamp?: string
  /** the process that raised the alert */
  focus: boolean
  /** parent known only by name (not in the captured window) */
  external?: boolean
  children: ProcessNode[]
}

/**
 * Process tree of a forensic bundle: process.create events linked by
 * ppid. Parents outside the captured window become external roots named
 * from the enrichment when the engine recorded it.
 */
export function buildProcessTree(timeline: readonly (ForensicEvent & { enrichment?: Record<string, string> })[], focusName?: string): ProcessNode[] {
  const byPid = new Map<number, ProcessNode>()
  const parentOf = new Map<number, number | undefined>()
  const parentName = new Map<number, string | undefined>()
  for (const ev of timeline) {
    if (ev.type !== 'process.create' || !ev.process) continue
    const { pid, ppid, name, command_line } = ev.process
    byPid.set(pid, {
      pid, name, commandLine: command_line, timestamp: ev.timestamp,
      focus: Boolean(focusName) && name.toLowerCase() === focusName!.toLowerCase(),
      children: [],
    })
    parentOf.set(pid, ppid)
    parentName.set(pid, ev.enrichment?.parent_name)
  }
  const roots: ProcessNode[] = []
  const externals = new Map<string, ProcessNode>()
  const linked = new Map<number, number>() // child pid -> parent pid
  const isAncestor = (candidate: number, of: number) => {
    for (let at: number | undefined = of, hops = 0; at !== undefined && hops <= byPid.size; at = linked.get(at), hops++) {
      if (at === candidate) return true
    }
    return false
  }
  for (const [pid, node] of byPid) {
    const ppid = parentOf.get(pid)
    const parent = ppid !== undefined ? byPid.get(ppid) : undefined
    if (parent && ppid !== undefined) {
      // a reused pid or a forged ppid must never close a cycle: the
      // node becomes a plain root instead
      if (isAncestor(pid, ppid)) roots.push(node)
      else {
        parent.children.push(node)
        linked.set(pid, ppid)
      }
      continue
    }
    const pname = parentName.get(pid)
    if (pname || ppid) {
      const key = `${ppid ?? ''}:${pname ?? ''}`
      let ext = externals.get(key)
      if (!ext) {
        ext = { pid: ppid ?? 0, name: pname ?? `pid ${ppid}`, focus: false, external: true, children: [] }
        externals.set(key, ext)
        roots.push(ext)
      }
      ext.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const byTime = (a: ProcessNode, b: ProcessNode) => (a.timestamp ?? '').localeCompare(b.timestamp ?? '')
  const sortTree = (list: ProcessNode[]) => {
    list.sort(byTime)
    list.forEach((n) => sortTree(n.children))
  }
  sortTree(roots)
  return roots
}
