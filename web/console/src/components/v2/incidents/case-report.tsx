'use client'

// The case report: a preview of what the exported report says (summary,
// chronology, ATT&CK techniques, hosts, alerts, response plan), its
// sections laid out one after another, and the two exports of the
// classic console: Markdown for a ticket or a wiki, and a printable page
// to save as PDF. Both are built in the browser from the same data.
import { useState } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import { useEngine } from '@/components/console/engine-provider'
import { formatDateTime } from '@/lib/console-types'
import type { Incident } from '@/lib/engine-writes'
import { buildEntityGraph } from '@/lib/entity-graph'
import { buildIncidentHtml, buildIncidentMarkdown, reportFilename, techniques } from '@/lib/incident-report'
import { playbookTemplate, progressOf } from '@/lib/incident-playbook'
import { caseAlerts, caseEvents } from '@/lib/v2/incidents-model'
import { usePlan } from './case-plan'
import { useEntryText } from './parts'

function download(filename: string, contents: string, mime: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function CaseReport({ incident }: { incident: Incident }) {
  const { dict, lang } = useI18n()
  const say = useEntryText()
  const t = dict.v2.incidentsView
  const { alerts, events } = useEngine()
  const { plan } = usePlan(incident.id)
  const [done, setDone] = useState<'md' | 'html' | null>(null)
  const list = caseAlerts(incident, alerts)
  const ttps = techniques(list)
  const template = plan ? playbookTemplate(plan.templateId) : undefined
  const progress = plan && template ? progressOf(plan, template) : null
  const chronology = [...incident.timeline].sort((a, b) => a.at.localeCompare(b.at)).slice(-10)

  function exportAs(kind: 'md' | 'html') {
    const input = { incident, alerts: list, graph: buildEntityGraph(list, caseEvents(incident, events)), playbook: plan ?? undefined, lang }
    if (kind === 'md') download(reportFilename(incident, 'md', lang), buildIncidentMarkdown(input), 'text/markdown;charset=utf-8')
    else download(reportFilename(incident, 'html', lang), buildIncidentHtml(input), 'text/html;charset=utf-8')
    setDone(kind)
    window.setTimeout(() => setDone((d) => (d === kind ? null : d)), 2500)
  }

  return (
    <div className="v2-report">
      <div className="v2-actions">
        <button type="button" className="v2-btn v2-btn-primary" onClick={() => exportAs('md')}>
          {done === 'md' ? `✓ ${t.downloaded}` : t.reportMd}
        </button>
        <button type="button" className="v2-btn" onClick={() => exportAs('html')}>
          {done === 'html' ? `✓ ${t.downloaded}` : t.reportHtml}
        </button>
        <span className="v2-dim v2-small">{t.reportPrintHint}</span>
      </div>
      <article className="v2-paper">
        <header>
          <h3>{incident.title}</h3>
          <p className="v2-dim v2-small v2-mono">
            {incident.id} · {dict.v2.sev[incident.severity]} · {dict.incidents.statusLabels[incident.status]}
            {incident.owner ? ` · ${incident.owner}` : ''} · {formatDateTime(incident.created_at, lang)}
          </p>
        </header>
        <section style={{ ['--i' as string]: 0 }}>
          <h4>{t.sections.summary}</h4>
          <p className={incident.summary ? undefined : 'v2-dim'}>{incident.summary || t.noSummary}</p>
        </section>
        <section style={{ ['--i' as string]: 1 }}>
          <h4>{t.sections.chronology}</h4>
          <ol>
            {chronology.map((e, i) => (
              <li key={`${e.at}${i}`}>
                <span className="v2-mono v2-dim">{formatDateTime(e.at, lang)}</span> {say(e)}
              </li>
            ))}
          </ol>
        </section>
        <section style={{ ['--i' as string]: 2 }}>
          <h4>{t.sections.techniques}</h4>
          <p className="v2-tags">
            {ttps.length ? ttps.map((id) => <span key={id} className="v2-tag v2-mono">{id}</span>) : <span className="v2-dim">—</span>}
          </p>
        </section>
        <section style={{ ['--i' as string]: 3 }}>
          <h4>{t.sections.hosts}</h4>
          <p className="v2-mono">{incident.hosts.length ? incident.hosts.join(' · ') : '—'}</p>
        </section>
        <section style={{ ['--i' as string]: 4 }}>
          <h4>{t.sections.alerts}</h4>
          <ul>
            {list.slice(0, 6).map((a) => (
              <li key={a.id}>
                {dict.v2.sev[a.severity]} · {a.rule_name} · <span className="v2-mono">{a.host}</span>
              </li>
            ))}
          </ul>
          {list.length > 6 && <p className="v2-dim v2-small">{t.moreAlerts(list.length - 6)}</p>}
        </section>
        <section style={{ ['--i' as string]: 5 }}>
          <h4>{t.sections.plan}</h4>
          <p className={progress ? undefined : 'v2-dim'}>
            {progress && template ? `${template.name} · ${t.planProgress(progress.done, progress.total)}` : t.planNone}
          </p>
        </section>
      </article>
    </div>
  )
}
