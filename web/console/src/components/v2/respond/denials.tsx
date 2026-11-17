'use client'

// Respuesta · Por qué se denegó: the refused attempts grouped by the reason
// the engine gave, each with how often it happened, the latest case and
// what to do about it — a denial is the safety layers working, and each
// one names which layer said no.
import { useState } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import type { SfRespondRecord } from '@/lib/console-types'
import { denialGroups } from '@/lib/v2/respond-model'
import { Empty } from '../home/parts'
import { AttemptLine, useDenial } from './parts'

export function Denials({ records, now }: { records: SfRespondRecord[]; now: number | null }) {
  const { dict } = useI18n()
  const t = dict.v2.respondView
  const denial = useDenial()
  const [open, setOpen] = useState<string | null>(null)
  const groups = denialGroups(records)

  return (
    <div className="v2-den">
      <div>
        <h2>{t.denTitle}</h2>
        <p className="v2-small v2-dim">{t.denHint}</p>
      </div>
      {groups.length === 0 ? (
        <Empty title={t.denNone} />
      ) : (
        <ul className="v2-den-list">
          {groups.map((g) => {
            const d = denial(g.code)
            const expanded = open === g.code
            const list = records.filter((r) => r.decision === 'denied' && (r.code || 'unknown') === g.code).slice(0, 8)
            return (
              <li key={g.code} className="v2-den-card">
                <header>
                  <strong>{d.title}</strong>
                  <span className="v2-mono v2-den-count">{t.denTimes(g.count)}</span>
                  <code className="v2-dim">{g.code}</code>
                </header>
                {d.fix && <p className="v2-small">{d.fix}</p>}
                <div className="v2-den-latest">
                  <span className="v2-eyebrow">{t.denLatest}</span>
                  <AttemptLine r={g.latest} now={now} />
                </div>
                <div className="v2-den-foot v2-small v2-dim">
                  <span>{t.denWho(g.operators.join(', ') || '—')}</span>
                  {g.count > 1 && (
                    <button type="button" className="v2-link" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : g.code)}>
                      {expanded ? t.denHide : t.denShow}
                    </button>
                  )}
                </div>
                {expanded && (
                  <ul className="v2-attempts">
                    {list.map((r) => (
                      <li key={r.action_id}>
                        <AttemptLine r={r} now={now} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
