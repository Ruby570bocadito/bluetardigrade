'use client'

// The lens of the queue: search, state, assignment, live or history, and
// one chip per severity with how many alerts it holds under the rest of
// the lens (no counts on a history page: they would only describe it).
import { useId, type ReactNode } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { alertStateFromParam, type AlertScope, type AssigneeLens } from '@/lib/alert-search'
import { SEVERITIES } from '@/lib/soc-metrics'
import { MAX_QUERY_CHARS, type SeverityFilter } from '@/lib/url-state'
import type { Severity } from '@/lib/console-types'
import type { QueueLens } from '@/lib/v2/alerts-model'
import { SEV_COLOR } from '../home/parts'

const STATES = ['all', 'open', 'new', 'acknowledged', 'closed'] as const
const ASSIGNEES = ['all', 'mine', 'unassigned'] as const

export function QueueToolbar({
  lens,
  onLens,
  chips,
  scope,
  onScope,
  saved,
}: {
  lens: QueueLens
  onLens: (patch: Partial<QueueLens>) => void
  chips: (Record<Severity, number> & { all: number }) | null
  scope: AlertScope
  onScope: (scope: AlertScope) => void
  /** the saved searches menu, at the end of the first row */
  saved?: ReactNode
}) {
  const { dict } = useI18n()
  const t = dict.v2.alertsView
  const id = useId()
  const sevChip = (sev: SeverityFilter, label: string, count: number | null, color?: string) => (
    <button
      key={sev}
      type="button"
      className="v2-chip-btn"
      aria-pressed={lens.sev === sev}
      onClick={() => onLens({ sev: lens.sev === sev && sev !== 'all' ? 'all' : sev })}
      style={color ? { ['--c' as string]: color } : undefined}
    >
      {color && <i aria-hidden="true" />}
      {label}
      {count !== null && (
        <b key={count} className="v2-tick">
          {count}
        </b>
      )}
    </button>
  )

  return (
    <div className="v2-toolbar" role="group" aria-label={t.filtersAria}>
      <div className="v2-toolbar-row">
        <label className="v2-search">
          <MagnifyingGlass aria-hidden="true" />
          <span className="v2-sr-only">{dict.alerts.searchAria}</span>
          <input
            type="search"
            value={lens.q}
            maxLength={MAX_QUERY_CHARS}
            placeholder={dict.alerts.searchPlaceholder}
            onChange={(e) => onLens({ q: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && lens.q) {
                e.stopPropagation()
                onLens({ q: '' })
              }
            }}
          />
        </label>
        <label className="v2-select">
          <span>{t.stateLabel}</span>
          <select id={`${id}-state`} value={lens.state} onChange={(e) => onLens({ state: alertStateFromParam(e.target.value) })}>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {dict.alerts.stateOptions[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="v2-select">
          <span>{t.assigneeLabel}</span>
          <select value={lens.assignee} onChange={(e) => onLens({ assignee: e.target.value as AssigneeLens })}>
            {ASSIGNEES.map((a) => (
              <option key={a} value={a}>
                {dict.alerts.assigneeOptions[a]}
              </option>
            ))}
          </select>
        </label>
        {saved}
      </div>
      <div className="v2-toolbar-row v2-toolbar-split">
        <div className="v2-chips" role="group" aria-label={dict.alerts.sevFilterAria}>
          {sevChip('all', t.allSeverities, chips ? chips.all : null)}
          {SEVERITIES.map((s) => sevChip(s, dict.v2.sev[s], chips ? chips[s] : null, SEV_COLOR[s]))}
        </div>
        <div className="v2-seg" role="group" aria-label={dict.alerts.scopeGroupAria}>
          <button type="button" aria-pressed={scope === 'live'} onClick={() => onScope('live')}>
            {dict.alerts.scopeLive}
          </button>
          <button type="button" aria-pressed={scope === 'history'} onClick={() => onScope('history')}>
            {dict.alerts.scopeHistory}
          </button>
        </div>
      </div>
    </div>
  )
}
