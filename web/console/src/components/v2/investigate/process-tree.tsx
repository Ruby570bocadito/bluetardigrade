'use client'

// The process tree of one host (boceto 3): who launched whom, built only
// from the host's own events. The branch that leads to an alert is drawn
// in amber and opens by itself; a parent that was never seen stays a bare
// PID. Levels unfold one after another when the tree first appears.
import { useEffect, useMemo, useRef, useState } from 'react'
import { CaretRight } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { formatTime, type SfAlert, type SfEvent } from '@/lib/console-types'
import { countNodes, flattenForest, matchEvent, parentIndex, processForest, type ProcNode, type QueryToken } from '@/lib/v2/investigate-model'
import { Empty, SEV_COLOR } from '../home/parts'

export function ProcessTree({
  events,
  alerts,
  host,
  focusPid,
  tokens,
  selectedId,
  onSelect,
}: {
  events: readonly SfEvent[]
  alerts: readonly SfAlert[]
  host: string
  focusPid: number | null
  tokens: readonly QueryToken[]
  selectedId: string | null
  onSelect: (ev: SfEvent) => void
}) {
  const { dict, lang } = useI18n()
  const t = dict.v2.investigateView
  const roots = useMemo(() => processForest(events, alerts, host), [events, alerts, host])
  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events])
  const parents = useMemo(() => parentIndex(events), [events])
  // the query's own tokens light up matching processes (the host is the scope, not a match)
  const marks = tokens.filter((x) => x.field !== 'host')
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const [all, setAll] = useState<boolean | null>(null)
  const focusRow = useRef<HTMLLIElement>(null)

  // the path from a root to the focused process opens by itself
  const focusPath = useMemo(() => {
    const keys = new Set<string>()
    if (focusPid === null) return keys
    const walk = (n: ProcNode, trail: string[]): boolean => {
      if (n.pid === focusPid && n.seen) {
        trail.forEach((k) => keys.add(k))
        return true
      }
      return n.children.some((c) => walk(c, [...trail, n.key]))
    }
    roots.forEach((r) => walk(r, []))
    return keys
  }, [roots, focusPid])

  useEffect(() => {
    setToggled({})
    setAll(null)
  }, [host])

  useEffect(() => {
    focusRow.current?.scrollIntoView({ block: 'nearest' })
  }, [focusPid, host])

  const isOpen = (n: ProcNode) => {
    if (n.key in toggled) return toggled[n.key]
    if (all !== null) return all
    return n.hot || focusPath.has(n.key) || n.children.length <= 2
  }
  const rows = flattenForest(roots, isOpen)

  if (roots.length === 0) return <Empty title={t.treeEmpty} />

  return (
    <div className="v2-tree-wrap">
      <div className="v2-tree-head">
        <span className="v2-dim v2-small">{t.treeCount(countNodes(roots))}</span>
        <span className="v2-tree-legend v2-small">
          <i aria-hidden="true" />
          {t.treeLegend}
        </span>
        <div className="v2-actions">
          <button type="button" className="v2-btn" onClick={() => (setToggled({}), setAll(true))}>
            {t.expandAll}
          </button>
          <button type="button" className="v2-btn" onClick={() => (setToggled({}), setAll(false))}>
            {t.collapseAll}
          </button>
        </div>
      </div>
      <ol className="v2-tree" role="tree" aria-label={t.treeAria(host)} key={host}>
        {rows.map(({ node, depth }) => {
          const ev = node.eventId ? byId.get(node.eventId) : undefined
          const match = marks.length > 0 && !!ev && matchEvent(ev, marks, parents)
          const open = node.children.length > 0 && isOpen(node)
          const focused = focusPid !== null && node.pid === focusPid && node.seen
          return (
            <li
              key={node.key}
              ref={focused ? focusRow : undefined}
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={node.children.length ? open : undefined}
              aria-selected={!!ev && ev.id === selectedId}
              className="v2-tree-row"
              data-hot={node.hot}
              data-seen={node.seen}
              data-match={match}
              data-focus={focused}
              style={{ ['--depth' as string]: depth }}
            >
              {node.children.length > 0 ? (
                <button
                  type="button"
                  className="v2-tree-toggle"
                  aria-label={t.toggleNode(node.name)}
                  onClick={() => setToggled((s) => ({ ...s, [node.key]: !open }))}
                >
                  <CaretRight aria-hidden="true" data-open={open} />
                </button>
              ) : (
                <span className="v2-tree-toggle" aria-hidden="true" />
              )}
              <button type="button" className="v2-tree-node" disabled={!ev} onClick={() => ev && onSelect(ev)}>
                <span className="v2-tree-name v2-mono">{node.name}</span>
                <span className="v2-tree-meta v2-mono v2-dim">
                  {node.seen ? `pid ${node.pid}` : t.notSeen}
                  {node.user ? ` · ${node.user}` : ''}
                  {node.start ? ` · ${formatTime(node.start, lang)}` : ''}
                </span>
                {node.cmd && node.cmd !== node.name && (
                  <span className="v2-tree-cmd v2-mono" title={node.cmd}>
                    {node.cmd}
                  </span>
                )}
                <span className="v2-tree-tags">
                  {node.activity.network > 0 && <span className="v2-tag">{t.activity.network(node.activity.network)}</span>}
                  {node.activity.file > 0 && <span className="v2-tag">{t.activity.file(node.activity.file)}</span>}
                  {node.activity.registry > 0 && <span className="v2-tag">{t.activity.registry(node.activity.registry)}</span>}
                  {match && <span className="v2-tag v2-tag-match">{t.matchesQuery}</span>}
                  {node.alerts.map((a) => (
                    <span key={a.id ?? a.rule_id} className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[a.severity] }} title={a.rule_name}>
                      {a.rule_name}
                    </span>
                  ))}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
