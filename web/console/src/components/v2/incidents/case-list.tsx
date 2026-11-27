'use client'

// The cases: a filter by state with its counts and one card per case
// (severity, state, title, how many alerts and hosts, the owner, when it
// last moved). A case that just appeared lands with a short highlight;
// one opened by someone else is announced at the top for a few seconds.
import { useI18n } from '@/components/console/i18n-provider'
import { formatAgo } from '@/lib/soc-metrics'
import type { Incident } from '@/lib/engine-writes'
import { initials, type IncidentFilter } from '@/lib/v2/incidents-model'
import { SEV_COLOR } from '../home/parts'
import { useNow } from '../use-now'
import { StateChip } from './parts'

const FILTERS: readonly IncidentFilter[] = ['active', 'open', 'investigating', 'contained', 'closed', 'all']

export function CaseList({
  cases,
  counts,
  filter,
  onFilter,
  selectedId,
  onSelect,
  fresh,
}: {
  cases: Incident[]
  counts: Record<IncidentFilter, number>
  filter: IncidentFilter
  onFilter: (f: IncidentFilter) => void
  selectedId: string | null
  onSelect: (id: string) => void
  fresh: Set<string>
}) {
  const { dict, lang } = useI18n()
  const t = dict.v2.incidentsView
  const now = useNow(30_000)

  return (
    <>
      <div className="v2-chips" role="group" aria-label={t.filterAria}>
        {FILTERS.map((f) => (
          <button key={f} type="button" className="v2-chip-btn" aria-pressed={filter === f} onClick={() => onFilter(f)}>
            {t.filters[f]}
            <b key={counts[f]} className="v2-tick">
              {counts[f]}
            </b>
          </button>
        ))}
      </div>
      <ul className="v2-cases">
        {cases.map((c) => {
          const ago = now === null ? '' : formatAgo(Math.max(0, now - Date.parse(c.updated_at)), lang)
          return (
            <li key={c.id} data-selected={c.id === selectedId} data-fresh={fresh.has(c.id)}>
              <button type="button" className="v2-case" onClick={() => onSelect(c.id)} aria-pressed={c.id === selectedId}>
                <span className="v2-case-top">
                  <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[c.severity] }}>
                    {dict.v2.sev[c.severity]}
                  </span>
                  <StateChip status={c.status} />
                  {c.owner && (
                    <span className="v2-avatar v2-avatar-inline" title={c.owner} aria-label={c.owner}>
                      {initials(c.owner)}
                    </span>
                  )}
                </span>
                <strong>{c.title}</strong>
                <span className="v2-q-sub">
                  {t.caseMeta(c.alert_ids.length, c.hosts.length)}
                  {ago && ` · ${t.updated(ago)}`}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}
