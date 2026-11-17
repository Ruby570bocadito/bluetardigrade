'use client'

// The case as a graph of entities: hosts, users, processes, rules and the
// destinations they talked to, built only from the case's alerts and its
// hosts' own events (lib/entity-graph: a missing link stays missing). On
// opening, the entities appear and the links draw themselves; the links
// the alerts walk along (the attack path) draw last, in amber. The drawing
// takes the real width of its frame, so the labels stay readable from a
// wide screen down to a phone.
import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import { useEngine } from '@/components/console/engine-provider'
import type { Incident } from '@/lib/engine-writes'
import { buildEntityGraph, layoutGraph, type NodeKind } from '@/lib/entity-graph'
import { caseAlerts, caseEvents } from '@/lib/v2/incidents-model'
import { SEV_COLOR } from '../home/parts'

// a phone gets a squarer canvas, a wide screen a landscape one
function graphHeight(width: number): number {
  if (width < 520) return Math.round(width * 1.1)
  return Math.round(Math.min(460, Math.max(320, width * 0.56)))
}

const KIND_COLOR: Record<NodeKind, string> = {
  host: '#5b9cff',
  user: '#4fc1c1',
  process: '#a3a4ab',
  destination: '#e7e7ea',
  rule: '#f5a524',
}

export function CaseGraph({ incident }: { incident: Incident }) {
  const { dict } = useI18n()
  const t = dict.v2.incidentsView
  const { alerts, events } = useEngine()
  const graph = useMemo(() => buildEntityGraph(caseAlerts(incident, alerts), caseEvents(incident, events)), [incident, alerts, events])
  const [frame, setFrame] = useState<HTMLElement | null>(null)
  const [W, setW] = useState(0)
  useEffect(() => {
    if (!frame) return undefined
    // small changes (a scrollbar coming and going) keep the drawing as it is
    const ro = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width)
      setW((prev) => (Math.abs(prev - next) < 24 ? prev : next))
    })
    ro.observe(frame)
    return () => ro.disconnect()
  }, [frame])
  const H = graphHeight(W)
  const pos = useMemo(() => layoutGraph(graph, W, H), [graph, W, H])
  const maxLabel = W < 520 ? 16 : 22

  if (graph.nodes.length === 0) return <p className="v2-dim v2-small">{t.graphEmpty}</p>

  const nodeDelay = new Map(graph.nodes.map((n, i) => [n.id, i * 45]))
  const start = graph.nodes.length * 45 + 120
  const ordered = [...graph.edges].sort((a, b) => Number(!!a.hot) - Number(!!b.hot))
  const hot = graph.edges.filter((e) => e.hot).length
  const kinds = [...new Set(graph.nodes.map((n) => n.kind))]

  return (
    <figure className="v2-graph" ref={setFrame}>
      {W > 0 && (
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={t.graphAria(graph.nodes.length, hot)}>
          {ordered.map((e, i) => {
            const a = pos.get(e.source)
            const b = pos.get(e.target)
            if (!a || !b) return null
            const len = Math.hypot(b.x - a.x, b.y - a.y)
            return (
              <line
                key={`${e.source}>${e.target}`}
                className="v2-g-edge"
                data-hot={!!e.hot}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                style={{ ['--len' as string]: `${len.toFixed(1)}`, ['--d' as string]: `${start + i * 60}ms` }}
              />
            )
          })}
          {graph.nodes.map((n) => {
            const p = pos.get(n.id)
            if (!p) return null
            const r = 6 + Math.min(8, Math.sqrt(n.weight) * 2)
            const color = n.kind === 'rule' && n.severity ? SEV_COLOR[n.severity] : KIND_COLOR[n.kind]
            // labels near a side grow inwards instead of off the frame
            const anchor = p.x < 80 ? 'start' : p.x > W - 80 ? 'end' : 'middle'
            return (
              <g key={n.id} className="v2-g-node" transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`} style={{ ['--d' as string]: `${nodeDelay.get(n.id)}ms` }}>
                <title>{`${t.kinds[n.kind]} · ${n.label}`}</title>
                <circle r={r} style={{ stroke: color }} />
                <text x={anchor === 'start' ? -r : anchor === 'end' ? r : 0} y={r + 14} textAnchor={anchor}>
                  {n.label.length > maxLabel ? `${n.label.slice(0, maxLabel - 1)}…` : n.label}
                </text>
              </g>
            )
          })}
        </svg>
      )}
      <figcaption className="v2-map-legend">
        {kinds.map((k) => (
          <span key={k}>
            <i style={{ background: 'transparent', boxShadow: `inset 0 0 0 2px ${KIND_COLOR[k]}` }} aria-hidden="true" />
            {t.kinds[k]}
          </span>
        ))}
        {hot > 0 && (
          <span>
            <i className="v2-g-legend-path" aria-hidden="true" />
            {t.graphPath}
          </span>
        )}
      </figcaption>
    </figure>
  )
}
