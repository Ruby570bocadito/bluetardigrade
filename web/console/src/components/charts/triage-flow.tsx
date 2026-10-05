'use client'

// VIZ-3 — triage flow: a three-column flow diagram (declared source →
// ATT&CK tactic → triage state) drawn as a compact sankey. Node heights
// and ribbon widths share one scale, so both link sets visually sum to
// the same total. Ribbons stay neutral (the flow is the message, not a
// fourth color axis); state nodes reuse the lifecycle palette of the
// dashboard. Keyboard: arrows move across levels, Escape clears. No
// animation; the table twin of the panel carries the exact triples.

import { useState, type KeyboardEvent } from 'react'
import { ChartTooltip, useElementWidth } from './chart-frame'
import type { TriageFlowLink, TriageFlowModel, TriageFlowNode } from '@/lib/triage-flow'

const NODE_W = 12
const NODE_GAP = 4
const HEADER_H = 22
const M_LEFT = 122
const M_RIGHT = 104
const RIBBON_BASE = 0.3

type PlacedNode = TriageFlowNode & { x: number; y: number; h: number }
type PlacedLink = TriageFlowLink & { x0: number; x1: number; sy: number; ty: number; h: number }

/** Stack a column top-down, heights proportional to value, vertically centered. */
function placeColumn(nodes: TriageFlowNode[], x: number, total: number, scale: number, contentH: number, top: number): PlacedNode[] {
  const columnH = scale * total + NODE_GAP * Math.max(0, nodes.length - 1)
  let y = contentH > columnH ? top + Math.round((contentH - columnH) / 2) : top
  return nodes.map((n) => {
    const h = Math.max(1, n.value * scale)
    const placed = { ...n, x, y, h }
    y += h + NODE_GAP
    return placed
  })
}

/** Truncate a label to the character budget of its gutter. */
export function fitGutterLabel(label: string, maxChars: number): string {
  return label.length > maxChars ? label.slice(0, Math.max(1, maxChars - 1)) + '…' : label
}

/** Horizontal ribbon between two column edges with cubic bezier sides. */
export function ribbonPath(x0: number, x1: number, sy: number, ty: number, h: number): string {
  const mx = (x0 + x1) / 2
  return `M${x0},${sy} C${mx},${sy} ${mx},${ty} ${x1},${ty} L${x1},${ty + h} C${mx},${ty + h} ${mx},${sy + h} ${x0},${sy + h} Z`
}

export function TriageFlowChart({
  model,
  ariaLabel,
  unit,
  height = 320,
}: {
  model: TriageFlowModel
  ariaLabel: string
  /** what the counts are («alertas») */
  unit: string
  height?: number
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const [activeNode, setActiveNode] = useState<{ level: number; key: string } | null>(null)
  const [activeLink, setActiveLink] = useState<number | null>(null)
  const [cursorLevel, setCursorLevel] = useState(0) // keyboard cursor column

  const contentTop = HEADER_H
  const contentH = height - contentTop - 8
  const nodeX = [M_LEFT, Math.round((width - NODE_W) / 2), width - M_RIGHT - NODE_W]
  const total = model.total

  // one shared scale so every column represents the same total; the
  // column with the most nodes leaves the least room for gaps
  const maxNodes = Math.max(model.sources.length, model.tactics.length, model.states.length, 1)
  const scale = total > 0 ? Math.max(0, contentH - NODE_GAP * (maxNodes - 1)) / total : 0

  const sources = placeColumn(model.sources, nodeX[0], total, scale, contentH, contentTop)
  const tactics = placeColumn(model.tactics, nodeX[1], total, scale, contentH, contentTop)
  const states = placeColumn(model.states, nodeX[2], total, scale, contentH, contentTop)
  const columns = [sources, tactics, states]

  const nodeOf = (list: PlacedNode[], key: string) => list.find((n) => n.key === key)

  /**
   * Ribbon spans inside each node stack in the order that minimizes
   * crossings: the source side follows the counterpart's vertical
   * order, then the target side follows the origin's.
   */
  function withSpans(links: TriageFlowLink[], from: PlacedNode[], to: PlacedNode[], x0: number, x1: number): PlacedLink[] {
    const drawn: PlacedLink[] = links.map((l) => ({ ...l, x0, x1, sy: 0, ty: 0, h: l.value * scale }))
    const fromOffsets = new Map<string, number>()
    for (const l of [...drawn].sort((a, b) => (nodeOf(to, a.target)?.y ?? 0) - (nodeOf(to, b.target)?.y ?? 0))) {
      l.sy = fromOffsets.get(l.source) ?? nodeOf(from, l.source)?.y ?? 0
      fromOffsets.set(l.source, l.sy + l.h)
    }
    const toOffsets = new Map<string, number>()
    for (const l of [...drawn].sort((a, b) => (nodeOf(from, a.source)?.y ?? 0) - (nodeOf(from, b.source)?.y ?? 0))) {
      l.ty = toOffsets.get(l.target) ?? nodeOf(to, l.target)?.y ?? 0
      toOffsets.set(l.target, l.ty + l.h)
    }
    return drawn
  }

  const ribbons = [
    ...withSpans(model.sourceTactic, sources, tactics, nodeX[0] + NODE_W, nodeX[1]),
    ...withSpans(model.tacticState, tactics, states, nodeX[1] + NODE_W, nodeX[2]),
  ].map((r, i) => ({ ...r, i }))

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = columns[cursorLevel] ?? sources
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const from = activeNode && activeNode.level === cursorLevel ? list.findIndex((n) => n.key === activeNode.key) : -1
      const next = e.key === 'ArrowDown' ? Math.min(list.length - 1, from + 1) : Math.max(0, from < 0 ? 0 : from - 1)
      if (list[next]) setActiveNode({ level: cursorLevel, key: list[next].key })
      setActiveLink(null)
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const level = Math.min(2, Math.max(0, cursorLevel + (e.key === 'ArrowRight' ? 1 : -1)))
      setCursorLevel(level)
      const prev = activeNode && columns[activeNode.level] ? columns[activeNode.level].findIndex((n) => n.key === activeNode.key) : -1
      const idx = Math.min(columns[level].length - 1, Math.max(0, prev))
      if (columns[level][idx]) setActiveNode({ level, key: columns[level][idx].key })
      setActiveLink(null)
    } else if (e.key === 'Escape') {
      setActiveNode(null)
      setActiveLink(null)
    }
  }

  const srcChars = Math.floor((M_LEFT - 14) / 5.6)
  const tacChars = Math.max(4, Math.floor((nodeX[1] - nodeX[0] - NODE_W - 14) / 5.6))
  const stChars = Math.floor((M_RIGHT - NODE_W - 14) / 5.6)
  const labelFit = (level: number, label: string) => fitGutterLabel(label, level === 0 ? srcChars : level === 1 ? tacChars : stChars)

  const activeNodeData = (() => {
    if (!activeNode) return null
    const n = (columns[activeNode.level] ?? []).find((d) => d.key === activeNode.key)
    return n ? { ...n, level: activeNode.level } : null
  })()
  const activeLinkData = activeLink !== null ? ribbons[activeLink] ?? null : null

  const share = (value: number) => (total ? `${Math.round((value / total) * 100)} % de ${total} ${unit}` : unit)

  return (
    <div
      ref={ref}
      role="img"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={onKey}
      onBlur={() => {
        setActiveNode(null)
        setActiveLink(null)
      }}
      className="relative rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ height }}
    >
      {width > 0 && total > 0 && (
        <svg width={width} height={height} aria-hidden className="block">
          {/* column headers */}
          {([
            { x: nodeX[0], anchor: 'start', text: 'Fuente' },
            { x: nodeX[1] + NODE_W / 2, anchor: 'middle', text: 'Táctica' },
            { x: nodeX[2] + NODE_W, anchor: 'end', text: 'Estado' },
          ] as const).map((h) => (
            <text key={h.text} x={h.x} y={12} textAnchor={h.anchor} className="fill-zinc-500 text-[9px] uppercase tracking-wider">
              {h.text}
            </text>
          ))}

          {/* ribbons first, under the nodes */}
          {ribbons.map((r) => {
            const dim = (activeLink !== null && activeLink !== r.i) || activeNode !== null
            return (
              <path
                key={`${r.source}>${r.target}`}
                d={ribbonPath(r.x0, r.x1, r.sy, r.ty, r.h)}
                fill="var(--series-other)"
                opacity={activeLink === r.i ? 0.65 : dim ? 0.1 : RIBBON_BASE}
                onPointerEnter={() => setActiveLink(r.i)}
                onPointerLeave={() => setActiveLink(null)}
              >
                <title>{`${r.source} → ${r.target}: ${r.value}`}</title>
              </path>
            )
          })}

          {/* nodes and gutter labels */}
          {columns.map((list, level) => (
            <g key={level}>
              {list.map((n) => {
                const color = level === 0 ? 'var(--series-1)' : level === 1 ? 'var(--series-3)' : n.key === 'cerradas' ? 'var(--series-2)' : n.key === 'reconocidas' ? 'var(--series-3)' : 'var(--series-1)'
                const dim = activeNode !== null && !(activeNode.level === level && activeNode.key === n.key)
                return (
                  <rect
                    key={n.key}
                    x={n.x}
                    y={n.y}
                    width={NODE_W}
                    height={n.h}
                    rx={2}
                    fill={color}
                    opacity={dim ? 0.35 : 1}
                    onPointerEnter={() => {
                      setActiveNode({ level, key: n.key })
                      setCursorLevel(level)
                      setActiveLink(null)
                    }}
                    onPointerLeave={() => setActiveNode(null)}
                  >
                    <title>{`${n.label}: ${n.value}`}</title>
                  </rect>
                )
              })}
              {list.map((n) => {
                const yMid = n.y + n.h / 2
                const text = `${labelFit(level, n.label)} · ${n.value}`
                const pos = level === 0
                  ? { x: n.x - 8, anchor: 'end' as const }
                  : level === 1
                    ? { x: n.x - 8, anchor: 'end' as const }
                    : { x: n.x + NODE_W + 8, anchor: 'start' as const }
                return (
                  <text
                    key={n.key}
                    x={pos.x}
                    y={yMid}
                    dy="0.32em"
                    textAnchor={pos.anchor}
                    className="fill-zinc-400 text-[10px]"
                    style={level === 1 ? { paintOrder: 'stroke', stroke: 'var(--viz-surface)', strokeWidth: 3, strokeLinejoin: 'round' } : undefined}
                  >
                    {text}
                  </text>
                )
              })}
            </g>
          ))}
        </svg>
      )}

      {activeNodeData && (
        <ChartTooltip
          x={activeNodeData.x + NODE_W / 2}
          y={activeNodeData.y}
          width={width}
          title={activeNodeData.label}
          rows={[
            {
              key: activeNodeData.key,
              color: activeNodeData.level === 1 ? 'var(--series-3)' : activeNodeData.level === 2 && activeNodeData.key === 'cerradas' ? 'var(--series-2)' : 'var(--series-1)',
              value: activeNodeData.value,
              label: share(activeNodeData.value),
            },
          ]}
        />
      )}
      {activeLinkData && !activeNodeData && (
        <ChartTooltip
          x={(activeLinkData.x0 + activeLinkData.x1) / 2}
          y={(activeLinkData.sy + activeLinkData.ty) / 2}
          width={width}
          title={`${activeLinkData.source} → ${activeLinkData.target}`}
          rows={[{ key: 'link', color: 'var(--series-other)', value: activeLinkData.value, label: share(activeLinkData.value) }]}
        />
      )}
    </div>
  )
}
