'use client'

// Respuesta · Sala de crisis: one active case in one line of time — its
// alerts, the response attempts on its hosts, the state changes and the
// notes — with how long it has been open (or how long it took to contain),
// the machines and accounts it touches, and its state to move forward.
import { useMemo } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import type { SfAlert, SfRespondRecord } from '@/lib/console-types'
import { formatDuration } from '@/lib/fleet'
import { updateIncident, type Incident, type IncidentStatus } from '@/lib/engine-writes'
import { v2HostLink } from '@/lib/v2/hosts-model'
import { v2IncidentLink } from '@/lib/v2/incidents-model'
import { affected, containedAt, pickWarIncident, warTimeline, type WarMarker } from '@/lib/v2/respond-model'
import { Empty, SEV_COLOR } from '../home/parts'
import { StateChip, Stepper, useCaseWrite, useEntryText } from '../incidents/parts'
import { When } from './parts'

export function WarRoom({
  incidents,
  available,
  caseId,
  onCase,
  alerts,
  records,
  now,
}: {
  incidents: Incident[]
  available: boolean
  caseId: string | null
  onCase: (id: string) => void
  alerts: SfAlert[]
  records: SfRespondRecord[]
  now: number | null
}) {
  const { dict } = useI18n()
  const t = dict.v2.respondView
  const entryText = useEntryText()
  const { run, busy, can, error } = useCaseWrite()
  const options = useMemo(
    () => [...incidents].sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || b.updated_at.localeCompare(a.updated_at)),
    [incidents],
  )
  const incident = incidents.find((i) => i.id === caseId) ?? pickWarIncident(incidents)
  const marks = useMemo(() => (incident ? warTimeline(incident, alerts, records) : []), [incident, alerts, records])

  if (!available) return <Empty title={t.incidentsOff} />
  if (!incident) return <Empty title={t.warNone} />

  const start = Date.parse(incident.created_at)
  const end = now ?? Date.now()
  const span = Math.max(1, end - start)
  const contained = containedAt(incident)
  const who = affected(incident, alerts)
  const clock = contained
    ? t.warContainedIn(formatDuration((Date.parse(contained) - start) / 1000))
    : incident.status === 'closed'
      ? t.warOpenFor(formatDuration((end - start) / 1000))
      : t.warNotContained(formatDuration((end - start) / 1000))

  const text = (m: WarMarker) => (m.kind === 'status' || m.kind === 'note' || m.kind === 'created' ? entryText({ kind: m.kind, text: m.text }) : m.text)

  return (
    <div className="v2-war">
      <div className="v2-war-bar">
        <label className="v2-select">
          <span className="v2-sr-only">{t.warPick}</span>
          <select value={incident.id} onChange={(e) => onCase(e.target.value)}>
            {options.map((i) => (
              <option key={i.id} value={i.id}>
                {`${dict.incidents.statusLabels[i.status]} · ${i.title}`}
              </option>
            ))}
          </select>
        </label>
        <a className="v2-link v2-small" href={v2IncidentLink(incident.id)}>
          {t.warOpenCase}
        </a>
      </div>

      <header className="v2-war-head">
        <div className="v2-detail-tags">
          <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[incident.severity] }}>
            {dict.v2.sev[incident.severity]}
          </span>
          <StateChip status={incident.status} />
        </div>
        <h2>{incident.title}</h2>
        <p className="v2-war-clock" data-contained={!!contained}>
          {clock}
        </p>
      </header>

      <div className="v2-war-track" role="img" aria-label={t.warTrackAria(marks.length)}>
        <i className="v2-war-line" aria-hidden="true" />
        {marks.map((m, i) => {
          const at = Date.parse(m.at)
          const x = Math.min(100, Math.max(0, ((at - start) / span) * 100))
          return <span key={`${m.at}|${i}`} className="v2-war-dot" data-kind={m.kind} style={{ ['--x' as string]: `${x}%` }} title={`${t.warKinds[m.kind]} · ${text(m)}`} />
        })}
      </div>

      <div className="v2-war-grid">
        <ol className="v2-war-list" aria-label={t.warTitle}>
          {marks.length === 0 ? (
            <li className="v2-small v2-dim">{t.warEmpty}</li>
          ) : (
            marks.map((m, i) => (
              <li key={`${m.at}|${i}`} data-kind={m.kind}>
                <span className="v2-war-mark" aria-hidden="true" />
                <span className="v2-war-time v2-small v2-dim">
                  <When iso={m.at} now={now} />
                </span>
                <span className="v2-war-body">
                  <strong>{t.warKinds[m.kind]}</strong>
                  {m.kind === 'alert' && m.severity && (
                    <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[m.severity] }}>
                      {dict.v2.sev[m.severity]}
                    </span>
                  )}
                  <span className="v2-small">{text(m)}</span>
                  {m.by && <span className="v2-small v2-dim">· {m.by}</span>}
                </span>
              </li>
            ))
          )}
        </ol>
        <aside className="v2-war-side">
          <div>
            <h3 className="v2-eyebrow">{t.warState}</h3>
            <Stepper
              status={incident.status}
              disabled={!can || busy}
              onPick={(s: IncidentStatus) => void run((by) => updateIncident(incident.id, { status: s }, by))}
            />
            {error && (
              <p className="v2-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div>
            <h3 className="v2-eyebrow">{t.warHosts}</h3>
            <ul className="v2-plainlist">
              {who.hosts.map((h) => (
                <li key={h}>
                  <a className="v2-link v2-mono" href={v2HostLink(h)}>
                    {h}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="v2-eyebrow">{t.warUsers}</h3>
            {who.users.length === 0 ? (
              <p className="v2-small v2-dim">{t.warNoUsers}</p>
            ) : (
              <ul className="v2-plainlist">
                {who.users.map((u) => (
                  <li key={u} className="v2-mono">
                    {u}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
