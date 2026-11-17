'use client'

// What has happened in the case: its summary (editable with triage
// rights), a note box, and the engine's timeline of the case, newest first.
// An entry that just arrived slides in at the top.
import { useState } from 'react'
import { ClockCounterClockwise, Lightning, NotePencil, Plus, ShieldWarning, UserCircle, type Icon } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { addIncidentNote, updateIncident, type Incident, type IncidentEntry } from '@/lib/engine-writes'
import { formatDateTime } from '@/lib/console-types'
import { activity } from '@/lib/v2/incidents-model'
import { useFreshKeys } from '../alerts/queue-table'
import { useCaseWrite, useEntryText } from './parts'

const KIND_ICON: Record<IncidentEntry['kind'], Icon> = {
  created: Plus,
  status: ClockCounterClockwise,
  severity: ShieldWarning,
  owner: UserCircle,
  alerts: Lightning,
  note: NotePencil,
}

export function CaseActivity({ incident }: { incident: Incident }) {
  const { dict, lang } = useI18n()
  const say = useEntryText()
  const t = dict.v2.incidentsView
  const { busy, error, run, can } = useCaseWrite()
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState(false)
  const [summary, setSummary] = useState(incident.summary ?? '')
  const entries = activity(incident)
  const fresh = useFreshKeys(entries.map((e) => e.key))

  return (
    <div className="v2-case-activity">
      <section className="v2-box">
        <div className="v2-box-head">
          <h3>{t.summary}</h3>
          {can && !editing && (
            <button
              type="button"
              className="v2-link"
              onClick={() => {
                setSummary(incident.summary ?? '')
                setEditing(true)
              }}
            >
              {t.editSummary}
            </button>
          )}
        </div>
        {editing ? (
          <form
            className="v2-actions"
            onSubmit={async (e) => {
              e.preventDefault()
              if (await run((by) => updateIncident(incident.id, { summary: summary.trim() }, by))) setEditing(false)
            }}
          >
            <textarea className="v2-input v2-textarea" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={4000} rows={4} aria-label={t.summary} />
            <button type="submit" className="v2-btn v2-btn-primary" disabled={busy}>
              {t.saveSummary}
            </button>
            <button type="button" className="v2-btn" onClick={() => setEditing(false)}>
              {t.cancel}
            </button>
          </form>
        ) : (
          <p className={incident.summary ? 'v2-small' : 'v2-dim v2-small'}>{incident.summary || t.noSummary}</p>
        )}
      </section>

      {can && (
        <form
          className="v2-actions"
          onSubmit={async (e) => {
            e.preventDefault()
            if (note.trim() && (await run((by) => addIncidentNote(incident.id, note.trim(), by)))) setNote('')
          }}
        >
          <input className="v2-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder={t.notePlaceholder} aria-label={t.notePlaceholder} />
          <button type="submit" className="v2-btn" disabled={busy || !note.trim()}>
            {t.addNote}
          </button>
        </form>
      )}
      {error && (
        <p className="v2-error" role="alert">
          {error}
        </p>
      )}

      {entries.length === 0 ? (
        <p className="v2-dim v2-small">{t.noActivity}</p>
      ) : (
        <ol className="v2-feed">
          {entries.map((e) => {
            const Glyph = KIND_ICON[e.kind] ?? NotePencil
            return (
              <li key={e.key} data-kind={e.kind} data-fresh={fresh.has(e.key)}>
                <span className="v2-feed-icon" aria-hidden="true">
                  <Glyph />
                </span>
                <div>
                  <p>{say(e)}</p>
                  <span className="v2-dim v2-mono">
                    {formatDateTime(e.at, lang)}
                    {e.by ? ` · ${e.by}` : ''}
                  </span>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
