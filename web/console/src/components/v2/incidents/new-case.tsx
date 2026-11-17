'use client'

// A new case from alerts: the open alerts that are in no case yet, a
// title that follows the pick until it is edited, and the count of alerts
// and hosts going in. On creating, the picked alerts leave toward the
// list, where the new case lands.
import { useMemo, useState } from 'react'
import { X } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { useEngine } from '@/components/console/engine-provider'
import { useIncidents } from '@/components/console/incidents-provider'
import { createIncident } from '@/lib/engine-writes'
import { formatTime } from '@/lib/console-types'
import { candidateAlerts, hostsOf, worstSeverity } from '@/lib/v2/incidents-model'
import { SEV_COLOR } from '../home/parts'
import { useCaseWrite } from './parts'

export function NewCase({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.incidentsView
  const w = dict.alertActions
  const { alerts } = useEngine()
  const { incidents } = useIncidents()
  const { busy, error, run, can } = useCaseWrite()
  const candidates = useMemo(() => candidateAlerts(alerts, incidents).slice(0, 60), [alerts, incidents])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [title, setTitle] = useState('')
  const [edited, setEdited] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const chosen = candidates.filter((a) => a.id && picked.has(a.id))
  const hosts = hostsOf(chosen)
  const suggested =
    chosen.length === 0
      ? ''
      : chosen.length === 1
        ? w.incidentDefaultOne(chosen[0].rule_name, chosen[0].host)
        : w.incidentDefaultMany(chosen.length, `${hosts.slice(0, 2).join(', ')}${hosts.length > 2 ? '…' : ''}`)
  const shownTitle = edited ? title : suggested

  async function submit() {
    if (!shownTitle.trim() || chosen.length === 0) return
    const created = await run((by) =>
      createIncident({ title: shownTitle.trim(), severity: worstSeverity(chosen), alert_ids: chosen.map((a) => a.id!).slice(0, 500), hosts, by }),
    )
    if (!created) return
    setLeaving(true)
    window.setTimeout(() => onCreated(created.id), 380)
  }

  return (
    <div className="v2-detail-body v2-new-case">
      <header className="v2-detail-head">
        <h2 className="v2-detail-title">{t.createTitle}</h2>
        <button type="button" className="v2-icon-btn v2-detail-close" aria-label={t.cancel} onClick={onCancel}>
          <X aria-hidden="true" />
        </button>
      </header>
      {!can ? (
        <p className="v2-dim v2-small">{t.readOnly}</p>
      ) : (
        <form
          className="v2-new-case-form"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label className="v2-field">
            <span>{t.createTitleLabel}</span>
            <input
              className="v2-input"
              value={shownTitle}
              maxLength={200}
              onChange={(e) => {
                setEdited(true)
                setTitle(e.target.value)
              }}
            />
          </label>
          <div className="v2-box-head">
            <h3>{t.createPick}</h3>
            <b key={`${chosen.length}-${hosts.length}`} className="v2-tick v2-small">
              {t.createCount(chosen.length, hosts.length)}
            </b>
          </div>
          <p className="v2-dim v2-small">{t.createPickHint}</p>
          {candidates.length === 0 ? (
            <p className="v2-dim v2-small">{t.createNone}</p>
          ) : (
            <ul className="v2-pick-list" data-leaving={leaving || undefined}>
              {candidates.map((a) => {
                const on = !!a.id && picked.has(a.id)
                return (
                  <li key={a.id} data-picked={on}>
                    <label>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setPicked((prev) => {
                            const next = new Set(prev)
                            if (next.has(a.id!)) next.delete(a.id!)
                            else next.add(a.id!)
                            return next
                          })
                        }
                      />
                      <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[a.severity] }}>
                        {dict.v2.sev[a.severity]}
                      </span>
                      <span className="v2-pick-main">
                        <strong>{a.rule_name}</strong>
                        <span className="v2-mono v2-dim">
                          {a.host} · {formatTime(a.timestamp, lang)}
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
          {error && (
            <p className="v2-error" role="alert">
              {error}
            </p>
          )}
          <div className="v2-actions">
            <button type="submit" className="v2-btn v2-btn-primary" disabled={busy || chosen.length === 0 || !shownTitle.trim()}>
              {t.createSubmit}
            </button>
            <button type="button" className="v2-btn" onClick={onCancel}>
              {t.cancel}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
