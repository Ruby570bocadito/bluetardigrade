'use client'

// Relationships between machines (boceto 9): fleet machines on an inner
// ring, outside destinations on an outer one, a line per relationship as
// thick as its connections. Lines with alerts draw last, in amber. The
// drawing takes the real width of its frame.
import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import type { SfAlert, SfEvent } from '@/lib/console-types'
import { relations, type HostRow } from '@/lib/v2/hosts-model'
import { Empty } from '../home/parts'

export function RelationsGraph({ rows, events, alerts, onOpen }: { rows: HostRow[]; events: readonly SfEvent[]; alerts: readonly SfAlert[]; onOpen: (host: string) => void }) {
  const { dict } = useI18n()
  const t = dict.v2.hostsView
  const { nodes, edges } = useMemo(() => relations(rows, events, alerts), [rows, events, alerts])
  const [frame, setFrame] = useState<HTMLElement | null>(null)
  const [W, setW] = useState(0)
  useEffect(() => {
    if (!frame) return undefined
    const ro = new ResizeObserver(([e]) => {
      const next = Math.round(e.contentRect.width)
      setW((prev) => (Math.abs(prev - next) < 24 ? prev : next))
    })
    ro.observe(frame)
    return () => ro.disconnect()
  }, [frame])

  if (edges.length === 0) return <Empty title={t.relEmpty} />

  const H = W < 520 ? Math.round(W * 1.05) : Math.round(Math.min(480, Math.max(340, W * 0.55)))
  const cx = W / 2
  const cy = H / 2
  const hosts = nodes.filter((n) => n.kind === 'host')
  const ext = nodes.filter((n) => n.kind === 'external')
  const rIn = Math.min(W, H) * (ext.length ? 0.2 : 0.32)
  const rOut = Math.min(W, H) * 0.4
  const pos = new Map<string, { x: number; y: number }>()
  hosts.forEach((n, i) => {
    const a = (i / Math.max(1, hosts.length)) * Math.PI * 2 - Math.PI / 2
    pos.set(n.id, hosts.length === 1 ? { x: cx, y: cy } : { x: cx + Math.cos(a) * rIn * (W / H > 1.3 ? 1.5 : 1), y: cy + Math.sin(a) * rIn })
  })
  ext.forEach((n, i) => {
    const a = (i / Math.max(1, ext.length)) * Math.PI * 2 - Math.PI / 2 + Math.PI / Math.max(2, ext.length)
    pos.set(n.id, { x: cx + Math.cos(a) * rOut * (W / H > 1.3 ? 1.5 : 1), y: cy + Math.sin(a) * rOut })
  })
  const maxConn = Math.max(1, ...edges.map((e) => e.connections))
  const ordered = [...edges].sort((a, b) => Number(a.alerted) - Number(b.alerted))
  const start = nodes.length * 50 + 100

  return (
    <figure className="v2-relations" ref={setFrame}>
      <figcaption className="v2-relations-head">
        <strong>{t.relTitle}</strong>
        <span className="v2-dim v2-small">{t.relHint}</span>
      </figcaption>
      {W > 0 && (
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={t.relAria(nodes.length, edges.length)}>
          {ordered.map((e, i) => {
            const a = pos.get(e.from)
            const b = pos.get(e.to)
            if (!a || !b) return null
            const len = Math.hypot(b.x - a.x, b.y - a.y)
            const fromLabel = nodes.find((n) => n.id === e.from)?.label ?? ''
            const toLabel = nodes.find((n) => n.id === e.to)?.label ?? ''
            return (
              <line
                key={`${e.from}>${e.to}`}
                className="v2-rel-edge"
                data-alerted={e.alerted}
                data-internal={e.to.startsWith('host:')}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                style={{ strokeWidth: 1 + (e.connections / maxConn) * 4, ['--len' as string]: `${len.toFixed(1)}`, ['--d' as string]: `${start + i * 70}ms` }}
              >
                <title>{t.relEdge(fromLabel, toLabel, e.connections, e.ports.sort((x, y) => x - y).join(', '))}</title>
              </line>
            )
          })}
          {nodes.map((n, i) => {
            const p = pos.get(n.id)
            if (!p) return null
            const anchor = p.x < 90 ? 'start' : p.x > W - 90 ? 'end' : 'middle'
            const r = n.kind === 'host' ? 9 : 6
            return (
              <g
                key={n.id}
                className="v2-rel-node"
                data-kind={n.kind}
                transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
                style={{ ['--d' as string]: `${i * 50}ms` }}
                tabIndex={n.kind === 'host' ? 0 : undefined}
                role={n.kind === 'host' ? 'link' : undefined}
                aria-label={n.kind === 'host' ? n.label : undefined}
                onClick={n.kind === 'host' ? () => onOpen(n.label) : undefined}
                onKeyDown={
                  n.kind === 'host'
                    ? (e) => {
                        if (e.key === 'Enter') onOpen(n.label)
                      }
                    : undefined
                }
              >
                <circle r={r} />
                <text x={anchor === 'start' ? -r : anchor === 'end' ? r : 0} y={r + 15} textAnchor={anchor}>
                  {n.label}
                </text>
              </g>
            )
          })}
        </svg>
      )}
      <p className="v2-map-legend v2-relations-legend">
        <span data-kind="host">
          <i aria-hidden="true" />
          {t.relLegend.host}
        </span>
        <span data-kind="external">
          <i aria-hidden="true" />
          {t.relLegend.external}
        </span>
        <span data-kind="alerted">
          <i aria-hidden="true" />
          {t.relLegend.alerted}
        </span>
      </p>
    </figure>
  )
}
