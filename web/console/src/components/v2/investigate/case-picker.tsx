'use client'

// "Añadir a un caso": a note on one of the open cases, signed like every
// other case write. Hidden without the incidents API or triage rights.
import { useMemo, useState } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import { useIncidents } from '@/components/console/incidents-provider'
import { addIncidentNote } from '@/lib/engine-writes'
import { useCaseWrite } from '../incidents/parts'

export function CasePicker({ note, onDone, compact = false }: { note: string; onDone: (message: string) => void; compact?: boolean }) {
  const { dict } = useI18n()
  const t = dict.v2.investigateView
  const { incidents, available } = useIncidents()
  const write = useCaseWrite()
  const [open, setOpen] = useState(false)
  const cases = useMemo(() => incidents.filter((i) => i.status !== 'closed').sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [incidents])

  if (!available || !write.can) return null
  return (
    <div className="v2-popover-anchor">
      <button type="button" className={compact ? 'v2-link' : 'v2-btn'} aria-expanded={open} onClick={() => setOpen((o) => !o)} disabled={write.busy}>
        {t.addToCase}
      </button>
      {open && (
        <div className="v2-popover" role="dialog" aria-label={t.pickCase}>
          <strong>{t.pickCase}</strong>
          {cases.length === 0 ? (
            <p className="v2-dim v2-small">{t.noCases}</p>
          ) : (
            <ul className="v2-saved-list">
              {cases.map((inc) => (
                <li key={inc.id}>
                  <button
                    type="button"
                    className="v2-saved-main"
                    onClick={async () => {
                      const done = await write.run((by) => addIncidentNote(inc.id, note, by))
                      setOpen(false)
                      if (done) onDone(t.addedToCase(inc.title))
                    }}
                  >
                    <span>{inc.title}</span>
                    <span className="v2-mono v2-dim v2-small">{inc.id}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {write.error && <p className="v2-error">{write.error}</p>}
    </div>
  )
}
