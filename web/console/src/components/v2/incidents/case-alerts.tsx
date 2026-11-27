'use client'

// The case's alerts still in the console's live window, oldest first,
// each opening in Alertas; the ones that already left the window are
// counted, not hidden.
import { useI18n } from '@/components/console/i18n-provider'
import { useEngine } from '@/components/console/engine-provider'
import { alertKey } from '@/lib/engine-client'
import { formatTime } from '@/lib/console-types'
import type { Incident } from '@/lib/engine-writes'
import { v2AlertLink, techniqueIds } from '@/lib/v2/alerts-model'
import { caseAlerts } from '@/lib/v2/incidents-model'
import { SEV_COLOR } from '../home/parts'

export function CaseAlerts({ incident }: { incident: Incident }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.incidentsView
  const { alerts } = useEngine()
  const list = caseAlerts(incident, alerts)
  const outside = incident.alert_ids.length - list.length

  return (
    <div className="v2-case-alerts">
      {list.length === 0 ? (
        <p className="v2-dim v2-small">{t.noAlerts}</p>
      ) : (
        <ul className="v2-plain-list">
          {list.map((a) => {
            const technique = techniqueIds(a.tags)[0]
            return (
              <li key={alertKey(a)}>
                <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[a.severity] }}>
                  {dict.v2.sev[a.severity]}
                </span>
                <a href={v2AlertLink(alertKey(a))}>{a.rule_name}</a>
                <span className="v2-mono v2-dim">
                  {a.host}
                  {technique ? ` · ${technique}` : ''} · {formatTime(a.timestamp, lang)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {outside > 0 && <p className="v2-dim v2-small">{t.outside(outside)}</p>}
    </div>
  )
}
