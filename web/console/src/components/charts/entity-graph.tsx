'use client'

// Investigation graph (node-link). Kinds are told apart by shape AND an
// icon AND the legend, never by color alone: hosts are squares, rules
// are diamonds (in their severity color), processes, users and
// destinations are circles in the validated categorical slots. Hovering
// or focusing a node lights its neighbourhood and dims the rest; edges
// that carry an open critical detection or an observed connection flow.
// Nodes settle from the centre on mount (static under reduced motion).

import { useMemo, useState, type KeyboardEvent } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Desktop, Globe, Gear, ShieldWarning, User, type Icon } from '@phosphor-icons/react'
import { useElementWidth } from './chart-frame'
import { SEV_COLOR } from './severity'
import { layoutGraph, type EntityGraph, type GraphNode, type NodeKind } from '@/lib/entity-graph'
import { SEVERITY_STYLE } from '@/lib/console-types'

export const NODE_KIND: Record<NodeKind, { label: string; color: string; icon: Icon }> = {
  host: { label: 'Equipo', color: 'var(--series-1)', icon: Desktop },
  rule: { label: 'Detección', color: 'var(--sev-high)', icon: ShieldWarning },
  process: { label: 'Proceso', color: 'var(--series-3)', icon: Gear },
  user: { label: 'Usuario', color: 'var(--series-2)', icon: User },
  destination: { label: 'Destino de red', color: 'var(--series-4)', icon: Globe },
}

function colorOf(node: GraphNode): string {
  return node.kind === 'rule' ? SEV_COLOR[node.severity ?? 'low'] : NODE_KIND[node.kind].color
}

function radiusOf(node: GraphNode, maxWeight: number): number {
  const base = node.kind === 'host' ? 15 : node.focus ? 16 : 11
  return base + Math.sqrt(node.weight / Math.max(1, maxWeight)) * 7
}

function shapePath(kind: NodeKind, r: number): string | null {
  if (kind === 'rule') return `M0,${-r} L${r},0 L0,${r} L${-r},0 Z`
  if (kind === 'host') {
    const s = r * 0.86
    const c = 5
    return `M${-s + c},${-s} H${s - c} Q${s},${-s} ${s},${-s + c} V${s - c} Q${s},${s} ${s - c},${s} H${-s + c} Q${-s},${s} ${-s},${s - c} V${-s + c} Q${-s},${-s} ${-s + c},${-s} Z`
  }
  return null
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

export function EntityGraphView({
  graph,
  height = 360,
  ariaLabel,
  onSelect,
  selectHint = 'Ver alertas relacionadas',
}: {
  graph: EntityGraph
  height?: number
  ariaLabel: string
  onSelect?: (node: GraphNode) => void
  selectHint?: string
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const reduce = useReducedMotion()
  const [active, setActive] = useState<string | null>(null)
  const layout = useMemo(() => layoutGraph(graph, width, height), [graph, width, height])
  const maxWeight = Math.max(1, ...graph.nodes.map((n) => n.weight))
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const e of graph.edges) {
      if (!map.has(e.source)) map.set(e.source, new Set())
      if (!map.has(e.target)) map.set(e.target, new Set())
      map.get(e.source)!.add(e.target)
      map.get(e.target)!.add(e.source)
    }
    return map
  }, [graph])
  const lit = (id: string) => active === null || id === active || neighbours.get(active)?.has(id)
  const maxEdge = Math.max(1, ...graph.edges.map((e) => e.weight))
  const activeNode = graph.nodes.find((n) => n.id === active)
  const activePos = activeNode ? layout.get(activeNode.id) : undefined

  const onKey = (e: KeyboardEvent<SVGGElement>, node: GraphNode) => {
    if ((e.key === 'Enter' || e.key === ' ') && onSelect) {
      e.preventDefault()
      onSelect(node)
    }
  }

  return (
    <div ref={ref} role="group" aria-label={ariaLabel} className="relative" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} className="block">
          <defs>
            <radialGradient id="graph-halo" cx="50%" cy="50%" r="50%">
              <stop offset="0" style={{ stopColor: 'var(--accent-halo, rgba(212, 212, 216, 0.1))' }} />
              <stop offset="1" stopColor="transparent" />
            </radialGradient>
          </defs>
          <rect x={0} y={0} width={width} height={height} fill="url(#graph-halo)" aria-hidden />
          <g aria-hidden>
            {graph.edges.map((e) => {
              const a = layout.get(e.source)
              const b = layout.get(e.target)
              if (!a || !b) return null
              const on = active === null || e.source === active || e.target === active
              const mx = (a.x + b.x) / 2
              const my = (a.y + b.y) / 2
              const dx = b.x - a.x
              const dy = b.y - a.y
              // gentle curve: control point offset perpendicular to the edge
              const cx = mx - dy * 0.12
              const cy = my + dx * 0.12
              const d = `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`
              const w = 1 + (e.weight / maxEdge) * 2.2
              return (
                <g key={e.source + '|' + e.target} opacity={on ? 1 : 0.12} style={{ transition: 'opacity 0.2s' }}>
                  <path d={d} fill="none" style={{ stroke: 'var(--viz-edge)' }} strokeWidth={w} strokeLinecap="round" />
                  {e.hot && (
                    <path d={d} fill="none" stroke={e.source.startsWith('destination') || e.target.startsWith('destination') ? 'var(--series-4)' : 'var(--sev-critical)'} strokeOpacity={0.75} strokeWidth={Math.max(1.4, w * 0.7)} strokeLinecap="round" className="edge-flow" />
                  )}
                </g>
              )
            })}
          </g>
          {graph.nodes.map((node, i) => {
            const p = layout.get(node.id)
            if (!p) return null
            const r = radiusOf(node, maxWeight)
            const color = colorOf(node)
            const KindIcon = NODE_KIND[node.kind].icon
            const path = shapePath(node.kind, r)
            const on = lit(node.id)
            const labelText = truncate(node.label, node.kind === 'host' ? 22 : 18)
            const critical = node.kind === 'rule' && node.severity === 'critical'
            return (
              <motion.g
                key={node.id}
                initial={reduce ? false : { x: width / 2, y: height / 2, opacity: 0 }}
                animate={{ x: p.x, y: p.y, opacity: on ? 1 : 0.22 }}
                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 70, damping: 16, delay: Math.min(i * 0.02, 0.4), opacity: { duration: 0.2 } }}
                tabIndex={0}
                role={onSelect ? 'button' : 'img'}
                aria-label={`${NODE_KIND[node.kind].label}: ${node.label}${node.severity ? `, severidad ${SEVERITY_STYLE[node.severity].label}` : ''}, ${neighbours.get(node.id)?.size ?? 0} conexiones${onSelect ? `. ${selectHint}` : ''}`}
                onPointerEnter={() => setActive(node.id)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(node.id)}
                onBlur={() => setActive(null)}
                onClick={onSelect ? () => onSelect(node) : undefined}
                onKeyDown={(e) => onKey(e, node)}
                style={{ cursor: onSelect ? 'pointer' : 'default', outline: 'none' }}
              >
                {critical && <circle r={r} fill="none" stroke="var(--sev-critical)" strokeWidth={2} className="node-pulse" />}
                {node.focus && <circle r={r + 6} fill="none" style={{ stroke: 'var(--viz-edge-strong)' }} strokeWidth={1} />}
                {active === node.id && <circle r={r + 4} fill="none" stroke="var(--ring)" strokeWidth={2} />}
                {path ? (
                  <path d={path} style={{ fill: 'var(--viz-raised)' }} stroke={color} strokeWidth={2} />
                ) : (
                  <circle r={r} style={{ fill: 'var(--viz-raised)' }} stroke={color} strokeWidth={2} />
                )}
                {path ? <path d={path} fill={color} fillOpacity={0.16} /> : <circle r={r} fill={color} fillOpacity={0.16} />}
                <KindIcon x={-7} y={-7} size={14} weight="bold" color="var(--viz-ink)" aria-hidden />
                <text y={node.focus ? -(r + 9) : r + 13} textAnchor="middle" className="fill-zinc-300 text-[10px]" style={{ paintOrder: 'stroke', stroke: 'var(--background)', strokeWidth: 3 }}>
                  {labelText}
                </text>
              </motion.g>
            )
          })}
        </svg>
      )}
      {activeNode && activePos && (
        <div className="viz-tooltip" style={{ left: Math.min(activePos.x + 18, Math.max(0, width - 230)), top: Math.max(0, activePos.y - 54) }}>
          <p className="mb-0.5 text-[11px] text-zinc-500">{NODE_KIND[activeNode.kind].label}</p>
          <p className="break-all font-medium text-zinc-50">{activeNode.label}</p>
          <p className="mt-1 text-[11px] text-zinc-400">
            {neighbours.get(activeNode.id)?.size ?? 0} conexiones
            {activeNode.kind === 'rule' && ` · ${activeNode.weight} alertas`}
            {activeNode.severity && ` · ${SEVERITY_STYLE[activeNode.severity].label}`}
          </p>
          {onSelect && <p className="mt-1 text-[11px] text-primary-link">{selectHint}</p>}
        </div>
      )}
    </div>
  )
}

export function GraphLegend({ graph }: { graph: EntityGraph }) {
  const kinds = (Object.keys(NODE_KIND) as NodeKind[]).filter((k) => graph.nodes.some((n) => n.kind === k))
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-zinc-400">
      {kinds.map((k) => {
        const KindIcon = NODE_KIND[k].icon
        return (
          <li key={k} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={`flex h-4 w-4 items-center justify-center border-2 ${k === 'rule' ? 'rotate-45 rounded-[2px]' : k === 'host' ? 'rounded-[4px]' : 'rounded-full'}`}
              style={{ borderColor: k === 'rule' ? 'var(--sev-critical)' : NODE_KIND[k].color }}
            >
              <KindIcon size={9} weight="bold" className={k === 'rule' ? '-rotate-45' : ''} />
            </span>
            {NODE_KIND[k].label}
          </li>
        )
      })}
      {graph.nodes.some((n) => n.kind === 'rule') && <li className="text-[11px] text-zinc-500">las detecciones toman el color de su severidad</li>}
    </ul>
  )
}
