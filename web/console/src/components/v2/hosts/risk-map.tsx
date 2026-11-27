'use client'

// The risk map (boceto 2): one tile per machine, grouped like the fleet,
// shaded by the engine's score next to the hottest machine. Tiles keep
// their identity, so a machine that heats up glides to its new place.
import { useLayoutEffect, useRef } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import { riskGroups, riskLevel, type HostRow } from '@/lib/v2/hosts-model'
import { Empty } from '../home/parts'
import { StatusPill } from './parts'

/** Slides each tile from where it was to where it is now (FLIP). */
function useGlide(dep: string) {
  const box = useRef<HTMLDivElement>(null)
  const last = useRef(new Map<string, DOMRect>())
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const next = new Map<string, DOMRect>()
    el.querySelectorAll<HTMLElement>('[data-tile]').forEach((tile) => {
      const id = tile.dataset.tile as string
      const now = tile.getBoundingClientRect()
      next.set(id, now)
      const before = last.current.get(id)
      if (!before || reduce) return
      const dx = before.left - now.left
      const dy = before.top - now.top
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
      tile.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' })
    })
    last.current = next
  }, [dep])
  return box
}

export function RiskMap({ rows, groupOrder, groupLabel, onOpen }: { rows: HostRow[]; groupOrder: string[]; groupLabel: (name: string) => string; onOpen: (host: string) => void }) {
  const { dict } = useI18n()
  const t = dict.v2.hostsView
  const groups = riskGroups(rows, groupOrder)
  const box = useGlide(groups.map((g) => g.rows.map((r) => `${r.host}${r.risk}`).join(',')).join('|'))

  if (rows.length === 0) return <Empty title={t.empty}>{t.emptyHint}</Empty>

  return (
    <div className="v2-riskmap" ref={box}>
      {!rows.some((r) => r.risk !== null) && <p className="v2-dim v2-small">{t.noRiskData}</p>}
      {groups.map((g) => (
        <section key={g.group ?? '_none'} className="v2-riskmap-group">
          <h3>
            {g.group === null ? t.groupNone : groupLabel(g.group)} <span className="v2-dim v2-mono">{g.rows.length}</span>
          </h3>
          <ul>
            {g.rows.map((r) => {
              const level = riskLevel(r.risk, rows)
              return (
                <li key={r.host} data-tile={r.host}>
                  <button type="button" className="v2-risktile" data-level={level} onClick={() => onOpen(r.host)}>
                    <span className="v2-risktile-top">
                      <strong className="v2-mono">{r.host}</strong>
                      <StatusPill status={r.status} />
                    </span>
                    <span className="v2-risktile-score v2-mono">{r.risk === null ? '—' : r.risk.toFixed(r.risk < 10 ? 1 : 0)}</span>
                    <span className="v2-dim v2-small">{r.openAlerts ? t.openAlerts(r.openAlerts) : t.riskLevels[level]}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      <p className="v2-riskmap-legend v2-small">
        {(['low', 'medium', 'high'] as const).map((l) => (
          <span key={l} data-level={l}>
            <i aria-hidden="true" />
            {t.riskLevels[l]}
          </span>
        ))}
        <span className="v2-dim">{t.riskLegend}</span>
      </p>
    </div>
  )
}
